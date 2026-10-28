// Platform-specific locations, kept in one place so the Windows and macOS
// builds use the same engine with native conventions on each OS.
//
// Every helper accepts an optional platform/env/home so the Windows layout can
// be unit-tested on macOS (see test/platform.test.js).
import os from 'node:os'
import { posix, win32 } from 'node:path'

export const isWindows = process.platform === 'win32'

export function pathFor(platform = process.platform) {
  return platform === 'win32' ? win32 : posix
}

// %APPDATA%\torlink-gui on Windows, ~/Library/Application Support on macOS,
// $XDG_CONFIG_HOME (or ~/.config) on Linux.
export function settingsDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const p = pathFor(platform)
  if (platform === 'win32') {
    const base = env.APPDATA || p.join(home, 'AppData', 'Roaming')
    return p.join(base, 'torlink-gui')
  }
  if (platform === 'darwin') {
    return p.join(home, 'Library', 'Application Support', 'torlink-gui')
  }
  return p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), 'torlink-gui')
}

// Older builds stored settings in ~/.config on every platform. macOS/Linux
// keep reading it so nobody loses their download folder after upgrading.
export function legacySettingsDir({ platform = process.platform, home = os.homedir() } = {}) {
  if (platform === 'win32') return null
  return posix.join(home, '.config', 'torlink-gui')
}

// torlnk itself defaults to <home>/Downloads/torlink on every platform.
export function defaultDownloadDir({ platform = process.platform, home = os.homedir() } = {}) {
  return pathFor(platform).join(home, 'Downloads', 'torlink')
}

// Accept what people actually paste: quotes from Explorer's "Copy as path",
// ~ shortcuts from the terminal, and surrounding whitespace.
export function normalizeDownloadDir(value, { platform = process.platform, home = os.homedir() } = {}) {
  let v = String(value ?? '').trim()
  if (v.length >= 2) {
    const first = v[0]
    const last = v[v.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      v = v.slice(1, -1).trim()
    }
  }
  if (!v) return ''
  if (v === '~') return home
  if (v.startsWith('~/') || v.startsWith('~\\')) return pathFor(platform).join(home, v.slice(2))
  return v
}

// Where npm keeps the packages fetched by `npx --yes torlnk` (which is the
// fallback when the bundled torlnk dependency is missing).
export function npxCacheDirs({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const p = pathFor(platform)
  const dirs = []
  if (env.npm_config_cache) dirs.push(p.join(env.npm_config_cache, '_npx'))
  if (platform === 'win32') {
    if (env.LOCALAPPDATA) dirs.push(p.join(env.LOCALAPPDATA, 'npm-cache', '_npx'))
    if (env.APPDATA) dirs.push(p.join(env.APPDATA, 'npm-cache', '_npx'))
    dirs.push(p.join(home, 'AppData', 'Local', 'npm-cache', '_npx'))
    // npm run from Git Bash / MSYS still uses the Unix cache location.
    dirs.push(p.join(home, '.npm', '_npx'))
  } else {
    dirs.push(p.join(home, '.npm', '_npx'))
  }
  return [...new Set(dirs)]
}

// Candidate paths for a torlnk installed with `npm install -g torlnk`.
export function globalTorlnkCandidates({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  execPath = process.execPath,
} = {}) {
  const p = pathFor(platform)
  const suffix = p.join('node_modules', 'torlnk', 'dist', 'cli.cjs')
  const list = []
  const add = (base) => {
    if (base) list.push(p.join(base, suffix))
  }

  if (env.npm_config_prefix) add(p.join(env.npm_config_prefix, platform === 'win32' ? '' : 'lib'))
  if (platform === 'win32') {
    if (env.APPDATA) add(p.join(env.APPDATA, 'npm'))
    add(p.join(home, 'AppData', 'Roaming', 'npm'))
    if (env.ProgramFiles) add(p.join(env.ProgramFiles, 'nodejs'))
    if (env['ProgramFiles(x86)']) add(p.join(env['ProgramFiles(x86)'], 'nodejs'))
    // Portable Node (including the copy this app provisions).
    add(p.dirname(execPath))
  } else {
    add(p.join(p.dirname(p.dirname(execPath)), 'lib'))
    add(p.join(home, '.npm-global', 'lib'))
    add(p.join(home, '.npm-global'))
    add(p.join(home, '.node', 'lib'))
    add('/usr/local/lib')
    add('/usr/lib')
  }
  return [...new Set(list)]
}
