// Search engines ported from torlink's own source implementations
// (torlnk package, dist/index.js). Same sources, same result shape.

const UA = 'torlink (+https://www.npmjs.com/package/torlnk)'

export class HttpError extends Error {
  constructor(status, message) {
    super(message ?? `HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
  }
}

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.dler.org:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'http://tracker.dler.org:6969/announce',
  'https://tracker.tamersunion.org:443/announce',
]

export function magnet(infoHash, name) {
  const dn = encodeURIComponent(name)
  const tr = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join('')
  return `magnet:?xt=urn:btih:${infoHash}&dn=${dn}${tr}`
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32ToHex(t) {
  let bits = 0
  let value = 0
  let out = ''
  for (const c of t.toUpperCase()) {
    const idx = BASE32.indexOf(c)
    if (idx === -1) return null
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out += ((value >>> bits) & 255).toString(16).padStart(2, '0')
      value &= (1 << bits) - 1
    }
  }
  return out.length === 40 ? out : null
}
function normalizeHash(t) {
  return t.length === 32 ? (base32ToHex(t) ?? t.toLowerCase()) : t.toLowerCase()
}
export function parseMagnet(text) {
  const t = text.trim()
  if (!/^magnet:\?/i.test(t)) return null
  const m = /xt=urn:btih:([a-f0-9]{40}|[a-z2-7]{32})/i.exec(t)
  if (!m) return null
  const infoHash = normalizeHash(m[1])
  let name = infoHash
  try {
    const dn = new URL(t).searchParams.get('dn')
    if (dn) name = dn
  } catch {}
  return { infoHash, name, magnet: t }
}

export function buildMagnetFromHash(hash) {
  const t = hash.trim()
  if (/^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(t)) {
    return magnet(normalizeHash(t), normalizeHash(t))
  }
  return null
}

const SIZE_UNITS = {
  B: 1,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
}
export function parseSize(text) {
  const m = text.replace(/\u00a0|&nbsp;/g, ' ').match(/([\d.]+)\s*([KMGT]?I?B)/i)
  if (!m) return 0
  return Math.round(parseFloat(m[1]) * (SIZE_UNITS[m[2].toUpperCase()] ?? 1))
}

function decodeEntities(t) {
  return t
    .replace(/&#0?38;|&amp;/g, '&')
    .replace(/&#8211;|&#8212;/g, '-')
    .replace(/&#8217;|&#0?39;|&apos;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const isAbort = (e) =>
  e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message))

// The response arrived but its structure did not (HTML challenge page where
// JSON was expected, a gateway error page where RSS was expected, ...).
export class ParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ParseError'
  }
}

// Truthful outcome taxonomy for one source. The UI must be able to tell
// "healthy, zero results" apart from every way a request can fail, so each
// per-source record carries one of these.
//   ok          completed with >= 1 result
//   empty       completed, upstream healthy, 0 results
//   timeout     no response within the per-source budget
//   rate_limited HTTP 429
//   forbidden   HTTP 401/403 (auth or bot-protection requirement)
//   unavailable HTTP 5xx / DNS / connect failure / stale endpoint
//   invalid     response arrived but could not be parsed
//   cancelled   the user aborted the search (not a source failure)
export function classifyFailure(err, ctx = {}) {
  if (ctx.cancelled) return 'cancelled'
  if (ctx.timedOut || isAbort(err)) return 'timeout'
  if (err instanceof ParseError || err instanceof SyntaxError) return 'invalid'
  if (err instanceof HttpError) {
    if (err.status === 429) return 'rate_limited'
    if (err.status === 401 || err.status === 403) return 'forbidden'
    return 'unavailable' // 404/408/5xx/0 (DNS, connect, both TPB paths down)
  }
  return 'unavailable'
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    if (signal) {
      if (signal.aborted) return done()
      signal.addEventListener('abort', done, { once: true })
    }
  })
}

async function fetchResilient(url, opts = {}) {
  const retries = opts.retries ?? 5
  const baseMs = opts.baseMs ?? 500
  const capMs = opts.capMs ?? 20000
  const { signal } = opts
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new HttpError(0, 'aborted')
    let res
    try {
      res = await fetch(url, { ...opts, signal })
    } catch (err) {
      if (isAbort(err) || signal?.aborted) throw err
      lastErr = err
      if (attempt < retries) {
        await sleep(backoff(attempt, baseMs, capMs), signal)
        continue
      }
      throw err
    }
    if (!RETRY_STATUSES.has(res.status)) return res
    if (
      res.status === 503 &&
      /ddos-guard|cloudflare/i.test(res.headers.get('server') ?? '')
    ) {
      throw new HttpError(res.status, `Request to ${url} blocked by Cloudflare/DDoS-Guard (HTTP 503).`)
    }
    if (attempt >= retries) {
      throw new HttpError(res.status, `Request to ${url} failed after ${retries} retries (HTTP ${res.status}).`)
    }
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
    await sleep(backoff(attempt, baseMs, capMs, retryAfter), signal)
  }
  throw lastErr instanceof Error ? lastErr : new HttpError(0, 'fetchResilient exhausted without a response')
}

function parseRetryAfter(t, now = Date.now()) {
  if (!t) return undefined
  const s = t.trim()
  if (/^\d+$/.test(s)) return Number(s) * 1000
  const parsed = Date.parse(s)
  if (!Number.isNaN(parsed)) return Math.max(0, parsed - now)
}

function backoff(attempt, base, cap, min, rand = Math.random) {
  const exp = Math.min(cap, base * 2 ** attempt)
  const ms = Math.floor(rand() * exp)
  return min !== undefined ? Math.max(ms, min) : ms
}

function rssItem(tag, xml) {
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${tag}>`, 's')
  return xml.match(re)?.[1]?.trim() ?? ''
}

// A challenge or error page served with HTTP 200 would otherwise parse as
// "zero results", which is a different fact than "not an RSS feed".
function assertRssFeed(body, source) {
  if (!/<(rss|feed|channel)\b/i.test(body)) {
    throw new ParseError(`${source} returned a page that is not an RSS feed`)
  }
}

function rssItems(xml, source) {
  assertRssFeed(xml, source)
  const out = []
  for (const item of xml.split('<item>').slice(1)) {
    const href = item.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/i)
    if (!href) continue
    const magnetRaw = decodeEntities(href[1])
    const hash = magnetRaw.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase() ?? ''
    if (!hash) continue
    const title = decodeEntities(item.match(/<title>(.*?)<\/title>/)?.[1] ?? 'Unknown Title')
    const pub = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? ''
    const link =
      decodeEntities(item.match(/<link>(.*?)<\/link>/)?.[1] ?? '') ||
      decodeEntities(item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1] ?? '')
    out.push({
      infoHash: hash,
      name: title,
      sizeBytes: 0,
      seeders: 0,
      leechers: 0,
      source,
      magnet: magnetRaw,
      added: pub ? new Date(pub).getTime() / 1000 : undefined,
      url: link || undefined,
    })
  }
  return out
}

