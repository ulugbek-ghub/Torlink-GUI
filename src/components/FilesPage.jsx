import { useCallback, useEffect, useState } from 'react'
import { listFiles } from '../api.js'
import { formatBytes } from '../format.js'

function streamUrl(path) {
  const rel = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  return rel ? `/files/${rel}` : '/files/'
}

export default function FilesPage() {
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async (p) => {
    setEntries(null)
    setError('')
    try {
      const q = p ? `?path=${encodeURIComponent(p)}` : ''
      const d = await listFiles(q)
      setEntries(d.entries ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    load(path)
  }, [load, path])

  const dirs = (entries ?? []).filter((e) => e.type === 'dir')
  const files = (entries ?? []).filter((e) => e.type === 'file')
  const crumbs = path.split('/').filter(Boolean)

  return (
    <div>
      <header className="page-header">
        <h1 className="page-title">Files</h1>
        <p className="page-desc">
          Finished downloads from the Torlink files server. Click a file to stream it in your
          browser.
        </p>
      </header>

      <div className="crumbs">
        <button className="btn btn-sm" onClick={() => setPath('')} disabled={!path}>
          <span className="btn-label-icon" aria-hidden="true">
            ↰
          </span>
          Back
        </button>
        <nav className="crumbs-text" aria-label="Folder path">
          {crumbs.length ? (
            <>
              <button type="button" className="link" onClick={() => setPath('')}>
                root
              </button>
              {crumbs.map((c, i) => {
                const sub = crumbs.slice(0, i + 1).join('/')
                return (
                  <span key={sub}>
                    {' / '}
                    <button type="button" className="link" onClick={() => setPath(sub)}>
                      {c}
                    </button>
                  </span>
                )
              })}
            </>
          ) : (
            'root'
          )}
        </nav>
      </div>

      {error && (
        <div className="banner error-banner" role="alert">
          {error}
        </div>
      )}

      {!entries && !error && (
        <div className="empty">
          <div className="spinner" aria-hidden="true" />
          <div>Loading…</div>
        </div>
      )}

      {entries && dirs.length === 0 && files.length === 0 && (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            📁
          </div>
          <div>This folder is empty.</div>
          <div className="sub">Finished downloads will appear here.</div>
        </div>
      )}

      {(dirs.length > 0 || files.length > 0) && (
        <div className="table-wrap">
          {dirs.map((d) => (
            <div key={d.name} className="file-entry">
              <div className="file-name">
                <span aria-hidden="true">📂</span>
                <button
                  type="button"
                  className="link"
                  onClick={() => setPath(path ? `${path}/${d.name}` : d.name)}
                >
                  {d.name}
                </button>
              </div>
              <span className="sub">Folder</span>
            </div>
          ))}
          {files.map((f) => {
            const full = path ? `${path}/${f.name}` : f.name
            return (
              <div key={f.name} className="file-entry">
                <div className="file-name">
                  <span aria-hidden="true">🎬</span>
                  <a href={streamUrl(full)} target="_blank" rel="noreferrer" title="Stream in browser">
                    {f.name}
                  </a>
                </div>
                <div className="file-meta">
                  <span className="sub">{formatBytes(f.size)}</span>
                  <a
                    className="btn btn-sm"
                    href={streamUrl(full)}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in a new tab"
                  >
                    <span className="btn-label-icon" aria-hidden="true">
                      ▶
                    </span>
                    Open
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
