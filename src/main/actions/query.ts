import { ObjectId, Binary, Decimal128, Long, Timestamp, UUID } from 'mongodb'
import * as mongoService from '../services/mongodb'
import * as connectionActions from './connection'
import { serializeDocuments, serializeToShellSource, reviveExtended } from '../services/serialize'
import * as queryLog from '../services/queryLog'
import { MAX_RESULT_SIZE, MAX_REGEX_PATTERN_LENGTH, REGEX_QUANTIFIER_DEPTH_LIMIT } from '@shared/constants'
import type { QueryOptions, QueryResult } from '@shared/types'

/**
 * Reject patterns that are likely to ReDoS the Node process or the MongoDB
 * server. Cheap structural checks — not a substitute for a real safe-regex,
 * but good enough to block obvious nested-quantifier attacks.
 */
function assertSafeRegex(pattern: string): void {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new Error(`Regex pattern exceeds maximum length (${MAX_REGEX_PATTERN_LENGTH})`)
  }
  // Count nested unbounded quantifiers — (a+)+, (a*)*, etc.
  const nested = pattern.match(/\([^()]*[+*][^()]*\)\s*[+*]/g)
  if (nested && nested.length >= REGEX_QUANTIFIER_DEPTH_LIMIT) {
    throw new Error('Regex pattern rejected: nested unbounded quantifiers (ReDoS risk)')
  }
  // Validate it compiles at all
  try {
    new RegExp(pattern)
  } catch (e) {
    throw new Error(`Invalid regex pattern: ${(e as Error).message}`)
  }
}

/**
 * True if any pipeline stage writes to a collection ($out / $merge). Such
 * stages execute a WRITE even though they run through the "aggregate" (read)
 * path, so they must be gated by the same write-access checks as mutations.
 */
export function pipelineHasWriteStage(pipeline: Record<string, unknown>[]): boolean {
  return pipeline.some(
    (stage) => stage && typeof stage === 'object' && ('$out' in stage || '$merge' in stage)
  )
}

/**
 * Block an aggregation that would write ($out/$merge) when the target
 * connection is read-only. Without this, a pipeline ending in `{ $out: ... }`
 * bypasses every mutation guard (read-only/production connections, and the
 * read-only-annotated Claude aggregate tool).
 */
function assertAggregateWriteAllowed(pipeline: Record<string, unknown>[], connectionId?: string): void {
  if (!pipelineHasWriteStage(pipeline)) return
  const blocked = connectionActions.checkReadOnly(connectionId)
  if (blocked) throw new Error(blocked)
}

/** Real BSON instances that must be passed through untouched (never recursed
 * into — Object.entries() would rebuild them as plain objects and lose the type). */
function isBsonInstance(v: unknown): boolean {
  return (
    v instanceof ObjectId || v instanceof Binary || v instanceof Decimal128 ||
    v instanceof Long || v instanceof Timestamp || v instanceof UUID ||
    v instanceof Date || v instanceof RegExp
  )
}

/**
 * Coerce 24-char hex strings to ObjectId — but ONLY under an `_id` path.
 * Coercing every hex-looking string breaks fields that legitimately store a
 * 24-char hex STRING (e.g. a `UserId`), which could then never be matched.
 * Fields that really hold ObjectIds are searched via an explicit `{$oid}` marker
 * (revived before this runs), so this fallback is only needed for bare `_id`.
 */