async function searchWithRss(base, source, query, opts = {}) {
  const q = query.trim()
  const firstUrl = q
    ? `${base}/?s=${encodeURIComponent(q)}&feed=rss2`
    : `${base}/feed/`
  const pages = 3
  const minPageFull = 10
  const html = await fetchText(firstUrl, source, opts, 3)
  const results = rssItems(html, source)
  if (html.split('<item>').length - 1 < minPageFull) return results
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      fetchText(pageUrl(base, q, i + 2), source, opts, 2)
        .then((t) => rssItems(t, source))
        .catch(() => []),
    ),
  )
  const seen = new Set(results.map((r) => r.infoHash))
  for (const item of rest.flat()) {
    if (!seen.has(item.infoHash)) {
      seen.add(item.infoHash)
      results.push(item)
    }
  }
  return results
}

function pageUrl(base, q, page) {
  const sep = q ? '&' : '?'
  return `${base}${q ? `/?s=${encodeURIComponent(q)}&feed=rss2` : '/feed/'}${sep}paged=${page}`
}

async function fetchText(url, source, opts, retries = 3) {
  const res = await fetchResilient(url, {
    headers: { 'User-Agent': UA },
    signal: opts.signal,
    retries,
  })
  if (!res.ok) throw new HttpError(res.status, `${source} returned ${res.status}`)
  return res.text()
}

const HOMEPAGES = {
  yts: 'https://yts.mx',
  'tpb-movies': 'https://thepiratebay.org',
  'tpb-tv': 'https://thepiratebay.org',
  'x1337-movies': 'https://1337x.to',
  'x1337-tv': 'https://1337x.to',
  eztv: 'https://eztvx.to',
  fitgirl: 'https://fitgirl-repacks.site',
  nyaa: 'https://nyaa.si',
  subsplease: 'https://subsplease.org',
  bittorrented: 'https://bittorrented.com',
}

