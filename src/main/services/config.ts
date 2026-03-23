import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { safeStorage } from 'electron'
import { CONFIG_DIR, CONNECTIONS_FILE, SETTINGS_FILE } from '../constants'
import type { ConnectionProfile } from '@shared/types'

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
      return connections.map((c) => ({
        ...c,
        uri: c.uri.startsWith('encrypted:')
          ? safeStorage.decryptString(Buffer.from(c.uri.slice(10), 'base64'))
          : c.uri
      }))
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
    ? connections.map((c) => ({
        ...c,
        uri: 'encrypted:' + safeStorage.encryptString(c.uri).toString('base64')
      }))
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
