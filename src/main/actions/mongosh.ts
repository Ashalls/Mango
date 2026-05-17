import { spawn } from 'child_process'
import { writeFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { app } from 'electron'
import * as configService from '../services/config'

/**
 * Discover mongosh install directories on Windows.
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
    } catch { /* ignore */ }
  }

  for (const p of candidates) {
    if (p && existsSync(p)) extra.push(p)
  }
  return extra
}

function buildUriWithDatabase(uri: string, database: string): string {
  const match = uri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)(\/[^?]*)?(\?.*)?$/)
  if (match) {
    return `${match[1]}/${encodeURIComponent(database)}${match[3] || ''}`
  }
  return uri
}

/**
 * Generate a setup script for mongosh that pre-selects the collection.
 * Written to a randomized path in userData (per-user, not /tmp) so other
 * users / processes on the host can't race a malicious replacement.
 */
function writeSetupScript(database: string, collection: string): string {
  const dir = join(app.getPath('userData'), 'mongosh')
  if (!existsSync(dir)) {
    require('fs').mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  const rand = randomBytes(8).toString('hex')
  const setupPath = join(dir, `setup-${rand}.js`)
  const setupCode = [
    `const coll = db.getCollection(${JSON.stringify(collection)})`,
    `print('')`,
    `print(${JSON.stringify(`  Collection: ${database}.${collection}`)})`,
    `print(${JSON.stringify(`  Access via: coll or db[${JSON.stringify(collection)}]`)})`,
    `print('')`
  ].join('\n')
  writeFileSync(setupPath, setupCode, { mode: 0o600 })
  return setupPath
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
    await openMongoshMac(uri, database, collection)
  } else {
    await openMongoshLinux(uri, database, collection)
  }
}

/**
 * Windows: spawn cmd.exe with a `start` builtin so the new console window
 * has its own lifetime. The URI and setup-path are passed as positional
 * args (not interpolated into a string), so quotes/spaces in the URI cannot
 * break out of the command line.
 */
async function openMongoshWindows(
  uri: string,
  database: string,
  label: string,
  collection?: string
): Promise<void> {
  const extraPaths = findMongoshPaths()
  const env = { ...process.env }
  if (extraPaths.length > 0) {
    env.PATH = (env.PATH || '') + ';' + extraPaths.join(';')
  }

  const args = ['/c', 'start', `Mango mongosh: ${label}`, 'cmd', '/k', 'mongosh', uri, '--quiet']
  if (collection) {
    const setupPath = writeSetupScript(database, collection)
    args.push('--file', setupPath, '--shell')
  }
  spawn('cmd.exe', args, { env, detached: true, stdio: 'ignore' }).unref()
}

/**
 * macOS: use the `open -a Terminal` helper with an argv-style command file.
 * Avoids osascript string-escaping entirely.
 */
async function openMongoshMac(
  uri: string,
  database: string,
  collection?: string
): Promise<void> {
  const dir = join(app.getPath('userData'), 'mongosh')
  if (!existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true, mode: 0o700 })

  const setupArg = collection ? `--file ${quoteShell(writeSetupScript(database, collection))} --shell` : ''
  const cmdPath = join(dir, `launch-${randomBytes(8).toString('hex')}.command`)
  const script = [
    '#!/bin/bash',
    `exec mongosh ${quoteShell(uri)} --quiet ${setupArg}`
  ].join('\n')
  writeFileSync(cmdPath, script, { mode: 0o700 })
  spawn('open', ['-a', 'Terminal', cmdPath], { detached: true, stdio: 'ignore' }).unref()
}

/**
 * Linux: try common terminal emulators with proper argv (no shell interpolation).
 */
async function openMongoshLinux(
  uri: string,
  database: string,
  collection?: string
): Promise<void> {
  const mongoshArgs = [uri, '--quiet']
  if (collection) {
    mongoshArgs.push('--file', writeSetupScript(database, collection), '--shell')
  }

  const terminals = [
    { bin: 'x-terminal-emulator', args: ['-e', 'mongosh', ...mongoshArgs] },
    { bin: 'gnome-terminal', args: ['--', 'mongosh', ...mongoshArgs] },
    { bin: 'konsole', args: ['-e', 'mongosh', ...mongoshArgs] },
    { bin: 'xterm', args: ['-e', 'mongosh', ...mongoshArgs] }
  ]

  for (const t of terminals) {
    try {
      const child = spawn(t.bin, t.args, { detached: true, stdio: 'ignore' })
      child.on('error', () => { /* try next */ })
      child.unref()
      return
    } catch { /* continue */ }
  }
  throw new Error('No supported terminal emulator found (tried x-terminal-emulator, gnome-terminal, konsole, xterm)')
}

/** POSIX single-quote escaping. */
function quoteShell(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
