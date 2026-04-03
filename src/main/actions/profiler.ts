import * as mongoService from '../services/mongodb'

export async function getProfilingStatus(database: string): Promise<{ was: number; slowms: number; mode: 'native' | 'currentOp' }> {
  const db = mongoService.getDb(database)
  try {
    const result = await db.command({ profile: -1 })
    return { was: result.was, slowms: result.slowms, mode: 'native' }
  } catch {
    // CosmosDB and others that don't support profile command
    // Fall back to currentOp mode
    return { was: -1, slowms: 0, mode: 'currentOp' }
  }
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

export async function getCurrentOps(
  database: string,
  limit: number = 100
): Promise<Record<string, unknown>[]> {
  const adminDb = mongoService.getDb('admin')

  try {
    // Try $currentOp aggregation (works on CosmosDB and MongoDB 3.6+)
    const pipeline = [
      { $currentOp: { allUsers: true, idleSessions: false } },
      { $limit: limit }
    ]
    const docs = await adminDb.aggregate(pipeline).toArray()
    return docs.map((doc) => ({
      ts: doc.currentOpTime ? new Date(doc.currentOpTime as Date).toISOString() : new Date().toISOString(),
      op: String(doc.op ?? doc.type ?? ''),
      ns: String(doc.ns ?? ''),
      millis: Number(doc.microsecs_running ? Math.round((doc.microsecs_running as number) / 1000) : doc.secs_running ? (doc.secs_running as number) * 1000 : 0),
      planSummary: String(doc.planSummary ?? ''),
      docsExamined: 0,
      keysExamined: 0,
      nreturned: 0,
      command: (doc.command as Record<string, unknown>) ?? {},
      rawDoc: doc as Record<string, unknown>
    }))
  } catch {
    // Try legacy currentOp command
    try {
      const result = await adminDb.command({ currentOp: 1, $all: true })
      const ops = (result.inprog as Record<string, unknown>[]) ?? []
      return ops.slice(0, limit).map((doc) => ({
        ts: new Date().toISOString(),
        op: String(doc.op ?? ''),
        ns: String(doc.ns ?? ''),
        millis: Number(doc.microsecs_running ? Math.round((doc.microsecs_running as number) / 1000) : doc.secs_running ? (doc.secs_running as number) * 1000 : 0),
        planSummary: String(doc.planSummary ?? ''),
        docsExamined: 0,
        keysExamined: 0,
        nreturned: 0,
        command: (doc.command as Record<string, unknown>) ?? {},
        rawDoc: doc as Record<string, unknown>
      }))
    } catch {
      return []
    }
  }
}

export async function clearProfilingData(database: string): Promise<void> {
  const db = mongoService.getDb(database)
  await db.collection('system.profile').drop().catch(() => {})
}
