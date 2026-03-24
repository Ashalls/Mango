import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { CONFIG_DIR } from '../constants'

const CHAT_DIR = join(CONFIG_DIR, 'chat-history')

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: unknown[]
  timestamp: number
}

interface ChatSession {
  id: string
  tabId: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

function ensureDir(): void {
  if (!existsSync(CHAT_DIR)) mkdirSync(CHAT_DIR, { recursive: true })
}

export function saveSession(
  tabId: string,
  sessionId: string,
  messages: ChatMessage[]
): ChatSession {
  ensureDir()
  const filePath = join(CHAT_DIR, `${sessionId}.json`)
  const existing = existsSync(filePath)
    ? (JSON.parse(readFileSync(filePath, 'utf-8')) as ChatSession)
    : null
  const session: ChatSession = {
    id: sessionId,
    tabId,
    messages,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now()
  }
  writeFileSync(filePath, JSON.stringify(session, null, 2))
  return session
}

export function loadSession(sessionId: string): ChatSession | null {
  ensureDir()
  const filePath = join(CHAT_DIR, `${sessionId}.json`)
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
    for (const file of readdirSync(CHAT_DIR)) {
      if (!file.endsWith('.json')) continue
      try {
        const data = JSON.parse(readFileSync(join(CHAT_DIR, file), 'utf-8')) as ChatSession
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
  const filePath = join(CHAT_DIR, `${sessionId}.json`)
  if (existsSync(filePath)) unlinkSync(filePath)
}
