import { ObjectId } from 'mongodb'
import * as mongoService from '../services/mongodb'

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

export async function insertOne(
  database: string,
  collection: string,
  document: Record<string, unknown>
): Promise<{ insertedId: string }> {
  const db = mongoService.getDb(database)
  const result = await db.collection(collection).insertOne(document)
  return { insertedId: result.insertedId.toString() }
}

export async function updateOne(
  database: string,
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>
): Promise<{ matchedCount: number; modifiedCount: number }> {
  const db = mongoService.getDb(database)
  const processedFilter = convertObjectIds(filter)
  // If update doesn't use operators, wrap in $set
  const updateDoc = Object.keys(update).some((k) => k.startsWith('$'))
    ? update
    : { $set: update }
  const result = await db.collection(collection).updateOne(processedFilter, updateDoc)
  return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }
}

export async function deleteOne(
  database: string,
  collection: string,
  filter: Record<string, unknown>
): Promise<{ deletedCount: number }> {
  const db = mongoService.getDb(database)
  const result = await db.collection(collection).deleteOne(convertObjectIds(filter))
  return { deletedCount: result.deletedCount }
}

export async function deleteMany(
  database: string,
  collection: string,
  filter: Record<string, unknown>
): Promise<{ deletedCount: number }> {
  const db = mongoService.getDb(database)
  const result = await db.collection(collection).deleteMany(convertObjectIds(filter))
  return { deletedCount: result.deletedCount }
}

export async function insertMany(
  database: string,
  collection: string,
  documents: Record<string, unknown>[]
): Promise<{ insertedCount: number }> {
  const db = mongoService.getDb(database)
  const result = await db.collection(collection).insertMany(documents)
  return { insertedCount: result.insertedCount }
}

export async function updateMany(
  database: string,
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>
): Promise<{ matchedCount: number; modifiedCount: number }> {
  const db = mongoService.getDb(database)
  const processedFilter = convertObjectIds(filter)
  const updateDoc = Object.keys(update).some((k) => k.startsWith('$'))
    ? update
    : { $set: update }
  const result = await db.collection(collection).updateMany(processedFilter, updateDoc)
  return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }
}
