import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { safeStorage } from 'electron'
import { CONFIG_DIR, CONNECTIONS_FILE, FOLDERS_FILE, SETTINGS_FILE } from '../constants'
import type { ConnectionFolder, ConnectionProfile } from '@shared/types'

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
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
  ensureConfigDir()
  const toSave = isEncryptionAvailable()
    ? connections.map((conn) => {
        conn = {
          ...conn,
          uri: 'encrypted:' + safeStorage.encryptString(conn.uri).toString('base64')
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
    : connections
  writeFileSync(CONNECTIONS_FILE, JSON.stringify(toSave, null, 2))
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
