import { useState } from 'react'
import { health } from '../api.js'
import { usePolling } from '../usePolling.js'

export default function Sidebar({ pages, active, onNavigate }) {
  const [healthInfo, setHealthInfo] = useState(null)

  usePolling(async () => {
    try {
      setHealthInfo(await health())
    } catch {
      setHealthInfo(null)
    }
  }, 5000)

  const serve = healthInfo?.torlnk?.up
  const files = healthInfo?.files?.up
  const starting = !!healthInfo?.starting && !healthInfo?.engineError
  const serveStarting = starting && !serve
  const filesStarting = starting && !files
  const serveLabel = serve ? 'online' : serveStarting ? 'starting…' : 'offline'
  const filesLabel = files ? 'online' : filesStarting ? 'starting…' : 'offline'
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">🌀</div>
        <div>
          <div className="brand-name">Torlink</div>
          <div className="brand-sub">
            {healthInfo?.version ? `v${healthInfo.version}` : 'web client'}
          </div>
        </div>
      </div>

      <nav className="nav" aria-label="Primary">
        {pages.map((p) => (
          <button
            key={p.id}
            className={`nav-item ${active === p.id ? 'active' : ''}`}
            aria-current={active === p.id ? 'page' : undefined}
            onClick={() => onNavigate(p.id)}
          >
            <span className="nav-icon" aria-hidden="true">
              {p.icon}
            </span>
            <span className="nav-label">{p.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="status-card" aria-live="polite">
          <div className="status-card-title">Services</div>
          <div className="status-row">
            <span className="status-label">Torlink engine</span>
            <span className="status-value" title={healthInfo?.engineError || undefined}>
              <span
                className={`status-dot ${serve ? 'dot-up' : serveStarting ? 'dot-warn' : 'dot-down'}`}
                aria-hidden="true"
              />
              {serveLabel}
            </span>
          </div>
          <div className="status-row">
            <span className="status-label">Files server</span>
            <span className="status-value" title={healthInfo?.engineError || undefined}>
              <span
                className={`status-dot ${files ? 'dot-up' : filesStarting ? 'dot-warn' : 'dot-down'}`}
                aria-hidden="true"
              />
              {filesLabel}
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
