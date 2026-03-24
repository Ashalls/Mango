import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { CHANGELOG_FILE, CONFIG_DIR } from '../constants'

export interface ChangeLogEntry {
  id: string
  timestamp: string
  source: 'claude' | 'user' | 'mcp'
  connectionId: string
  connectionName: string
  database: string
  collection: string
  operation: 'insert' | 'update' | 'delete' | 'drop' | 'create'
  filter?: Record<string, unknown>
  changes?: Record<string, unknown>
  documentsBefore?: Record<string, unknown>[]
  documentsAfter?: Record<string, unknown>[]
  count?: number
  rolledBack?: boolean
}

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

export function loadChangeLog(): ChangeLogEntry[] {
  ensureDir()
  if (!existsSync(CHANGELOG_FILE)) return []
  try {
    return JSON.parse(readFileSync(CHANGELOG_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export function appendChangeLog(entry: Omit<ChangeLogEntry, 'id' | 'timestamp'>): ChangeLogEntry {
  const log = loadChangeLog()
  const full: ChangeLogEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString()
  }
  log.push(full)
  // Keep last 10000 entries max
  const trimmed = log.length > 10000 ? log.slice(-10000) : log
  ensureDir()
  writeFileSync(CHANGELOG_FILE, JSON.stringify(trimmed, null, 2))
  return full
}

export function markRolledBack(id: string): void {
  const log = loadChangeLog()
  const entry = log.find((e) => e.id === id)
  if (entry) {
    entry.rolledBack = true
    ensureDir()
    writeFileSync(CHANGELOG_FILE, JSON.stringify(log, null, 2))
  }
}

export function getRecentChanges(limit: number = 50): ChangeLogEntry[] {
  const log = loadChangeLog()
  return log.slice(-limit).reverse()
}
