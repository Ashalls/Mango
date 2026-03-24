import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { DEFAULT_MCP_PORT } from '@shared/constants'
import * as configService from './config'
import * as mongoService from './mongodb'

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
    'When you run a query, the results appear in the user\'s table view automatically.',
    '',
    '## WRITE ACCESS RULES',
    '- The system enforces write access at the tool level. If a tool call is blocked, you will get a BLOCKED error.',
    '- If a database has a per-database override of [claude:readwrite], you ARE allowed to write to it — just call the tool directly.',
    '- Do NOT refuse writes if the database has a [claude:readwrite] override. The override explicitly grants permission.',
    '- NEVER write to a connection/database marked [PRODUCTION] unless it has an explicit [claude:readwrite] override.',
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
    const defaultAccess = c.claudeAccess || (c.isProduction ? 'readonly' : 'readwrite')
    lines.push(`- ${c.name} (id: ${c.id}): ${connected}${active}${prod} [claude-default:${defaultAccess}]`)

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
  if (context.database) {
    lines.push(`Database: ${context.database}`)
  }
  if (context.collection) {
    lines.push(`Collection: ${context.collection}`)
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
          'mcp__mango__mongo_rollback'
        ],
        tools: [],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 10,
        persistSession: false
      }
    })

    let fullText = ''
    const seenToolCalls = new Set<string>()

    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const textBlocks = msg.message.content.filter(
          (b: { type: string }) => b.type === 'text'
        )
        const text = textBlocks
          .map((b: { type: string; text: string }) => b.text)
          .join('')

        if (text && text !== fullText) {
          fullText = text
          emitToRenderer('claude:text-delta', { messageId, text: fullText })
        }

        // Tool use blocks
        const toolUseBlocks = msg.message.content.filter(
          (b: { type: string }) => b.type === 'tool_use'
        )
        for (const block of toolUseBlocks) {
          const tb = block as {
            type: string
            id: string
            name: string
            input: Record<string, unknown>
          }
          if (!seenToolCalls.has(tb.id)) {
            seenToolCalls.add(tb.id)
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
        }

        // Tool result blocks
        const toolResultBlocks = msg.message.content.filter(
          (b: { type: string }) => b.type === 'tool_result'
        )
        for (const block of toolResultBlocks) {
          const tr = block as { type: string; tool_use_id: string; content: unknown }
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
