export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

export function formatSpeed(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '—'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bytesPerSec
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

export function formatCompact(n) {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 10000) return String(Math.round(n))
  const k = Math.round(n / 1000)
  if (k < 1000) return `${k}k`
  const m = n / 1e6
  return m < 10 ? `${m.toFixed(1).replace(/\.0$/, '')}m` : `${Math.round(m)}m`
}

export function timeAgo(unix) {
  if (!unix || !Number.isFinite(unix) || unix <= 0) return '—'
  const elapsed = Date.now() / 1000 - unix
  if (elapsed < 60) return 'now'
  const min = Math.floor(elapsed / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) {
    const m = min % 60
    return m > 0 ? `${hr}h ${m}m ago` : `${hr}h ago`
  }
  const d = Math.floor(hr / 24)
  return d < 365 ? `${d}d ago` : `${Math.floor(d / 365)}y ago`
}

export function statusLabel(status) {
  const map = {
    queued: 'Queued',
    checking: 'Checking',
    downloading: 'Downloading',
    paused: 'Paused',
    seeding: 'Seeding',
    done: 'Complete',
    error: 'Error',
    missing: 'Missing',
    metadata: 'Fetching metadata',
  }
  return map[status] ?? status ?? '—'
}

// Class must be derived from the RAW status, not the translated label:
// statusLabel('done') is "Complete", which would look for `.status-complete`
// while the stylesheet defines `.status-done`.
export function statusClass(status) {
  const key = String(status ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return key ? `status-${key}` : 'status-queued'
}

export const SOURCE_COLORS = {
  yts: '#7b5cff',
  'tpb-movies': '#ff5c7b',
  'tpb-tv': '#ff5c7b',
  'x1337-movies': '#3ec6ff',
  'x1337-tv': '#3ec6ff',
  eztv: '#2fd6a5',
  fitgirl: '#ff9f43',
  nyaa: '#ffd166',
  subsplease: '#8a5cff',
  bittorrented: '#5cb8ff',
}

export const SOURCE_LABELS = {
  yts: 'YTS',
  'tpb-movies': 'TPB',
  'tpb-tv': 'TPB',
  'x1337-movies': '1337x',
  'x1337-tv': '1337x',
  eztv: 'EZTV',
  fitgirl: 'FitGirl',
  nyaa: 'Nyaa',
  subsplease: 'SubsPlease',
  bittorrented: 'BitTorrented',
}

export const SOURCE_GROUPS = {
  fitgirl: ['Games'],
  yts: ['Movies'],
  'tpb-movies': ['Movies'],
  'x1337-movies': ['Movies'],
  eztv: ['TV'],
  'tpb-tv': ['TV'],
  'x1337-tv': ['TV'],
  nyaa: ['Anime'],
  subsplease: ['Anime'],
  bittorrented: ['Movies', 'TV'],
}

export const SOURCE_HOMEPAGES = {
  fitgirl: 'https://fitgirl-repacks.site',
  yts: 'https://yts.mx',
  'tpb-movies': 'https://thepiratebay.org',
  'tpb-tv': 'https://thepiratebay.org',
  'x1337-movies': 'https://1337x.to',
  'x1337-tv': 'https://1337x.to',
  eztv: 'https://eztvx.to',
  nyaa: 'https://nyaa.si',
  subsplease: 'https://subsplease.org',
  bittorrented: 'https://bittorrented.com',
}

export const GROUPS = ['Games', 'Movies', 'TV', 'Anime']

// ---------- Resolution classification ----------
// Release titles carry resolution in several shapes: 2160p, 1080p, 720p,
// 3840x2160, 1920x1080, "4K", "UHD", "FHD". Numbers that are not
// resolutions must never be read as one: years (2026), audio channels
// (5.1, 7.1), file sizes (4.7GB), codecs (x264, H.265), bitrates
// (4000kbps) and episode codes (S02E04) all stay unclassified.
// When a title names both a hi-fi container and a pixel height
// ("UHD BDRip IMAX 1080p" is a 1080p file), an explicit P-height wins
// and the alias is ignored — that is exactly how 4K false positives
// used to appear. Aliases (4K/UHD/FHD) only apply when no explicit
// height exists anywhere in the title.
const RES_ORDER = ['2160p', '1080p', '720p', '576p', '480p', '360p']
const RES_EXPLICIT = [
  [/\b2160\s?[pi]\b/i, '2160p'],
  [/\b1920\s*[x×]\s*1080\b/i, '1080p'],
  [/\b3840\s*[x×]\s*2160\b/i, '2160p'],
  [/\b1080\s?[pi]\b/i, '1080p'],
  [/\b1280\s*[x×]\s*720\b/i, '720p'],
  [/\b720\s?[pi]\b/i, '720p'],
  [/\b576\s?[pi]\b/i, '576p'],
  [/\b480\s?[pi]\b/i, '480p'],
  [/\b360\s?[pi]\b/i, '360p'],
]
const RES_ALIASES = [
  [/\b4k\b/i, '2160p'],
  [/\buhd\b/i, '2160p'],
  [/\bfhd\b/i, '1080p'],
]

const bestOf = (a, b) =>
  a === null ? b : b === null ? a : RES_ORDER.indexOf(a) <= RES_ORDER.indexOf(b) ? a : b

export function classifyResolution(name) {
  const text = String(name ?? '')
  let found = null
  for (const [re, res] of RES_EXPLICIT) if (re.test(text)) found = bestOf(found, res)
  if (found) return found
  for (const [re, res] of RES_ALIASES) if (re.test(text)) return res
  return null
}

export const RES_FILTERS = [
  { id: 'all', label: 'All resolutions' },
  { id: '2160p', label: '2160p / 4K' },
  { id: '1080p', label: '1080p' },
  { id: 'sd', label: '720p and below' },
  { id: 'unknown', label: 'Unknown' },
]

export function matchesResolution(row, filter) {
  if (!filter || filter === 'all') return true
  const res = classifyResolution(row?.name)
  if (filter === 'unknown') return res === null
  if (filter === 'sd') return res !== null && res !== '2160p' && res !== '1080p'
  return res === filter
}

export function filterByResolution(list, filter) {
  return (list ?? []).filter((r) => matchesResolution(r, filter))
}

// The status panel lists each registration once; category-scoped twins
// (the same provider searched against two categories) need distinguishable
// names there, while result badges keep the short label above.
export const SOURCE_CHIP_LABELS = {
  ...SOURCE_LABELS,
  'tpb-movies': 'TPB · Movies',
  'tpb-tv': 'TPB · TV',
  'x1337-movies': '1337x · Movies',
  'x1337-tv': '1337x · TV',
}
