import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { globalTorlnkCandidates, isWindows, npxCacheDirs } from './paths.js'

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const SERVE_PORT = 9161
export const FILES_PORT = 9160

function localTorlnk() {
  const candidate = join(APP_ROOT, 'node_modules', 'torlnk', 'dist', 'cli.cjs')
  return existsSync(candidate) ? candidate : null
}

function npxCacheBin() {
  let best = null
  let bestMtime = 0
  for (const root of npxCacheDirs()) {
    let entries = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const dir of entries) {
      const candidate = join(root, dir, 'node_modules', 'torlnk', 'dist', 'cli.cjs')
      if (!existsSync(candidate)) continue
      let mtime = 0
      try {
        mtime = statSync(candidate).mtimeMs
      } catch {
        continue
      }
      if (mtime > bestMtime) {
        bestMtime = mtime
        best = candidate
      }
    }
  }
  return best
}

function globalBin() {
  for (const candidate of globalTorlnkCandidates()) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

// Search order:
//   1. explicit override (for power users / tests)
//   2. the torlnk dependency installed by `npm install`
//   3. the newest copy in npx's cache
//   4. a global npm install
export function resolveTorlnkBin() {
  const override = process.env.TORLINK_BIN
  if (override && existsSync(override)) return override
  return localTorlnk() ?? npxCacheBin() ?? globalBin() ?? null
}

export function torlnkBinLabel() {
  const bin = resolveTorlnkBin()
  return bin ? `node ${bin}` : 'npx torlnk'
}

// `npx` itself can be a .cmd file on Windows, which Node refuses to spawn
// without a shell. Running npm's npx-cli.js with the current Node avoids that
// problem and keeps paths with spaces intact.
function resolveNpxCli() {
  const candidates = []
  if (process.env.npm_execpath && /npm-cli\.c?js$/i.test(process.env.npm_execpath)) {
    candidates.push(join(dirname(process.env.npm_execpath), 'npx-cli.js'))
  }
  const execDir = dirname(process.execPath || 'node')
  candidates.push(join(execDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'))
  candidates.push(join(execDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'))
  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npx-cli.js'))
  }
  if (process.env.ProgramFiles) {
    candidates.push(join(process.env.ProgramFiles, 'nodejs', 'node_modules', 'npm', 'bin', 'npx-cli.js'))
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function quoteForCmd(value) {
  const s = String(value)
  return /[\s"&|<>^()%!]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function waitForExit(proc, ms) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve(true)
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      proc.off('exit', onExit)
      resolve(ok)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(proc.exitCode !== null), ms)
    proc.once('exit', onExit)
  })
}

async function stopProcess(proc) {
  if (!proc || proc.exitCode !== null) return
  // Closing the pipes first keeps a killed child from leaving listeners behind.
  try {
    proc.stdout?.destroy()
    proc.stderr?.destroy()
  } catch {}

  try {
    if (isWindows) {
      // torlnk may be started through npx, which has child processes of its
      // own. /T kills the whole tree; /F makes it reliable for hidden windows.
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      await new Promise((resolve) => {
        killer.once('exit', resolve)
        killer.once('error', resolve)
      })
    } else {
      proc.kill('SIGTERM')
    }
  } catch {}

  if (await waitForExit(proc, 3000)) return
  try {
    proc.kill('SIGKILL')
  } catch {}
  await waitForExit(proc, 2000)
}

class TorlnkManager extends EventEmitter {
  constructor() {
    super()
    this.serve = null
    this.files = null
    this.startedAt = null
    this.serveLog = []
    this.filesLog = []
    this.lastError = null
    this.stopping = false
  }

  bin() {
    return resolveTorlnkBin()
  }

  isRunning(kind) {
    const proc = kind === 'files' ? this.files : this.serve
    return !!(proc && proc.exitCode === null && !proc.killed)
  }

  spawnCommand(args, log) {
    const bin = this.bin()
    const options = {
      cwd: APP_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      // NO_COLOR keeps the engine's TUI colours out of the log file when the
      // app is launched without a console on Windows.
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      windowsHide: true,
    }

    let child
    if (bin) {
      // When a bundled/cached/global torlnk binary exists, run it with this
      // Node. This is the normal Windows path.
      child = spawn(process.execPath || 'node', [bin, ...args], options)
    } else {
      // Fall back to npx only if the dependency is missing (for example a
      // partial `npm install`). Prefer npm's JS entry point over npx.cmd.
      const npxCli = resolveNpxCli()
      if (npxCli) {
        child = spawn(process.execPath || 'node', [npxCli, '--yes', 'torlnk', ...args], options)
      } else if (isWindows) {
        const command = ['npx', '--yes', 'torlnk', ...args].map(quoteForCmd).join(' ')
        child = spawn(command, { ...options, shell: true })
      } else {
        child = spawn('npx', ['--yes', 'torlnk', ...args], options)
      }
    }

    const record = (d) => {
      const text = String(d)
      log.push(text)
      while (log.length > 200) log.shift()
      this.emit('log', text)
    }
    child.stdout?.on('data', record)
    child.stderr?.on('data', record)
    child.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err)
      this.lastError = `Could not start torlnk: ${message}`
      record(`[torlnk] spawn error: ${message}\n`)
      this.emit('spawn-error', err)
    })
    return child
  }

  startServe(downloadDir) {
    if (this.isRunning('serve')) return this.serve
    this.stopping = false
    this.lastError = null
    const args = ['serve', '--port', String(SERVE_PORT), '--host', '127.0.0.1']
    const dir = typeof downloadDir === 'string' ? downloadDir.trim() : ''
    if (dir) args.push('--to', dir)
    const child = this.spawnCommand(args, this.serveLog)
    this.serve = child
    this.startedAt = Date.now()
    child.on('exit', (code, signal) => {
      if (this.serve === child) this.serve = null
      if (!this.stopping) {
        const tail = this.logTail('serve').trim().split('\n').slice(-3).join(' ')
        this.lastError = `Torlink engine stopped (${signal ?? `exit ${code}`}).${tail ? ` ${tail}` : ''}`
      }
      this.emit('serve-exit', { code, signal, intentional: this.stopping })
    })
    return child
  }

  startFiles(dir) {
    if (this.isRunning('files')) return this.files
    this.stopping = false
    const args = ['files', '--port', String(FILES_PORT), '--host', '127.0.0.1']
    const target = typeof dir === 'string' ? dir.trim() : ''
    if (target) args.push('--dir', target)
    const child = this.spawnCommand(args, this.filesLog)
    this.files = child
    child.on('exit', (code, signal) => {
      if (this.files === child) this.files = null
      if (!this.stopping && !this.lastError) {
        const tail = this.logTail('files').trim().split('\n').slice(-3).join(' ')
        this.lastError = `Torlink files server stopped (${signal ?? `exit ${code}`}).${tail ? ` ${tail}` : ''}`
      }
      this.emit('files-exit', { code, signal, intentional: this.stopping })
    })
    return child
  }

  logTail(kind, maxChars = 4000) {
    const log = kind === 'files' ? this.filesLog : this.serveLog
    return log.join('').slice(-maxChars)
  }

  async stopAll() {
    this.stopping = true
    const procs = [this.serve, this.files]
    this.serve = null
    this.files = null
    await Promise.all(procs.map((proc) => stopProcess(proc)))
  }

  status() {
    return {
      serve: this.isRunning('serve'),
      files: this.isRunning('files'),
      starting: false,
      error: this.lastError,
      bin: torlnkBinLabel(),
      startedAt: this.startedAt,
    }
  }
}

export const torlnk = new TorlnkManager()
export const SERVE_URL = `http://127.0.0.1:${SERVE_PORT}`
export const FILES_URL = `http://127.0.0.1:${FILES_PORT}`
