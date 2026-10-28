import { useEffect, useMemo, useRef, useState } from 'react'
import { search, addMagnet } from '../api.js'
import {
  formatBytes,
  formatCompact,
  timeAgo,
  SOURCE_LABELS,
  SOURCE_COLORS,
  SOURCE_GROUPS,
  SOURCE_HOMEPAGES,
  SOURCE_CHIP_LABELS,
  GROUPS,
  classifyResolution,
  RES_FILTERS,
  filterByResolution,
} from '../format.js'
import AddMagnet from './AddMagnet.jsx'

const ALL_SOURCE_IDS = [
  'fitgirl',
  'yts',
  'tpb-movies',
  'x1337-movies',
  'eztv',
  'tpb-tv',
  'x1337-tv',
  'nyaa',
  'subsplease',
  'bittorrented',
]

export default function SearchPage({ initialTerm = '', onOpenDownloads }) {
  const [term, setTerm] = useState(initialTerm)
  const [group, setGroup] = useState('All')
  const [resFilter, setResFilter] = useState('all')
  const [results, setResults] = useState([])
  const [perSource, setPerSource] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [copied, setCopied] = useState(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const [adding, setAdding] = useState(null)
  const abortRef = useRef(null)
  const inFlightRef = useRef(null)

  const runSearch = async (q) => {
    // Enter is repeatable while a request is running; ignore a resubmit of
    // the same query instead of aborting and restarting the whole fan-out.
    if (inFlightRef.current === q) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    inFlightRef.current = q
    setTerm(q)
    setLoading(true)
    setError('')
    setResults([])
    setPerSource({})
    try {
      const data = await search(q, controller.signal, (id, info, partialResults) => {
        setPerSource((prev) => ({ ...(prev ?? {}), [id]: info }))
        setResults(partialResults.slice())
      })
      setResults(data.results ?? [])
      setPerSource(data.perSource ?? {})
    } catch (err) {
      if (err.name === 'AbortError') return
      // Keep whatever arrived before the failure, and stop any source that
      // never reported from spinning as "loading" forever.
      if (Array.isArray(err.partials) && err.partials.length > 0) setResults(err.partials)
      setPerSource((prev) => {
        const next = { ...(err.perSource ?? prev ?? {}) }
        for (const [id, s] of Object.entries(next)) {
          if (s?.loading) next[id] = { ...s, loading: false, error: s.error ?? 'interrupted' }
        }
        return next
      })
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // Only the newest request may clear the shared flags — otherwise an
      // aborted run's cleanup would wipe the state of the request that
      // replaced it, leaving the UI "idle" while a search is still in flight.
      if (abortRef.current === controller) {
        inFlightRef.current = null
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (initialTerm) runSearch(initialTerm)
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doDownload = async (result) => {
    setFlash('')
    setError('')
    setAdding(result.infoHash)
    try {
      await addMagnet({ infoHash: result.infoHash })
      setFlash(result.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(null)
    }
  }

  const copyMagnet = async (result) => {
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(result.magnet)
      setCopied(result.infoHash)
      window.setTimeout(() => setCopied(null), 1500)
    } catch (err) {
      // Clipboard access can be denied; say so instead of silently doing nothing.
      setCopied(null)
      setCopyFailed(true)
      setError(err instanceof Error ? err.message : 'Could not copy the magnet link to the clipboard.')
      window.setTimeout(() => setCopyFailed(false), 2500)
    }
  }

  const visible = useMemo(() => {
    const byGroup =
      group === 'All' ? results : results.filter((r) => (SOURCE_GROUPS[r.source] ?? []).includes(group))
    const list = filterByResolution(byGroup, resFilter)
    return [...list].sort(
      (a, b) =>
        b.seeders !== a.seeders ? b.seeders - a.seeders : (b.added ?? 0) - (a.added ?? 0),
    )
  }, [results, group, resFilter])

  const doneSources = useMemo(() => Object.entries(perSource ?? {}), [perSource])

  // Truthful aggregate: "responded" used to count 403s, timeouts and empty
  // answers as successes. Every outcome class is counted separately.
  const statusOf = (s) =>
    s?.status ??
    (s?.loading
      ? 'loading'
      : s?.error
        ? 'failed'
        : (s?.count ?? 0) > 0
          ? 'ok'
          : 'empty')

  const metrics = useMemo(() => {
    const m = { attempted: 0, withResults: 0, empty: 0, failed: 0, pending: 0 }
    for (const [, s] of Object.entries(perSource ?? {})) {
      if (!s) continue
      const status = statusOf(s)
      if (status === 'loading') m.pending++
      else if (status === 'ok') m.withResults++
      else if (status === 'empty') m.empty++
      else if (status !== 'cancelled') m.failed++
      else continue // user cancelled: not a source outcome
      m.attempted++
    }
    return m
  }, [perSource])

  const metricsText = [
    `${metrics.attempted} source${metrics.attempted === 1 ? '' : 's'}`,
    `${metrics.withResults} with results`,
    `${metrics.empty} empty`,
    metrics.failed > 0 ? `${metrics.failed} failed` : null,
    metrics.pending > 0
      ? `${metrics.attempted - metrics.pending}/${metrics.attempted} finished`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  // Each chip states its condition in words as well as colour: healthy-zero
  // must never read like a failure, and an HTTP error must never read like a
  // completed search.
  const sourceChipState = (s) => {
    if (!s || s.loading) return { cls: 'load', text: 'searching' }
    switch (statusOf(s)) {
      case 'ok':
        return { cls: 'ok', text: String(s.count ?? 0) }
      case 'empty':
        return { cls: 'empty', text: 'no results' }
      case 'timeout':
        return { cls: 'err', text: 'timed out' }
      case 'rate_limited':
        return { cls: 'err', text: 'rate limited' }
      case 'forbidden':
        return {
          cls: 'err',
          text: s.code === 401 ? 'account required' : `blocked (${s.code ?? 403})`,
        }
      case 'unavailable':
        return { cls: 'err', text: s.code ? `unavailable (${s.code})` : 'unavailable' }
      case 'invalid':
        return { cls: 'err', text: 'invalid response' }
      case 'cancelled':
        return { cls: 'load', text: 'cancelled' }
      default:
        // A broken stream leaves sources mid-flight; say that plainly, and
        // otherwise fall back to the legacy error-only entries.
        if (s.error === 'interrupted') return { cls: 'err', text: 'interrupted' }
        if (s.error) return { cls: 'err', text: s.code ? `failed (${s.code})` : 'failed' }
        return { cls: 'empty', text: 'no results' }
    }
  }

  return (
    <div>
      <header className="page-header">
        <h1 className="page-title">Search</h1>
        <p className="page-desc">
          Search every torrent source at once, or leave empty to browse the latest.
        </p>
      </header>

      <div className="toolbar">
        <form
          className="search-bar"
          onSubmit={(e) => {
            e.preventDefault()
            runSearch(term)
          }}
        >
          <input
            className="search-input"
            type="search"
            placeholder="Search movies, TV, anime, games…"
            aria-label="Search query"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">🔍</span>}
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>
        <button className="btn" onClick={() => runSearch('')} disabled={loading}>
          Browse
        </button>
        <AddMagnet />
      </div>

      <div className="chips" role="group" aria-label="Filter by category">
        <button
          className={`chip ${group === 'All' ? 'active' : ''}`}
          aria-pressed={group === 'All'}
          onClick={() => setGroup('All')}
        >
          All
        </button>
        {GROUPS.map((g) => (
          <button
            key={g}
            className={`chip ${group === g ? 'active' : ''}`}
            aria-pressed={group === g}
            onClick={() => setGroup(g)}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="chips" role="group" aria-label="Filter by resolution">
        {RES_FILTERS.map((f) => (
          <button
            key={f.id}
            className={`chip ${resFilter === f.id ? 'active' : ''}`}
            aria-pressed={resFilter === f.id}
            onClick={() => setResFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {(loading || doneSources.length > 0) && (
        <div className="source-status" role="group" aria-label="Source status">
          {ALL_SOURCE_IDS.map((id) => {
            const s = perSource?.[id]
            const { cls, text } = sourceChipState(s)
            return (
              <span
                key={id}
                className={`source-chip state-${cls}`}
                title={s?.error ? `${SOURCE_LABELS[id] ?? id}: ${s.error}` : undefined}
              >
                <span className="dot" aria-hidden="true" />
                <span className="source-name">{SOURCE_CHIP_LABELS[id] ?? id}</span>
                <span className="source-state">{text}</span>
              </span>
            )
          })}
        </div>
      )}

      {error && (
        <div className="banner error-banner" role="alert">
          {error}
        </div>
      )}
      {flash && (
        <div className="banner success-banner" role="status">
          <span>
            Added to downloads: <strong>{flash}</strong>.{' '}
            <button type="button" className="link" onClick={onOpenDownloads}>
              Go to Downloads →
            </button>
          </span>
        </div>
      )}

      {!loading && !error && visible.length === 0 && doneSources.length === 0 && (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            🔍
          </div>
          <div>Type a query and hit Search, or press Browse for the latest releases.</div>
        </div>
      )}

      {/* Filters hid everything the search found: a filter fact, not a failed search. */}
      {!loading && !error && visible.length === 0 && results.length > 0 && doneSources.length > 0 && (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            🎯
          </div>
          <div>
            None of the {results.length} result{results.length === 1 ? '' : 's'} match the current
            filters
            {resFilter !== 'all'
              ? ` (${RES_FILTERS.find((f) => f.id === resFilter)?.label ?? resFilter})`
              : ''}
            {group !== 'All' ? ` in ${group}` : ''}.
          </div>
          <button
            type="button"
            className="link"
            onClick={() => {
              setGroup('All')
              setResFilter('all')
            }}
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Search completed and nothing matched: honest zero, with source health. */}
      {!loading && !error && visible.length === 0 && results.length === 0 && doneSources.length > 0 && (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            🕸️
          </div>
          <div>No results matched “{term || 'latest releases'}”.</div>
          {metrics.attempted > 0 && <div className="sub">{metricsText}</div>}
          {metrics.failed > 0 && (
            <div className="sub">
              {metrics.failed} source{metrics.failed === 1 ? '' : 's'} failed — see the source
              status above.
            </div>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <div className="results-meta">
          <span className="sub">
            {visible.length} result{visible.length === 1 ? '' : 's'}
            {metrics.attempted > 0 ? ` · ${metricsText}` : ''}
          </span>
          <span className="clear-links">
            {group !== 'All' && (
              <button type="button" className="link" onClick={() => setGroup('All')}>
                Clear “{group}” filter
              </button>
            )}
            {resFilter !== 'all' && (
              <button type="button" className="link" onClick={() => setResFilter('all')}>
                Clear {RES_FILTERS.find((f) => f.id === resFilter)?.label ?? 'resolution'} filter
              </button>
            )}
          </span>
        </div>
      )}

      {visible.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Res</th>
                  <th scope="col" className="num-right">
                    Size
                  </th>
                  <th scope="col" className="num-right">
                    Seeds
                  </th>
                  <th scope="col" className="num-right">
                    Leech
                  </th>
                  <th scope="col">Added</th>
                  <th scope="col" className="num-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const isAdding = adding === r.infoHash
                  return (
                    <tr key={`${r.infoHash}-${r.source}`}>
                      <td className="result-name">
                        <div className="result-title" title={r.name}>
                          {r.name}
                          <span
                            className="badge"
                            style={{ background: SOURCE_COLORS[r.source] ?? '#4a5468' }}
                          >
                            {SOURCE_LABELS[r.source] ?? r.source}
                          </span>
                        </div>
                        {r.infoHash && <div className="result-meta">{r.infoHash}</div>}
                      </td>
                      <td className="num">{classifyResolution(r.name) ?? '—'}</td>
                      <td className="num num-right">{formatBytes(r.sizeBytes)}</td>
                      <td className="seed-num num-right">{formatCompact(r.seeders)}</td>
                      <td className="num num-right">{formatCompact(r.leechers)}</td>
                      <td className="num">{timeAgo(r.added)}</td>
                      <td className="actions-cell">
                        <a
                          className="btn btn-ghost btn-sm"
                          href={r.url || SOURCE_HOMEPAGES[r.source] || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Open on ${SOURCE_LABELS[r.source] ?? r.source}`}
                        >
                          <span className="btn-label-icon" aria-hidden="true">
                            ↗
                          </span>
                          Source
                        </a>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => doDownload(r)}
                          disabled={isAdding}
                          title="Add this torrent to downloads"
                        >
                          {isAdding ? (
                            <span className="spinner" aria-hidden="true" />
                          ) : (
                            <span className="btn-label-icon" aria-hidden="true">
                              ⬇
                            </span>
                          )}
                          {isAdding ? 'Adding…' : 'Download'}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => copyMagnet(r)}
                          disabled={!r.magnet}
                          title={r.magnet ? 'Copy magnet link to clipboard' : 'No magnet link available'}
                        >
                          {copied === r.infoHash
                            ? '✓ Copied'
                            : copyFailed && !copied
                              ? '⚠ Retry copy'
                              : 'Copy magnet'}
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
