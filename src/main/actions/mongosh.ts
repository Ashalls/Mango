import { exec } from 'child_process'
import { writeFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import * as configService from '../services/config'

/**
 * Discover mongosh install directories on Windows.
 * Checks common locations including version-specific standalone installs
 * (e.g. "C:\Program Files (x86)\mongosh-2.8.1-win32-x64\bin").
 */
function findMongoshPaths(): string[] {
  const extra: string[] = []

  const candidates = [
    process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'mongosh') : '',
    'C:\\Program Files\\mongosh\\bin',
    'C:\\Program Files\\MongoDB\\Server\\8.0\\bin',
    'C:\\Program Files\\MongoDB\\Server\\7.0\\bin',
    'C:\\Program Files\\MongoDB\\Server\\6.0\\bin'
  ].filter(Boolean)

  // Scan Program Files directories for mongosh-* standalone installs
  for (const pf of ['C:\\Program Files', 'C:\\Program Files (x86)']) {
    try {
      if (!existsSync(pf)) continue
      for (const entry of readdirSync(pf)) {
        if (entry.toLowerCase().startsWith('mongosh')) {
          const binDir = join(pf, entry, 'bin')
          if (existsSync(join(binDir, 'mongosh.exe'))) {
            candidates.push(binDir)
          }
        }
      }
    } catch { /* ignore permission errors */ }
  }

  for (const p of candidates) {
    if (p && existsSync(p)) extra.push(p)
  }
  return extra
}

function buildUriWithDatabase(uri: string, database: string): string {
  // Match: scheme + authority, then optional /database, then optional ?query
  const match = uri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)(\/[^?]*)?(\?.*)?$/)
  if (match) {
    return `${match[1]}/${encodeURIComponent(database)}${match[3] || ''}`
  }
  return uri
}

export async function openMongosh(
  connectionId: string,
  database: string,
  collection?: string
): Promise<void> {
  const profiles = configService.loadConnections()
  const profile = profiles.find((p) => p.id === connectionId)
  if (!profile) throw new Error('Connection profile not found')

  const uri = buildUriWithDatabase(profile.uri, database)
  const label = collection ? `${database}.${collection}` : database

  if (process.platform === 'win32') {
    await openMongoshWindows(uri, database, label, collection)
  } else if (process.platform === 'darwin') {
    await openMongoshMac(uri, database, label, collection)
  } else {
    await openMongoshLinux(uri, database, label, collection)
  }
}

async function openMongoshWindows(
  uri: string,
  database: string,
  label: string,
  collection?: string
): Promise<void> {
  const batPath = join(app.getPath('temp'), `mango-mongosh-${Date.now()}.bat`)
  // Discover actual mongosh install directories at launch time
  const extraPaths = findMongoshPaths()
  const pathAugment = extraPaths.length > 0 ? ';' + extraPaths.join(';') : ''

  const lines = [
    '@echo off',
    `title Mango mongosh: ${label}`,
    `set "PATH=%PATH%${pathAugment}"`
  ]

  let mongoshCmd: string
  if (collection) {
    const setupPath = join(app.getPath('temp'), `mango-mongosh-setup-${Date.now()}.js`)
    const setupCode = [
      `const coll = db.getCollection(${JSON.stringify(collection)})`,
      `print('')`,
      `print('  Collection: ${database}.${collection}')`,
      `print('  Access via: coll or db.${collection}')`,
      `print('')`
    ].join('\n')
    writeFileSync(setupPath, setupCode)
    mongoshCmd = `mongosh "${uri}" --file "${setupPath}" --shell --quiet`
  } else {
    mongoshCmd = `mongosh "${uri}" --quiet`
  }

  // Run mongosh; if it fails (not found / error), show install guidance
  lines.push(
    mongoshCmd,
    'if errorlevel 1 (',
    '  echo.',
    '  echo   mongosh is not installed or not in your PATH.',
    '  echo.',
    '  echo   Install it from: https://www.mongodb.com/docs/mongodb-shell/install/',
    '  echo.',
    '  pause',
    ')'
  )

  writeFileSync(batPath, lines.join('\r\n') + '\r\n')
  exec(`start "" "${batPath}"`)
}

async function openMongoshMac(
  uri: string,
  _database: string,
  _label: string,
  collection?: string
): Promise<void> {
  const args = [`"${uri}"`, '--quiet']
  if (collection) {
    const setupPath = join(app.getPath('temp'), `mango-mongosh-setup-${Date.now()}.js`)
    const setupCode = `const coll = db.getCollection(${JSON.stringify(collection)})`
    writeFileSync(setupPath, setupCode)
    args.push('--file', `"${setupPath}"`, '--shell')
  }
  const cmd = `mongosh ${args.join(' ')}`
  exec(`osascript -e 'tell app "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"'`)
}

async function openMongoshLinux(
  uri: string,
  _database: string,
  _label: string,
  collection?: string
): Promise<void> {
  const args = [`"${uri}"`, '--quiet']
  if (collection) {
    const setupPath = join(app.getPath('temp'), `mango-mongosh-setup-${Date.now()}.js`)
    const setupCode = `const coll = db.getCollection(${JSON.stringify(collection)})`
    writeFileSync(setupPath, setupCode)
    args.push('--file', `"${setupPath}"`, '--shell')
  }
  const cmd = `mongosh ${args.join(' ')}`
  // Try common terminal emulators
  exec(`x-terminal-emulator -e '${cmd}'`, (err) => {
    if (err) {
      exec(`gnome-terminal -- bash -c '${cmd}; exec bash'`, (err2) => {
        if (err2) {
          exec(`xterm -e '${cmd}'`)
        }
      })
    }
  })
}
