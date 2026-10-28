import { useMemo, useState } from 'react'
import { downloads, control } from '../api.js'
import { formatBytes, statusLabel, statusClass } from '../format.js'
import { usePolling } from '../usePolling.js'

export default function SeedsPage() {
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

  // The third argument used to be dropped, so "Remove" never forwarded
  // deleteFiles and left the data on disk while disappearing from the list.
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

  const seeds = useMemo(() => data?.seeds ?? [], [data])

  return (
    <div>
      <header className="page-header">
        <h1 className="page-title">Seeds</h1>
        <p className="page-desc">Completed torrents you are giving back to the swarm.</p>
      </header>

      {error && (
        <div className="banner error-banner" role="alert">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="empty">
          <div className="spinner" aria-hidden="true" />
          <div>Loading seeds…</div>
        </div>
      )}

      {data && seeds.length === 0 && (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            🌱
          </div>
          <div>Not seeding anything right now.</div>
          <div className="sub">Finished downloads seed automatically.</div>
        </div>
      )}

      {seeds.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" className="num-right">
                    Uploaded
                  </th>
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
                {seeds.map((t) => (
                  <tr key={t.id}>
                    <td className="result-name">
                      <div className="result-title" title={t.name}>
                        {t.name}
                      </div>
                    </td>
                    <td className="num num-right">{formatBytes(t.uploaded)}</td>
                    <td className="num num-right">{t.peers ?? '—'}</td>
                    <td>
                      {/* torlnk reports real per-seed status (e.g. "paused");
                          painting every row green hid that. */}
                      <span className={`status-pill ${statusClass(t.status)}`}>{statusLabel(t.status)}</span>
                    </td>
                    <td className="actions-cell">
                      <button
                        className="btn btn-sm"
                        disabled={busy[`${t.id}-stop-seed`]}
                        onClick={() => act(t.id, 'stop-seed')}
                      >
                        <span className="btn-label-icon" aria-hidden="true">
                          ⏹
                        </span>
                        Stop seeding
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busy[`${t.id}-delete`]}
                        onClick={() => act(t.id, 'delete', { deleteFiles: true })}
                      >
                        <span className="btn-label-icon" aria-hidden="true">
                          🗑
                        </span>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
