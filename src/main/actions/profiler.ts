import * as mongoService from '../services/mongodb'

export async function getProfilingStatus(database: string): Promise<{ was: number; slowms: number }> {
  const db = mongoService.getDb(database)
  const result = await db.command({ profile: -1 })
  return { was: result.was, slowms: result.slowms }
}

export async function setProfilingLevel(
  database: string,
  level: 0 | 1 | 2,
  slowms?: number
): Promise<void> {
  const db = mongoService.getDb(database)
  const cmd: Record<string, unknown> = { profile: level }
  if (slowms !== undefined) cmd.slowms = slowms
  await db.command(cmd)
}

export async function getProfilingData(
  database: string,
  limit: number = 100,
  namespace?: string
): Promise<Record<string, unknown>[]> {
  const db = mongoService.getDb(database)
  const filter: Record<string, unknown> = {}
  if (namespace) filter.ns = namespace

  const docs = await db
    .collection('system.profile')
    .find(filter)
    .sort({ millis: -1 })
    .limit(limit)
    .toArray()

  return docs.map((doc) => ({
    ts: doc.ts ? new Date(doc.ts as Date).toISOString() : '',
    op: String(doc.op ?? ''),
    ns: String(doc.ns ?? ''),
    millis: Number(doc.millis ?? 0),
    planSummary: String(doc.planSummary ?? ''),
    docsExamined: Number(doc.docsExamined ?? 0),
    keysExamined: Number(doc.keysExamined ?? 0),
    nreturned: Number(doc.nreturned ?? 0),
    command: (doc.command as Record<string, unknown>) ?? {},
    rawDoc: doc as Record<string, unknown>
  }))
}

export async function clearProfilingData(database: string): Promise<void> {
  const db = mongoService.getDb(database)
  await db.collection('system.profile').drop().catch(() => {})
}
