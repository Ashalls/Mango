import { writeFileSync, readFileSync, existsSync, createWriteStream, createReadStream, statSync } from 'fs'
import { app, dialog, BrowserWindow } from 'electron'
import { execFile, fork, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import * as mongoService from '../services/mongodb'
import * as configService from '../services/config'
import { serializeDocuments, serializeDocument } from '../services/serialize'
import type { OperationProgress } from '@shared/types'

const execFileAsync = promisify(execFile)

/** Yield to the event loop so the UI stays responsive during long operations */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Stream-read a JSON array file and yield documents in batches.
 * Avoids loading the entire file into memory.
 * Works with our export format: [\n{...},\n{...}\n]
 */
async function* streamJsonArray(
  filePath: string,
  batchSize: number
): AsyncGenerator<Record<string, unknown>[]> {
  // For files under 200MB, use readFileSync — much faster than streaming
  const fileSize = statSync(filePath).size
  if (fileSize < 200 * 1024 * 1024) {
    const raw = readFileSync(filePath, 'utf-8')
    const docs = JSON.parse(raw)
    if (!Array.isArray(docs)) return
    for (let i = 0; i < docs.length; i += batchSize) {
      yield docs.slice(i, i + batchSize)
    }
    return
  }

  // For large files, stream-parse with small read chunks
  const stream = createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 })
  let buffer = ''
  let depth = 0
  let inString = false
  let escape = false
  let batch: Record<string, unknown>[] = []
  let objectStart = -1
  let lastParsedEnd = 0

  for await (const chunk of stream) {
    buffer += chunk

    let i = lastParsedEnd
    while (i < buffer.length) {
      const ch = buffer[i]

      if (escape) {
        escape = false
        i++
        continue
      }

      if (ch === '\\' && inString) {
        escape = true
        i++
        continue
      }

      if (ch === '"') {
        inString = !inString
        i++
        continue
      }

      if (inString) {
        i++
        continue
      }

      if (ch === '{') {
        if (depth === 0) objectStart = i
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0 && objectStart >= 0) {
          const jsonStr = buffer.substring(objectStart, i + 1)
          try {
            batch.push(JSON.parse(jsonStr))
          } catch {
            // Skip malformed objects
          }
          objectStart = -1
          lastParsedEnd = i + 1

          if (batch.length >= batchSize) {
            yield batch
            batch = []
          }
        }
      }
      i++
    }

    // Trim consumed portion of buffer to prevent unbounded growth
    if (objectStart >= 0) {
      buffer = buffer.substring(objectStart)
      lastParsedEnd = 0
      objectStart = 0
    } else {
      buffer = buffer.substring(lastParsedEnd)
      lastParsedEnd = 0
    }
  }

  if (batch.length > 0) {
    yield batch
  }
}

/**
 * Inline worker script for import operations.
 * Runs in a separate thread with its own MongoDB connection.
 * Communicates progress via parentPort messages.
 */
// Write worker scripts to temp files on startup so fork() can use them
const IMPORT_SCRIPT_PATH = pathJoin(tmpdir(), 'mango-import-worker.js')
const EXPORT_SCRIPT_PATH = pathJoin(tmpdir(), 'mango-export-worker.js')

