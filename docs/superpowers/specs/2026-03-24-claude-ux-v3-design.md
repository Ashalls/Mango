# Claude UX v0.3.0 — Design Spec

**Date:** 2026-03-24
**Goal:** Persistent chat history, Claude query results in table, database-level and connection-level Claude tabs.

---

## 1. Chat History Persistence

### Problem
Chat messages are stored in memory per tab. Switching tabs or restarting wipes all conversations.

### Design
Store chat sessions to `~/.mango/chat-history/` as JSON files, keyed by tab ID (connectionId:database:collection).

**Backend service** (`src/main/services/chatHistory.ts`):
- `saveChatSession(tabId: string, messages: ChatMessage[]): void` — write to `~/.mango/chat-history/{tabId-hash}.json`
- `loadChatSession(tabId: string): ChatMessage[]` — read from file
- `listChatSessions(tabId: string): { id: string, timestamp: number, preview: string }[]` — list past sessions for a tab
- `deleteChatSession(sessionId: string): void`
- Each session file: `{ tabId, messages, createdAt, updatedAt }`

**tRPC routes** (new `chatHistory` router):
- `chatHistory.save` mutation
- `chatHistory.load` query
- `chatHistory.list` query
- `chatHistory.delete` mutation

**UI changes:**
- On tab load, auto-restore the most recent chat session for that tab
- "New Chat" button in ClaudePanel header to start a fresh session (saves current first)
- "Chat History" dropdown showing past sessions with timestamps and preview of first message
- Auto-save after each stream-end event

### Data model
```typescript
interface ChatSession {
  id: string           // UUID
  tabId: string        // connectionId:database:collection
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}
```

---

## 2. Claude Query Results → Document Table

### Problem
When Claude runs `mongo_find`, results are described in chat text but don't appear in the DocumentTable.

### Design
When a `mongo_find` tool call completes, push the results into the active tab's query state so the DocumentTable updates.

**Changes in ClaudePanel.tsx:**
In the `handleToolResult` handler, detect when the tool is `mcp__mango__mongo_find`. Parse the result JSON and call `tabStore.updateTab` to set the results.

```typescript
// In handleToolResult:
if (data.toolCall?.name === 'mcp__mango__mongo_find' || toolName.includes('find')) {
  try {
    const parsed = JSON.parse(data.result)
    if (parsed.documents) {
      store.updateTab(activeTab.id, {
        results: parsed,
        loading: false
      })
    }
  } catch { /* not parseable, ignore */ }
}
```

Actually, the tool result comes through `handleToolResult` which has `data.result` as a string. But we need to match tool names. The tool call info is on the message's `toolCalls` array.

Better approach: in `handleStreamEnd`, after `store.executeQuery()` (line 90), this already refreshes the table. The issue might be that `executeQuery` re-runs the tab's current filter, not the filter Claude used.

Simplest fix: Instead of `executeQuery()` at stream end, parse the most recent find tool result and push it directly. OR keep `executeQuery()` but also update the tab's filter to match what Claude searched for.

Actually the cleanest approach: keep `executeQuery()` at stream end (it refreshes with the tab's current filter). Additionally, in `handleToolResult`, when a `mongo_find` result comes back, update the tab's results directly so the user sees Claude's results immediately without waiting for stream end.

---

## 3. Database-Level Claude Tab

### Problem
Currently Claude is always scoped to a specific collection. Users need to ask cross-collection questions about a database.

### Design
Add a `scope` field to the Tab interface: `'collection' | 'database' | 'connection'`.

- Collection scope (existing): tab has connectionId + database + collection
- Database scope: tab has connectionId + database, no collection
- Connection scope: tab has connectionId only

**Tab interface changes:**
```typescript
interface Tab {
  // ... existing fields
  scope: 'collection' | 'database' | 'connection'
  collection: string  // empty for db/connection scope
  database: string    // empty for connection scope
}
```

**Tab ID format:**
- Collection: `{connId}:{db}:{collection}`
- Database: `{connId}:{db}:__db__`
- Connection: `{connId}:__conn__`

**Opening a database tab:** Click the database name in the sidebar (currently just toggles expand). Add: if the database is already expanded, clicking it opens a database-scoped tab.

Or simpler: right-click database → "Open Claude Chat" opens a db-scoped tab.

**Opening a connection tab:** right-click connection → "Open Claude Chat" opens a connection-scoped tab.

**UI for non-collection tabs:**
- No QueryBuilder, no DocumentTable, no IndexPanel
- Full-screen ClaudePanel (or a centered chat layout)
- System prompt adjusts: lists all collections in the database (for db scope) or all databases (for connection scope)

**System prompt adjustments in claude.ts:**
- Database scope: include all collections in the system prompt, no specific collection focus
- Connection scope: include all databases and their collections, no specific focus

---

## 4. Implementation Order

1. Chat history persistence (backend + UI)
2. Claude query results → table
3. Database/connection scoped tabs

Each is independently shippable.
