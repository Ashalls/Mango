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
  return db.collection(collection).createIndex(fields, options)
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