// Single-collection import worker — streams JSON line-by-line to handle any file size
const IMPORT_WORKER_SCRIPT = `
try {
const { MongoClient, ObjectId, Decimal128, Long, UUID, Binary, Timestamp } = require('mongodb');
const { readFileSync, existsSync, createReadStream, statSync } = require('fs');
const { createInterface } = require('readline');
const path = require('path');
const send = (msg) => process.send(msg);
const config = JSON.parse(process.argv[2]);

function deserialize(doc) {
  if (doc === null || doc === undefined) return doc;
  if (typeof doc !== 'object') return doc;
  if (Array.isArray(doc)) return doc.map(deserialize);
  if (doc.$oid) { try { return new ObjectId(doc.$oid); } catch { return doc.$oid; } }
  if (doc.$date) return new Date(doc.$date);
  if (doc.$numberDecimal) return Decimal128.fromString(doc.$numberDecimal);
  if (doc.$numberLong) return Long.fromString(doc.$numberLong);
  if (doc.$uuid) return new UUID(doc.$uuid);
  if (doc.$binary && doc.$type) return new Binary(Buffer.from(doc.$binary, 'base64'), parseInt(doc.$type, 16));
  if (doc.$timestamp) return new Timestamp({ t: doc.$timestamp.t, i: doc.$timestamp.i });
  if (doc.$regex) return new RegExp(doc.$regex, doc.$options || '');
  const r = {};
  for (const [k, v] of Object.entries(doc)) r[k] = deserialize(v);
  return r;
}

// Stream a JSON array file line by line, yielding parsed objects in batches.
// Works with our export format: [\\n  {\\n    ...\\n  },\\n  {\\n    ...\\n  }\\n]
async function* readJsonArrayStreaming(filePath, batchSize) {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  });
  let lines = [];
  let depth = 0;
  let batch = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (depth === 0 && (trimmed === '[' || trimmed === ']' || trimmed === '')) continue;

    // Track brace depth
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '"') {
        // Skip string contents
        i++;
        while (i < trimmed.length) {
          if (trimmed[i] === '\\\\') { i++; }
          else if (trimmed[i] === '"') break;
          i++;
        }
      } else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }

    lines.push(line);

    if (depth === 0 && lines.length > 0) {
      let jsonStr = lines.join('\\n');
      // Remove trailing comma
      if (jsonStr.endsWith(',')) jsonStr = jsonStr.slice(0, -1);
      try {
        batch.push(JSON.parse(jsonStr));
      } catch {}
      lines = [];
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
  }
  if (batch.length > 0) yield batch;
}

async function run() {
  const { uri, database, importDir, file, colName, dropTarget } = config;
  let client;
  try {
    client = new MongoClient(uri);
    await client.connect();
    const db = client.db(database);

    if (dropTarget) {
      try { await db.dropCollection(colName); } catch {}
    }

    const filePath = path.join(importDir, file);
    let copied = 0;

    for await (const batch of readJsonArrayStreaming(filePath, 2000)) {
      const restored = batch.map(deserialize);
      try {
        await db.collection(colName).insertMany(restored, { ordered: false });
        copied += restored.length;
      } catch (e) {
        // BulkWriteError — some docs inserted, some had duplicate keys
        if (e.insertedCount !== undefined) {
          copied += e.insertedCount;
        }
        // Other errors: don't count, log for debugging
        send({ type: 'batch-error', error: (e.message || String(e)).slice(0, 200) });
      }
      send({ type: 'progress', copied });
    }

    // Restore indexes
    const indexFile = path.join(importDir, colName + '.indexes.json');
    if (existsSync(indexFile)) {
      try {
        const indexes = JSON.parse(readFileSync(indexFile, 'utf-8'));
        for (const idx of indexes) {
          if (idx.name === '_id_') continue;
          const { key, ...opts } = idx;
          delete opts.v; delete opts.ns;
          try { await db.collection(colName).createIndex(key, opts); } catch {}
        }
      } catch {}
    }

    send({ type: 'done', copied, total: copied });
  } catch (err) {
    send({ type: 'error', error: err.message || 'Import failed' });
  } finally {
    if (client) await client.close().catch(() => {});
    process.exit(0);
  }
}
run();
} catch (e) { console.error('Import worker error:', e); process.exit(1); }
`;

/**
 * Inline worker script for export operations.
 * Runs in a separate thread with its own MongoDB connection.
 */
