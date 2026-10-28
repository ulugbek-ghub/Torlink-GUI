import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  searchAll,
  mergeResults,
  classifyFailure,
  HttpError,
  ParseError,
  SOURCES,
} from '../server/search.js'
import { SOURCE_LABELS, SOURCE_GROUPS } from '../src/format.js'

const HASH = (c) => c.repeat(40)
const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })

test('source registry: unique ids, every id has frontend labels/groups, twins are category-scoped', () => {
  const ids = SOURCES.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate source registration')
  assert.deepEqual(new Set(Object.keys(SOURCE_LABELS)), new Set(ids), 'SOURCE_LABELS out of sync')
  assert.deepEqual(new Set(Object.keys(SOURCE_GROUPS)), new Set(ids), 'SOURCE_GROUPS out of sync')
  // The two "TPB" and two "1337x" entries are the same provider searched
  // against two different categories — genuinely distinct registrations,
  // which the UI must disambiguate.
  for (const label of ['TPB', '1337x']) {
    const twins = SOURCES.filter((s) => s.label === label)
    assert.equal(twins.length, 2)
    assert.notDeepEqual(twins[0].groups, twins[1].groups)
  }
  for (const s of SOURCES) {
    assert.ok(s.groups?.length, `${s.id} has no group`)
    assert.equal(typeof s.search, 'function', `${s.id} has no search function`)
  }
})

test('failure classification is distinct for every error kind', () => {
  assert.equal(classifyFailure(new HttpError(403, 'blocked'), {}), 'forbidden')
  assert.equal(classifyFailure(new HttpError(401, 'unauthorized'), {}), 'forbidden')
  assert.equal(classifyFailure(new HttpError(429, 'slow down'), {}), 'rate_limited')
  assert.equal(classifyFailure(new HttpError(503, 'upstream down'), {}), 'unavailable')
  assert.equal(classifyFailure(new HttpError(504, 'gateway'), {}), 'unavailable')
  assert.equal(classifyFailure(new HttpError(0, 'dns failed'), {}), 'unavailable')
  assert.equal(classifyFailure(new ParseError('not an RSS feed'), {}), 'invalid')
  assert.equal(classifyFailure(new SyntaxError('Unexpected token < in JSON'), {}), 'invalid')
  assert.equal(classifyFailure(new Error('slow source'), { timedOut: true }), 'timeout')
  assert.equal(classifyFailure(new Error('user left'), { cancelled: true }), 'cancelled')
  assert.equal(classifyFailure(abortError(), {}), 'timeout')
  // Cancellation wins over every other interpretation.
  assert.equal(classifyFailure(new HttpError(403, 'x'), { cancelled: true }), 'cancelled')
})

test('partial failures: successful sources survive, failures keep their exact kind', async () => {
  const sources = [
    {
      id: 'pf-ok',
      search: async () => [
        { infoHash: HASH('a'), name: 'Movie 2160p WEB', seeders: 5, source: 'pf-ok', sizeBytes: 1 },
      ],
    },
    { id: 'pf-403', search: async () => { throw new HttpError(403, 'pf-403 returned 403') } },
    { id: 'pf-empty', search: async () => [] },
    { id: 'pf-503', search: async () => { throw new HttpError(503, 'pf-503 returned 503') } },
    { id: 'pf-garbage', search: async () => { throw new ParseError('pf-garbage is not JSON') } },
  ]
  const { results, perSource } = await searchAll('partial failure probe', { sources, timeoutMs: 3000 })

  // A failing source must not discard successful results.
  assert.equal(results.length, 1)
  assert.equal(results[0].name, 'Movie 2160p WEB')

  assert.equal(perSource['pf-ok'].status, 'ok')
  assert.equal(perSource['pf-ok'].count, 1)
  assert.equal(perSource['pf-403'].status, 'forbidden')
  assert.equal(perSource['pf-403'].code, 403)
  assert.equal(perSource['pf-empty'].status, 'empty')
  assert.equal(perSource['pf-empty'].count, 0)
  assert.equal(perSource['pf-empty'].error, null)
  assert.equal(perSource['pf-503'].status, 'unavailable')
  assert.equal(perSource['pf-garbage'].status, 'invalid')

  // An HTTP error is never a "successful" search: count stays 0, status != ok.
  for (const id of ['pf-403', 'pf-503', 'pf-garbage']) {
    assert.notEqual(perSource[id].status, 'ok')
    assert.equal(perSource[id].count, 0)
  }
})

test('empty results are healthy, distinguishable from failures', async () => {
  const sources = [{ id: 'er-empty', search: async () => [] }]
  const { results, perSource } = await searchAll('empty results probe', { sources, timeoutMs: 3000 })
  assert.equal(results.length, 0)
  assert.equal(perSource['er-empty'].status, 'empty')
  assert.equal(perSource['er-empty'].error, null)
  assert.equal(perSource['er-empty'].count, 0)
})

