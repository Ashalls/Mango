import * as mongoService from '../services/mongodb'
import type { DatabaseInfo, CollectionInfo } from '@shared/types'

export async function listDatabases(): Promise<DatabaseInfo[]> {
  const client = mongoService.getClient()
  try {
    // Try admin command first
    const result = await client.db('admin').command({ listDatabases: 1 })
    return result.databases.map(
      (db: { name: string; sizeOnDisk: number; empty: boolean }) => ({
        name: db.name,
        sizeOnDisk: db.sizeOnDisk,
        empty: db.empty
      })
    )
  } catch {
    // Fallback: try with authorizedDatabases flag (works without admin privileges)
    try {
      const result = await client
        .db('admin')
        .command({ listDatabases: 1, authorizedDatabases: true, nameOnly: true })
      return result.databases.map((db: { name: string }) => ({
        name: db.name,
        sizeOnDisk: 0,
        empty: false
      }))
    } catch {
      return []
    }
  }
}

export async function listCollections(database: string, connectionId?: string): Promise<CollectionInfo[]> {
  const db = mongoService.getDb(database, connectionId)
  const collections = await db.listCollections().toArray()

  return collections.map((col) => ({
    name: col.name,
    type: col.type || 'collection',
    documentCount: undefined,
    viewOn: col.options?.viewOn,
    pipeline: col.options?.pipeline
  }))
}

export async function collectionSchema(
  database: string,
  collection: string,
  sampleSize: number = 100
): Promise<Record<string, { types: string[]; frequency: number }>> {
  const db = mongoService.getDb(database)
  const docs = await db.collection(collection).find({}).limit(sampleSize).toArray()

  if (docs.length === 0) return {}

  const fieldMap: Record<string, { types: Set<string>; count: number }> = {}

  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc)) {
      if (!fieldMap[key]) {
        fieldMap[key] = { types: new Set(), count: 0 }
      }
      fieldMap[key].types.add(
        typeof value === 'object' && value !== null
          ? Array.isArray(value)
            ? 'array'
            : 'object'
          : typeof value
      )
      fieldMap[key].count++
    }
  }

  const result: Record<string, { types: string[]; frequency: number }> = {}
  for (const [key, info] of Object.entries(fieldMap)) {
    result[key] = {
      types: Array.from(info.types),
      frequency: info.count / docs.length
    }
  }

  return result
}

export async function collectionStats(
  database: string,
  collection: string
): Promise<{ documentCount: number; indexCount: number; avgDocSize: number }> {
  const db = mongoService.getDb(database)
  const col = db.collection(collection)

  const [count, indexes] = await Promise.all([
    col.estimatedDocumentCount().catch(() => 0),
    col.indexes().catch(() => [])
  ])

  return {
    documentCount: count,
    indexCount: indexes.length,
    avgDocSize: 0
  }
}