const EXPORT_WORKER_SCRIPT = `
try {
const { MongoClient, ObjectId, Binary, Decimal128, Long, Timestamp, UUID } = require('mongodb');
const { writeFileSync, mkdirSync, createWriteStream } = require('fs');
const path = require('path');
const send = (msg) => process.send(msg);
const config = JSON.parse(process.argv[2]);

function serialize(doc) {
  if (doc === null || doc === undefined) return doc;
  if (typeof doc === 'string' || typeof doc === 'number' || typeof doc === 'boolean') return doc;
  if (doc instanceof ObjectId || (doc && typeof doc.toHexString === 'function')) return { $oid: doc.toHexString() };
  if (doc instanceof Date) return { $date: doc.toISOString() };
  if (doc instanceof Decimal128) return { $numberDecimal: doc.toString() };
  if (doc instanceof Long) return { $numberLong: doc.toString() };
  if (doc instanceof UUID) return { $uuid: doc.toString() };
  if (doc instanceof Binary) return { $binary: doc.toString('base64'), $type: doc.sub_type.toString(16) };
  if (doc instanceof Timestamp) return { $timestamp: { t: doc.getHighBits(), i: doc.getLowBits() } };
  if (doc instanceof RegExp) return { $regex: doc.source, $options: doc.flags };
  if (Array.isArray(doc)) return doc.map(serialize);
  if (typeof doc === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(doc)) r[k] = serialize(v);
    return r;
  }
  return doc;
}

async function run() {
  const { uri, database, outDir, collections: selectedCols } = config;
  let client;
  try {
    client = new MongoClient(uri);
    await client.connect();
    const db = client.db(database);
    const dbDir = path.join(outDir, database);
    mkdirSync(dbDir, { recursive: true });

    const allCols = await db.listCollections().toArray();
    let regular = allCols.filter(c => c.type !== 'view');
    let views = allCols.filter(c => c.type === 'view');
    if (selectedCols && selectedCols.length > 0) {
      const selected = new Set(selectedCols);
      regular = regular.filter(c => selected.has(c.name));
      views = views.filter(c => selected.has(c.name));
    }

    send({ type: 'init', collections: regular.map(c => c.name), viewCount: views.length });

    for (let i = 0; i < regular.length; i++) {
      const col = regular[i];
      send({ type: 'collection-start', index: i, colName: col.name });
      try {
        const count = await db.collection(col.name).estimatedDocumentCount().catch(() => 0);
        send({ type: 'collection-total', index: i, total: count });

        const ws = createWriteStream(path.join(dbDir, col.name + '.json'), { encoding: 'utf-8' });
        ws.write('[\\n');
        const cursor = db.collection(col.name).find({});
        let first = true, copied = 0;
        for await (const rawDoc of cursor) {
          if (!first) ws.write(',\\n');
          ws.write(JSON.stringify(serialize(rawDoc), null, 2));
          first = false;
          copied++;
          if (copied % 5000 === 0) {
            send({ type: 'collection-progress', index: i, copied });
          }
        }
        ws.write('\\n]');
        await new Promise((res, rej) => { ws.end(() => res()); ws.on('error', rej); });

        // Save indexes
        try {
          const indexes = await db.collection(col.name).indexes();
          writeFileSync(path.join(dbDir, col.name + '.indexes.json'), JSON.stringify(indexes, null, 2));
        } catch {}

        send({ type: 'collection-done', index: i, copied, total: count || copied });
      } catch (err) {
        send({ type: 'collection-error', index: i, error: err.message || 'Export failed' });
      }
    }

    if (views.length > 0) {
      send({ type: 'views-start' });
      try {
        writeFileSync(path.join(dbDir, '_views.json'), JSON.stringify(views, null, 2));
        send({ type: 'views-done', copied: views.length, total: views.length });
      } catch (err) {
        send({ type: 'views-error', error: err.message || 'View export failed' });
      }
    }

    send({ type: 'complete', path: dbDir });
  } catch (err) {
    send({ type: 'fatal-error', error: err.message || 'Export failed' });
  } finally {
    if (client) await client.close().catch(() => {});
    process.exit(0);
  }
}
run();
} catch (e) { console.error('Export worker startup error:', e); process.exit(1); }
`;

