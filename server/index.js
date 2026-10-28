import express from 'express'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn, execFile } from 'node:child_process'
import { join } from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  torlnk,
  SERVE_URL,
  FILES_URL,
  SERVE_PORT,
  FILES_PORT,
  torlnkBinLabel,
  resolveTorlnkBin,
} from './torlnk.js'
import { searchAll, buildMagnetFromHash, SOURCES } from './search.js'
import {
  defaultDownloadDir,
  isWindows,
  legacySettingsDir,
  normalizeDownloadDir,
  settingsDir,
} from './paths.js'

const PORT = Number(process.env.TORLINK_GUI_PORT) || 4040
const SETTINGS_DIR = settingsDir()
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json')
const LEGACY_SETTINGS_DIR = legacySettingsDir()
const LEGACY_SETTINGS_FILE =
  LEGACY_SETTINGS_DIR && LEGACY_SETTINGS_DIR !== SETTINGS_DIR
    ? join(LEGACY_SETTINGS_DIR, 'settings.json')
    : null
const DEFAULT_DOWNLOAD_DIR = defaultDownloadDir()
const APP_VERSION = process.env.npm_package_version || '1.0.0'

const defaultSettings = { downloadDir: '' }

let settings = { ...defaultSettings }

async function loadSettings() {
  const candidates = [SETTINGS_FILE, LEGACY_SETTINGS_FILE].filter(Boolean)
  for (const file of candidates) {
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = JSON.parse(raw)
      settings = {
        ...defaultSettings,
        downloadDir: normalizeDownloadDir(parsed?.downloadDir),
      }
      if (file !== SETTINGS_FILE) await saveSettings()
      return
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        console.warn(`[torlink-gui] Could not read settings from ${file}: ${err.message}`)
      }
    }
  }
  settings = { ...defaultSettings }
}

async function saveSettings() {
  await mkdir(SETTINGS_DIR, { recursive: true })
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

function effectiveDownloadDir() {
  return settings.downloadDir || DEFAULT_DOWNLOAD_DIR
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function torlnkUp() {
  try {
    const res = await fetch(`${SERVE_URL}/health`, { signal: AbortSignal.timeout(1500) })
    if (res.ok) return await res.json()
  } catch {}
  return null
}

async function filesUp() {
  try {
    const res = await fetch(`${FILES_URL}/`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

async function waitFor(check, { timeoutMs, intervalMs = 300, failFast } = {}) {
  const started = Date.now()
  for (;;) {
    if (await check()) return true
    if (failFast?.()) return false
    if (Date.now() - started >= timeoutMs) return false
    await sleep(intervalMs)
  }
}

// Starting the engine can take a few seconds on the first run (the binary is
// already installed, but WebTorrent initialises native helpers). The wait is
// shared between the startup and the restart button so two clicks can't spawn
// duplicate engines.
let ensurePromise = null
let engineRestarts = 0
let restartTimer = null
let shuttingDown = false

async function ensureTorlnk() {
  if (ensurePromise) return ensurePromise
  ensurePromise = (async () => {
    if (!(await torlnkUp())) {
      torlnk.startServe(settings.downloadDir)
      const ok = await waitFor(torlnkUp, {
        timeoutMs: 90_000,
        failFast: () => !torlnk.isRunning('serve') && !!torlnk.lastError,
      })
      if (!ok && !(await torlnkUp())) {
        throw new Error(torlnk.lastError || 'The Torlink engine did not start.')
      }
    }
    if (!(await filesUp())) {
      torlnk.startFiles(settings.downloadDir)
      const ok = await waitFor(filesUp, {
        timeoutMs: 30_000,
        failFast: () => !torlnk.isRunning('files') && !!torlnk.lastError,
      })
      if (!ok && !(await filesUp())) {
        throw new Error(torlnk.lastError || 'The Torlink files server did not start.')
      }
    }
    return { serve: await torlnkUp(), files: await filesUp() }
  })().finally(() => {
    ensurePromise = null
  })
  return ensurePromise
}

function scheduleEngineRestart() {
  if (shuttingDown) return
  if (engineRestarts >= 3) return
  engineRestarts += 1
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    if (shuttingDown) return
    ensureTorlnk()
      .then(() => {
        engineRestarts = 0
      })
      .catch((err) => {
        console.warn(`[torlink-gui] Engine restart failed: ${err.message}`)
      })
  }, 2000 * engineRestarts)
  restartTimer.unref?.()
}

torlnk.on('serve-exit', ({ intentional }) => {
  if (!intentional) scheduleEngineRestart()
})
torlnk.on('files-exit', ({ intentional }) => {
  if (!intentional) scheduleEngineRestart()
})

function openPath(target) {
  const command = isWindows ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    const child = spawn(command, [target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

const execFileAsync = promisify(execFile)

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

async function pickFolderWindows(initial) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.Opacity = 0
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Show()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose where Torlink saves downloads'
$dialog.ShowNewFolderButton = $true
$initial = ${psQuote(initial)}
if ($initial -and (Test-Path -LiteralPath $initial)) { $dialog.SelectedPath = $initial }
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::Out.Write($dialog.SelectedPath)
}
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout: 10 * 60 * 1000, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
  )
  return stdout.trim() || null
}

async function pickFolderMac(initial) {
  const defaultLocation = initial && existsSync(initial) ? ` default location POSIX file ${psQuoteMac(initial)}` : ''
  const script = `POSIX path of (choose folder with prompt "Choose where Torlink saves downloads"${defaultLocation})`
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    })
    return stdout.trim() || null
  } catch (err) {
    if (/User canceled|-128/i.test(String(err?.stderr ?? err?.message ?? ''))) return null
    throw err
  }
}

