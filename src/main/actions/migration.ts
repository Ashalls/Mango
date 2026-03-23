import { BrowserWindow } from 'electron'
import * as mongoService from '../services/mongodb'
import * as configService from '../services/config'
import type { CopyDatabaseOptions, CopyProgress } from '@shared/types'

function emitProgress(event: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(event, data)
    }
  }
}

export async function copyDatabase(options: CopyDatabaseOptions): Promise<void> {
  // Production safety check
  const connections = configService.loadConnections()
  const targetProfile = connections.find((c) => c.id === options.targetConnectionId)
  if (targetProfile?.isProduction) {
    throw new Error(
      `Cannot copy to "${targetProfile.name}" — it is tagged as production. ` +
        'Production connections are protected from mass write operations.'
    )
  }

  const sourceClient = mongoService.getClient(options.sourceConnectionId)
  const targetClient = mongoService.getClient(options.targetConnectionId)
  const sourceDb = sourceClient.db(options.sourceDatabase)
  const targetDb = targetClient.db(options.targetDatabase)

  // Get collections to copy
  const allCollections = await sourceDb.listCollections().toArray()
  const collectionNames = options.collections?.length
    ? options.collections
    : allCollections.map((c) => c.name)

  for (const colName of collectionNames) {
    const progress: CopyProgress = {
      collection: colName,
      copied: 0,
      total: 0,
      status: 'pending'
    }
    emitProgress('migration:progress', progress)

    try {
      const sourceCol = sourceDb.collection(colName)
      const count = await sourceCol.estimatedDocumentCount().catch(() => 0)
      progress.total = count
      progress.status = 'copying'
      emitProgress('migration:progress', progress)

      // Drop target collection if requested
      if (options.dropTarget) {
        try {
          await targetDb.dropCollection(colName)
        } catch {
          // Collection may not exist
        }
      }

      const targetCol = targetDb.collection(colName)

      // Copy in batches
      const batchSize = 1000
      const cursor = sourceCol.find({})
      let batch: Record<string, unknown>[] = []

      for await (const doc of cursor) {
        batch.push(doc as Record<string, unknown>)
        if (batch.length >= batchSize) {
          await targetCol.insertMany(batch)
          progress.copied += batch.length
          emitProgress('migration:progress', progress)
          batch = []
        }
      }

      // Insert remaining
      if (batch.length > 0) {
        await targetCol.insertMany(batch)
        progress.copied += batch.length
      }

      progress.status = 'done'
      emitProgress('migration:progress', progress)

      // Copy indexes
      try {
        const indexes = await sourceCol.indexes()
        for (const idx of indexes) {
          if (idx.name === '_id_') continue // Skip default index
          const { key, ...indexOptions } = idx
          delete (indexOptions as any).v
          delete (indexOptions as any).ns
          try {
            await targetCol.createIndex(key, indexOptions)
          } catch {
            // Index may already exist
          }
        }
      } catch {
        // Index copy is best-effort
      }
    } catch (err) {
      progress.status = 'error'
      progress.error = err instanceof Error ? err.message : 'Copy failed'
      emitProgress('migration:progress', progress)
    }
  }

  emitProgress('migration:complete', {
    sourceDatabase: options.sourceDatabase,
    targetDatabase: options.targetDatabase
  })
}