let opCounter = 0

/** Active child processes for cancellable operations */
const activeProcesses = new Map<string, ChildProcess>()

/** Abort controllers for cancellable operations */
const activeOperations = new Map<string, AbortController>()

// Write worker scripts to temp files
try { writeFileSync(IMPORT_SCRIPT_PATH, IMPORT_WORKER_SCRIPT) } catch {}
try { writeFileSync(EXPORT_SCRIPT_PATH, EXPORT_WORKER_SCRIPT) } catch {}

export function cancelOperation(opId: string): boolean {
  const proc = activeProcesses.get(opId)
  if (proc) {
    proc.kill('SIGKILL')
    activeProcesses.delete(opId)
    return true
  }
  const controller = activeOperations.get(opId)
  if (controller) {
    controller.abort()
    activeOperations.delete(opId)
    return true
  }
  return false
}

/**
 * Import a single collection in a child process.
 * Process exits after completion, fully freeing all memory.
 */
function importCollectionInProcess(
  uri: string,
  database: string,
  importDir: string,
  file: string,
  colName: string,
  dropTarget: boolean,
  colProgress: { name: string; status: string; copied: number; total: number; error?: string },
  op: OperationProgress
): Promise<number> {
  return new Promise((resolve) => {
    const child = fork(IMPORT_SCRIPT_PATH, [
      JSON.stringify({ uri, database, importDir, file, colName, dropTarget })
    ], {
      execArgv: ['--max-old-space-size=8192'],
      silent: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: [pathJoin(app.getAppPath(), 'node_modules'), pathJoin(process.cwd(), 'node_modules')].join(require('path').delimiter) }
    })

    activeProcesses.set(op.id, child)
    let copied = 0
    let stderrOutput = ''

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        stderrOutput += data.toString()
      })
    }

    child.on('message', (msg: any) => {
      switch (msg.type) {
        case 'total':
          colProgress.total = msg.total
          emitProgress('operation:progress', op)
          break
        case 'progress':
          colProgress.copied = msg.copied
          copied = msg.copied
          op.currentStep = `Importing ${colName} (${msg.copied.toLocaleString()}/${colProgress.total.toLocaleString()})`
          emitProgress('operation:progress', op)
          break
        case 'done':
          colProgress.status = 'done'
          colProgress.copied = msg.copied
          colProgress.total = msg.total
          copied = msg.copied
          op.processed++
          emitProgress('operation:progress', op)
          break
        case 'error':
          colProgress.status = 'error'
          colProgress.error = msg.error
          op.processed++
          emitProgress('operation:progress', op)
          break
      }
    })

    child.on('exit', (code) => {
      activeProcesses.delete(op.id)
      if (colProgress.status === 'running') {
        if (code === null) {
          colProgress.status = 'error'
          colProgress.error = 'Cancelled'
        } else {
          colProgress.status = 'error'
          const lastErr = stderrOutput.trim().split('\n').slice(-2).join(' ').slice(0, 150)
          colProgress.error = lastErr || `Process crashed (code ${code})`
        }
        op.processed++
        emitProgress('operation:progress', op)
      }
      resolve(copied)
    })

    child.on('error', () => {
      activeProcesses.delete(op.id)
      if (colProgress.status === 'running') {
        colProgress.status = 'error'
        colProgress.error = 'Process error'
        op.processed++
        emitProgress('operation:progress', op)
      }
      resolve(copied)
    })
  })
}

/**
 * Run import by forking one process per collection.
 * Each process gets a fresh 8GB heap and exits when done, preventing memory accumulation.
 */
