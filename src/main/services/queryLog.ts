/**
 * Application-level query timing log.
 * Records all queries executed through Mango with their duration.
 * Works on any database engine (MongoDB, CosmosDB, Atlas restricted).
 */

export interface QueryLogEntry {
  ts: string
  op: string
  ns: string
  millis: number
  command: Record<string, unknown>
  planSummary: string
}

const MAX_ENTRIES = 500
const entries: QueryLogEntry[] = []
let slowThresholdMs = 0  // 0 = log everything

export function setSlowThreshold(ms: number): void {
  slowThresholdMs = ms
}

export function getSlowThreshold(): number {
  return slowThresholdMs
}

export function recordQuery(
  database: string,
  collection: string,
  op: string,
  command: Record<string, unknown>,
  durationMs: number
): void {
  if (slowThresholdMs > 0 && durationMs < slowThresholdMs) return

  const entry: QueryLogEntry = {
    ts: new Date().toISOString(),
    op,
    ns: `${database}.${collection}`,
    millis: Math.round(durationMs),
    command,
    planSummary: ''
  }

  entries.unshift(entry)
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES
}

export function getEntries(limit: number = 100, namespace?: string): QueryLogEntry[] {
  let result = entries
  if (namespace) result = result.filter((e) => e.ns.startsWith(namespace))
  return result.slice(0, limit)
}

export function clear(): void {
  entries.length = 0
}

/**
 * Wraps an async function to record its timing in the query log.
 */
export async function timed<T>(
  database: string,
  collection: string,
  op: string,
  command: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    const duration = performance.now() - start
    recordQuery(database, collection, op, command, duration)
  }
}