// ---------- YTS ----------
// Every YTS response announces the move: "Base URL moving to
// https://movies-api.accel.li/api/v2/". Verified2026-10: accel.li, yts.am,
// yts.lt and yts.ag answer200 with data; yts.mx does not resolve from every
// network (ENOTFOUND) and yts.rs serves HTTP 500 (shard outage), so both are
// kept only as late fallbacks.
const YTS_DOMAINS = ['movies-api.accel.li', 'yts.am', 'yts.lt', 'yts.ag', 'yts.mx']
async function ytsSearch(query, opts = {}) {
  const params = new URLSearchParams({ limit: '50' })
  const q = query.trim()
  if (q) params.set('query_term', q)
  else params.set('sort_by', 'date_added')

  let lastErr
  for (const domain of YTS_DOMAINS) {
    try {
      const res = await fetchResilient(`https://${domain}/api/v2/list_movies.json?${params}`, {
        headers: { 'User-Agent': UA },
        signal: opts.signal,
        retries: 1,
      })
      if (res.ok) {
        const data = await res.json() // SyntaxError on HTML/empty body -> invalid
        if (!data || data.status !== 'ok' || !data.data || typeof data.data !== 'object') {
          throw new ParseError(
            `YTS responded with an error (${data?.status_message ?? 'unexpected payload'})`,
          )
        }
        const out = []
        for (const movie of data.data.movies ?? []) {
          const title = movie.title_long || movie.title || 'Unknown'
          for (const t of movie.torrents ?? []) {
            if (!t.hash) continue
            const label = [t.quality, t.type].filter(Boolean).join(' ')
            const name = label ? `${title} [${label}]` : title
            out.push({
              infoHash: t.hash.toLowerCase(),
              name,
              sizeBytes: t.size_bytes ?? 0,
              seeders: t.seeds ?? 0,
              leechers: t.peers ?? 0,
              source: 'yts',
              magnet: magnet(t.hash.toLowerCase(), name),
              added: movie.date_uploaded_unix,
              url: movie.url || undefined,
            })
          }
        }
        return out
      }
      lastErr = new HttpError(res.status, `YTS returned ${res.status}`)
    } catch (err) {
      if (err && isAbort(err)) throw err
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new HttpError(0, 'YTS unreachable')
}

// ---------- The Pirate Bay (apibay.org + tpb.party mirror fallback) ----------
// Category ids verified against tpb.party's own category list (2026-10):
//   201 Movies, 202 Movies DVDR, 207 HD - Movies, 209 3D,
//   211 UHD/4k - Movies, 210 CAM/TS (excluded on purpose: cam rips),
//   205 TV shows, 208 HD - TV shows, 212 UHD/4k - TV shows.
// Without 211/212 the whole UHD/4K bucket of both sides of TPB was dropped.
const TPB_MOVIE_CATS = new Set([201, 202, 207, 209, 211])
const TPB_TV_CATS = new Set([205, 208, 212])
const TPB_TOP_MOVIES = 'https://apibay.org/precompiled/data_top100_207.json'
const TPB_TOP_TV = 'https://apibay.org/precompiled/data_top100_208.json'
const TPB_MIRROR_BASE = 'https://tpb.party'
const TPB_ZERO = '0000000000000000000000000000000000000000'

function tpbResult(t, source) {
  const infoHash = (t.info_hash ?? '').toLowerCase()
  if (!infoHash || infoHash === TPB_ZERO || t.id === '0') return null
  const name = t.name || 'Unknown'
  return {
    infoHash,
    name,
    sizeBytes: Number(t.size) || 0,
    seeders: Number(t.seeders) || 0,
    leechers: Number(t.leechers) || 0,
    numFiles: Number.isFinite(Number(t.num_files)) && Number(t.num_files) > 0 ? Number(t.num_files) : undefined,
    source,
    magnet: magnet(infoHash, name),
    added: Number(t.added) || undefined,
    url: `https://thepiratebay.org/torrent/${t.id}`,
  }
}

async function tpbApiSearch(url, q, cats, source, opts = {}) {
  const res = await fetchResilient(url, {
    headers: { 'User-Agent': UA },
    signal: opts.signal,
    retries: 1,
  })
  if (!res.ok) throw new HttpError(res.status, `Pirate Bay returned ${res.status}`)
  const json = await res.json()
  // apibay's contract is a JSON array; anything else (error payload, challenge
  // page served as JSON) must not be mistaken for "no results".
  if (!Array.isArray(json)) throw new ParseError('apibay.org returned an unexpected response (not an array)')
  const out = []
  for (const t of json) {
    if (q && !cats.has(Number(t.category))) continue
    const r = tpbResult(t, source)
    if (r) out.push(r)
  }
  return out
}

function parseTpbHtml(html, cats, source) {
  const out = []
  for (const row of html.split('<tr>')) {
    if (!row.includes('class="vertTh"')) continue
    const nameM = row.match(/title="Details for ([^"]*)"[^>]*>/)
    const magnetM = row.match(/href="(magnet:\?[^"]+)"/)
    if (!nameM || !magnetM) continue
    const hashM = magnetM[1].match(/urn:btih:([a-f0-9]{40})/i)
    if (!hashM) continue
    const infoHash = hashM[1].toLowerCase()
    if (infoHash === TPB_ZERO) continue
    const catM = row.match(/browse\/(\d+)/)
    const cat = catM ? Number(catM[1]) : 0
    if (!cats.has(cat)) continue
    const name = decodeEntities(nameM[1]).trim()
    const urlM = row.match(/href="(https:\/\/[^"]*\/torrent\/[^"]+)"/)
    const tds = row.match(/<td align="right">([^<]*)<\/td>/g) || []
    const clean = (td) => (td ? td.replace(/<[^>]+>/g, '').trim() : '')
    const seeders = Number(clean(tds[1]).replace(/[^\d]/g, '')) || 0
    const leechers = Number(clean(tds[2]).replace(/[^\d]/g, '')) || 0
    const dateM = row.match(/<td>(\d\d-\d\d)&nbsp;(\d{4})<\/td>/)
    const dateStr = dateM ? `${dateM[2]}-${dateM[1]}` : ''
    const added = dateM ? Date.parse(dateStr) / 1000 : undefined
    out.push({
      infoHash,
      name,
      sizeBytes: parseSize(clean(tds[0])),
      seeders,
      leechers,
      source,
      magnet: magnet(infoHash, name),
      added: Number.isFinite(added) ? added : undefined,
      url: urlM ? decodeEntities(urlM[1]) : undefined,
    })
  }
  return out
}