async function runImportWorker(
  uri: string,
  database: string,
  importDir: string,
  files: string[],
  dropTarget: boolean,
  hasViews: boolean,
  op: OperationProgress
): Promise<{ collections: number; documents: number }> {
  let totalDocs = 0
  const cancelled = () => !activeProcesses.has(op.id) && op.status === 'running'

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const colName = file.replace('.json', '')
    const colProgress = op.collections[i]

    colProgress.status = 'running'
    op.currentStep = `Importing ${colName}...`
    emitProgress('operation:progress', op)

    const copied = await importCollectionInProcess(
      uri, database, importDir, file, colName, dropTarget, colProgress as any, op
    )
    totalDocs += copied

    // Check if cancelled
    if (colProgress.status === 'error' && colProgress.error === 'Cancelled') break
  }

  // Handle views (small, can run on main thread)
  if (hasViews && op.collections.every((c) => c.error !== 'Cancelled')) {
    const viewCol = op.collections.find((c) => c.name === 'Views')
    if (viewCol) {
      viewCol.status = 'running'
      op.currentStep = 'Restoring views...'
      emitProgress('operation:progress', op)

      try {
        const { join } = await import('path')
        const { MongoClient } = await import('mongodb')
        const viewsRaw = JSON.parse(readFileSync(join(importDir, '_views.json'), 'utf-8'))
        const viewClient = new MongoClient(uri)
        await viewClient.connect()
        const db = viewClient.db(database)

        viewCol.total = viewsRaw.length
        for (const viewDef of viewsRaw) {
          try {
            if (dropTarget) { try { await db.dropCollection(viewDef.name) } catch {} }
            const viewOn = viewDef.options?.viewOn
            const pipeline = viewDef.options?.pipeline || []
            if (viewOn) await db.createCollection(viewDef.name, { viewOn, pipeline })
            viewCol.copied++
          } catch {}
        }
        viewCol.status = 'done'
        op.processed++
        await viewClient.close()
      } catch (err) {
        viewCol.status = 'error'
        viewCol.error = err instanceof Error ? err.message : 'View restore failed'
        op.processed++
      }
      emitProgress('operation:progress', op)
    }
  }

  const wasCancelled = op.collections.some((c) => c.error === 'Cancelled')
  op.status = wasCancelled ? 'error' : op.collections.some((c) => c.status === 'error') ? 'error' : 'done'
  op.currentStep = wasCancelled ? 'Cancelled' : op.status === 'done' ? 'Complete' : 'Completed with errors'
  if (wasCancelled) op.error = 'Operation cancelled'
  emitProgress('operation:progress', op)

  return { collections: files.length, documents: totalDocs }
}

/**
 * Run an export in a child process.
 */
