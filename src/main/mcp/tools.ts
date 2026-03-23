import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as connectionActions from '../actions/connection'
import * as explorerActions from '../actions/explorer'
import * as queryActions from '../actions/query'
import * as mutationActions from '../actions/mutation'
import * as configService from '../services/config'
import * as mongoService from '../services/mongodb'

/**
 * Check if the active connection allows Claude to write.
 * Returns an error message if blocked, null if allowed.
 */
function checkWriteAccess(): string | null {
  const activeId = mongoService.getActiveConnectionId()
  if (!activeId) return 'No active connection'

  const connections = configService.loadConnections()
  const profile = connections.find((c) => c.id === activeId)
  if (!profile) return 'Connection profile not found'

  if (profile.isProduction && profile.claudeAccess !== 'readwrite') {
    return `BLOCKED: "${profile.name}" is a production database with Claude access set to "${profile.claudeAccess || 'readonly'}". Mutations are not allowed. Tell the user to change Claude access to "readwrite" in the connection settings if they want to allow this.`
  }

  if (profile.claudeAccess === 'readonly') {
    return `BLOCKED: "${profile.name}" has Claude access set to "readonly". Mutations are not allowed. Tell the user to change this in connection settings if they want to allow writes.`
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
    const access = `claude:${c.claudeAccess || (c.isProduction ? 'readonly' : 'readwrite')}`
    return `- ${c.name}${active}: ${connected}${prod} (${access})`
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

  // --- Mutation tools (with write access checks) ---
  server.registerTool('mongo_insert_one', {
    description: 'Insert a single document. BLOCKED on readonly/production connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      document: z.record(z.unknown())
    }
  }, async ({ database, collection, document }) => {
    const blocked = checkWriteAccess()
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const result = await mutationActions.insertOne(database, collection, document)
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
    const blocked = checkWriteAccess()
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const result = await mutationActions.updateOne(database, collection, filter, update)
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
    const blocked = checkWriteAccess()
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const result = await mutationActions.deleteOne(database, collection, filter)
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
    const blocked = checkWriteAccess()
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const result = await mutationActions.deleteMany(database, collection, filter)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })
}
