import { useMemo, useState } from 'react'
import { downloads, control } from '../api.js'
import { formatBytes, formatSpeed, statusLabel, statusClass } from '../format.js'
import AddMagnet from './AddMagnet.jsx'
import { usePolling } from '../usePolling.js'

// torlnk may report progress as a 0..1 fraction or, in some builds, as a
// 0..100 percentage. Normalize so the bar is never mis-scaled.
function clampProgress(p) {
  if (!Number.isFinite(p)) return 0
  if (p > 1) p = p / 100
  return Math.max(0, Math.min(1, p))
}

export default function DownloadsPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState({})

  usePolling(async () => {
    try {
      const d = await downloads()
      setData(d)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, 1000)

  const act = async (id, action, opts = {}) => {
    setBusy((b) => ({ ...b, [`${id}-${action}`]: true }))
    try {
      await control(id, action, opts.deleteFiles)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy((b) => ({ ...b, [`${id}-${action}`]: false }))
    }
  }

  const items = useMemo(() => data?.downloads ?? [], [data])

  return (
    <div>
      <header className="page-header">
        <h1 className="page-title">Downloads</h1>
        <p className="page-desc">Active torrents. Progress refreshes automatically.</p>
      </header>

      <div className="mb-3">
        <AddMagnet />
      </div>

      {error && (
        <div className="banner error-banner" role="alert">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="empty">
          <div className="spinner" aria-hidden="true" />
          <div>Loading downloads…</div>
        </div>
      )}

      {data && items.length === 0 && (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            ⬇
          </div>
          <div>No active downloads.</div>
          <div className="sub">Paste a magnet or search the catalog to get started.</div>
        </div>
      )}

      {items.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Down</th>
                  <th scope="col" className="num-right">
                    Peers
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num-right">
                    Actions
                  </th>
                </tr>
              </thead>
            <tbody>
              {items.map((t) => {
                const pct = Math.round(clampProgress(t.progress) * 100)
                const done = pct >= 100
                const idle =
                  pct === 0 &&
                  (t.status === 'downloading' || t.status === 'metadata' || t.status === 'checking')
                return (
                  <tr key={t.id}>
                    <td className="result-name">
                      <div className="result-title" title={t.name}>
                        {t.name}
                      </div>
                      {t.size ? <div className="result-meta">{formatBytes(t.size)} total</div> : null}
                    </td>
                    <td className="progress-cell">
                      <div className="progress-row">
                        <div
                          className="progress-bar"
                          role="progressbar"
                          aria-label="Download progress"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className={`progress-fill ${done ? 'done' : ''} ${idle ? 'zero' : ''}`}
                            style={idle ? undefined : { width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="progress-pct">{idle ? '…' : `${pct}%`}</span>
                      </div>
                    </td>
                    <td className="num">{formatSpeed(t.speed)}</td>
                    <td className="num num-right">{t.peers ?? '—'}</td>
                    <td>
                      <span className={`status-pill ${statusClass(t.status)}`}>{statusLabel(t.status)}</span>
                    </td>
                    <td className="actions-cell">
                      {t.status === 'paused' ? (
                        <button
                          className="btn btn-sm"
                          disabled={busy[`${t.id}-resume`]}
                          onClick={() => act(t.id, 'resume')}
                        >
                          <span className="btn-label-icon" aria-hidden="true">
                            ▶
                          </span>
                          Resume
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm"
                          disabled={busy[`${t.id}-pause`]}
                          onClick={() => act(t.id, 'pause')}
                        >
                          <span className="btn-label-icon" aria-hidden="true">
                            ⏸
                          </span>
                          Pause
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busy[`${t.id}-delete`]}
                        onClick={() => act(t.id, 'delete', { deleteFiles: true })}
                      >
                        <span className="btn-label-icon" aria-hidden="true">
                          🗑
                        </span>
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
