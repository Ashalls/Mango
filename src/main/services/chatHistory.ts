import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, lstatSync } from 'fs'
import { join, resolve, sep } from 'path'
import { CONFIG_DIR } from '../constants'

const CHAT_DIR = join(CONFIG_DIR, 'chat-history')

/**
 * Resolve `<CHAT_DIR>/<sessionId>.json` for a session id that must be a bare
 * filename component. The tRPC schema requires a UUID, but the sink itself must
 * guarantee containment in case a caller bypasses validation:
 *  - the charset (no `.`/`/`/`\`) makes `..` and path separators impossible;
 *  - the resolved path is asserted to stay inside CHAT_DIR; and
 *  - we refuse to follow a symlink planted at the target (lexical containment
 *    alone doesn't resolve symlinks).
 */
function sessionFilePath(sessionId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(sessionId)) {
    throw new Error('Invalid session id')
  }
  const p = resolve(CHAT_DIR, `${sessionId}.json`)
  if (!p.startsWith(resolve(CHAT_DIR) + sep)) {
    throw new Error('Invalid session id')
  }
  try {
    if (lstatSync(p).isSymbolicLink()) throw new Error('Refusing to follow a symlinked session file')
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Refusing')) throw e
    // ENOENT (a not-yet-created session file) is expected and fine.
  }
  return p
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: unknown[]
  timestamp: number
}

export interface ChatSession {
  id: string
  tabId: string
  messages: ChatMessage[]
  sdkSessionId?: string
  createdAt: number
  updatedAt: number
}

function ensureDir(): void {
  if (!existsSync(CHAT_DIR)) mkdirSync(CHAT_DIR, { recursive: true })
}

export function saveSession(
  tabId: string,
  sessionId: string,
  messages: ChatMessage[],
  sdkSessionId?: string
): ChatSession {
  ensureDir()
  const filePath = sessionFilePath(sessionId)
  const existing = existsSync(filePath)
    ? (JSON.parse(readFileSync(filePath, 'utf-8')) as ChatSession)
    : null
  const session: ChatSession = {
    id: sessionId,
    tabId,
    messages,
    sdkSessionId: sdkSessionId ?? existing?.sdkSessionId,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now()
  }
  writeFileSync(filePath, JSON.stringify(session, null, 2))
  return session
}

export function loadSession(sessionId: string): ChatSession | null {
  ensureDir()
  let filePath: string
  try { filePath = sessionFilePath(sessionId) } catch { return null }
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

export function listSessions(
  tabId: string
): { id: string; createdAt: number; updatedAt: number; preview: string; messageCount: number }[] {
  ensureDir()
  const results: {
    id: string
    createdAt: number
    updatedAt: number
    preview: string
    messageCount: number
  }[] = []
  try {
    for (const entry of readdirSync(CHAT_DIR, { withFileTypes: true })) {
      // Only real files directly in CHAT_DIR — never follow a symlink.
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const data = JSON.parse(readFileSync(join(CHAT_DIR, entry.name), 'utf-8')) as ChatSession
        if (data.tabId === tabId && data.messages.length > 0) {
          const firstUserMsg = data.messages.find((m) => m.role === 'user')
          results.push({
            id: data.id,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            preview: firstUserMsg?.content?.slice(0, 100) || '(empty)',
            messageCount: data.messages.length
          })
        }
      } catch {
        /* skip corrupt files */
      }
    }
  } catch {
    /* dir read error */
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function deleteSession(sessionId: string): void {
  const filePath = sessionFilePath(sessionId)
  if (existsSync(filePath)) unlinkSync(filePath)
}
