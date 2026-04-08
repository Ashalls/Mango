import { app, BrowserWindow } from 'electron'
import { fork, ChildProcess } from 'child_process'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import * as mongoService from '../services/mongodb'
import * as configService from '../services/config'
import type { CopyDatabaseOptions, CopyCollectionOptions, CopyProgress, OperationProgress, CollectionProgress } from '@shared/types'

function emitProgress(event: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(event, data)
    }
  }
}

let opCounter = 0

const activeProcesses = new Map<string, ChildProcess>()

export function cancelOperation(opId: string): boolean {
  const proc = activeProcesses.get(opId)
  if (proc) {
    proc.kill('SIGKILL')
    activeProcesses.delete(opId)
    return true
  }
  return false
}

// Single-collection copy worker script
const COPY_SCRIPT_PATH = pathJoin(tmpdir(), 'mango-copy-worker.js')
const COPY_WORKER_SCRIPT = `
try {
const { MongoClient } = require('mongodb');
const send = (msg) => process.send(msg);
const config = JSON.parse(process.argv[2]);

async function run() {
  const { sourceUri, targetUri, sourceDatabase, targetDatabase, sourceColName, targetColName, dropTarget } = config;
  let sourceClient, targetClient;
  try {
    sourceClient = new MongoClient(sourceUri);
    targetClient = sourceUri === targetUri ? sourceClient : new MongoClient(targetUri);
    await sourceClient.connect();
    if (sourceUri !== targetUri) await targetClient.connect();

    const sourceDb = sourceClient.db(sourceDatabase);
    const targetDb = targetClient.db(targetDatabase);

    if (dropTarget) {
      try { await targetDb.dropCollection(targetColName); } catch {}
    }

    const sourceCol = sourceDb.collection(sourceColName);
    const count = await sourceCol.estimatedDocumentCount().catch(() => 0);
    send({ type: 'total', total: count });

    const targetCol = targetDb.collection(targetColName);
    const batchSize = 2000;
    const cursor = sourceCol.find({});
    let batch = [], copied = 0;

    for await (const doc of cursor) {
      batch.push(doc);
      if (batch.length >= batchSize) {
        await targetCol.insertMany(batch, { ordered: false });
        copied += batch.length;
        send({ type: 'progress', copied });
        batch = [];
      }
    }
    if (batch.length > 0) {
      await targetCol.insertMany(batch, { ordered: false });
      copied += batch.length;
    }

    // Copy indexes
    try {
      const indexes = await sourceCol.indexes();
      for (const idx of indexes) {
        if (idx.name === '_id_') continue;
        const { key, ...opts } = idx;
        delete opts.v; delete opts.ns;
        try { await targetCol.createIndex(key, opts); } catch {}
      }
    } catch {}

    send({ type: 'done', copied, total: count || copied });
  } catch (err) {
    send({ type: 'error', error: err.message || 'Copy failed' });
  } finally {
    if (sourceClient) await sourceClient.close().catch(() => {});
    if (targetClient && config.sourceUri !== config.targetUri) await targetClient.close().catch(() => {});
    process.exit(0);
  }
}
run();
} catch (e) { console.error('Copy worker error:', e); process.exit(1); }
`

// Write script on startup
try { writeFileSync(COPY_SCRIPT_PATH, COPY_WORKER_SCRIPT) } catch {}