function runExportWorker(
  uri: string,
  database: string,
  outDir: string,
  op: OperationProgress,
  collections?: string[]
): Promise<{ path: string }> {
  return new Promise((resolve, reject) => {
    const child = fork(EXPORT_SCRIPT_PATH, [
      JSON.stringify({ uri, database, outDir, collections })
    ], {
      execArgv: ['--max-old-space-size=8192'],
      silent: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: [pathJoin(app.getAppPath(), 'node_modules'), pathJoin(process.cwd(), 'node_modules')].join(require('path').delimiter) }
    })

    activeProcesses.set(op.id, child)

    child.on('message', (msg: any) => {
      switch (msg.type) {
        case 'init': {
          const cols = msg.collections as string[]
          op.total = cols.length + (msg.viewCount > 0 ? 1 : 0)
          op.collections = [
            ...cols.map((name: string) => ({ name, status: 'pending' as const, copied: 0, total: 0 })),
            ...(msg.viewCount > 0 ? [{ name: `Views (${msg.viewCount})`, status: 'pending' as const, copied: 0, total: 0 }] : [])
          ]
          emitProgress('operation:progress', op)
          break
        }
        case 'collection-start': {
          const col = op.collections[msg.index]
          if (col) { col.status = 'running'; op.currentStep = `Exporting ${msg.colName}...` }
          emitProgress('operation:progress', op)
          break
        }
        case 'collection-total': {
          const col = op.collections[msg.index]
          if (col) col.total = msg.total
          break
        }
        case 'collection-progress': {
          const col = op.collections[msg.index]
          if (col) {
            col.copied = msg.copied
            op.currentStep = `Exporting ${col.name} (${msg.copied.toLocaleString()}/${col.total.toLocaleString()})`
          }
          emitProgress('operation:progress', op)
          break
        }
        case 'collection-done': {
          const col = op.collections[msg.index]
          if (col) { col.status = 'done'; col.copied = msg.copied; col.total = msg.total; op.processed++ }
          emitProgress('operation:progress', op)
          break
        }
        case 'collection-error': {
          const col = op.collections[msg.index]
          if (col) { col.status = 'error'; col.error = msg.error; op.processed++ }
          emitProgress('operation:progress', op)
          break
        }
        case 'views-start': {
          const v = op.collections.find((c) => c.name.startsWith('Views'))
          if (v) { v.status = 'running'; op.currentStep = 'Exporting views...' }
          emitProgress('operation:progress', op)
          break
        }
        case 'views-done': {
          const v = op.collections.find((c) => c.name.startsWith('Views'))
          if (v) { v.status = 'done'; v.copied = msg.copied; v.total = msg.total; op.processed++ }
          emitProgress('operation:progress', op)
          break
        }
        case 'views-error': {
          const v = op.collections.find((c) => c.name.startsWith('Views'))
          if (v) { v.status = 'error'; v.error = msg.error; op.processed++ }
          emitProgress('operation:progress', op)
          break
        }
        case 'complete': {
          activeProcesses.delete(op.id)
          op.status = op.collections.some((c) => c.status === 'error') ? 'error' : 'done'
          op.currentStep = op.status === 'done' ? 'Complete' : 'Completed with errors'
          emitProgress('operation:progress', op)
          resolve({ path: msg.path })
          break
        }
        case 'fatal-error': {
          activeProcesses.delete(op.id)
          op.status = 'error'; op.error = msg.error; op.currentStep = 'Failed'
          emitProgress('operation:progress', op)
          reject(new Error(msg.error))
          break
        }
      }
    })

    child.on('error', (err) => {
      activeProcesses.delete(op.id)
      op.status = 'error'; op.error = err.message; op.currentStep = 'Failed'
      emitProgress('operation:progress', op)
      reject(err)
    })

    child.on('exit', (code) => {
      activeProcesses.delete(op.id)
      if (op.status === 'running') {
        op.status = 'error'; op.currentStep = code === null ? 'Cancelled' : 'Crashed'; op.error = code === null ? 'Operation cancelled' : `Process exited with code ${code}`
        emitProgress('operation:progress', op)
        resolve({ path: '' })
      }
    })
  })
}

function emitProgress(event: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(event, data)
    }
  }
}

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

export async function listDatabaseCollections(
  connectionId: string,
  database: string
): Promise<{ name: string; type: string }[]> {
  const client = mongoService.getClient(connectionId)
  const db = client.db(database)
  const cols = await db.listCollections().toArray()
  return cols.map((c) => ({ name: c.name, type: c.type || 'collection' })).sort((a, b) => a.name.localeCompare(b.name))
}

