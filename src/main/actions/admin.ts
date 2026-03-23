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
