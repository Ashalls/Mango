import * as mongoService from '../services/mongodb'

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
  // If update doesn't use operators, wrap in $set
  const updateDoc = Object.keys(update).some((k) => k.startsWith('$'))
    ? update
    : { $set: update }
  const result = await db.collection(collection).updateOne(filter, updateDoc)
  return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }
}

export async function deleteOne(
  database: string,
  collection: string,
  filter: Record<string, unknown>
): Promise<{ deletedCount: number }> {
  const db = mongoService.getDb(database)
  const result = await db.collection(collection).deleteOne(filter)
  return { deletedCount: result.deletedCount }
}

export async function deleteMany(
  database: string,
  collection: string,
  filter: Record<string, unknown>
): Promise<{ deletedCount: number }> {
  const db = mongoService.getDb(database)
  const result = await db.collection(collection).deleteMany(filter)
  return { deletedCount: result.deletedCount }
}
