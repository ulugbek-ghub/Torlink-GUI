import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultDownloadDir,
  globalTorlnkCandidates,
  legacySettingsDir,
  normalizeDownloadDir,
  npxCacheDirs,
  settingsDir,
} from '../server/paths.js'

const WIN_HOME = 'C:\\Users\\Ana'
const WIN_ENV = {
  APPDATA: 'C:\\Users\\Ana\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\Ana\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
}

test('settings live in the native config location on each platform', () => {
  assert.equal(
    settingsDir({ platform: 'win32', env: WIN_ENV, home: WIN_HOME }),
    'C:\\Users\\Ana\\AppData\\Roaming\\torlink-gui',
  )
  assert.equal(
    settingsDir({ platform: 'win32', env: {}, home: WIN_HOME }),
    'C:\\Users\\Ana\\AppData\\Roaming\\torlink-gui',
  )
  assert.equal(
    settingsDir({ platform: 'darwin', home: '/Users/ana' }),
    '/Users/ana/Library/Application Support/torlink-gui',
  )
  assert.equal(
    settingsDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/home/ana/.cfg' }, home: '/home/ana' }),
    '/home/ana/.cfg/torlink-gui',
  )
  // There is no legacy Windows location to migrate from.
  assert.equal(legacySettingsDir({ platform: 'win32', home: WIN_HOME }), null)
  assert.equal(legacySettingsDir({ platform: 'darwin', home: '/Users/ana' }), '/Users/ana/.config/torlink-gui')
})

test('the default download folder matches torlnk itself', () => {
  assert.equal(
    defaultDownloadDir({ platform: 'win32', home: WIN_HOME }),
    'C:\\Users\\Ana\\Downloads\\torlink',
  )
  assert.equal(defaultDownloadDir({ platform: 'darwin', home: '/Users/ana' }), '/Users/ana/Downloads/torlink')
})

test('pasted paths are cleaned without changing their meaning', () => {
  assert.equal(normalizeDownloadDir('  "C:\\Users\\Ana\\My Torrents"  ', { platform: 'win32', home: WIN_HOME }), 'C:\\Users\\Ana\\My Torrents')
  assert.equal(normalizeDownloadDir("'C:\\Torrents'", { platform: 'win32', home: WIN_HOME }), 'C:\\Torrents')
  assert.equal(normalizeDownloadDir('~/Media', { platform: 'darwin', home: '/Users/ana' }), '/Users/ana/Media')
  assert.equal(normalizeDownloadDir('~\\Media', { platform: 'win32', home: WIN_HOME }), 'C:\\Users\\Ana\\Media')
  assert.equal(normalizeDownloadDir('~', { platform: 'win32', home: WIN_HOME }), WIN_HOME)
  assert.equal(normalizeDownloadDir('   ', { platform: 'win32', home: WIN_HOME }), '')
  assert.equal(normalizeDownloadDir('D:/Torrents', { platform: 'win32', home: WIN_HOME }), 'D:/Torrents')
})

test('npx cache lookup includes Windows npm locations', () => {
  const dirs = npxCacheDirs({ platform: 'win32', env: WIN_ENV, home: WIN_HOME })
  assert.ok(dirs.includes('C:\\Users\\Ana\\AppData\\Local\\npm-cache\\_npx'))
  assert.ok(dirs.includes('C:\\Users\\Ana\\AppData\\Roaming\\npm-cache\\_npx'))
  assert.ok(dirs.includes('C:\\Users\\Ana\\AppData\\Local\\npm-cache\\_npx'))
  const custom = npxCacheDirs({ platform: 'win32', env: { npm_config_cache: 'D:\\npm-cache' }, home: WIN_HOME })
  assert.equal(custom[0], 'D:\\npm-cache\\_npx')
  assert.ok(npxCacheDirs({ platform: 'darwin', env: {}, home: '/Users/ana' }).includes('/Users/ana/.npm/_npx'))
})

test('global torlnk lookup covers npm prefix, AppData and portable Node on Windows', () => {
  const candidates = globalTorlnkCandidates({
    platform: 'win32',
    env: { ...WIN_ENV, npm_config_prefix: 'C:\\Users\\Ana\\AppData\\Roaming\\npm' },
    home: WIN_HOME,
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
  })
  const needle = 'node_modules\\torlnk\\dist\\cli.cjs'
  assert.ok(candidates.some((p) => p.endsWith(needle) && p.includes('AppData\\Roaming\\npm')))
  assert.ok(candidates.some((p) => p.endsWith(needle) && p.includes('Program Files\\nodejs')))
  assert.ok(candidates.some((p) => p.endsWith(needle) && p.includes('Program Files (x86)\\nodejs')))
})

test('global torlnk lookup covers nvm/Homebrew style Unix installs', () => {
  const candidates = globalTorlnkCandidates({
    platform: 'darwin',
    env: {},
    home: '/Users/ana',
    execPath: '/Users/ana/.nvm/versions/node/v24.0.0/bin/node',
  })
  assert.ok(candidates.includes('/Users/ana/.nvm/versions/node/v24.0.0/lib/node_modules/torlnk/dist/cli.cjs'))
  assert.ok(candidates.includes('/Users/ana/.npm-global/lib/node_modules/torlnk/dist/cli.cjs'))
})