function psQuoteMac(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function pickFolderLinux(initial) {
  const attempts = [
    ['zenity', ['--file-selection', '--directory', '--title=Choose where Torlink saves downloads', `--filename=${initial || os.homedir()}/`]],
    ['kdialog', ['--getexistingdirectory', initial || os.homedir()]],
  ]
  let lastError = null
  for (const [command, args] of attempts) {
    try {
      const { stdout } = await execFileAsync(command, args, {
        timeout: 10 * 60 * 1000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
      })
      return stdout.trim() || null
    } catch (err) {
      if (err?.code === 'ENOENT') {
        lastError = err
        continue
      }
      // A non-zero exit is how zenity/kdialog report "Cancel".
      return null
    }
  }
  throw lastError ?? new Error('No folder picker is available on this system.')
}

async function pickFolder(initial) {
  if (isWindows) return pickFolderWindows(initial)
  if (process.platform === 'darwin') return pickFolderMac(initial)
  return pickFolderLinux(initial)
}

const app = express()
app.use(express.json({ limit: '1mb' }))

// The app listens on loopback only. Checking Host defends against DNS
// rebinding, and the Origin allow-list stops other websites from driving the
// local API (add/delete/shutdown) in the user's browser.
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  `http://[::1]:${PORT}`,
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://[::1]:5173',
])

app.use((req, res, next) => {
  const host = req.hostname
  if (!ALLOWED_HOSTS.has(host)) {
    return res.status(403).json({ error: 'This server only accepts local requests.' })
  }
  const origin = req.headers.origin
  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({ error: 'Origin not allowed.' })
    }
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,HEAD,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/api/health', async (_req, res) => {
  const [serve, files] = await Promise.all([torlnkUp(), filesUp()])
  res.json({
    ok: true,
    version: serve?.version ?? null,
    appVersion: APP_VERSION,
    torlnkBin: torlnkBinLabel(),
    torlnkResolved: !!resolveTorlnkBin(),
    engineError: serve && files ? null : torlnk.lastError,
    starting: !!ensurePromise,
    torlnk: { up: !!serve, version: serve?.version ?? null },
    files: { up: files },
    platform: process.platform,
    platformLabel:
      process.platform === 'win32'
        ? 'Windows'
        : process.platform === 'darwin'
          ? 'macOS'
          : process.platform === 'linux'
            ? 'Linux'
            : process.platform,
    arch: process.arch,
    node: process.version,
    defaultDownloadDir: DEFAULT_DOWNLOAD_DIR,
    downloadDir: effectiveDownloadDir(),
    settingsFile: SETTINGS_FILE,
    ports: { app: PORT, serve: SERVE_PORT, files: FILES_PORT },
  })
})

app.get('/api/sources', (_req, res) => {
  res.json({ sources: SOURCES })
})