test('a slow source times out without delaying or failing the others', async () => {
  const sources = [
    { id: 'to-fast', search: async () => [{ infoHash: HASH('b'), name: 'Fast 1080p', seeders: 9, source: 'to-fast' }] },
    {
      id: 'to-slow',
      search: (_q, o) =>
        new Promise((_resolve, reject) => {
          o.signal.addEventListener('abort', () => reject(abortError()), { once: true })
        }),
    },
  ]
  const started = Date.now()
  const { results, perSource } = await searchAll('timeout probe', { sources, timeoutMs: 400 })
  const elapsed = Date.now() - started

  assert.equal(results.length, 1)
  assert.equal(results[0].name, 'Fast 1080p')
  assert.equal(perSource['to-slow'].status, 'timeout')
  assert.equal(perSource['to-fast'].status, 'ok')
  assert.ok(elapsed < 3000, `search took ${elapsed}ms`)
})

test('cancellation marks sources cancelled, never failed, and settles quickly', async () => {
  const controller = new AbortController()
  const sources = [
    {
      id: 'cx-hang',
      search: (_q, o) =>
        new Promise((_resolve, reject) => {
          o.signal.addEventListener('abort', () => reject(abortError()), { once: true })
        }),
    },
  ]
  const run = searchAll('cancellation probe', { sources, controller, timeoutMs: 60000 })
  setTimeout(() => controller.abort(), 40)
  const started = Date.now()
  const { perSource, results } = await run
  const elapsed = Date.now() - started

  assert.ok(elapsed < 5000, `settled in ${elapsed}ms`)
  assert.equal(perSource['cx-hang'].status, 'cancelled')
  assert.equal(perSource['cx-hang'].count, 0)
  assert.equal(results.length, 0)
})

test('dedup: identical release from two sources merges once, with provenance', async () => {
  const hash = HASH('d')
  const sources = [
    { id: 'dd-one', search: async () => [{ infoHash: hash, name: 'Same.Release.2160p', seeders: 4, source: 'dd-one', sizeBytes: 10 }] },
    { id: 'dd-two', search: async () => [{ infoHash: hash, name: 'Same.Release.2160p', seeders: 40, source: 'dd-two', sizeBytes: 20 }] },
  ]
  const { results } = await searchAll('dedup probe', { sources, timeoutMs: 3000 })
  assert.equal(results.length, 1)
  assert.equal(results[0].seeders, 40, 'kept the copy with better metadata')
  assert.equal(results[0].sizeBytes, 20)
  assert.deepEqual(results[0].sources, ['dd-one', 'dd-two'])
  assert.equal(results[0].name, 'Same.Release.2160p', 'original title retained')
})

test('dedup: similar titles with different hashes are different releases', () => {
  const merged = mergeResults([
    { infoHash: HASH('1'), name: 'Movie.2026.2160p.WEB', seeders: 5, source: 'yts' },
    { infoHash: HASH('2'), name: 'Movie.2026.2160p.WEB', seeders: 500, source: 'tpb-movies' },
    { infoHash: HASH('3'), name: 'Movie.2026.1080p.WEB', seeders: 4000, source: 'tpb-movies' },
  ])
  assert.equal(merged.length, 3, 'distinct releases must not be merged')
})

test('dedup: rows without an info hash are never merged by title', () => {
  const merged = mergeResults([
    { name: 'Unknown hash A', seeders: 1, source: 'x' },
    { name: 'Unknown hash A', seeders: 2, source: 'y' },
  ])
  assert.equal(merged.length, 2)
})

test('results are ordered by seeders, then recency', async () => {
  const sources = [
    { id: 'so-low', search: async () => [{ infoHash: HASH('4'), name: 'low', seeders: 3, source: 'so-low', added: 100 }] },
    { id: 'so-high', search: async () => [{ infoHash: HASH('5'), name: 'high', seeders: 300, source: 'so-high', added: 50 }] },
    { id: 'so-mid', search: async () => [{ infoHash: HASH('6'), name: 'mid', seeders: 300, source: 'so-mid', added: 90 }] },
  ]
  const { results } = await searchAll('ordering probe', { sources, timeoutMs: 3000 })
  assert.deepEqual(results.map((r) => r.name), ['mid', 'high', 'low'])
})

test('per-source status is streamed to onSource as it finishes', async () => {
  const seen = []
  const sources = [
    { id: 'st-ok', search: async () => [{ infoHash: HASH('7'), name: 'n', seeders: 1, source: 'st-ok' }] },
    { id: 'st-bad', search: async () => { throw new HttpError(403, 'nope') } },
  ]
  await searchAll('stream probe', {
    sources,
    timeoutMs: 3000,
    onSource: (id, info) => seen.push([id, info.status, info.count]),
  })
  assert.deepEqual(seen.sort(), [
    ['st-bad', 'forbidden', 0],
    ['st-ok', 'ok', 1],
  ])
})
