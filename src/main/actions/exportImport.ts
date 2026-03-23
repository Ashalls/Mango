import { writeFileSync, readFileSync, existsSync } from 'fs'
import { dialog, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as mongoService from '../services/mongodb'
import * as configService from '../services/config'
import { serializeDocuments } from '../services/serialize'

const execFileAsync = promisify(execFile)

export async function exportCollection(
  database: string,
  collection: string,
  format: 'json' | 'csv' = 'json'
): Promise<{ path: string; count: number } | null> {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return null

  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: `Export ${collection}`,
    defaultPath: `${collection}.${format}`,
    filters:
      format === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'CSV', extensions: ['csv'] }]
  })

  if (canceled || !filePath) return null

  const db = mongoService.getDb(database)
  const docs = await db.collection(collection).find({}).toArray()
  const serialized = serializeDocuments(docs as Record<string, unknown>[])

  if (format === 'json') {
    writeFileSync(filePath, JSON.stringify(serialized, null, 2))
  } else {
    if (serialized.length === 0) {
      writeFileSync(filePath, '')
    } else {
      const headers = new Set<string>()
      for (const doc of serialized) {
        for (const key of Object.keys(doc)) headers.add(key)
      }
      const headerRow = Array.from(headers)
      const rows = serialized.map((doc) =>
        headerRow
          .map((h) => {
            const val = doc[h]
            if (val === null || val === undefined) return ''
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str
          })
          .join(',')
      )
      writeFileSync(filePath, [headerRow.join(','), ...rows].join('\n'))
    }
  }

  return { path: filePath, count: serialized.length }
}

export async function exportDatabaseDump(
  connectionId: string,
  database: string
): Promise<{ path: string } | null> {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return null

  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    title: `Export ${database} (mongodump)`,
    properties: ['openDirectory', 'createDirectory']
  })

  if (canceled || filePaths.length === 0) return null
  const outDir = filePaths[0]

  // Get the URI for this connection
  const connections = configService.loadConnections()
  const profile = connections.find((c) => c.id === connectionId)
  if (!profile) throw new Error('Connection not found')

  try {
    await execFileAsync('mongodump', [
      '--uri', profile.uri,
      '--db', database,
      '--out', outDir
    ])
    return { path: outDir }
  } catch (err) {
    // mongodump not available — fall back to JSON export
    const db = mongoService.getClient(connectionId).db(database)
    const collections = await db.listCollections().toArray()
    const { mkdirSync } = await import('fs')
    const { join } = await import('path')
    const dbDir = join(outDir, database)
    mkdirSync(dbDir, { recursive: true })

    for (const col of collections) {
      if (col.type === 'view') continue
      const docs = await db.collection(col.name).find({}).toArray()
      const serialized = serializeDocuments(docs as Record<string, unknown>[])
      writeFileSync(join(dbDir, `${col.name}.json`), JSON.stringify(serialized, null, 2))

      // Save indexes
      try {
        const indexes = await db.collection(col.name).indexes()
        writeFileSync(join(dbDir, `${col.name}.indexes.json`), JSON.stringify(indexes, null, 2))
      } catch { /* best effort */ }
    }

    // Save view definitions
    const views = collections.filter((c) => c.type === 'view')
    if (views.length > 0) {
      writeFileSync(join(dbDir, '_views.json'), JSON.stringify(views, null, 2))
    }

    return { path: dbDir }
  }
}

export async function importDatabaseDump(
  connectionId: string,
  database: string,
  dropExisting: boolean = false
): Promise<{ collections: number; documents: number } | null> {
  // Check production protection
  const connections = configService.loadConnections()
  const profile = connections.find((c) => c.id === connectionId)
  if (profile?.isProduction) {
    throw new Error('Cannot import to a production connection')
  }

  const win = BrowserWindow.getFocusedWindow()
  if (!win) return null

  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    title: `Import to ${database}`,
    properties: ['openDirectory']
  })

  if (canceled || filePaths.length === 0) return null
  const importDir = filePaths[0]

  const { readdirSync } = await import('fs')
  const { join } = await import('path')

  // Try mongorestore first
  try {
    const args = [
      '--uri', profile!.uri,
      '--db', database,
      '--dir', importDir
    ]
    if (dropExisting) args.push('--drop')
    await execFileAsync('mongorestore', args)
    return { collections: -1, documents: -1 } // mongorestore doesn't report counts easily
  } catch {
    // Fall back to JSON import
  }

  const files = readdirSync(importDir).filter((f) => f.endsWith('.json') && !f.startsWith('_') && !f.endsWith('.indexes.json'))
  const db = mongoService.getClient(connectionId).db(database)
  let totalDocs = 0

  for (const file of files) {
    const colName = file.replace('.json', '')
    const raw = readFileSync(join(importDir, file), 'utf-8')
    const docs = JSON.parse(raw)
    if (!Array.isArray(docs) || docs.length === 0) continue

    if (dropExisting) {
      try { await db.dropCollection(colName) } catch { /* may not exist */ }
    }

    // Remove _id to avoid conflicts
    const cleaned = docs.map((doc: Record<string, unknown>) => {
      const { _id, ...rest } = doc
      return rest
    })

    await db.collection(colName).insertMany(cleaned)
    totalDocs += cleaned.length

    // Restore indexes
    const indexFile = join(importDir, `${colName}.indexes.json`)
    if (existsSync(indexFile)) {
      try {
        const indexes = JSON.parse(readFileSync(indexFile, 'utf-8'))
        for (const idx of indexes) {
          if (idx.name === '_id_') continue
          const { key, ...opts } = idx
          delete opts.v
          delete opts.ns
          try { await db.collection(colName).createIndex(key, opts) } catch { /* best effort */ }
        }
      } catch { /* best effort */ }
    }
  }

  return { collections: files.length, documents: totalDocs }
}

export async function importCollection(
  database: string,
  collection: string,
  dropExisting: boolean = false
): Promise<{ count: number } | null> {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return null

  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    title: `Import to ${collection}`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })

  if (canceled || filePaths.length === 0) return null

  const raw = readFileSync(filePaths[0], 'utf-8')
  let docs: Record<string, unknown>[]

  try {
    const parsed = JSON.parse(raw)
    docs = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    throw new Error('Invalid JSON file')
  }

  if (docs.length === 0) return { count: 0 }

  const db = mongoService.getDb(database)

  if (dropExisting) {
    try { await db.dropCollection(collection) } catch { /* may not exist */ }
  }

  const cleaned = docs.map((doc) => {
    const { _id, ...rest } = doc
    return rest
  })

  const result = await db.collection(collection).insertMany(cleaned)
  return { count: result.insertedCount }
}