app.get('/api/logs', (_req, res) => {
  res.json({
    error: torlnk.lastError,
    serve: torlnk.logTail('serve'),
    files: torlnk.logTail('files'),
  })
})

app.get('/api/search', async (req, res) => {
  const q = (req.query.q ?? '').toString().trim()

  // Stream results as newline-delimited JSON so the UI can show each
  // source's status the moment it finishes instead of freezing until the
  // slowest source (or timeout) resolves. Old clients that expect a single
  // JSON object still work: this route only responds to ndjson once the
  // client advertises it (the new frontend always does).
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.flushHeaders()

  const controller = new AbortController()
  req.on('close', () => controller.abort())
  const safeWrite = (line) => {
    try {
      res.write(line)
      return true
    } catch {
      return false
    }
  }

  safeWrite(JSON.stringify({ type: 'start', query: q }) + '\n')
  try {
    const { results, perSource } = await searchAll(q, {
      timeoutMs: 8000,
      controller,
      onSource: (id, info) =>
        safeWrite(JSON.stringify({ type: 'source', id, ...info }) + '\n'),
    })
    safeWrite(JSON.stringify({ type: 'done', query: q, results, perSource }) + '\n')
  } catch (err) {
    safeWrite(
      JSON.stringify({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      }) + '\n',
    )
  } finally {
    if (!res.writableEnded) res.end()
  }
})

app.post('/api/add', async (req, res) => {
  const { magnet, infoHash } = req.body ?? {}
  const value = (magnet ?? '').toString().trim()
  let payload = value
  if (!payload && infoHash) {
    const built = buildMagnetFromHash(infoHash.toString().trim())
    if (!built) return res.status(400).json({ error: 'invalid info hash' })
    payload = built
  }
  if (!payload) return res.status(400).json({ error: 'missing magnet or info hash' })
  if (!(await torlnkUp())) {
    return res.status(503).json({ error: torlnk.lastError || 'The Torlink engine is not reachable yet.' })
  }
  try {
    const r = await fetch(`${SERVE_URL}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnet: payload }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await r.json().catch(() => ({}))
    res.status(r.status).json(data)
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/downloads', async (_req, res) => {
  if (!(await torlnkUp())) {
    return res.status(503).json({ error: torlnk.lastError || 'The Torlink engine is not reachable yet.' })
  }
  try {
    const r = await fetch(`${SERVE_URL}/downloads`, { signal: AbortSignal.timeout(5000) })
    res.status(r.status).json(await r.json().catch(() => ({})))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/control', async (req, res) => {
  const { id, action, deleteFiles } = req.body ?? {}
  if (!id || !action) return res.status(400).json({ error: 'missing id or action' })
  if (!(await torlnkUp())) {
    return res.status(503).json({ error: torlnk.lastError || 'The Torlink engine is not reachable yet.' })
  }
  try {
    const r = await fetch(`${SERVE_URL}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, deleteFiles }),
      signal: AbortSignal.timeout(5000),
    })
    res.status(r.status).json(await r.json().catch(() => ({})))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/files', async (req, res) => {
  if (!(await filesUp())) {
    return res.status(503).json({ error: torlnk.lastError || 'The Torlink files server is not reachable yet.' })
  }
  const rel = (req.query.path ?? '').toString().split('/').filter(Boolean).map(encodeURIComponent).join('/')
  const target = `${FILES_URL}/${rel}`
  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(5000) })
    res.status(r.status).json(await r.json().catch(() => ({})))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

async function proxyFile(req, res) {
  const raw = req.params[0] || ''
  const urlPath = raw && raw !== '/' ? `/${raw.replace(/^\/+/, '').replace(/\/$/, '')}` : '/'
  const target = `${FILES_URL}${encodePath(urlPath)}`
  const headers = {}
  const range = req.headers.range
  if (range) headers.range = range

  // No overall timeout here: a movie stream is supposed to stay open for
  // minutes. The abort controller only fires when the browser goes away.
  const controller = new AbortController()
  res.on('close', () => controller.abort())

  try {
    const r = await fetch(target, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      signal: controller.signal,
    })
    res.status(r.status)
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      const value = r.headers.get(header)
      if (value) res.setHeader(header, value)
    }
    if (!r.body || req.method === 'HEAD') return res.end()
    try {
      await pipeline(Readable.fromWeb(r.body), res)
    } catch (err) {
      // Browsers close video connections all the time (seeking, tab closed).
      if (err?.code !== 'ERR_STREAM_PREMATURE_CLOSE' && !res.destroyed) res.destroy(err)
    }
  } catch (err) {
    if (controller.signal.aborted) return
    if (!res.headersSent) res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
    else res.end()
  }
}

