import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BrowserWindow } from 'electron'
import * as connectionActions from '../actions/connection'
import * as explorerActions from '../actions/explorer'
import * as queryActions from '../actions/query'
import * as mutationActions from '../actions/mutation'
import * as configService from '../services/config'
import * as mongoService from '../services/mongodb'
import * as changelog from '../services/changelog'
import * as adminActions from '../actions/admin'
import * as profilerActions from '../actions/profiler'

let _mainWindow: BrowserWindow | null = null

export function setToolsMainWindow(win: BrowserWindow): void {
  _mainWindow = win
}

function emitToRenderer(event: string, data: unknown): void {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send(event, data)
  }
}

/**
 * Check if the active connection allows Claude to write to a specific database.
 * Checks: connection-level default → per-database override.
 * Returns an error message if blocked, null if allowed.
 */
function checkWriteAccess(database?: string): string | null {
  const activeId = mongoService.getActiveConnectionId()
  if (!activeId) return 'No active connection'

  const connections = configService.loadConnections()
  const profile = connections.find((c) => c.id === activeId)
  if (!profile) return 'Connection profile not found'

  // Read-only connections block all writes, no per-database override
  if (profile.isReadOnly) {
    return `BLOCKED: connection "${profile.name}" is marked as read-only. All mutations are blocked. The user must disable Read Only in connection settings to allow writes.`
  }

  // Determine effective access: per-database override takes priority over connection default
  const connectionDefault = profile.claudeAccess || (profile.isProduction ? 'readonly' : 'readwrite')
  const effectiveAccess = (database && profile.claudeDbOverrides?.[database]) || connectionDefault

  if (effectiveAccess === 'readonly') {
    const overridden = database && profile.claudeDbOverrides?.[database]
    const source = overridden ? `database "${database}"` : `connection "${profile.name}"`
    return `BLOCKED: ${source} has Claude access set to "readonly". Mutations are not allowed. The user can change this by right-clicking the ${overridden ? 'database' : 'connection'} and toggling Claude access.`
  }

  return null
}

/**
 * Build a context summary of all connections for Claude's awareness.
 */
function getConnectionsSummary(): string {
  const connections = configService.loadConnections()
  const connectedIds = mongoService.getConnectedIds()
  const activeId = mongoService.getActiveConnectionId()

  const lines = connections.map((c) => {
    const connected = connectedIds.includes(c.id) ? 'CONNECTED' : 'disconnected'
    const active = c.id === activeId ? ' (ACTIVE)' : ''
    const prod = c.isProduction ? ' [PRODUCTION]' : ''
    const readOnly = c.isReadOnly ? ' [READ-ONLY]' : ''
    const access = `claude:${c.claudeAccess || (c.isProduction ? 'readonly' : 'readwrite')}`
    return `- ${c.name}${active}: ${connected}${prod}${readOnly} (${access})`
  })

  return lines.join('\n')
}

