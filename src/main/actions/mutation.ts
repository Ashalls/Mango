import { ObjectId, Binary, Decimal128, Long, Timestamp, UUID } from 'mongodb'
import * as mongoService from '../services/mongodb'
import { reviveExtended } from '../services/serialize'

/** Real BSON instances that must be passed through untouched (never recursed
 * into — Object.entries() would rebuild them as plain objects and lose the type). */
function isBsonInstance(v: unknown): boolean {
  return (
    v instanceof ObjectId || v instanceof Binary || v instanceof Decimal128 ||
    v instanceof Long || v instanceof Timestamp || v instanceof UUID ||
    v instanceof Date || v instanceof RegExp
  )
}

/** Recursively convert 24-char hex strings to ObjectId in filter values */
function convertObjectIds(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)) {
      result[key] = new ObjectId(value)
    } else if (isBsonInstance(value)) {
      result[key] = value
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) =>
        typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v) ? new ObjectId(v) : v
      )
    } else if (value && typeof value === 'object') {
      result[key] = convertObjectIds(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Prepare a user/dialog-supplied filter for the driver: revive Extended-JSON
 * markers ($oid/$date/...) so typed filters keep their BSON type instead of
 * silently matching nothing, then coerce bare 24-hex strings to ObjectId.
 * Applied to filters just as reviveExtended is applied to update bodies.
 */
function reviveFilter(filter: Record<string, unknown>): Record<string, unknown> {
  return convertObjectIds(reviveExtended(filter) as Record<string, unknown>)
}

export async function insertOne(
  database: string,
  collection: string,
  document: Record<string, unknown>,
  connectionId?: string
): Promise<{ insertedId: string }> {
  const db = mongoService.getDb(database, connectionId)
  const revived = reviveExtended(document) as Record<string, unknown>
  const result = await db.collection(collection).insertOne(revived)
  return { insertedId: result.insertedId.toString() }
}

export async function updateOne(
  database: string,
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  connectionId?: string
): Promise<{ matchedCount: number; modifiedCount: number }> {
  const db = mongoService.getDb(database, connectionId)
  const processedFilter = reviveFilter(filter)
  // If update doesn't use operators, wrap in $set
  const wrapped = Object.keys(update).some((k) => k.startsWith('$'))
    ? update
    : { $set: update }
  // Revive Extended-JSON markers ($oid/$date/...) the document editor emits so
  // edited fields keep their BSON type instead of being written as strings.
  const updateDoc = reviveExtended(wrapped) as Record<string, unknown>
  const result = await db.collection(collection).updateOne(processedFilter, updateDoc)
  return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }
}

export async function deleteOne(
  database: string,
  collection: string,
  filter: Record<string, unknown>,
  connectionId?: string
): Promise<{ deletedCount: number }> {
  const db = mongoService.getDb(database, connectionId)
  const result = await db.collection(collection).deleteOne(reviveFilter(filter))
  return { deletedCount: result.deletedCount }
}

export async function deleteMany(
  database: string,
  collection: string,
  filter: Record<string, unknown>,
  connectionId?: string
): Promise<{ deletedCount: number }> {
  const db = mongoService.getDb(database, connectionId)
  const result = await db.collection(collection).deleteMany(reviveFilter(filter))
  return { deletedCount: result.deletedCount }
}

export async function insertMany(
  database: string,
  collection: string,
  documents: Record<string, unknown>[],
  connectionId?: string
): Promise<{ insertedCount: number }> {
  const db = mongoService.getDb(database, connectionId)
  const revived = documents.map((d) => reviveExtended(d) as Record<string, unknown>)
  const result = await db.collection(collection).insertMany(revived)
  return { insertedCount: result.insertedCount }
}

export async function updateMany(
  database: string,
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  connectionId?: string
): Promise<{ matchedCount: number; modifiedCount: number }> {
  const db = mongoService.getDb(database, connectionId)
  const processedFilter = reviveFilter(filter)
  const wrapped = Object.keys(update).some((k) => k.startsWith('$'))
    ? update
    : { $set: update }
  const updateDoc = reviveExtended(wrapped) as Record<string, unknown>
  const result = await db.collection(collection).updateMany(processedFilter, updateDoc)
  return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }
}
