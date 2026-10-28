export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const health = () => api('/api/health')
export async function search(q, signal, onSource) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal })
  const isStream = res.ok && res.body && (res.headers.get('content-type') ?? '').includes('ndjson')
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Search failed (${res.status})`)
  }
  // Fallback for an older server that still returns a single JSON object.
  if (!isStream) {
    const data = await res.json().catch(() => ({}))
    if (data.results || data.perSource) return data
    throw new Error('Unexpected search response')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const perSource = {}
  const merged = []
  let doneData = null

  const mergeResult = (item) => {
    if (!item?.infoHash) return
    const prev = merged.find((r) => r.infoHash === item.infoHash)
    if (!prev) merged.push(item)
    else if (item.seeders > prev.seeders) {
      Object.assign(prev, item)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl = buffer.indexOf('\n')
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
        if (!line) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.type === 'source') {
          for (const r of msg.results ?? []) mergeResult(r)
          const info = {
            loading: msg.loading,
            count: msg.count,
            error: msg.error,
            code: msg.code,
            status: msg.status,
          }
          perSource[msg.id] = info
          onSource?.(msg.id, info, merged)
        } else if (msg.type === 'done') {
          doneData = { query: msg.query, results: msg.results, perSource: msg.perSource }
        } else if (msg.type === 'error') {
          throw new Error(msg.error || 'Search failed')
        }
      }
    }
  } catch (err) {
    // A broken stream must not throw away results the user already has.
    if (err && typeof err === 'object') {
      err.partials = merged
      err.perSource = perSource
    }
    throw err
  }
  if (doneData) return doneData
  throw new Error('Search stream ended unexpectedly')
}
export const addMagnet = (body) => api('/api/add', { method: 'POST', body: JSON.stringify(body) })
export const downloads = () => api('/api/downloads')
export const control = (id, action, deleteFiles) =>
  api('/api/control', {
    method: 'POST',
    body: JSON.stringify({ id, action, deleteFiles: !!deleteFiles }),
  })
// `query` is the raw search string (e.g. "?path=Some%20Folder") — it used to be
// dropped, which made every directory click silently re-list the root.
export const listFiles = (query = '') => api(`/api/files${query}`)
export const getSettings = () => api('/api/settings')
export const saveSettings = (body) => api('/api/settings', { method: 'POST', body: JSON.stringify(body) })
export const restartTorlnk = () => api('/api/restart-torlnk', { method: 'POST' })
export const openFolder = (path) =>
  api('/api/open-folder', { method: 'POST', body: JSON.stringify({ path }) })
export const browseFolder = (path) =>
  api('/api/browse-folder', { method: 'POST', body: JSON.stringify({ path }) })
export const getLogs = () => api('/api/logs')
export const shutdown = () => api('/api/shutdown', { method: 'POST' })