function copyCollectionInProcess(
  sourceUri: string,
  targetUri: string,
  sourceDatabase: string,
  targetDatabase: string,
  sourceColName: string,
  targetColName: string,
  dropTarget: boolean,
  colProgress: CollectionProgress,
  op: OperationProgress
): Promise<number> {
  return new Promise((resolve) => {
    const child = fork(COPY_SCRIPT_PATH, [
      JSON.stringify({ sourceUri, targetUri, sourceDatabase, targetDatabase, sourceColName, targetColName, dropTarget })
    ], {
      execArgv: ['--max-old-space-size=4096'],
      silent: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: [pathJoin(app.getAppPath(), 'node_modules'), pathJoin(process.cwd(), 'node_modules')].join(require('path').delimiter) }
    })

    activeProcesses.set(op.id, child)
    let copied = 0

    child.on('message', (msg: any) => {
      switch (msg.type) {
        case 'total':
          colProgress.total = msg.total
          emitProgress('operation:progress', op)
          break
        case 'progress':
          colProgress.copied = msg.copied
          copied = msg.copied
          op.currentStep = `Copying ${targetColName} (${msg.copied.toLocaleString()}/${colProgress.total.toLocaleString()})`
          emitProgress('operation:progress', op)
          // Legacy event
          emitProgress('migration:progress', {
            collection: targetColName, copied: msg.copied, total: colProgress.total, status: 'copying'
          })
          break
        case 'done':
          colProgress.status = 'done'
          colProgress.copied = msg.copied
          colProgress.total = msg.total
          copied = msg.copied
          op.processed++
          emitProgress('operation:progress', op)
          emitProgress('migration:progress', {
            collection: targetColName, copied: msg.copied, total: msg.total, status: 'done'
          })
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
        colProgress.status = 'error'
        colProgress.error = code === null ? 'Cancelled' : `Process crashed (code ${code})`
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
  if (targetProfile?.isReadOnly) {
    throw new Error(
      `Cannot copy to "${targetProfile.name}" — it is marked as read-only. ` +
        'Disable Read Only in connection settings to allow writes.'
    )
  }

  const sourceProfile = connections.find((c) => c.id === options.sourceConnectionId)
  if (!sourceProfile || !targetProfile) throw new Error('Connection not found')

  // We need the URIs for child processes
  const sourceUri = sourceProfile.uri
  const targetUri = targetProfile.uri

  const sourceClient = mongoService.getClient(options.sourceConnectionId)
  const sourceDb = sourceClient.db(options.sourceDatabase)

  const opId = `copy-${++opCounter}-${Date.now()}`
  const op: OperationProgress = {
    id: opId,
    type: 'copy',
    label: `Copy ${options.sourceDatabase} → ${options.targetDatabase} on ${targetProfile.name}`,
    status: 'running',
    currentStep: 'Listing collections...',
    processed: 0,
    total: 0,
    collections: [],
    startedAt: Date.now()
  }
  emitProgress('operation:progress', op)

  // Get collections
  const allCollections = await sourceDb.listCollections().toArray()
  const regularCollections = allCollections.filter((c) => c.type !== 'view')
  const views = allCollections.filter((c) => c.type === 'view')

  const collectionsToCopy = options.collections?.length
    ? regularCollections.filter((c) => options.collections!.includes(c.name))
    : regularCollections

  op.collections = [
    ...collectionsToCopy.map((c) => ({
      name: c.name,
      status: 'pending' as const,
      copied: 0,
      total: 0
    })),
    ...views.map((v) => ({
      name: `${v.name} (view)`,
      status: 'pending' as const,
      copied: 0,
      total: 0
    }))
  ]
  op.total = collectionsToCopy.length + views.length
  emitProgress('operation:progress', op)

  // Copy collections — one child process each
  for (let i = 0; i < collectionsToCopy.length; i++) {
    const colName = collectionsToCopy[i].name
    const colProgress = op.collections[i]

    colProgress.status = 'running'
    op.currentStep = `Copying ${colName}...`
    emitProgress('operation:progress', op)

    await copyCollectionInProcess(
      sourceUri, targetUri,
      options.sourceDatabase, options.targetDatabase,
      colName, colName, options.dropTarget || false,
      colProgress, op
    )

    if (colProgress.error === 'Cancelled') break
  }

  // Copy views (small, main thread is fine)
  if (!op.collections.some((c) => c.error === 'Cancelled')) {
    const targetClient = mongoService.getClient(options.targetConnectionId)
    const targetDb = targetClient.db(options.targetDatabase)

    for (let i = 0; i < views.length; i++) {
      const viewInfo = views[i]
      const viewProgressIdx = collectionsToCopy.length + i
      const viewProgress = op.collections[viewProgressIdx]

      viewProgress.status = 'running'
      op.currentStep = `Creating view ${viewInfo.name}...`
      emitProgress('operation:progress', op)

      try {
        if (options.dropTarget) {
          try { await targetDb.dropCollection(viewInfo.name) } catch {}
        }
        const viewOn = (viewInfo as any).options?.viewOn
        const pipeline = (viewInfo as any).options?.pipeline || []
        if (viewOn) {
          await targetDb.createCollection(viewInfo.name, { viewOn, pipeline })
        }
        viewProgress.status = 'done'
        op.processed++
      } catch (err) {
        viewProgress.status = 'error'
        viewProgress.error = err instanceof Error ? err.message : 'View creation failed'
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

  emitProgress('migration:complete', {
    sourceDatabase: options.sourceDatabase,
    targetDatabase: options.targetDatabase,
    targetConnectionId: options.targetConnectionId
  })
}

export async function copyCollection(options: CopyCollectionOptions): Promise<void> {
  // Production safety check
  const connections = configService.loadConnections()
  const targetProfile = connections.find((c) => c.id === options.targetConnectionId)
  if (targetProfile?.isProduction) {
    throw new Error(
      `Cannot copy to "${targetProfile.name}" — it is tagged as production. ` +
        'Production connections are protected from mass write operations.'
    )
  }
  if (targetProfile?.isReadOnly) {
    throw new Error(
      `Cannot copy to "${targetProfile.name}" — it is marked as read-only. ` +
        'Disable Read Only in connection settings to allow writes.'
    )
  }

  const sourceProfile = connections.find((c) => c.id === options.sourceConnectionId)
  if (!sourceProfile || !targetProfile) throw new Error('Connection not found')

  const sourceUri = sourceProfile.uri
  const targetUri = targetProfile.uri

  const opId = `copy-col-${++opCounter}-${Date.now()}`
  const op: OperationProgress = {
    id: opId,
    type: 'copy',
    label: `Copy ${options.sourceDatabase}.${options.sourceCollection} → ${options.targetDatabase}.${options.targetCollection} on ${targetProfile.name}`,
    status: 'running',
    currentStep: `Copying ${options.targetCollection}...`,
    processed: 0,
    total: 1,
    collections: [
      {
        name: options.targetCollection,
        status: 'running',
        copied: 0,
        total: 0
      }
    ],
    startedAt: Date.now()
  }
  emitProgress('operation:progress', op)

  const colProgress = op.collections[0]

  await copyCollectionInProcess(
    sourceUri,
    targetUri,
    options.sourceDatabase,
    options.targetDatabase,
    options.sourceCollection,
    options.targetCollection,
    options.dropTarget || false,
    colProgress,
    op
  )

  const wasCancelled = colProgress.error === 'Cancelled'
  op.status = wasCancelled ? 'error' : colProgress.status === 'error' ? 'error' : 'done'
  op.currentStep = wasCancelled
    ? 'Cancelled'
    : op.status === 'done'
      ? 'Complete'
      : 'Completed with errors'
  if (wasCancelled) op.error = 'Operation cancelled'
  emitProgress('operation:progress', op)

  emitProgress('migration:complete', {
    sourceDatabase: options.sourceDatabase,
    targetDatabase: options.targetDatabase,
    targetConnectionId: options.targetConnectionId,
    targetCollection: options.targetCollection
  })
}
