import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { DEFAULT_MCP_PORT } from '@shared/constants'
import * as configService from './config'
import * as mongoService from './mongodb'
import { scanCodebase, formatContext } from './codebaseContext'

/**
 * In packaged builds the SDK's cli.js is inside app.asar.unpacked so that
 * the spawned node child process can actually read it.
 */
function getClaudeExecutablePath(): string | undefined {
  if (!app.isPackaged) return undefined // let SDK resolve in dev
  return join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
    'cli.js'
  )
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

export async function sendMessage(
  message: string,
  context: ChatContext,
  mcpPort: number = DEFAULT_MCP_PORT
): Promise<void> {
  if (activeAbortController) {
    activeAbortController.abort()
  }
  activeAbortController = new AbortController()

  const messageId = crypto.randomUUID()

  emitToRenderer('claude:stream-start', { messageId })

  try {
    const q = claudeQuery({
      prompt: message,
      options: {
        pathToClaudeCodeExecutable: getClaudeExecutablePath(),
        systemPrompt: buildSystemPrompt(context),
        model: 'claude-sonnet-4-5-20250929',
        abortController: activeAbortController,
        mcpServers: {
          mango: {
            type: 'http',
            url: `http://127.0.0.1:${mcpPort}/mcp`
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
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 200,
        persistSession: false
      }
    })

    let fullText = ''
    let currentTurnText = ''
    let previousTurnsText = ''
    const seenToolCalls = new Set<string>()
    const activeTurnToolIds: string[] = []

    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const textBlocks = msg.message.content.filter(
          (b: { type: string }) => b.type === 'text'
        )
        const turnText = textBlocks
          .map((b: { type: string; text: string }) => b.text)
          .join('')

        // Detect new tool uses
        const toolUseBlocks = msg.message.content.filter(
          (b: { type: string }) => b.type === 'tool_use'
        )
        const newToolUses = toolUseBlocks.filter(
          (b: { type: string; id: string }) => !seenToolCalls.has(b.id)
        )

        // Detect turn boundary: text changed completely or new tools after previous ones completed
        const textChanged = turnText && currentTurnText && !turnText.startsWith(currentTurnText)
        const newToolsAfterPrevious = newToolUses.length > 0 && activeTurnToolIds.length > 0

        if (textChanged || newToolsAfterPrevious) {
          // New turn — mark previous tools as complete
          for (const toolId of activeTurnToolIds) {
            emitToRenderer('claude:tool-result', {
              messageId,
              toolUseId: toolId,
              result: '',
              status: 'success'
            })
          }
          activeTurnToolIds.length = 0
          if (currentTurnText) {
            previousTurnsText = fullText
          }
          currentTurnText = ''
        }

        // Accumulate text across turns instead of replacing
        if (turnText && turnText !== currentTurnText) {
          currentTurnText = turnText
          fullText = previousTurnsText
            ? previousTurnsText + '\n\n' + turnText
            : turnText
          emitToRenderer('claude:text-delta', { messageId, text: fullText })
        }

        // Register new tool calls
        for (const block of newToolUses) {
          const tb = block as {
            type: string
            id: string
            name: string
            input: Record<string, unknown>
          }
          seenToolCalls.add(tb.id)
          activeTurnToolIds.push(tb.id)
          emitToRenderer('claude:tool-use', {
            messageId,
            toolCall: {
              id: tb.id,
              name: tb.name,
              input: tb.input,
              status: 'running'
            }
          })
        }

        // Tool result blocks (if SDK includes them in assistant messages)
        const toolResultBlocks = msg.message.content.filter(
          (b: { type: string }) => b.type === 'tool_result'
        )
        for (const block of toolResultBlocks) {
          const tr = block as { type: string; tool_use_id: string; content: unknown }
          const idx = activeTurnToolIds.indexOf(tr.tool_use_id)
          if (idx >= 0) activeTurnToolIds.splice(idx, 1)
          emitToRenderer('claude:tool-result', {
            messageId,
            toolUseId: tr.tool_use_id,
            result:
              typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
            status: 'success'
          })
        }
      } else if (msg.type === 'result') {
        // Use result text if we didn't get any assistant text
        const finalText = fullText || msg.result || ''
        emitToRenderer('claude:stream-end', {
          messageId,
          text: finalText,
          lastTurnText: currentTurnText,
          cost: msg.total_cost_usd
        })
        return // Done — exit cleanly
      }
    }

    // Generator exhausted without a result message
    emitToRenderer('claude:stream-end', { messageId, text: fullText || '' })
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
