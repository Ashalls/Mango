import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { QUERY_HISTORY_FILE, CONFIG_DIR } from '../constants'

export interface QueryHistoryEntry {
  id: string
  connectionId: string
  database: string
  collection: string
  filter: Record<string, unknown>
  sort: Record<string, number> | null
  projection: Record<string, number> | null
  limit: number
  resultCount: number
  timestamp: number
  pinned: boolean
}

const MAX_ENTRIES = 200

let buffer: QueryHistoryEntry[] | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
}

function readFromDisk(): QueryHistoryEntry[] {
  ensureDir()
  if (!existsSync(QUERY_HISTORY_FILE)) return []
  try {
    return JSON.parse(readFileSync(QUERY_HISTORY_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function flush(): void {
  if (!buffer) return
  ensureDir()
  writeFileSync(QUERY_HISTORY_FILE, JSON.stringify(buffer, null, 2))
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flush()
    flushTimer = null
  }, 500)
}

function getBuffer(): QueryHistoryEntry[] {
  if (!buffer) buffer = readFromDisk()
  return buffer
}

export function loadHistory(): QueryHistoryEntry[] {
  return getBuffer().slice().reverse()
}

export function saveEntry(entry: Omit<QueryHistoryEntry, 'id' | 'timestamp' | 'pinned'>): QueryHistoryEntry {
  const buf = getBuffer()
  const full: QueryHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    pinned: false
  }
  buf.push(full)
  const pinned = buf.filter((e) => e.pinned)
  const unpinned = buf.filter((e) => !e.pinned)
  if (pinned.length + unpinned.length > MAX_ENTRIES) {
    const keep = MAX_ENTRIES - pinned.length
    buffer = [...pinned, ...unpinned.slice(-keep)]
  }
  scheduleFlush()
  return full
}

export function togglePin(id: string): void {
  const buf = getBuffer()
  const entry = buf.find((e) => e.id === id)
  if (entry) {
    entry.pinned = !entry.pinned
    scheduleFlush()
  }
}

export function deleteEntry(id: string): void {
  buffer = getBuffer().filter((e) => e.id !== id)
  scheduleFlush()
}

export function clearHistory(): void {
  buffer = getBuffer().filter((e) => e.pinned)
  scheduleFlush()
}
