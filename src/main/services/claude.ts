import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { DEFAULT_MCP_PORT } from '@shared/constants'
import type { ClaudeAuthMethod } from '@shared/types'
import * as configService from './config'
import * as mongoService from './mongodb'
import { scanCodebase, formatContext } from './codebaseContext'
import { getMcpToken } from '../mcp/server'

/**
 * Executable + env wiring shared by sendMessage and the availability probe.
 * - Packaged builds run the asar-unpacked cli.js via Electron-as-node.
 * - On the apiKey method we inject the stored ANTHROPIC_API_KEY.
 * - On the subscription method we STRIP ambient ANTHROPIC_API_KEY/AUTH_TOKEN so a
 *   key in the user's shell can't silently cause metered billing.
 */
export function buildSdkSpawnOptions(): {
  pathToClaudeCodeExecutable?: string
  executable?: 'node' | 'bun' | 'deno'
  env?: NodeJS.ProcessEnv
} {
  const method: ClaudeAuthMethod =
    configService.loadSettings().claudeAuthMethod === 'apiKey' ? 'apiKey' : 'subscription'
  const env: NodeJS.ProcessEnv = { ...process.env }

  if (method === 'apiKey') {
    const key = configService.loadClaudeApiKey()
    if (key) env.ANTHROPIC_API_KEY = key
  } else {
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
  }

  const opts: { pathToClaudeCodeExecutable?: string; executable?: 'node' | 'bun' | 'deno'; env: NodeJS.ProcessEnv } = { env }
  if (app.isPackaged) {
    opts.pathToClaudeCodeExecutable = join(
      process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'
    )
    opts.executable = process.execPath as 'node'
    env.ELECTRON_RUN_AS_NODE = '1'
  } else {
    // Dev: pin to the SDK bundled in the project's node_modules so `npm run dev`
    // uses the SAME Claude Code CLI as the packaged app, instead of letting the
    // SDK resolve a (possibly mismatched) `claude` from the developer's PATH —
    // a version mismatch there produces malformed server_tool_use blocks that
    // the API rejects. Guarded by existsSync so a missing path just falls back.
    const devCli = join(app.getAppPath(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
    if (existsSync(devCli)) {
      opts.pathToClaudeCodeExecutable = devCli
      opts.executable = process.execPath as 'node'
      env.ELECTRON_RUN_AS_NODE = '1'
    }
  }
  return opts
}

/** 'auto' -> Haiku on the apiKey path (cheap), Sonnet on subscription. */
export function resolveModel(requested: string | undefined, method: ClaudeAuthMethod): string {
  if (requested && requested !== 'auto') return requested
  return method === 'apiKey' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6'
}

let mainWindow: BrowserWindow | null = null
let activeAbortController: AbortController | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

function emitToRenderer(event: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(event, data)
  }
}

interface ChatContext {
  connectionName?: string
  connectionUri?: string
  database?: string
  collection?: string
  currentFilter?: Record<string, unknown>
  resultCount?: number
  page?: number
  totalPages?: number
  openDocumentId?: string
}

function buildSystemPrompt(context: ChatContext): string {
  const connections = configService.loadConnections()
  const connectedIds = mongoService.getConnectedIds()
  const activeId = mongoService.getActiveConnectionId()

  const lines = [
    'You are an assistant embedded in Mango, a MongoDB client application.',
    'You have access to MongoDB tools via MCP that let you query, modify, and explore databases.',
    '',
    '## CONNECTION RULES',
    '- You are ALREADY connected to the active database. Do NOT call mongo_connect or mongo_switch_connection unless the user explicitly asks you to switch to a different connection.',
    '- All query tools (mongo_find, mongo_aggregate, mongo_count, etc.) work on the active connection. Just use them directly with the database and collection names.',
    '',
    '## QUERY BEHAVIOR',
    '- When investigating or searching for data, use mongo_aggregate, mongo_count, and mongo_distinct. These do NOT affect the user\'s table view.',
    '- mongo_find results are automatically displayed in the user\'s table view. Only use mongo_find when you want to SHOW results to the user.',
    '- When you find relevant data during investigation, summarize your findings in chat and ask: "Would you like me to display these documents in the table view?"',
    '- When the user confirms, THEN use mongo_find with the appropriate filter, sort, and limit to render the results.',
    '',
    '## WRITE ACCESS RULES',
    '- The system enforces write access at the tool level. If a tool call is blocked, you will get a BLOCKED error.',
    '- If a database has a per-database override of [claude:readwrite], you ARE allowed to write to it — just call the tool directly.',
    '- Do NOT refuse writes if the database has a [claude:readwrite] override. The override explicitly grants permission.',
    '- NEVER write to a connection/database marked [PRODUCTION] unless it has an explicit [claude:readwrite] override.',
    '- Connections marked [READ-ONLY] block ALL writes regardless of Claude access settings or per-database overrides.',
    '- If asked to copy data, you may READ from production but NEVER WRITE to it (unless overridden).',
    '- You can switch between connections using mongo_switch_connection.',
    '- When the user asks you to modify data, just do it. Do not ask for confirmation on non-production databases with readwrite access.',
    '',
    '## Connected Databases',
  ]

  for (const c of connections) {
    const connected = connectedIds.includes(c.id) ? 'CONNECTED' : 'disconnected'
    const active = c.id === activeId ? ' (ACTIVE - currently focused)' : ''
    const prod = c.isProduction ? ' [PRODUCTION]' : ''
    const readOnly = c.isReadOnly ? ' [READ-ONLY]' : ''
    const defaultAccess = c.claudeAccess || (c.isProduction ? 'readonly' : 'readwrite')
    lines.push(`- ${c.name} (id: ${c.id}): ${connected}${active}${prod}${readOnly} [claude-default:${defaultAccess}]`)

    // Show per-database overrides
    if (c.claudeDbOverrides && Object.keys(c.claudeDbOverrides).length > 0) {
      for (const [dbName, dbAccess] of Object.entries(c.claudeDbOverrides)) {
        lines.push(`    - Database "${dbName}": [claude:${dbAccess}] (OVERRIDE — ${dbAccess === 'readwrite' ? 'WRITES ALLOWED' : 'READ ONLY'})`)
      }
    }
  }

  lines.push('')
  lines.push('IMPORTANT: Always check per-database overrides before refusing a write. If a database has [claude:readwrite] as an override, you CAN write to it even if the connection default is readonly.')

  lines.push('')
  lines.push('## Current Focus')

  if (context.connectionName) {
    lines.push(`Connection: ${context.connectionName}`)
  }

  if (context.database && context.collection) {
    // Collection-level chat
    lines.push(`Database: ${context.database}`)
    lines.push(`Collection: ${context.collection}`)
  } else if (context.database && !context.collection) {
    // Database-level chat
    lines.push(`Database: ${context.database} (all collections)`)
    lines.push('You are chatting at the database level. Use mongo_list_collections to discover collections in this database before performing operations.')
  } else if (!context.database && !context.collection) {
    // Connection-level chat
    lines.push('Connection-level chat (all databases).')
    lines.push('You are chatting at the connection level. Use mongo_list_databases and mongo_list_collections to discover and explore databases and collections.')
  }

  if (context.currentFilter && Object.keys(context.currentFilter).length > 0) {
    lines.push(`Current query filter: ${JSON.stringify(context.currentFilter)}`)
  }
  if (context.resultCount !== undefined) {
    lines.push(
      `Results in view: ${context.resultCount} documents (page ${context.page ?? 1} of ${context.totalPages ?? 1})`
    )
  }
  if (context.openDocumentId) {
    lines.push(`Open document: ${context.openDocumentId}`)
  }

  // Codebase context
  const activeConn = connections.find((c) => c.id === activeId)
  const dbCodebasePath = activeConn?.databaseCodebasePaths?.[context.database!]
  if (dbCodebasePath && context.database) {
    const searchTerms = [context.database]
    if (context.collection) searchTerms.push(context.collection)
    const formatted = formatContext(scanCodebase(dbCodebasePath, searchTerms))
    if (formatted) {
      lines.push('')
      lines.push(formatted)
    }

    lines.push('')
    lines.push('## Codebase Analysis')
    lines.push(`Database "${context.database}" has a linked codebase at: ${dbCodebasePath}`)
    lines.push('You MUST use the mongo_search_codebase tool when:')
    lines.push('- Recommending indexes (search for collection names, query patterns, .find(), .aggregate(), sort, filter usage)')
    lines.push('- Advising on schema design (search for model definitions, schemas, interfaces)')
    lines.push('- Understanding how data is used (search for collection names, field names)')
    lines.push('- The user asks about query patterns, performance, or data modeling')
    lines.push('')
    lines.push('Always search the codebase BEFORE making recommendations. Your index/schema advice is only useful if it reflects actual application query patterns, not hypothetical ones.')
  }

  return lines.join('\n')
}

interface SendOptions {
  /** Model id (defaults to Sonnet 4.6). */
  model?: string
  /** SDK session id to resume, for conversation continuity. */
  resumeSessionId?: string
  /** When true, emit the SDK session id to the renderer (chat path only). */
  emitSessionId?: boolean
}

export async function sendMessage(
  message: string,
  context: ChatContext,
  mcpPort: number = DEFAULT_MCP_PORT,
  opts: SendOptions = {}
): Promise<void> {
  if (activeAbortController) {
    activeAbortController.abort()
  }
  activeAbortController = new AbortController()

  const settings = configService.loadSettings()
  const method: ClaudeAuthMethod = settings.claudeAuthMethod === 'apiKey' ? 'apiKey' : 'subscription'
  const model = resolveModel(opts.model, method)
  const maxBudgetUsd =
    method === 'apiKey' && typeof settings.claudeMaxBudgetUsd === 'number' && settings.claudeMaxBudgetUsd > 0
      ? settings.claudeMaxBudgetUsd
      : null

  const messageId = crypto.randomUUID()

  emitToRenderer('claude:stream-start', { messageId })

  let fullText = ''
  try {
    const q = claudeQuery({
      prompt: message,
      options: {
        ...buildSdkSpawnOptions(),
        systemPrompt: buildSystemPrompt(context),
        model,
        ...(maxBudgetUsd != null ? { maxBudgetUsd } : {}),
        resume: opts.resumeSessionId,
        persistSession: true,
        includePartialMessages: true,
        abortController: activeAbortController,
        mcpServers: {
          mango: {
            type: 'http',
            url: `http://127.0.0.1:${mcpPort}/mcp?token=${encodeURIComponent(getMcpToken())}`
          }
        },
        allowedTools: [
          'mcp__mango__mongo_list_connections',
          'mcp__mango__mongo_connect',
          'mcp__mango__mongo_connection_status',
          'mcp__mango__mongo_list_databases',
          'mcp__mango__mongo_list_collections',
          'mcp__mango__mongo_collection_schema',
          'mcp__mango__mongo_find',
          'mcp__mango__mongo_count',
          'mcp__mango__mongo_aggregate',
          'mcp__mango__mongo_distinct',
          'mcp__mango__mongo_explain',
          'mcp__mango__mongo_insert_one',
          'mcp__mango__mongo_update_one',
          'mcp__mango__mongo_delete_one',
          'mcp__mango__mongo_delete_many',
          'mcp__mango__mongo_insert_many',
          'mcp__mango__mongo_update_many',
          'mcp__mango__mongo_list_indexes',
          'mcp__mango__mongo_index_stats',
          'mcp__mango__mongo_create_index',
          'mcp__mango__mongo_drop_index',
          'mcp__mango__mongo_changelog',
          'mcp__mango__mongo_rollback',
          'mcp__mango__mongo_search_codebase'
        ],
        tools: [],
        permissionMode: 'default',
        canUseTool: async (toolName, input) => {
          // The MCP tool layer (src/main/mcp/tools.ts) is the authoritative
          // enforcer of production / read-only / per-db write rules. This
          // callback only ensures Claude cannot invoke tools outside Mango's
          // own MCP surface, and replaces the previous bypassPermissions flag.
          if (toolName.startsWith('mcp__mango__')) {
            return { behavior: 'allow', updatedInput: input }
          }
          return { behavior: 'deny', message: `Tool "${toolName}" is not available in Mango.` }
        },
        maxTurns: 200
      }
    })

    let assembledText = '' // completed assistant turns, joined
    let liveText = '' // current in-flight assistant text (from stream deltas)
    let lastTurnText = '' // final turn text, for the cat-sound heuristic
    let sessionId = ''
    const seenToolCalls = new Set<string>()

    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id
        if (opts.emitSessionId) emitToRenderer('claude:session', { messageId, sessionId })
      } else if (msg.type === 'stream_event') {
        const ev = msg.event as { type?: string; delta?: { type?: string; text?: string } }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          liveText += ev.delta.text
          const display = assembledText ? `${assembledText}\n\n${liveText}` : liveText
          emitToRenderer('claude:text-delta', { messageId, text: display })
        }
      } else if (msg.type === 'assistant') {
        const blocks = msg.message.content as Array<{ type: string; [k: string]: unknown }>
        for (const b of blocks) {
          if (b.type === 'tool_use') {
            const tb = b as unknown as { id: string; name: string; input: Record<string, unknown> }
            if (!seenToolCalls.has(tb.id)) {
              seenToolCalls.add(tb.id)
              emitToRenderer('claude:tool-use', {
                messageId,
                toolCall: { id: tb.id, name: tb.name, input: tb.input, status: 'running' }
              })
            }
          }
        }
        const turnText = blocks
          .filter((b) => b.type === 'text')
          .map((b) => (b as unknown as { text: string }).text)
          .join('')
        if (turnText) {
          lastTurnText = turnText
          assembledText = assembledText ? `${assembledText}\n\n${turnText}` : turnText
          liveText = '' // finalized text supersedes the live preview for this turn
          emitToRenderer('claude:text-delta', { messageId, text: assembledText })
        }
      } else if (msg.type === 'user') {
        // Tool results return as user messages carrying tool_result blocks.
        const content = msg.message.content
        if (Array.isArray(content)) {
          for (const b of content as Array<{ type?: string; tool_use_id?: string; content?: unknown }>) {
            if (b.type === 'tool_result' && b.tool_use_id) {
              emitToRenderer('claude:tool-result', {
                messageId,
                toolUseId: b.tool_use_id,
                result: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
                status: 'success'
              })
            }
          }
        }
      } else if (msg.type === 'result') {
        sessionId = msg.session_id || sessionId
        if (opts.emitSessionId && sessionId) {
          emitToRenderer('claude:session', { messageId, sessionId })
        }
        const resultText =
          'result' in msg ? (msg as { result?: string }).result ?? '' : ''
        const finalText = assembledText || liveText || resultText
        const u = (msg as { usage?: { input_tokens?: number; output_tokens?: number } }).usage
        emitToRenderer('claude:stream-end', {
          messageId,
          text: finalText,
          lastTurnText,
          cost: 'total_cost_usd' in msg ? msg.total_cost_usd : undefined,
          usage: u
            ? {
                model,
                inputTokens: u.input_tokens ?? 0,
                outputTokens: u.output_tokens ?? 0,
                costUsd: 'total_cost_usd' in msg ? (msg as { total_cost_usd?: number }).total_cost_usd : undefined
              }
            : undefined
        })
        return
      }
    }

    // Generator exhausted without a result message
    emitToRenderer('claude:stream-end', { messageId, text: assembledText || liveText || '' })
  } catch (err) {
    const errorMessage =
      err instanceof Error && err.name === 'AbortError'
        ? ''
        : err instanceof Error
          ? err.message
          : 'Unknown error'

    emitToRenderer('claude:stream-end', {
      messageId,
      text: errorMessage ? `Error: ${errorMessage}` : fullText || '',
      aborted: err instanceof Error && err.name === 'AbortError'
    })
  } finally {
    activeAbortController = null
  }
}

export function abortCurrentQuery(): void {
  if (activeAbortController) {
    activeAbortController.abort()
    activeAbortController = null
  }
}