app.get('/files/*', proxyFile)
app.head('/files/*', proxyFile)

// Declared as `encodeURI` before, which shadowed the global for this whole
// module. Anything else here calling encodeURI() would have gotten this.
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/')
}

app.get('/api/settings', (_req, res) => {
  res.json({
    settings,
    effectiveDownloadDir: effectiveDownloadDir(),
    defaultDownloadDir: DEFAULT_DOWNLOAD_DIR,
    platform: process.platform,
  })
})

app.post('/api/settings', async (req, res) => {
  const raw = req.body?.downloadDir
  settings.downloadDir = typeof raw === 'string' ? normalizeDownloadDir(raw) : ''
  await saveSettings()
  res.json({
    settings,
    effectiveDownloadDir: effectiveDownloadDir(),
    defaultDownloadDir: DEFAULT_DOWNLOAD_DIR,
    platform: process.platform,
  })
})

app.post('/api/open-folder', async (req, res) => {
  const target = normalizeDownloadDir(req.body?.path) || effectiveDownloadDir()
  try {
    await mkdir(target, { recursive: true })
    const opened = openPath(target)
    if (!opened) return res.status(500).json({ error: `Could not open ${target}` })
    res.json({ ok: true, path: target })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/browse-folder', async (req, res) => {
  const initial = normalizeDownloadDir(req.body?.path) || effectiveDownloadDir()
  try {
    const picked = await pickFolder(initial)
    res.json({ path: picked, cancelled: !picked })
  } catch (err) {
    res.status(501).json({
      error: `Could not open a folder picker: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
})

app.post('/api/restart-torlnk', async (_req, res) => {
  engineRestarts = 0
  clearTimeout(restartTimer)
  await torlnk.stopAll()
  await sleep(300)
  try {
    const state = await ensureTorlnk()
    res.json({ ok: true, ...state, status: torlnk.status() })
  } catch (err) {
    res.status(503).json({
      error: err instanceof Error ? err.message : String(err),
      engineError: torlnk.lastError,
      status: torlnk.status(),
    })
  }
})

app.post('/api/shutdown', (_req, res) => {
  res.json({ ok: true })
  setTimeout(() => {
    void shutdown(0)
  }, 150)
})

const distDir = fileURLToPath(new URL('../dist', import.meta.url))
const distIndex = join(distDir, 'index.html')
app.use(express.static(distDir))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/files')) return next()
  if (!existsSync(distIndex)) {
    return res
      .status(503)
      .type('text/plain')
      .send(
        'Torlink GUI is not built yet.\n\n' +
          'Run:\n  npm install\n  npm run build\n  npm start\n\n' +
          'On Windows, double-click "Torlink.vbs" or run "Setup Torlink.bat".\n',
      )
  }
  res.sendFile(distIndex)
})

let server = null

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  clearTimeout(restartTimer)
  try {
    await torlnk.stopAll()
  } catch {}
  if (server) {
    server.close(() => process.exit(code))
    setTimeout(() => process.exit(code), 2000).unref?.()
  } else {
    process.exit(code)
  }
}

await loadSettings()

server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[torlink-gui] Ready on http://127.0.0.1:${PORT}`)
  console.log(`[torlink-gui] Download folder: ${effectiveDownloadDir()}`)
})

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(
      `[torlink-gui] Port ${PORT} is already in use. Another copy of Torlink GUI may be running.\n` +
        `Open http://127.0.0.1:${PORT} or close the program using that port.`,
    )
  } else {
    console.error('[torlink-gui] Server error:', err)
  }
  process.exit(1)
})

ensureTorlnk()
  .then(() => {
    engineRestarts = 0
    console.log('[torlink-gui] Torlink engine is ready.')
  })
  .catch((err) => {
    console.warn(`[torlink-gui] Torlink engine is not ready: ${err.message}`)
  })

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    void shutdown(0)
  })
}
