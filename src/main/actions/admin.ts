import type { IndexSpecification } from 'mongodb'
import * as mongoService from '../services/mongodb'

export async function dropDatabase(database: string): Promise<void> {
  const client = mongoService.getClient()
  await client.db(database).dropDatabase()
}

export async function dropCollection(database: string, collection: string): Promise<void> {
  const db = mongoService.getDb(database)
  await db.dropCollection(collection)
}

export async function createCollection(database: string, collection: string): Promise<void> {
  const db = mongoService.getDb(database)
  await db.createCollection(collection)
}

export async function listIndexes(
  database: string,
  collection: string
): Promise<Record<string, unknown>[]> {
  const db = mongoService.getDb(database)
  return db.collection(collection).indexes()
}

export async function createIndex(
  database: string,
  collection: string,
  fields: Record<string, number | string>,
  options: {
    unique?: boolean
    sparse?: boolean
    expireAfterSeconds?: number
    partialFilterExpression?: Record<string, unknown>
    name?: string
  } = {}
): Promise<string> {
  const db = mongoService.getDb(database)
  return db.collection(collection).createIndex(fields as IndexSpecification, options)
}

export async function dropIndex(
  database: string,
  collection: string,
  indexName: string
): Promise<void> {
  const db = mongoService.getDb(database)
  await db.collection(collection).dropIndex(indexName)
}

export async function renameCollection(
  database: string,
  oldName: string,
  newName: string
): Promise<void> {
  const db = mongoService.getDb(database)
  await db.renameCollection(oldName, newName)
}

export async function getIndexStats(
  database: string,
  collection: string
): Promise<Record<string, unknown>[]> {
  const db = mongoService.getDb(database)
  return db.collection(collection).aggregate([{ $indexStats: {} }]).toArray()
}

export async function truncateCollection(database: string, collection: string): Promise<{ deletedCount: number }> {
  const db = mongoService.getDb(database)
  const result = await db.collection(collection).deleteMany({})
  return { deletedCount: result.deletedCount }
}

/**
 * Return the current $jsonSchema (or any) validator configured on a
 * collection. `null` when no validator is set. Also returns validationLevel
 * and validationAction so the UI can round-trip them.
 */
export async function getValidator(
  database: string,
  collection: string
): Promise<{
  validator: Record<string, unknown> | null
  validationLevel: 'off' | 'strict' | 'moderate'
  validationAction: 'error' | 'warn'
}> {
  const db = mongoService.getDb(database)
  const cols = await db.listCollections({ name: collection }).toArray()
  const info = cols[0] as { options?: { validator?: Record<string, unknown>; validationLevel?: string; validationAction?: string } } | undefined
  return {
    validator: info?.options?.validator ?? null,
    validationLevel: (info?.options?.validationLevel as 'off' | 'strict' | 'moderate') ?? 'strict',
    validationAction: (info?.options?.validationAction as 'error' | 'warn') ?? 'error'
  }
}

/**
 * Apply a validator to an existing collection via collMod. Pass null to
 * remove the validator entirely.
 */
export async function setValidator(
  database: string,
  collection: string,
  validator: Record<string, unknown> | null,
  level: 'off' | 'strict' | 'moderate' = 'strict',
  action: 'error' | 'warn' = 'error'
): Promise<void> {
  const db = mongoService.getDb(database)
  await db.command({
    collMod: collection,
    validator: validator ?? {},
    validationLevel: level,
    validationAction: action
  })
}

/**
 * Sample documents from the collection and report how many fail to satisfy
 * the candidate validator. Returns a few failing documents so the user can
 * see why. Read-only — never modifies data.
 */
export async function validateSample(
  database: string,
  collection: string,
  validator: Record<string, unknown>,
  sampleSize: number = 200
): Promise<{ sampled: number; failed: number; failures: Record<string, unknown>[] }> {
  const db = mongoService.getDb(database)
  const sample = await db.collection(collection)
    .aggregate([{ $sample: { size: sampleSize } }])
    .toArray()
  const failures = await db.collection(collection)
    .aggregate([
      { $match: { _id: { $in: sample.map((d) => d._id) } } },
      { $match: { $nor: [validator] } },
      { $limit: 10 }
    ])
    .toArray() as Record<string, unknown>[]
  // Re-run a count of failures against the same sample IDs
  const failedCount = await db.collection(collection).countDocuments({
    _id: { $in: sample.map((d) => d._id) },
    $nor: [validator]
  })
  return { sampled: sample.length, failed: failedCount, failures }
}
