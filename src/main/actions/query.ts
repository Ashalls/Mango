import * as mongoService from '../services/mongodb'
import { serializeDocuments } from '../services/serialize'
import { MAX_RESULT_SIZE } from '@shared/constants'
import type { QueryOptions, QueryResult } from '@shared/types'

export async function find(options: QueryOptions): Promise<QueryResult> {
  const db = mongoService.getDb(options.database)
  const col = db.collection(options.collection)

  const limit = Math.min(options.limit ?? 50, MAX_RESULT_SIZE)
  const skip = options.skip ?? 0

  let cursor = col.find(options.filter ?? {})

  if (options.projection) {
    cursor = cursor.project(options.projection)
  }
  if (options.sort) {
    cursor = cursor.sort(options.sort)
  }

  cursor = cursor.skip(skip).limit(limit)

  const rawDocs = await cursor.toArray()
  const totalCount = await col.countDocuments(options.filter ?? {})

  return {
    documents: serializeDocuments(rawDocs as Record<string, unknown>[]),
    totalCount
  }
}

export async function count(
  database: string,
  collection: string,
  filter: Record<string, unknown>
): Promise<number> {
  const db = mongoService.getDb(database)
  return db.collection(collection).countDocuments(filter)
}

export async function aggregate(
  database: string,
  collection: string,
  pipeline: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const db = mongoService.getDb(database)
  const results = await db.collection(collection).aggregate(pipeline).toArray()
  return serializeDocuments(results.slice(0, MAX_RESULT_SIZE) as Record<string, unknown>[])
}

export async function distinct(
  database: string,
  collection: string,
  field: string,
  filter: Record<string, unknown>
): Promise<unknown[]> {
  const db = mongoService.getDb(database)
  return db.collection(collection).distinct(field, filter)
}

export async function explain(
  database: string,
  collection: string,
  filter: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const db = mongoService.getDb(database)
  const result = await db
    .collection(collection)
    .find(filter)
    .explain('executionStats')
  return result as unknown as Record<string, unknown>
}