export async function exportDatabaseDump(
  connectionId: string,
  database: string,
  collections?: string[]
): Promise<{ path: string } | null> {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return null

  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    title: `Export ${database} (mongodump)`,
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled || filePaths.length === 0) return null
  const outDir = filePaths[0]

  const connections = configService.loadConnections()
  const profile = connections.find((c) => c.id === connectionId)
  if (!profile) throw new Error('Connection not found')

  // Try mongodump first (only for full database exports)
  if (!collections) {
    try {
      await execFileAsync('mongodump', ['--uri', profile.uri, '--db', database, '--out', outDir])
      const opId = `export-${++opCounter}-${Date.now()}`
      const op: OperationProgress = {
        id: opId, type: 'export', label: `Export ${database} from ${profile.name}`,
        status: 'done', currentStep: 'Complete (mongodump)', processed: 0, total: 0,
        collections: [], startedAt: Date.now()
      }
      emitProgress('operation:progress', op)
      return { path: outDir }
    } catch { /* Fall back to worker-based JSON export */ }
  }

  const opId = `export-${++opCounter}-${Date.now()}`
  const op: OperationProgress = {
    id: opId, type: 'export',
    label: `Export ${database} from ${profile.name}`,
    status: 'running', currentStep: 'Starting export...', processed: 0, total: 0,
    collections: [], startedAt: Date.now()
  }
  emitProgress('operation:progress', op)

  return runExportWorker(profile.uri, database, outDir, op, collections)
}

export async function importDatabaseDump(
  connectionId: string,
  database: string,
  dropExisting: boolean = false,
  collections?: string[]
): Promise<{ collections: number; documents: number } | null> {
  const connections = configService.loadConnections()
  const profile = connections.find((c) => c.id === connectionId)
  if (profile?.isProduction) throw new Error('Cannot import to a production connection')
  if (profile?.isReadOnly) throw new Error('Cannot import to a read-only connection')

  const win = BrowserWindow.getFocusedWindow()
  if (!win) return null

  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    title: `Import to ${database}`,
    properties: ['openDirectory']
  })
  if (canceled || filePaths.length === 0) return null
  const importDir = filePaths[0]

  // Try mongorestore first (only for full database imports)
  if (!collections) {
    try {
      const args = ['--uri', profile!.uri, '--db', database, '--dir', importDir]
      if (dropExisting) args.push('--drop')
      await execFileAsync('mongorestore', args)
      return { collections: -1, documents: -1 }
    } catch { /* Fall back to worker-based JSON import */ }
  }

  const { readdirSync } = await import('fs')
  const { join } = await import('path')
  let files = readdirSync(importDir).filter((f: string) => f.endsWith('.json') && !f.startsWith('_') && !f.endsWith('.indexes.json'))
  if (collections && collections.length > 0) {
    const selected = new Set(collections)
    files = files.filter((f: string) => selected.has(f.replace('.json', '')))
  }
  const hasViews = !collections && existsSync(join(importDir, '_views.json'))

  const opId = `import-${++opCounter}-${Date.now()}`
  const op: OperationProgress = {
    id: opId, type: 'import',
    label: `Import to ${database} on ${profile?.name || 'unknown'}`,
    status: 'running', currentStep: 'Starting import...', processed: 0,
    total: files.length + (hasViews ? 1 : 0),
    collections: [
      ...files.map((f: string) => ({ name: f.replace('.json', ''), status: 'pending' as const, copied: 0, total: 0 })),
      ...(hasViews ? [{ name: 'Views', status: 'pending' as const, copied: 0, total: 0 }] : [])
    ],
    startedAt: Date.now()
  }
  emitProgress('operation:progress', op)

  return runImportWorker(profile!.uri, database, importDir, files, dropExisting, hasViews, op)
}

/**
 * Pick a dump folder and detect the database name from it.
 * Returns the resolved import directory and detected database name.
 */