async function tpbMirrorSearch(url, cats, source, opts = {}) {
  const res = await fetchResilient(url, {
    headers: { 'User-Agent': UA },
    signal: opts.signal,
    retries: 1,
  })
  if (!res.ok) throw new HttpError(res.status, `TPB mirror returned ${res.status}`)
  const html = await res.text()
  // Both a real result page and a real empty-result page carry the search UI
  // (the category <select>); a bot-challenge or error page does not. Report
  // that as an invalid response instead of an honest-looking zero.
  if (!/<option/i.test(html)) throw new ParseError('tpb.party returned an unrecognized page')
  return parseTpbHtml(html, cats, source)
}

const waitGrace = (ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    t.unref?.()
  })

// Try apibay.org (the documented TPB API) and tpb.party (the site itself) in
// parallel. Whichever answers first is never allowed to hide the other's
// data: an empty or partial parse from one path used to win the race and
// discard the full answer from the other (observed: 44 rows replaced by 8,
// or by none at all). Union whatever arrives, dedupe by info hash, and cap
// the wait for the slower path so a hung mirror can't stall the source.
async function tpbSearch(query, cats, topUrl, topCat, source, opts = {}) {
  const q = query.trim()
  const apiUrl = q ? `https://apibay.org/q.php?q=${encodeURIComponent(q)}` : topUrl
  const mirrorUrl = q
    ? `${TPB_MIRROR_BASE}/search/${encodeURIComponent(q)}/1/99/0`
    : `${TPB_MIRROR_BASE}/top/${topCat}`
  const arrived = []
  const paths = [
    tpbApiSearch(apiUrl, q, cats, source, opts),
    tpbMirrorSearch(mirrorUrl, cats, source, opts),
  ].map((p) =>
    p.then((rows) => {
      arrived.push(rows)
      return rows
    }),
  )
  let first
  try {
    first = await Promise.any(paths)
  } catch {
    throw new HttpError(0, 'Pirate Bay unreachable (apibay.org and tpb.party both failed)')
  }
  if (first.length > 0) {
    // Results in hand: give the slower endpoint a short grace period, then
    // merge whatever arrived. A hung mirror can cost at most 1.5s.
    await Promise.race([Promise.allSettled(paths), waitGrace(1500)])
  } else {
    // First answer was empty: wait for the other endpoint too, so "0 results"
    // is only reported when every endpoint that answered says so.
    await Promise.allSettled(paths)
  }
  const seen = new Map()
  for (const rows of arrived) {
    for (const r of rows) if (!seen.has(r.infoHash)) seen.set(r.infoHash, r)
  }
  return [...seen.values()]
}

// ---------- 1337x ----------
const X1337_DOMAINS = ['1337x.to', '1337x.st', 'x1337x.ws', '1337xx.to']
const X1337_DROP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to'])
// Remember the last host that answered so a blocked mirror isn't re-tried
// first on every search.
let x1337HostIndex = 0

