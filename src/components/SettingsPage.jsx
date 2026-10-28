import { useEffect, useState } from 'react'
import {
  browseFolder,
  getLogs,
  getSettings,
  health,
  openFolder,
  restartTorlnk,
  saveSettings,
  shutdown,
} from '../api.js'

const PLACEHOLDERS = {
  win32: 'C:\\Users\\you\\Downloads\\torlink',
  darwin: '/Users/you/Downloads/torlink',
  linux: '/home/you/Downloads/torlink',
}

function StatusValue({ up, starting, error }) {
  const dot = up ? 'dot-up' : starting ? 'dot-warn' : 'dot-down'
  const label = up ? 'online' : starting ? 'starting…' : 'offline'
  return (
    <span className="status-value" title={error || undefined}>
      <span className={`status-dot ${dot}`} aria-hidden="true" />
      {label}
    </span>
  )
}

export default function SettingsPage() {
  const [downloadDir, setDownloadDir] = useState('')
  const [settingsInfo, setSettingsInfo] = useState(null)
  const [healthInfo, setHealthInfo] = useState(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [stopped, setStopped] = useState(false)
  const [logs, setLogs] = useState(null)
  const [logsError, setLogsError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [s, h] = await Promise.all([getSettings(), health()])
        if (cancelled) return
        setSettingsInfo(s)
        setHealthInfo(h)
        setDownloadDir(s.settings?.downloadDir ?? '')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const flash = (message) => {
    setStatus({ type: 'success', text: message })
    window.setTimeout(() => setStatus((current) => (current?.text === message ? null : current)), 3500)
  }

  const doSave = async (e) => {
    e.preventDefault()
    setBusy('save')
    setError('')
    setStatus(null)
    try {
      const next = await saveSettings({ downloadDir })
      setSettingsInfo(next)
      setDownloadDir(next.settings?.downloadDir ?? '')
      flash('Settings saved. If the folder changed, restart the engine to use it.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  const doBrowse = async () => {
    setBusy('browse')
    setError('')
    setStatus(null)
    try {
      const result = await browseFolder(downloadDir || healthInfo?.defaultDownloadDir || '')
      if (result.path) {
        setDownloadDir(result.path)
        setStatus({ type: 'notice', text: 'Folder selected. Click Save to apply it.' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  const doOpenFolder = async () => {
    setBusy('open')
    setError('')
    setStatus(null)
    try {
      const result = await openFolder(downloadDir || healthInfo?.defaultDownloadDir || '')
      flash(`Opened ${result.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  const doRestart = async () => {
    setBusy('restart')
    setError('')
    setStatus(null)
    try {
      const next = await saveSettings({ downloadDir })
      setSettingsInfo(next)
      setDownloadDir(next.settings?.downloadDir ?? '')
      await restartTorlnk()
      setHealthInfo(await health())
      flash('Engine restarted with the new download folder.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  const doQuit = async () => {
    const ok = window.confirm(
      'Quit Torlink?\n\nDownloads and seeding will stop until you open Torlink again. Files already downloaded are kept.',
    )
    if (!ok) return

    setBusy('quit')
    setError('')
    setStatus(null)
    try {
      await shutdown()
    } catch {
      // The server closes the connection before the response arrives.
    } finally {
      setStopped(true)
      setBusy('')
    }
  }

  const toggleLogs = async () => {
    if (logs) {
      setLogs(null)
      return
    }
    setBusy('logs')
    setLogsError('')
    try {
      setLogs(await getLogs())
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  const platform = healthInfo?.platform ?? settingsInfo?.platform
  const platformLabel = healthInfo?.platformLabel ?? platform ?? 'this computer'
  const defaultDir = healthInfo?.defaultDownloadDir ?? settingsInfo?.defaultDownloadDir ?? ''
  const placeholder = PLACEHOLDERS[platform] ?? '/path/to/downloads'
  const engineUp = !!healthInfo?.torlnk?.up
  const filesUp = !!healthInfo?.files?.up
  const starting = !!healthInfo?.starting && !engineUp && !healthInfo?.engineError
  const filesStarting = !!healthInfo?.starting && !filesUp && !healthInfo?.engineError
  const engineError = healthInfo?.engineError
  const disabled = !!busy || stopped

  const logText =
    [
      logs?.error ? `Engine error: ${logs.error}` : '',
      logs?.serve ? `[serve]\n${logs.serve.trim()}` : '',
      logs?.files ? `[files]\n${logs.files.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n\n') || 'No engine log output yet.'

  return (
    <div>
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-desc">Where Torlink saves files and how the engine runs.</p>
      </header>

      {stopped && (
        <div className="banner success-banner" role="status">
          Torlink has stopped. You can close this tab, or open Torlink again from the Desktop shortcut.
        </div>
      )}
      {error && (
        <div className="banner error-banner" role="alert">
          {error}
        </div>
      )}
      {!stopped && engineError && (
        <div className="banner error-banner" role="alert">
          <div>
            <strong>The Torlink engine is not running.</strong> {engineError}
          </div>
        </div>
      )}
      {status && (
        <div
          className={`banner ${status.type === 'notice' ? 'notice-banner' : 'success-banner'}`}
          role="status"
        >
          {status.text}
        </div>
      )}

      <form className="card" onSubmit={doSave}>
        <h2 className="card-title">Download folder</h2>
        <p className="card-desc">
          Where new torrents are saved. Leave empty to use the default
          {defaultDir ? (
            <>
              {' '}
              (<code>{defaultDir}</code>)
            </>
          ) : null}
          . Changes apply after restarting the Torlink engine.
        </p>
        <div className="field">
          <label htmlFor="download-dir">Folder path</label>
          <div className="field-row">
            <input
              id="download-dir"
              value={downloadDir}
              onChange={(e) => setDownloadDir(e.target.value)}
              placeholder={placeholder}
              spellCheck={false}
              disabled={stopped}
            />
            <button type="button" className="btn" onClick={doBrowse} disabled={disabled}>
              {busy === 'browse' ? 'Choosing…' : 'Browse…'}
            </button>
            <button type="button" className="btn" onClick={doOpenFolder} disabled={disabled}>
              {busy === 'open' ? 'Opening…' : 'Open folder'}
            </button>
          </div>
          <p className="field-hint">
            Tip: paste a path with quotes from Explorer and Torlink will clean it up. The folder
            is created if it does not exist.
          </p>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={disabled}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn" onClick={doRestart} disabled={disabled}>
            {busy === 'restart' ? 'Restarting…' : 'Save & restart engine'}
          </button>
        </div>
      </form>

      <div className="card">
        <h2 className="card-title">Engine</h2>
        <p className="card-desc">The Torlink daemon and file server behind this app.</p>
        <table className="kv-table">
          <tbody>
            <tr>
              <td className="kv-key">Engine</td>
              <td className="kv-val">
                <StatusValue up={engineUp} starting={starting} error={engineError} />
              </td>
            </tr>
            <tr>
              <td className="kv-key">Files server</td>
              <td className="kv-val">
                <StatusValue up={filesUp} starting={filesStarting} error={engineError} />
              </td>
            </tr>
            <tr>
              <td className="kv-key">Engine version</td>
              <td className="kv-val">{healthInfo?.version ? `v${healthInfo.version}` : '—'}</td>
            </tr>
            <tr>
              <td className="kv-key">Platform</td>
              <td className="kv-val">
                {platformLabel}
                {healthInfo?.arch ? ` (${healthInfo.arch})` : ''}
              </td>
            </tr>
            <tr>
              <td className="kv-key">Node.js</td>
              <td className="kv-val">{healthInfo?.node ?? '—'}</td>
            </tr>
            <tr>
              <td className="kv-key">Engine binary</td>
              <td className="kv-val">{healthInfo?.torlnkBin ?? '—'}</td>
            </tr>
            <tr>
              <td className="kv-key">Settings file</td>
              <td className="kv-val">{healthInfo?.settingsFile ?? '—'}</td>
            </tr>
          </tbody>
        </table>

        <div className="form-actions card-actions">
          <button type="button" className="btn btn-sm" onClick={toggleLogs} disabled={!!busy || stopped}>
            {logs ? 'Hide recent logs' : busy === 'logs' ? 'Loading logs…' : 'Show recent logs'}
          </button>
        </div>
        {logsError && (
          <div className="banner error-banner" role="alert">
            {logsError}
          </div>
        )}
        {logs && <pre className="log-view">{logText}</pre>}
      </div>

      <div className="card">
        <h2 className="card-title">Quit Torlink</h2>
        <p className="card-desc">
          Stops the local server, the torrent engine and seeding. Files already downloaded stay on
          disk.
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-danger" onClick={doQuit} disabled={disabled}>
            {busy === 'quit' ? 'Quitting…' : 'Quit Torlink'}
          </button>
        </div>
      </div>
    </div>
  )
}