function convertObjectIds(obj: Record<string, unknown>, underId = false): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const coerce = underId || key === '_id'
    if (typeof value === 'string') {
      result[key] = coerce && /^[0-9a-f]{24}$/i.test(value) ? new ObjectId(value) : value
    } else if (isBsonInstance(value)) {
      result[key] = value
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) => {
        if (typeof v === 'string') return coerce && /^[0-9a-f]{24}$/i.test(v) ? new ObjectId(v) : v
        if (isBsonInstance(v)) return v
        // Recurse into object elements so hex _ids inside $and/$or/$in-of-docs
        // coerce too (QueryBuilder emits {$and:[{_id:"…"}]} for multi-row).
        if (v && typeof v === 'object') return convertObjectIds(v as Record<string, unknown>, coerce)
        return v
      })
    } else if (value && typeof value === 'object') {
      result[key] = convertObjectIds(value as Record<string, unknown>, coerce)
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Prepare a user/dialog-supplied filter for the driver. Revive Extended-JSON
 * markers ($oid/$date/$numberDecimal/...) the shell parser and dialogs emit —
 * WITHOUT this, a typed filter like `{createdAt: {$lt: ISODate(...)}}` reaches
 * Mongo as `{$date: "..."}` and silently matches nothing — then coerce any
 * remaining bare 24-hex strings to ObjectId.
 */
function reviveFilter(filter: Record<string, unknown>): Record<string, unknown> {
  return convertObjectIds(reviveExtended(filter) as Record<string, unknown>)
}

/**
 * Fetch a single document by _id and render it as MongoDB shell text
 * (ObjectId("..."), ISODate("..."), ...) for the document editor, so typed
 * fields are shown and edited as their real BSON types. Returns null when the
 * document no longer exists.
 */
export async function findOneSource(
  database: string,
  collection: string,
  id: unknown,
  connectionId?: string
): Promise<{ source: string | null }> {
  const db = mongoService.getDb(database, connectionId)
  const filter = convertObjectIds({ _id: id } as Record<string, unknown>)
  const doc = await db.collection(collection).findOne(filter)
  return { source: doc ? serializeToShellSource(doc) : null }
}

export async function find(options: QueryOptions): Promise<QueryResult> {
  return queryLog.timed(options.database, options.collection, 'find', {
    filter: options.filter, projection: options.projection, sort: options.sort,
    skip: options.skip, limit: options.limit
  }, async () => {
    const db = mongoService.getDb(options.database, options.connectionId)
    const col = db.collection(options.collection)

    const limit = Math.min(options.limit ?? 50, MAX_RESULT_SIZE)
    const skip = options.skip ?? 0
    const processedFilter = reviveFilter(options.filter ?? {})

    let cursor = col.find(processedFilter)

    if (options.projection) {
      cursor = cursor.project(options.projection)
    }
    if (options.sort) {
      cursor = cursor.sort(options.sort as Record<string, 1 | -1>)
    }

    cursor = cursor.skip(skip).limit(limit)

    const rawDocs = await cursor.toArray()
    const totalCount = await col.countDocuments(processedFilter)

    return {
      documents: serializeDocuments(rawDocs as Record<string, unknown>[]),
      totalCount
    }
  })
}

export async function count(
  database: string,
  collection: string,
  filter: Record<string, unknown>,
  connectionId?: string
): Promise<number> {
  const db = mongoService.getDb(database, connectionId)
  return db.collection(collection).countDocuments(reviveFilter(filter))
}

export async function aggregate(
  database: string,
  collection: string,
  pipeline: Record<string, unknown>[],
  connectionId?: string
): Promise<Record<string, unknown>[]> {
  assertAggregateWriteAllowed(pipeline, connectionId)
  return queryLog.timed(database, collection, 'aggregate', { pipeline }, async () => {
    const db = mongoService.getDb(database, connectionId)
    const results = await db.collection(collection).aggregate(pipeline).toArray()
    return serializeDocuments(results.slice(0, MAX_RESULT_SIZE) as Record<string, unknown>[])
  })
}

export async function aggregateWithStagePreview(
  database: string,
  collection: string,
  pipeline: Record<string, unknown>[],
  stageIndex: number,
  sampleSize: number = 20,
  connectionId?: string
): Promise<{ documents: Record<string, unknown>[]; count: number }> {
  assertAggregateWriteAllowed(pipeline, connectionId)
  const db = mongoService.getDb(database, connectionId)
  const stagesUpTo = pipeline.slice(0, stageIndex + 1)
  const countPipeline = [...stagesUpTo, { $count: 'total' }]
  const previewPipeline = [...stagesUpTo, { $limit: sampleSize }]

  const [previewResults, countResults] = await Promise.all([
    db.collection(collection).aggregate(previewPipeline).toArray(),
    db.collection(collection).aggregate(countPipeline).toArray()
  ])

  return {
    documents: serializeDocuments(previewResults as Record<string, unknown>[]),
    count: countResults[0]?.total ?? 0
  }
}

export async function distinct(
  database: string,
  collection: string,
  field: string,
  filter: Record<string, unknown>,
  connectionId?: string
): Promise<unknown[]> {
  const db = mongoService.getDb(database, connectionId)
  return db.collection(collection).distinct(field, reviveFilter(filter))
}

export async function explain(
  database: string,
  collection: string,
  filter: Record<string, unknown>,
  pipeline?: Record<string, unknown>[],
  connectionId?: string
): Promise<Record<string, unknown>> {
  const db = mongoService.getDb(database, connectionId)
  if (pipeline && pipeline.length > 0) {
    const result = await db
      .collection(collection)
      .aggregate(pipeline)
      .explain('allPlansExecution')
    return result as unknown as Record<string, unknown>
  }
  const result = await db
    .collection(collection)
    .find(reviveFilter(filter))
    .explain('allPlansExecution')
  return result as unknown as Record<string, unknown>
}

export async function valueSearch(
  searchTerm: string,
  scope: { type: 'server' | 'database' | 'collection'; database?: string; collection?: string },
  options: { regex: boolean; caseInsensitive: boolean; maxResults: number },
  connectionId?: string
): Promise<
  { database: string; collection: string; documentId: string; fieldPath: string; matchedValue: string }[]
> {
  const results: {
    database: string
    collection: string
    documentId: string
    fieldPath: string
    matchedValue: string
  }[] = []

  const collectionsToSearch: { database: string; collection: string }[] = []

  if (scope.type === 'collection' && scope.database && scope.collection) {
    collectionsToSearch.push({ database: scope.database, collection: scope.collection })
  } else if (scope.type === 'database' && scope.database) {
    const db = mongoService.getDb(scope.database, connectionId)
    const cols = await db.listCollections().toArray()
    for (const col of cols) {
      if (col.type !== 'view') collectionsToSearch.push({ database: scope.database, collection: col.name })
    }
  } else {
    const admin = mongoService.getDb('admin', connectionId).admin()
    const dbList = await admin.listDatabases()
    for (const dbInfo of dbList.databases) {
      if (['admin', 'local', 'config'].includes(dbInfo.name)) continue
      const db = mongoService.getDb(dbInfo.name, connectionId)
      const cols = await db.listCollections().toArray()
      for (const col of cols) {
        if (col.type !== 'view') collectionsToSearch.push({ database: dbInfo.name, collection: col.name })
      }
    }
  }

  for (const { database, collection } of collectionsToSearch) {
    if (results.length >= options.maxResults) break

    const db = mongoService.getDb(database, connectionId)
    const col = db.collection(collection)

    const sample = await col.aggregate([{ $sample: { size: 10 } }]).toArray()
    const stringFields = new Set<string>()
    for (const doc of sample) {
      for (const [key, val] of Object.entries(doc)) {
        if (typeof val === 'string') stringFields.add(key)
      }
    }

    if (stringFields.size === 0) continue

    const regexFlags = options.caseInsensitive ? 'i' : ''
    const pattern = options.regex ? searchTerm : searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (options.regex) assertSafeRegex(pattern)

    const orConditions = Array.from(stringFields).map((field) => ({
      [field]: { $regex: pattern, $options: regexFlags }
    }))

    const remaining = options.maxResults - results.length
    const docs = await col.find({ $or: orConditions }).limit(remaining).toArray()

    for (const doc of docs) {
      const docId = String(doc._id)
      for (const field of stringFields) {
        const val = doc[field]
        if (typeof val !== 'string') continue
        const re = new RegExp(pattern, regexFlags)
        if (re.test(val)) {
          results.push({ database, collection, documentId: docId, fieldPath: field, matchedValue: val })
          if (results.length >= options.maxResults) break
        }
      }
      if (results.length >= options.maxResults) break
    }
  }

  return results
}