function parse1337Table(html) {
  const idx = html.indexOf('table-list')
  if (idx < 0) return []
  const rows = []
  for (const tr of html.slice(idx).split(/<tr[\s>]/i).slice(1)) {
    const m = tr.match(/href="(\/torrent\/[^"]+)"[^>]*>([^<]+)<\/a>/i)
    if (!m) continue
    const size = tr.match(/class="coll-4 size[^"]*">\s*([\d.]+\s*[KMGT]i?B)/i)?.[1] ?? ''
    rows.push({
      name: decodeEntities(m[2].trim()),
      path: m[1],
      seeders: Number(tr.match(/class="coll-2 seeds[^"]*">\s*(\d+)/i)?.[1] ?? 0),
      leechers: Number(tr.match(/class="coll-3 leeches[^"]*">\s*(\d+)/i)?.[1] ?? 0),
      sizeBytes: parseSize(size),
    })
  }
  return rows
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
function parse1337Date(html) {
  const m = html.match(/Date uploaded<\/strong>\s*<span>\s*([A-Za-z]{3})\.?\s+(\d{1,2})[a-z]{2}\s*'(\d{2})/i)
  if (!m) return undefined
  const month = MONTHS[m[1].toLowerCase()]
  if (month === undefined) return undefined
  const day = Number(m[2])
  const year = 2000 + Number(m[3])
  const ts = Math.floor(Date.UTC(year, month, day) / 1000)
  return Number.isNaN(ts) ? undefined : ts
}

async function fetch1337Torrent(base, path, opts) {
  try {
    const html = await fetchText(`${base}${path}`, '1337x', opts, 1)
    const m = html.match(/magnet:\?xt=urn:btih:[^"'<>\s]+/i)?.[0]
    return m ? { magnet: decodeEntities(m), added: parse1337Date(html) } : null
  } catch {
    return null
  }
}

async function x1337Search(query, category, source, opts = {}) {
  const q = query.trim()
  const path = q
    ? `/category-search/${encodeURIComponent(q).replace(/%20/g, '+')}/${category}/1/`
    : `/popular-${category === 'Movies' ? 'movies' : 'tv'}`
  const topCount = 4
  let lastErr
  let currentDomain = ''
  let html = ''
  for (let v = 0; v < X1337_DOMAINS.length; v++) {
    const hostIndex = (x1337HostIndex + v) % X1337_DOMAINS.length
    const domain = X1337_DOMAINS[hostIndex]
    try {
      html = await fetchText(`https://${domain}${path}`, '1337x', opts, v === 0 ? 2 : 0)
      currentDomain = `https://${domain}`
      x1337HostIndex = hostIndex
      break
    } catch (err) {
      if (opts.signal?.aborted) throw err
      lastErr = err
    }
  }
  if (!currentDomain) throw lastErr instanceof Error ? lastErr : new HttpError(0, '1337x unreachable')
  // A real results page always carries the results table; a challenge or
  // error page served with HTTP 200 must not read as an honest zero.
  if (!/table-list/i.test(html)) throw new ParseError('1337x returned an unrecognized page')

  const rows = parse1337Table(html)
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const sig = words.filter((w) => !X1337_DROP_WORDS.has(w))
  const keep = sig.length ? sig : words
  const filtered = keep.length
    ? rows.filter((r) => {
        const name = r.name.toLowerCase()
        return keep.every((w) => name.includes(w))
      })
    : rows
  filtered.sort((a, b) => b.seeders - a.seeders)
  const top = filtered.slice(0, topCount)

  const withMagnet = await Promise.all(
    top.map(async (row) => {
      const info = await fetch1337Torrent(currentDomain, row.path, opts)
      const rawHash = info?.magnet?.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1]
      if (!info || !rawHash) return null
      const hash = normalizeHash(rawHash)
      return {
        infoHash: hash,
        name: row.name,
        sizeBytes: row.sizeBytes,
        seeders: row.seeders,
        leechers: row.leechers,
        source,
        magnet: info.magnet,
        added: info.added,
        url: `${currentDomain}${row.path}`,
      }
    }),
  )
  return withMagnet.filter(Boolean)
}

// ---------- EZTV ----------
// EZTV's API only honours `limit` and `page` today. Verified2026-10: with
// `search=The+Last+of+Us`, `imdb_id=tt14500888` and no params at all,
// eztvx.to, eztv.tf, eztv.re, eztv.wf and eztv.ag return byte-identical top
// rows, i.e. every filter parameter is ignored, and the HTML search routes are
// behind Cloudflare on every mirror. So a text query can only be matched
// against EZTV's own recent feed (every row carries show, filename and
// hash), which is fetched once and shared between queries. Browse (empty
// query) uses a plain first page, which does work.
const EZTV_API = 'https://eztvx.to/api/get-torrents'
const EZTV_PAGE_LIMIT = 100 // above 100 the API quietly answers with 30
const EZTV_INDEX_PAGES = 10 // ~1000 rows, ~250 distinct shows, ~2.5 days
const EZTV_MAX_RESULTS = 100 // one API page's worth, like every other query
const EZTV_INDEX_TTL = 5 * 60 * 1000 // same five-minute life as the result cache

// The recent feed is identical for every query, so fetch it once and share it.
let eztvIndex = null

async function eztvPage(params, opts, retries) {
  const qs = new URLSearchParams({ limit: String(EZTV_PAGE_LIMIT), ...params })
  const res = await fetchResilient(`${EZTV_API}?${qs}`, {
    headers: { 'User-Agent': UA },
    signal: opts.signal,
    retries,
  })
  if (!res.ok) throw new HttpError(res.status, `EZTV returned ${res.status}`)
  const data = await res.json()
  if (!data || !Array.isArray(data.torrents)) {
    throw new ParseError('EZTV returned an unexpected response (no torrent list)')
  }
  return data.torrents
}

async function eztvRecentIndex(opts) {
  const now = Date.now()
  if (eztvIndex && now - eztvIndex.at < EZTV_INDEX_TTL) return eztvIndex.rows
  // Page 1 decides whether EZTV is reachable at all; deeper pages only widen
  // the window, so one of them failing narrows the search instead of breaking.
  const pages = Array.from({ length: EZTV_INDEX_PAGES }, (_, i) =>
    eztvPage({ page: String(i + 1) }, opts, i === 0 ? 1 : 0),
  )
  const guarded = pages.map((p, i) => (i === 0 ? p : p.catch(() => [])))
  const rows = (await Promise.all(guarded)).flat()
  eztvIndex = { at: now, rows }
  return rows
}

function eztvMatches(t, tokens) {
  const name = `${t.title ?? ''} ${t.filename ?? ''}`.toLowerCase()
  return tokens.every((token) => name.includes(token))
}

function eztvResult(t) {
  const hash = (t.hash ?? '').toLowerCase()
  const name = t.title || t.filename || hash
  const magnetLink = t.magnet_url || (hash ? magnet(hash, name) : '')
  if (!magnetLink || !hash) return null
  return {
    infoHash: hash,
    name,
    sizeBytes: Number(t.size_bytes ?? 0) || 0,
    seeders: t.seeds ?? 0,
    leechers: t.peers ?? 0,
    source: 'eztv',
    magnet: magnetLink,
    added: t.date_released_unix,
    url: t.id != null ? `https://eztvx.to/ep/${t.id}` : undefined,
  }
}

// A show's catalogue overlaps the recent feed, so the same hash arrives twice;
// keep the first and stop there.
function eztvResults(rows) {
  const byHash = new Map()
  for (const row of rows) {
    const r = eztvResult(row)
    if (r && !byHash.has(r.infoHash)) byHash.set(r.infoHash, r)
  }
  return [...byHash.values()]
}

async function eztvSearch(query, opts = {}) {
  const q = query.trim()
  // The empty query is the popular list, and one page is what it has always
  // been; widening the index there would make every startup ten times heavier.
  if (!q) return eztvResults(await eztvPage({ page: '1' }, opts, 1))

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  const recent = await eztvRecentIndex(opts)
  const hits = recent.filter((t) => eztvMatches(t, tokens))
  return eztvResults(hits)
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, EZTV_MAX_RESULTS)
}

// ---------- FitGirl (WordPress RSS) ----------
function fitgirlSearch(query, opts = {}) {
  return searchWithRss('https://fitgirl-repacks.site', 'fitgirl', query, opts)
}

// ---------- Nyaa ----------
async function nyaaSearch(query, opts = {}) {
  const params = new URLSearchParams({ page: 'rss', q: query.trim(), c: '0_0', f: '0' })
  const res = await fetchResilient(`https://nyaa.si/?${params}`, {
    headers: { 'User-Agent': UA },
    signal: opts.signal,
  })
  if (!res.ok) throw new HttpError(res.status, `Nyaa returned ${res.status}`)
  const xml = await res.text()
  assertRssFeed(xml, 'nyaa')
  const out = []
  for (const item of xml.split('<item>').slice(1)) {
    const infoHash = rssItem('nyaa:infoHash', item).toLowerCase()
    const title = decodeEntities(rssItem('title', item))
    if (!infoHash || !title) continue
    const seeders = Number(rssItem('nyaa:seeders', item))
    const leechers = Number(rssItem('nyaa:leechers', item))
    const pub = rssItem('pubDate', item)
    const viewUrl = decodeEntities(item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1] ?? '')
    out.push({
      infoHash,
      name: title,
      sizeBytes: parseSize(rssItem('nyaa:size', item)),
      seeders: Number.isFinite(seeders) ? seeders : 0,
      leechers: Number.isFinite(leechers) ? leechers : 0,
      source: 'nyaa',
      magnet: magnet(infoHash, title),
      added: pub ? new Date(pub).getTime() / 1000 : undefined,
      url: viewUrl || undefined,
    })
  }
  return out
}

// ---------- SubsPlease ----------
const SP_RES = ['1080', '720', '480']
function bestDownload(list) {
  for (const res of SP_RES) {
    const found = list.find((d) => d.res === res && d.magnet)
    if (found) return found
  }
  return list.find((d) => d.magnet)
}

async function subsPleaseSearch(query, opts = {}) {
  const params = new URLSearchParams({ tz: 'UTC' })
  const q = query.trim()
  if (q) {
    params.set('f', 'search')
    params.set('s', q)
  } else {
    params.set('f', 'latest')
  }
  const res = await fetchResilient(`https://subsplease.org/api/?${params}`, {
    headers: { 'User-Agent': UA },
    signal: opts.signal,
  })
  if (!res.ok) throw new HttpError(res.status, `SubsPlease returned ${res.status}`)
  let data
  try {
    data = await res.json()
  } catch {
    // Their own no-results payload is `[]`, but a challenge page arrives as
    // HTML and must not be read as an honest zero.
    throw new ParseError('SubsPlease returned a response that is not JSON')
  }
  if (data === null || typeof data !== 'object') {
    throw new ParseError('SubsPlease returned an unexpected response')
  }
  const out = []
  // Show entries arrive as an object keyed by show; no results is `[]`.
  for (const item of Object.values(data)) {
    const dl = bestDownload(item.downloads ?? [])
    if (!dl?.magnet) continue
    const parsed = parseMagnet(dl.magnet)
    if (!parsed) continue
    const show = item.show ?? 'Unknown'
    const ep = item.episode ? ` - ${item.episode}` : ''
    const xl = dl.magnet.match(/[?&]xl=(\d+)/)
    out.push({
      infoHash: parsed.infoHash,
      name: `${show}${ep} [${dl.res ?? '?'}p]`,
      sizeBytes: xl ? Number(xl[1]) : 0,
      seeders: 0,
      leechers: 0,
      source: 'subsplease',
      magnet: parsed.magnet,
      added: item.release_date ? new Date(item.release_date).getTime() / 1000 : undefined,
      url: item.page ? `https://subsplease.org/shows/${item.page}/` : undefined,
    })
  }
  return out
}

// ---------- BitTorrented ----------
async function bittorrentedSearch(query, opts = {}) {
  const q = query.trim()
  if (q.length < 3) return []
  const params = new URLSearchParams({
    q,
    type: 'video',
    limit: '50',
    sortBy: 'seeders',
    sortOrder: 'desc',
  })
  const res = await fetchResilient(`https://bittorrented.com/api/search/torrents?${params}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: opts.signal,
    retries: 1,
  })
  if (!res.ok) throw new HttpError(res.status, `BitTorrented returned ${res.status}`)
  let data
  try {
    data = await res.json()
  } catch {
    throw new ParseError('BitTorrented returned a response that is not JSON')
  }
  if (!data || !Array.isArray(data.results)) {
    throw new ParseError('BitTorrented returned an unexpected response (no result list)')
  }
  const out = []
  for (const t of data.results) {
    const infoHash = t.torrent_infohash?.toLowerCase()
    if (!infoHash || !/^[a-f0-9]{40}$/.test(infoHash)) continue
    const name = t.torrent_name || infoHash
    const added = t.torrent_created_at ? Math.floor(Date.parse(t.torrent_created_at) / 1000) : undefined
    out.push({
      infoHash,
      name,
      sizeBytes: t.torrent_total_size ?? 0,
      seeders: t.torrent_seeders ?? 0,
      leechers: t.torrent_leechers ?? 0,
      numFiles: t.torrent_file_count,
      source: 'bittorrented',
      magnet: magnet(infoHash, name),
      added: Number.isNaN(added) ? undefined : added,
    })
  }
  return out
}

// ---------- Source registry ----------
export const SOURCES = [
  { id: 'fitgirl', label: 'FitGirl', groups: ['Games'], homepage: HOMEPAGES.fitgirl, search: fitgirlSearch },
  { id: 'yts', label: 'YTS', groups: ['Movies'], homepage: HOMEPAGES.yts, search: ytsSearch },
  { id: 'tpb-movies', label: 'TPB', groups: ['Movies'], homepage: HOMEPAGES['tpb-movies'], search: (q, o) => tpbSearch(q, TPB_MOVIE_CATS, TPB_TOP_MOVIES, '207', 'tpb-movies', o) },
  { id: 'x1337-movies', label: '1337x', groups: ['Movies'], homepage: HOMEPAGES['x1337-movies'], search: (q, o) => x1337Search(q, 'Movies', 'x1337-movies', o) },
  { id: 'eztv', label: 'EZTV', groups: ['TV'], homepage: HOMEPAGES.eztv, search: eztvSearch },
  { id: 'tpb-tv', label: 'TPB', groups: ['TV'], homepage: HOMEPAGES['tpb-tv'], search: (q, o) => tpbSearch(q, TPB_TV_CATS, TPB_TOP_TV, '208', 'tpb-tv', o) },
  { id: 'x1337-tv', label: '1337x', groups: ['TV'], homepage: HOMEPAGES['x1337-tv'], search: (q, o) => x1337Search(q, 'TV', 'x1337-tv', o) },
  { id: 'nyaa', label: 'Nyaa', groups: ['Anime'], homepage: HOMEPAGES.nyaa, search: nyaaSearch },
  { id: 'subsplease', label: 'SubsPlease', groups: ['Anime'], homepage: HOMEPAGES.subsplease, search: subsPleaseSearch },
  { id: 'bittorrented', label: 'BitTorrented', groups: ['Movies', 'TV'], homepage: HOMEPAGES.bittorrented, search: bittorrentedSearch },
]

export const GROUPS = ['Games', 'Movies', 'TV', 'Anime']

const CACHE_TTL = 5 * 60 * 1000
const cache = new Map()

// Circuit breaker: a source that fails hard is skipped for several minutes
// so a dead tracker (e.g. apibay.org) can't stall every search for the full
// per-source timeout.
const FAIL_TTL = 5 * 60 * 1000
const deadSources = new Map()

// Merge the rows every source produced. Identical releases (same info hash)
// are collapsed into one row that keeps provenance: `sources` lists every
// source that returned it, while name/size/seeds/url stay on the copy with
// the stronger metadata. Rows without an info hash are never merged with
// anything — a title alone is not an identity, and similar titles can be
// different releases.
export function mergeResults(rows) {
  const merged = new Map()
  const unkeyed = []
  for (const r of rows) {
    if (!r || !r.infoHash) {
      if (r) unkeyed.push(r)
      continue
    }
    const prev = merged.get(r.infoHash)
    if (!prev) {
      merged.set(r.infoHash, { ...r, sources: [...(r.sources ?? (r.source ? [r.source] : []))] })
      continue
    }
    for (const s of r.sources ?? []) if (!prev.sources.includes(s)) prev.sources.push(s)
    if (r.source && !prev.sources.includes(r.source)) prev.sources.push(r.source)
    if ((r.seeders ?? 0) > (prev.seeders ?? 0)) {
      const sources = prev.sources
      Object.assign(prev, r, { sources })
    }
  }
  return [...merged.values(), ...unkeyed]
}

export async function searchAll(query, opts = {}) {
  const perSource = {}
  const parentController = opts.controller ?? new AbortController()
  const timeoutMs = opts.timeoutMs ?? 8000
  const onSource = opts.onSource
  const sources = opts.sources ?? SOURCES
  const results = []

  const runs = sources.map(async (src) => {
    const controller = new AbortController()
    const onParentAbort = () => controller.abort()
    if (parentController.signal.aborted) controller.abort()
    else parentController.signal.addEventListener('abort', onParentAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()

    const key = `${src.id}::${query.trim().toLowerCase()}`
    const hit = cache.get(key)
    const start = { loading: true, error: null, code: null, count: 0, status: 'loading' }
    perSource[src.id] = start
    try {
      let found
      let skipped = false
      const held = deadSources.get(src.id)
      if (held && held.until > Date.now()) {
        // Report the ORIGINAL failure kind, not a generic mystery message.
        skipped = true
        start.status = held.status
        start.code = held.code
        start.error = `${held.error} (not retried for another ${Math.max(
          1,
          Math.ceil((held.until - Date.now()) / 1000),
        )}s after recent failures)`
        found = []
      } else if (hit && Date.now() - hit.at < CACHE_TTL) {
        found = hit.results
      } else {
        try {
          found = await src.search(query, { signal: controller.signal })
          if (!Array.isArray(found)) {
            throw new ParseError(`${src.id} returned a result list that is not an array`)
          }
          cache.set(key, { at: Date.now(), results: found })
        } catch (err) {
          const cancelled = parentController.signal.aborted
          const timedOut = controller.signal.aborted && !cancelled
          if (!cancelled) {
            // A source that just failed is skipped for a few minutes so its
            // timeout/403 can't be added to every future search — but the
            // exact failure kind is remembered and still reported.
            deadSources.set(src.id, {
              until: Date.now() + FAIL_TTL,
              status: classifyFailure(err, { cancelled, timedOut }),
              code: err instanceof HttpError ? err.status : null,
              error: err instanceof Error ? err.message : String(err),
            })
          }
          throw err
        }
      }
      start.loading = false
      if (skipped) {
        start.results = []
      } else {
        start.count = found.length
        start.status = found.length > 0 ? 'ok' : 'empty'
        start.results = found
        results.push(...found)
      }
    } catch (err) {
      const cancelled = parentController.signal.aborted
      const timedOut = controller.signal.aborted && !cancelled
      start.loading = false
      start.status = classifyFailure(err, { cancelled, timedOut })
      start.error = err instanceof Error ? err.message : String(err)
      start.code = err instanceof HttpError ? err.status : null
    } finally {
      clearTimeout(timer)
      parentController.signal.removeEventListener('abort', onParentAbort)
      onSource?.(src.id, {
        loading: false,
        count: start.count,
        error: start.error,
        code: start.code,
        status: start.status,
        results: start.results ?? [],
      })
    }
  })

  await Promise.all(runs)
  const merged = mergeResults(results).sort(
    (a, b) => (b.seeders !== a.seeders ? b.seeders - a.seeders : (b.added ?? 0) - (a.added ?? 0)),
  )
  return { results: merged, perSource }
}
