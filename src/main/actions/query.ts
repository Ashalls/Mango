import { ObjectId } from 'mongodb'
import * as mongoService from '../services/mongodb'
import * as connectionActions from './connection'
import { serializeDocuments, serializeToShellSource } from '../services/serialize'
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

/** Recursively convert 24-char hex strings to ObjectId in filter values */
function convertObjectIds(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)) {
      result[key] = new ObjectId(value)
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) =>
        typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v) ? new ObjectId(v) : v
      )
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = convertObjectIds(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
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
    const processedFilter = convertObjectIds(options.filter ?? {})

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
  return db.collection(collection).countDocuments(convertObjectIds(filter))
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
  return db.collection(collection).distinct(field, convertObjectIds(filter))
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
    .find(convertObjectIds(filter))
    .explain('allPlansExecution')
  return result as unknown as Record<string, unknown>
}

export async function valueSearch(
  searchTerm: string,
  scope: { type: 'server' | 'database' | 'collection'; database?: string; collection?: string },
  options: { regex: boolean; caseInsensitive: boolean; maxResults: number }
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
    const db = mongoService.getDb(scope.database)
    const cols = await db.listCollections().toArray()
    for (const col of cols) {
      if (col.type !== 'view') collectionsToSearch.push({ database: scope.database, collection: col.name })
    }
  } else {
    const admin = mongoService.getDb('admin').admin()
    const dbList = await admin.listDatabases()
    for (const dbInfo of dbList.databases) {
      if (['admin', 'local', 'config'].includes(dbInfo.name)) continue
      const db = mongoService.getDb(dbInfo.name)
      const cols = await db.listCollections().toArray()
      for (const col of cols) {
        if (col.type !== 'view') collectionsToSearch.push({ database: dbInfo.name, collection: col.name })
      }
    }
  }

  for (const { database, collection } of collectionsToSearch) {
    if (results.length >= options.maxResults) break

    const db = mongoService.getDb(database)
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
