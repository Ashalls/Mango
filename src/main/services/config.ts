import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { safeStorage } from 'electron'
import { CONFIG_DIR, CONNECTIONS_FILE, FOLDERS_FILE, SETTINGS_FILE, CLAUDE_SECRET_FILE } from '../constants'
import type { ConnectionFolder, ConnectionProfile } from '@shared/types'

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
}

function isEncryptionAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    // Reject Electron's Linux `basic_text` backend: it "encrypts" with a
    // hardcoded key and provides no real OS-backed protection — treat it as
    // unavailable so we refuse to persist rather than store weakly-obscured
    // secrets. (getSelectedStorageBackend may be absent on older Electron.)
    const withBackend = safeStorage as unknown as { getSelectedStorageBackend?: () => string }
    if (typeof withBackend.getSelectedStorageBackend === 'function') {
      if (withBackend.getSelectedStorageBackend() === 'basic_text') return false
    }
    return true
  } catch {
    return false
  }
}

export function loadConnections(): ConnectionProfile[] {
  ensureConfigDir()
  if (!existsSync(CONNECTIONS_FILE)) {
    return []
  }
  try {
    const raw = readFileSync(CONNECTIONS_FILE, 'utf-8')
    const connections: ConnectionProfile[] = JSON.parse(raw)
    if (isEncryptionAvailable()) {
      return connections.map((conn) => {
        conn = {
          ...conn,
          uri: conn.uri.startsWith('encrypted:')
            ? safeStorage.decryptString(Buffer.from(conn.uri.slice(10), 'base64'))
            : conn.uri
        }
        if (conn.sshConfig?.password && conn.sshConfig.password.startsWith('encrypted:')) {
          const buf = Buffer.from(conn.sshConfig.password.slice(10), 'base64')
          conn.sshConfig = { ...conn.sshConfig, password: safeStorage.decryptString(buf) }
        }
        if (conn.sshConfig?.passphrase && conn.sshConfig.passphrase.startsWith('encrypted:')) {
          const buf = Buffer.from(conn.sshConfig.passphrase.slice(10), 'base64')
          conn.sshConfig = { ...conn.sshConfig, passphrase: safeStorage.decryptString(buf) }
        }
        if (conn.tlsConfig?.certificateKeyFilePassword && conn.tlsConfig.certificateKeyFilePassword.startsWith('encrypted:')) {
          const buf = Buffer.from(conn.tlsConfig.certificateKeyFilePassword.slice(10), 'base64')
          conn.tlsConfig = { ...conn.tlsConfig, certificateKeyFilePassword: safeStorage.decryptString(buf) }
        }
        return conn
      })
    }
    return connections
  } catch (err) {
    console.error('Failed to load connections:', err)
    return []
  }
}

export function saveConnections(connections: ConnectionProfile[]): void {
  if (!isEncryptionAvailable()) {
    // CLAUDE.md (Secrets): refuse rather than persist connection URIs and
    // SSH/TLS passwords in cleartext when OS secure storage (safeStorage) is
    // unavailable. Checked before touching the filesystem. The caller surfaces
    // this to the user.
    throw new Error(
      'Cannot save connection: OS secure storage (safeStorage) is unavailable, so Mango will not ' +
      'write connection credentials to disk in plaintext. On Linux, ensure a Secret Service / keyring ' +
      '(e.g. gnome-keyring or KWallet) is running, then try again.'
    )
  }
  ensureConfigDir()
  const toSave = connections.map((conn) => {
    conn = {
      ...conn,
      uri: conn.uri.startsWith('encrypted:')
        ? conn.uri
        : 'encrypted:' + safeStorage.encryptString(conn.uri).toString('base64')
    }
    if (conn.sshConfig?.password && !conn.sshConfig.password.startsWith('encrypted:')) {
      conn.sshConfig = { ...conn.sshConfig, password: 'encrypted:' + safeStorage.encryptString(conn.sshConfig.password).toString('base64') }
    }
    if (conn.sshConfig?.passphrase && !conn.sshConfig.passphrase.startsWith('encrypted:')) {
      conn.sshConfig = { ...conn.sshConfig, passphrase: 'encrypted:' + safeStorage.encryptString(conn.sshConfig.passphrase).toString('base64') }
    }
    if (conn.tlsConfig?.certificateKeyFilePassword && !conn.tlsConfig.certificateKeyFilePassword.startsWith('encrypted:')) {
      conn.tlsConfig = { ...conn.tlsConfig, certificateKeyFilePassword: 'encrypted:' + safeStorage.encryptString(conn.tlsConfig.certificateKeyFilePassword).toString('base64') }
    }
    return conn
  })
  writeFileSync(CONNECTIONS_FILE, JSON.stringify(toSave, null, 2), { mode: 0o600 })
}

export function loadSettings(): Record<string, unknown> {
  ensureConfigDir()
  if (!existsSync(SETTINGS_FILE)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

export function saveSettings(settings: Record<string, unknown>): void {
  ensureConfigDir()
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

export function loadFolders(): ConnectionFolder[] {
  ensureConfigDir()
  try {
    const data = readFileSync(FOLDERS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

export function saveFolders(folders: ConnectionFolder[]): void {
  ensureConfigDir()
  writeFileSync(FOLDERS_FILE, JSON.stringify(folders, null, 2))
}

export function hasClaudeApiKey(): boolean {
  ensureConfigDir()
  return existsSync(CLAUDE_SECRET_FILE)
}

export function loadClaudeApiKey(): string | null {
  ensureConfigDir()
  if (!existsSync(CLAUDE_SECRET_FILE)) return null
  try {
    const data = JSON.parse(readFileSync(CLAUDE_SECRET_FILE, 'utf-8')) as { apiKey?: string }
    if (!data.apiKey) return null
    if (data.apiKey.startsWith('encrypted:')) {
      if (!isEncryptionAvailable()) return null
      return safeStorage.decryptString(Buffer.from(data.apiKey.slice(10), 'base64'))
    }
    return data.apiKey
  } catch (err) {
    console.error('Failed to load Claude API key:', err)
    return null
  }
}

export function saveClaudeApiKey(key: string): { ok: boolean; reason?: string } {
  ensureConfigDir()
  const trimmed = key.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }
  if (!isEncryptionAvailable()) return { ok: false, reason: 'encryption-unavailable' }
  const enc = 'encrypted:' + safeStorage.encryptString(trimmed).toString('base64')
  writeFileSync(CLAUDE_SECRET_FILE, JSON.stringify({ apiKey: enc }, null, 2))
  return { ok: true }
}

export function clearClaudeApiKey(): void {
  if (existsSync(CLAUDE_SECRET_FILE)) rmSync(CLAUDE_SECRET_FILE)
}