export async function pickDumpFolder(): Promise<{ importDir: string; detectedName: string; collections: string[] } | null> {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return null

  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    title: 'Select database dump folder to import',
    properties: ['openDirectory']
  })

  if (canceled || filePaths.length === 0) return null
  const selectedDir = filePaths[0]

  const { readdirSync, statSync } = await import('fs')
  const { join, basename } = await import('path')

  const entries = readdirSync(selectedDir)
  const hasDataFiles = entries.some((e) => e.endsWith('.json') || e.endsWith('.bson'))
  const subdirs = entries.filter((e) => {
    try { return statSync(join(selectedDir, e)).isDirectory() } catch { return false }
  })

  let importDir: string
  let detectedName: string

  if (hasDataFiles) {
    importDir = selectedDir
    detectedName = basename(selectedDir)
  } else if (subdirs.length === 1) {
    importDir = join(selectedDir, subdirs[0])
    detectedName = subdirs[0]
  } else if (subdirs.length > 1) {
    const dbDir = subdirs.find((d) => {
      const files = readdirSync(join(selectedDir, d))
      return files.some((f) => f.endsWith('.json') || f.endsWith('.bson'))
    })
    if (!dbDir) throw new Error('No importable data found in selected folder')
    importDir = join(selectedDir, dbDir)
    detectedName = dbDir
  } else {
    throw new Error('No importable data found in selected folder. Expected .json files or a database subfolder.')
  }

  // List collections found in the dump for preview
  const dumpFiles = readdirSync(importDir)
  const collections = dumpFiles
    .filter((f) => f.endsWith('.json') && !f.startsWith('_') && !f.endsWith('.indexes.json'))
    .map((f) => f.replace('.json', ''))
  // Also include BSON collections (from mongodump)
  const bsonCollections = dumpFiles
    .filter((f) => f.endsWith('.bson'))
    .map((f) => f.replace('.bson', ''))
  const allCollections = [...new Set([...collections, ...bsonCollections])].sort()

  return { importDir, detectedName, collections: allCollections }
}

/**
 * Import a database from a previously picked dump folder.
 * Supports overwrite (dropTarget=true) or create as new name.
 */
export async function importDatabaseFromDump(
  connectionId: string,
  importDir: string,
  targetDatabase: string,
  dropTarget: boolean,
  collections?: string[]
): Promise<{ database: string; collections: number; documents: number }> {
  const connections = configService.loadConnections()
  const profile = connections.find((c) => c.id === connectionId)
  if (profile?.isProduction) throw new Error('Cannot import to a production connection')
  if (profile?.isReadOnly) throw new Error('Cannot import to a read-only connection')
  if (!profile) throw new Error('Connection not found')

  // Try mongorestore first (only for full database imports)
  if (!collections) {
    try {
      const args = ['--uri', profile.uri, '--db', targetDatabase, '--dir', importDir]
      if (dropTarget) args.push('--drop')
      await execFileAsync('mongorestore', args)
      return { database: targetDatabase, collections: -1, documents: -1 }
    } catch { /* Fall back to worker-based JSON import */ }
  }

  const { readdirSync } = await import('fs')
  const { join } = await import('path')
  let files = readdirSync(importDir).filter((f: string) => f.endsWith('.json') && !f.startsWith('_') && !f.endsWith('.indexes.json'))
  if (collections && collections.length > 0) {
    const selected = new Set(collections)
    files = files.filter((f: string) => selected.has(f.replace('.json', '')))
  }
  const hasViews = !collections && existsSync(join(importDir, '_views.json'))

  const opId = `import-${++opCounter}-${Date.now()}`
  const op: OperationProgress = {
    id: opId, type: 'import',
    label: `Import ${targetDatabase} → ${profile.name}`,
    status: 'running', currentStep: 'Starting import...', processed: 0,
    total: files.length + (hasViews ? 1 : 0),
    collections: [
      ...files.map((f: string) => ({ name: f.replace('.json', ''), status: 'pending' as const, copied: 0, total: 0 })),
      ...(hasViews ? [{ name: 'Views', status: 'pending' as const, copied: 0, total: 0 }] : [])
    ],
    startedAt: Date.now()
  }
  emitProgress('operation:progress', op)

  const result = await runImportWorker(profile.uri, targetDatabase, importDir, files, dropTarget, hasViews, op)
  return { database: targetDatabase, ...result }
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