export function registerTools(server: McpServer): void {
  // --- Connection tools ---
  server.registerTool('mongo_list_connections', {
    description: 'List all saved MongoDB connection profiles with their status, production flag, and Claude access level',
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async () => {
    const summary = getConnectionsSummary()
    return {
      content: [{ type: 'text', text: summary }]
    }
  })

  server.registerTool('mongo_connect', {
    description: 'Connect to a MongoDB instance using a saved connection profile ID',
    inputSchema: { id: z.string().describe('Connection profile ID') }
  }, async ({ id }) => {
    const result = await connectionActions.connect(id)
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }]
    }
  })

  server.registerTool('mongo_connection_status', {
    description: 'Get current connection status including all connected databases and their permissions',
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async () => {
    const status = connectionActions.getStatus()
    const summary = getConnectionsSummary()
    return {
      content: [{ type: 'text', text: `Active: ${status.profileId}\nConnected: ${status.connectedIds.join(', ')}\n\nAll connections:\n${summary}` }]
    }
  })

  server.registerTool('mongo_switch_connection', {
    description: 'Switch the active connection to a different connected database',
    inputSchema: { id: z.string().describe('Connection profile ID to switch to') }
  }, async ({ id }) => {
    connectionActions.setActive(id)
    return {
      content: [{ type: 'text', text: `Switched active connection to ${id}` }]
    }
  })

  // --- Explorer tools ---
  server.registerTool('mongo_list_databases', {
    description: 'List all databases on the active connection',
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async () => {
    const dbs = await explorerActions.listDatabases()
    return {
      content: [{ type: 'text', text: JSON.stringify(dbs, null, 2) }]
    }
  })

  server.registerTool('mongo_list_collections', {
    description: 'List all collections in a database',
    inputSchema: { database: z.string().describe('Database name') },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database }) => {
    const collections = await explorerActions.listCollections(database)
    return {
      content: [{ type: 'text', text: JSON.stringify(collections, null, 2) }]
    }
  })

  server.registerTool('mongo_collection_schema', {
    description: 'Sample documents to infer the schema of a collection',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name'),
      sampleSize: z.number().default(100).describe('Number of documents to sample')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, collection, sampleSize }) => {
    const schema = await explorerActions.collectionSchema(database, collection, sampleSize)
    return {
      content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }]
    }
  })

  // --- Index tools ---
  server.registerTool('mongo_list_indexes', {
    description: 'List all indexes on a collection',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, collection }) => {
    const indexes = await adminActions.listIndexes(database, collection)
    return { content: [{ type: 'text', text: JSON.stringify(indexes, null, 2) }] }
  })

  server.registerTool('mongo_index_stats', {
    description: 'Get index usage statistics for a collection',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, collection }) => {
    const stats = await adminActions.getIndexStats(database, collection)
    return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] }
  })

  server.registerTool('mongo_create_index', {
    description: 'Create an index on a collection. BLOCKED on readonly connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      fields: z.record(z.union([z.number(), z.string()])).describe('Index fields and directions (1, -1, "text", "2dsphere")'),
      unique: z.boolean().optional().default(false),
      sparse: z.boolean().optional().default(false),
      expireAfterSeconds: z.number().optional(),
      name: z.string().optional()
    }
  }, async ({ database, collection, fields, unique, sparse, expireAfterSeconds, name }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const options: Record<string, unknown> = {}
    if (unique) options.unique = true
    if (sparse) options.sparse = true
    if (expireAfterSeconds !== undefined) options.expireAfterSeconds = expireAfterSeconds
    if (name) options.name = name
    const indexName = await adminActions.createIndex(database, collection, fields, options)
    return { content: [{ type: 'text', text: `Created index: ${indexName}` }] }
  })

  server.registerTool('mongo_drop_index', {
    description: 'Drop an index by name. BLOCKED on readonly connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      indexName: z.string().describe('Name of the index to drop')
    }
  }, async ({ database, collection, indexName }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    await adminActions.dropIndex(database, collection, indexName)
    return { content: [{ type: 'text', text: `Dropped index: ${indexName}` }] }
  })

  server.registerTool('mongo_rename_collection', {
    description: 'Rename a collection. BLOCKED on readonly connections.',
    inputSchema: {
      database: z.string().describe('Database name'),
      oldName: z.string().describe('Current collection name'),
      newName: z.string().describe('New collection name')
    }
  }, async ({ database, oldName, newName }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    await adminActions.renameCollection(database, oldName, newName)
    return { content: [{ type: 'text', text: `Renamed collection "${oldName}" to "${newName}" in database "${database}"` }] }
  })

  // --- Query tools (always read-only) ---
  server.registerTool('mongo_find', {
    description: 'Find documents in a collection with optional filter, projection, sort, skip, and limit',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name'),
      filter: z.record(z.unknown()).optional().default({}).describe('MongoDB query filter'),
      projection: z.record(z.number()).optional().describe('Fields to include/exclude'),
      sort: z.record(z.number()).optional().describe('Sort specification'),
      skip: z.number().optional().default(0),
      limit: z.number().optional().default(50)
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async (params) => {
    const result = await queryActions.find(params)
    // Emit directly to renderer so the table can display these exact results
    emitToRenderer('claude:find-results', {
      database: params.database,
      collection: params.collection,
      documents: result.documents,
      totalCount: result.totalCount
    })
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    }
  })

  server.registerTool('mongo_count', {
    description: 'Count documents matching a filter',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name'),
      filter: z.record(z.unknown()).optional().default({})
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, collection, filter }) => {
    const count = await queryActions.count(database, collection, filter)
    return { content: [{ type: 'text', text: String(count) }] }
  })

  server.registerTool('mongo_aggregate', {
    description: 'Run an aggregation pipeline on a collection',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name'),
      pipeline: z.array(z.record(z.unknown())).describe('Aggregation pipeline stages')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, collection, pipeline }) => {
    const result = await queryActions.aggregate(database, collection, pipeline)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('mongo_distinct', {
    description: 'Get distinct values for a field',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name'),
      field: z.string().describe('Field name'),
      filter: z.record(z.unknown()).optional().default({})
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, collection, field, filter }) => {
    const values = await queryActions.distinct(database, collection, field, filter)
    return { content: [{ type: 'text', text: JSON.stringify(values, null, 2) }] }
  })

  server.registerTool('mongo_explain', {
    description: 'Get the query execution plan',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name'),
      filter: z.record(z.unknown()).optional().default({})
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, collection, filter }) => {
    const plan = await queryActions.explain(database, collection, filter)
    return { content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }] }
  })

  server.registerTool('mongo_aggregate_preview', {
    description: 'Preview the output of an aggregation pipeline up to a specific stage index. Useful for debugging pipelines stage by stage.',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name'),
      pipeline: z.array(z.record(z.unknown())).describe('Full aggregation pipeline array'),
      stageIndex: z.number().describe('Zero-based index of the stage to preview up to'),
      sampleSize: z.number().default(10).describe('Max documents to return in preview')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, collection, pipeline, stageIndex, sampleSize }) => {
    const result = await queryActions.aggregateWithStagePreview(
      database, collection, pipeline, stageIndex, sampleSize
    )
    return {
      content: [{ type: 'text', text: `Stage ${stageIndex} output (${result.count} total docs):\n${JSON.stringify(result.documents, null, 2)}` }]
    }
  })

  server.registerTool('mongo_value_search', {
    description: 'Search for a text value across all fields in collections. Useful for finding where a specific value appears in the database.',
    inputSchema: {
      searchTerm: z.string().describe('Text to search for'),
      scope: z.enum(['server', 'database', 'collection']).describe('Search scope'),
      database: z.string().optional().describe('Database name (required for database/collection scope)'),
      collection: z.string().optional().describe('Collection name (required for collection scope)'),
      caseInsensitive: z.boolean().default(true).describe('Case-insensitive search'),
      maxResults: z.number().default(50).describe('Maximum results to return')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ searchTerm, scope, database, collection, caseInsensitive, maxResults }) => {
    const results = await queryActions.valueSearch(
      searchTerm,
      { type: scope, database, collection },
      { regex: false, caseInsensitive, maxResults }
    )
    const summary = results.map((r) => `${r.database}.${r.collection} | _id:${r.documentId} | ${r.fieldPath}: ${r.matchedValue}`).join('\n')
    return {
      content: [{ type: 'text', text: `Found ${results.length} matches:\n${summary}` }]
    }
  })

  server.registerTool('mongo_query_profiler', {
    description: 'Read slow query profiling data from a MongoDB database. Returns recent profiled operations sorted by duration.',
    inputSchema: {
      database: z.string().describe('Database name'),
      limit: z.number().default(20).describe('Max results'),
      namespace: z.string().optional().describe('Filter by namespace (e.g., "mydb.users")')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, limit, namespace }) => {
    const data = await profilerActions.getProfilingData(database, limit, namespace)
    const summary = data.map((d: Record<string, unknown>) =>
      `${d.op} ${d.ns} — ${d.millis}ms | ${d.planSummary} | docs:${d.docsExamined} keys:${d.keysExamined}`
    ).join('\n')
    return {
      content: [{ type: 'text', text: `Profiling data (${data.length} entries):\n${summary}` }]
    }
  })

  // --- Mutation tools (with write access checks) ---
  // Helper to get connection info for logging
  function getActiveConnectionInfo() {
    const activeId = mongoService.getActiveConnectionId()
    const connections = configService.loadConnections()
    const profile = connections.find((c) => c.id === activeId)
    return { connectionId: activeId || '', connectionName: profile?.name || '' }
  }

  server.registerTool('mongo_insert_one', {
    description: 'Insert a single document. BLOCKED on readonly/production connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      document: z.record(z.unknown())
    }
  }, async ({ database, collection, document }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const conn = getActiveConnectionInfo()
    const result = await mutationActions.insertOne(database, collection, document)
    changelog.appendChangeLog({
      source: 'claude', ...conn, database, collection,
      operation: 'insert', changes: document, count: 1
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })

  server.registerTool('mongo_update_one', {
    description: 'Update a single document. BLOCKED on readonly/production connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      filter: z.record(z.unknown()),
      update: z.record(z.unknown())
    }
  }, async ({ database, collection, filter, update }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const conn = getActiveConnectionInfo()
    // Capture document before update for rollback
    const before = await queryActions.find({ database, collection, filter, limit: 1 })
    const result = await mutationActions.updateOne(database, collection, filter, update)
    changelog.appendChangeLog({
      source: 'claude', ...conn, database, collection,
      operation: 'update', filter, changes: update,
      documentsBefore: before.documents.slice(0, 1),
      count: result.modifiedCount
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })

  server.registerTool('mongo_delete_one', {
    description: 'Delete a single document. BLOCKED on readonly/production connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      filter: z.record(z.unknown())
    }
  }, async ({ database, collection, filter }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const conn = getActiveConnectionInfo()
    // Capture document before delete for rollback
    const before = await queryActions.find({ database, collection, filter, limit: 1 })
    const result = await mutationActions.deleteOne(database, collection, filter)
    changelog.appendChangeLog({
      source: 'claude', ...conn, database, collection,
      operation: 'delete', filter,
      documentsBefore: before.documents.slice(0, 1),
      count: result.deletedCount
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })

  server.registerTool('mongo_delete_many', {
    description: 'Delete all documents matching filter. BLOCKED on readonly/production connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      filter: z.record(z.unknown())
    }
  }, async ({ database, collection, filter }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const conn = getActiveConnectionInfo()
    const result = await mutationActions.deleteMany(database, collection, filter)
    changelog.appendChangeLog({
      source: 'claude', ...conn, database, collection,
      operation: 'delete', filter, count: result.deletedCount
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })

  server.registerTool('mongo_insert_many', {
    description: 'Insert multiple documents. BLOCKED on readonly connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      documents: z.array(z.record(z.unknown())).describe('Array of documents to insert')
    }
  }, async ({ database, collection, documents }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const conn = getActiveConnectionInfo()
    const result = await mutationActions.insertMany(database, collection, documents)
    changelog.appendChangeLog({
      source: 'claude', ...conn, database, collection,
      operation: 'insert', count: result.insertedCount
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })

  server.registerTool('mongo_update_many', {
    description: 'Update all documents matching filter. BLOCKED on readonly connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      filter: z.record(z.unknown()),
      update: z.record(z.unknown())
    }
  }, async ({ database, collection, filter, update }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const conn = getActiveConnectionInfo()
    const result = await mutationActions.updateMany(database, collection, filter, update)
    changelog.appendChangeLog({
      source: 'claude', ...conn, database, collection,
      operation: 'update', filter, changes: update, count: result.modifiedCount
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })

  // --- Codebase search tool ---
  server.registerTool('mongo_search_codebase', {
    description: 'Search the linked codebase for a database/collection for specific terms. Returns matching code excerpts. Only works if a codebase path is configured for the database.',
    inputSchema: {
      database: z.string().describe('Database name (must have a linked codebase path)'),
      searchTerms: z.array(z.string()).describe('Terms to search for in the codebase (e.g. collection names, field names, function names)')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, searchTerms }) => {
    const activeId = mongoService.getActiveConnectionId()
    if (!activeId) return { content: [{ type: 'text', text: 'No active connection' }], isError: true }
    const connections = configService.loadConnections()
    const profile = connections.find((c) => c.id === activeId)
    const codebasePath = profile?.databaseCodebasePaths?.[database]
    if (!codebasePath) {
      return { content: [{ type: 'text', text: `No codebase path linked for database "${database}". The user can link one by right-clicking the database in the sidebar.` }], isError: true }
    }
    const { scanCodebase, formatContext } = await import('../services/codebaseContext')
    const ctx = scanCodebase(codebasePath, searchTerms)
    const formatted = formatContext(ctx)
    return { content: [{ type: 'text', text: formatted || 'No matching code found for the given search terms.' }] }
  })

  // --- Change log tools ---
  server.registerTool('mongo_changelog', {
    description: 'View the change log of all mutations made by Claude. Use this to review or rollback changes.',
    inputSchema: {
      limit: z.number().optional().default(20)
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ limit }) => {
    const entries = changelog.getRecentChanges(limit)
    return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] }
  })

  server.registerTool('mongo_rollback', {
    description: 'Rollback a specific change by ID. Re-inserts deleted documents or reverts updates.',
    inputSchema: {
      changeId: z.string().describe('The change log entry ID to rollback')
    }
  }, async ({ changeId }) => {
    const entries = changelog.loadChangeLog()
    const entry = entries.find((e) => e.id === changeId)
    if (!entry) return { content: [{ type: 'text', text: 'Change not found' }], isError: true }
    if (entry.rolledBack) return { content: [{ type: 'text', text: 'Already rolled back' }], isError: true }

    const blocked = checkWriteAccess(entry.database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }

    if (entry.operation === 'delete' && entry.documentsBefore?.length) {
      for (const doc of entry.documentsBefore) {
        await mutationActions.insertOne(entry.database, entry.collection, doc)
      }
      changelog.markRolledBack(changeId)
      return { content: [{ type: 'text', text: `Rolled back: re-inserted ${entry.documentsBefore.length} document(s)` }] }
    }

    if (entry.operation === 'update' && entry.documentsBefore?.length) {
      for (const doc of entry.documentsBefore) {
        const { _id, ...fields } = doc
        if (_id) {
          await mutationActions.updateOne(entry.database, entry.collection, { _id }, { $set: fields })
        }
      }
      changelog.markRolledBack(changeId)
      return { content: [{ type: 'text', text: `Rolled back: reverted ${entry.documentsBefore.length} document(s) to previous state` }] }
    }

    return { content: [{ type: 'text', text: 'Cannot rollback this operation type (no before-state captured)' }], isError: true }
  })
}
