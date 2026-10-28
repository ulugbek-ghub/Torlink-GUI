import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyResolution, filterByResolution, matchesResolution, RES_FILTERS } from '../src/format.js'

test('recognises common 2160p / 4K indicators', () => {
  const names = [
    'Project.Hail.Mary.2026.2160p.WEB-DL.H.265-RDNYB',
    'Some Movie (2026) [2160p] [BluRay] [5.1]',
    'Big Buck Bunny 4K HDR',
    'Nature Documentary UHD BluRay Remux DV',
    'Clip 3840x2160 x265',
    'Wall.2160P.HDR10+.WEB',
  ]
  for (const name of names) assert.equal(classifyResolution(name), '2160p', name)
})

test('recognises 1080p, 720p and lower', () => {
  assert.equal(classifyResolution('Movie (2026) 1080p WEBRip [5.1]'), '1080p')
  assert.equal(classifyResolution('Movie 1920x1080 BluRay'), '1080p')
  assert.equal(classifyResolution('Show 720p HEVC'), '720p')
  assert.equal(classifyResolution('Old Movie 480p XviD'), '480p')
  assert.equal(classifyResolution('PAL rip 576p'), '576p')
  assert.equal(classifyResolution('Low quality 360p'), '360p')
  assert.equal(classifyResolution('FullHD release FHD'), '1080p')
})

test('aliases never override an explicit lower resolution (no 4K false positives)', () => {
  // UHD + an explicit pixel height is a 1080p file in release naming.
  assert.equal(
    classifyResolution('Project Hail Mary (2026) UHD BDRip IMAX 1080p AV1 HDR10 Atmos'),
    '1080p',
  )
  assert.equal(classifyResolution('IMAX 10bit 4KDS 1080p AV1tester.mkv'), '1080p')
  assert.equal(classifyResolution('TrueHD Atmos 7.1 1080p WEB-DL'), '1080p')
  assert.equal(classifyResolution('UHD rip 720p x264'), '720p')
})

test('years, audio channels, sizes and codecs are not resolutions', () => {
  const unknowns = [
    'Project Hail Mary (2026) WEBRip x264 AAC 5.1',
    'Album FLAC 24bit 4000kbps 7.1 Surround',
    'Game.Repack.v1.4.2-INSIDER',
    'Some.Show.S02E04.x264-GRP',
    'Random file 4.7GB complete',
    'AK47 documentary collection',
    'Bundle of 4 files x265',
  ]
  for (const name of unknowns) assert.equal(classifyResolution(name), null, name)
})

test('resolution filter buckets partition results correctly', () => {
  const rows = [
    { name: 'A 2160p WEB' },
    { name: 'B 1080p WEB' },
    { name: 'C UHD BluRay' },
    { name: 'D UHD BDRip IMAX 1080p' },
    { name: 'E untagged release' },
    { name: 'F 720p' },
    { name: 'G 480p' },
  ]
  const pick = (f) => filterByResolution(rows, f).map((r) => r.name)

  assert.deepEqual(pick('2160p'), ['A 2160p WEB', 'C UHD BluRay'])
  assert.deepEqual(pick('1080p'), ['B 1080p WEB', 'D UHD BDRip IMAX 1080p'])
  assert.deepEqual(pick('sd'), ['F 720p', 'G 480p'])
  assert.deepEqual(pick('unknown'), ['E untagged release'])
  assert.equal(pick('all').length, rows.length)
  // Buckets must not overlap: every row lands in exactly one non-all bucket.
  const bucketed = [...pick('2160p'), ...pick('1080p'), ...pick('sd'), ...pick('unknown')]
  assert.equal(bucketed.length, rows.length)
})

test('a 2160p filter never includes a known 1080p result', () => {
  const rows = [
    { name: 'Hail Mary 1080p' },
    { name: 'Hail Mary UHD 1080p' },
    { name: 'Hail Mary 4KDS 1080p' },
    { name: 'Hail Mary 720p' },
    { name: 'Hail Mary unknown' },
  ]
  const fourK = filterByResolution(rows, '2160p')
  assert.equal(fourK.length, 0)
  for (const row of rows) {
    if (classifyResolution(row.name) !== '2160p') {
      assert.equal(matchesResolution(row, '2160p'), false, row.name)
    }
  }
})

test('filter ids match the RES_FILTERS definition', () => {
  assert.deepEqual(
    RES_FILTERS.map((f) => f.id),
    ['all', '2160p', '1080p', 'sd', 'unknown'],
  )
  for (const f of RES_FILTERS) assert.equal(typeof f.label, 'string')
})
