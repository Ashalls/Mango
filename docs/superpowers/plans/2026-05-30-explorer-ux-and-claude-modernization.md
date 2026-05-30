# Explorer UX & Claude Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three Explorer/layout UX features (refresh-databases menu item, click-to-collapse connections, resizable table/editor split) and modernize the embedded Claude assistant (selectable model defaulting to Sonnet 4.6, conversation memory, true streaming, safer permissions).

**Architecture:** Electron + React 19 + TypeScript (electron-vite). UI in `src/renderer`, main process in `src/main`, tRPC over IPC bridges them. State in zustand stores. The Claude assistant uses `@anthropic-ai/claude-agent-sdk` (installed **0.1.77**) via `query()` in `src/main/services/claude.ts`; all needed APIs (`resume`, `includePartialMessages`, `canUseTool`, `persistSession`) already exist in 0.1.77 — **no package bump required**.

**Tech Stack:** React 19, zustand 5, Radix UI, Tailwind v4, tRPC 10, `@anthropic-ai/claude-agent-sdk` 0.1.77.

---

## Testing approach (read first)

This repo has **no unit-test runner** (no vitest/jest; `package.json` has no `test` script). Do **not** add one — it would be inappropriate scope for these UI/IPC changes. Instead, every task's verification is:

1. **Typecheck gate:** `npm run typecheck` (runs `typecheck:node` + `typecheck:web`). Must pass with no errors.
2. **Manual verification:** `npm run dev`, then perform the listed steps and observe the listed outcome.

All commits should end with the repo's trailer line:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

Work is on branch `feat/explorer-ux-and-claude-modernization` (already created).

---

# Phase A — Explorer & layout UX

## Task A1: "Refresh Databases" connection context-menu item

**Files:**
- Modify: `src/renderer/src/components/layout/Sidebar.tsx` (connection `ContextMenu.Content`, ~line 341)

`Sidebar.tsx` already destructures `setActive` (from `useConnectionStore`, line 49) and `loadDatabases` (from `useExplorerStore`, line 51), and already imports `RefreshCw` (line 2). Only a menu item is added.

- [ ] **Step 1: Add the menu item**

In `renderConnection()`, inside `<ContextMenu.Content ...>`, immediately AFTER the Connect/Disconnect conditional block (the block that ends `</ContextMenu.Item>` for "Connect", around line 358) and BEFORE the "Create Database" item, insert:

```tsx
{isThisConnected && (
  <ContextMenu.Item
    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
    onSelect={() => {
      if (!isThisActive) setActive(profile.id)
      loadDatabases()
    }}
  >
    <RefreshCw className="h-3.5 w-3.5" />
    Refresh Databases
  </ContextMenu.Item>
)}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Connect to a database. Right-click the connection → confirm a "Refresh Databases" item appears with a refresh icon. Add/drop a database externally (or trust the call), click it, and confirm the database list re-queries (watch the tree refresh). Right-click a *non-active but connected* connection → "Refresh Databases" should switch to it and load its databases.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/Sidebar.tsx
git commit -m "feat(explorer): add Refresh Databases to connection context menu"
```

---

## Task A2: Click-to-collapse connection tree + chevron

**Files:**
- Modify: `src/renderer/src/components/layout/Sidebar.tsx` (imports; new state; `renderConnection()` button + tree render condition)

- [ ] **Step 1: Add imports**

At the top of `Sidebar.tsx`, add `ChevronRight` to the existing lucide import (line 2) and add the `cn` util import after the other `@renderer` imports (e.g. after line 16's type import):

```tsx
import { cn } from '@renderer/lib/utils'
```

The lucide import (line 2) must include `ChevronRight`:

```tsx
import { Plus, RefreshCw, Plug, PlugZap, ShieldAlert, ClipboardPaste, Pencil, Trash2, Database, Bot, MessageSquare, Upload, FolderClosed, FolderOpen, FolderPlus, ChevronRight } from 'lucide-react'
```

- [ ] **Step 2: Add collapsed-connections state**

Inside the `Sidebar()` component, alongside the other `useState` hooks (e.g. after the `expandedFolders` state at line 42), add:

```tsx
const [collapsedConnections, setCollapsedConnections] = useState<Set<string>>(new Set())
```

- [ ] **Step 3: Rewrite the connection button + chevron**

In `renderConnection()`, the connection `<button ...>` (lines ~245-273). Compute `isCollapsed` near the top of `renderConnection` (after `isThisActive` at line 238):

```tsx
const isCollapsed = collapsedConnections.has(profile.id)
```

Replace the button's `onClick` (lines 249-255) with toggle logic:

```tsx
onClick={() => {
  if (!isThisConnected) {
    connect(profile.id)
    return
  }
  if (!isThisActive) {
    setActive(profile.id)
    setCollapsedConnections((prev) => {
      const next = new Set(prev)
      next.delete(profile.id)
      return next
    })
    return
  }
  // connected + active → toggle collapse of its tree
  setCollapsedConnections((prev) => {
    const next = new Set(prev)
    if (next.has(profile.id)) next.delete(profile.id)
    else next.add(profile.id)
    return next
  })
}}
```

Then, as the FIRST child inside the button (immediately after the opening `>` of `<button ...>`, before the `isThisConnected ? <PlugZap/> : <Plug/>` block at line 257), add the chevron:

```tsx
{isThisConnected ? (
  <ChevronRight
    className={cn(
      'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
      isThisActive && !isCollapsed && 'rotate-90'
    )}
  />
) : (
  <span className="h-3.5 w-3.5 shrink-0" />
)}
```

- [ ] **Step 4: Gate the tree on !isCollapsed**

Change the tree render condition (line 276) from:

```tsx
{isThisActive && isConnected && (
```

to:

```tsx
{isThisActive && isConnected && !isCollapsed && (
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. Connect. Confirm a chevron sits left of the active connection and points down (rotated) while its tree is shown. Click the active connection → tree collapses, chevron points right. Click again → tree expands. Click a different connected connection → it becomes active and expands; the previous one's collapse state is independent.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/layout/Sidebar.tsx
git commit -m "feat(explorer): click active connection to collapse its tree, add chevron"
```

---

## Task A3: Resizable, globally-persisted table/editor split

**Files:**
- Modify: `src/renderer/src/store/settingsStore.ts` (add `documentSplitRatio` + setter + load)
- Modify: `src/renderer/src/components/data/MainPanel.tsx` (drag handle + flex ratios)

- [ ] **Step 1: Extend the settings store**

In `settingsStore.ts`, extend the `SettingsStore` interface (after `catSounds: boolean`, line 10):

```tsx
  documentSplitRatio: number
```

and after `setCatSounds` (line 12):

```tsx
  setDocumentSplitRatio: (ratio: number, persist?: boolean) => void
```

Add the default in the store body (after `catSounds: true`, line 33):

```tsx
  documentSplitRatio: 0.5,
```

Add the setter (after the `setCatSounds` setter, line 44):

```tsx
  setDocumentSplitRatio: (ratio, persist = false) => {
    set({ documentSplitRatio: ratio })
    if (persist) {
      trpc.settings.set.mutate({ key: 'documentSplitRatio', value: ratio }).catch(() => {})
    }
  },
```

In `loadFromSettings`, extend the `Promise.all` (lines 48-51) to also fetch the ratio:

```tsx
      const [savedTheme, savedCatSounds, savedSplit] = await Promise.all([
        trpc.settings.get.query({ key: 'theme' }) as Promise<Theme | null>,
        trpc.settings.get.query({ key: 'catSounds' }) as Promise<boolean | null>,
        trpc.settings.get.query({ key: 'documentSplitRatio' }) as Promise<number | null>
      ])
```

and after the `savedCatSounds` apply block (line 58), add:

```tsx
      if (typeof savedSplit === 'number' && savedSplit > 0 && savedSplit < 1) {
        set({ documentSplitRatio: savedSplit })
      }
```

- [ ] **Step 2: Typecheck the store change**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Add the resizable split to MainPanel**

In `MainPanel.tsx`, add imports at the top (after line 1's React import):

```tsx
import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '@renderer/store/settingsStore'
```

(Replace the existing `import { useState, useEffect } from 'react'` line 1 with the `useRef` version above; keep the rest.)

Inside `MainPanel()`, after the existing `useState` hooks (after line 21), add:

```tsx
  const splitRef = useRef<HTMLDivElement>(null)
  const documentSplitRatio = useSettingsStore((s) => s.documentSplitRatio)
  const setDocumentSplitRatio = useSettingsStore((s) => s.setDocumentSplitRatio)

  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const onMove = (ev: PointerEvent) => {
      const el = splitRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      let ratio = (ev.clientY - rect.top) / rect.height
      ratio = Math.min(0.85, Math.max(0.15, ratio))
      setDocumentSplitRatio(ratio)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDocumentSplitRatio(useSettingsStore.getState().documentSplitRatio, true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
```

- [ ] **Step 4: Replace the fixed-height documents layout**

In `MainPanel.tsx`, replace the documents block (lines 127-139, the `{subTab === 'documents' ? (` body up to and including the DocumentEditor conditional):

```tsx
              {subTab === 'documents' ? (
                <>
                  <QueryBuilder />
                  <BulkToolbar />
                  <div className={viewMode === 'table' && activeTab.selectedDocument ? 'h-1/2 min-h-0' : 'flex-1 min-h-0'}>
                    <DocumentTable viewMode={viewMode} onViewModeChange={setViewMode} />
                  </div>
                  {viewMode === 'table' && activeTab.selectedDocument && (
                    <div className="h-1/2 min-h-0">
                      <DocumentEditor />
                    </div>
                  )}
                </>
              ) : subTab === 'aggregation' ? (
```

with:

```tsx
              {subTab === 'documents' ? (
                <>
                  <QueryBuilder />
                  <BulkToolbar />
                  {viewMode === 'table' && activeTab.selectedDocument ? (
                    <div ref={splitRef} className="flex flex-1 min-h-0 flex-col">
                      <div className="min-h-0" style={{ flexGrow: documentSplitRatio, flexBasis: 0 }}>
                        <DocumentTable viewMode={viewMode} onViewModeChange={setViewMode} />
                      </div>
                      <div
                        className="h-1.5 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-emerald-500/50"
                        onPointerDown={startSplitDrag}
                        title="Drag to resize"
                      />
                      <div className="min-h-0" style={{ flexGrow: 1 - documentSplitRatio, flexBasis: 0 }}>
                        <DocumentEditor />
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0">
                      <DocumentTable viewMode={viewMode} onViewModeChange={setViewMode} />
                    </div>
                  )}
                </>
              ) : subTab === 'aggregation' ? (
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. Open a collection, click a row to open the Document Editor. A thin draggable bar appears between the table and the editor; the cursor becomes a row-resize cursor on hover (bar highlights). Drag up → editor grows, table shrinks (clamped so neither disappears). Release, fully quit and relaunch the app → the split ratio is restored. Switch to another collection tab → the same ratio applies (global).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/store/settingsStore.ts src/renderer/src/components/data/MainPanel.tsx
git commit -m "feat(data): drag-resizable table/document-editor split, persisted globally"
```

---

# Phase B — Claude modernization

## Task B1: Selectable model setting (default Sonnet 4.6)

**Files:**
- Modify: `src/renderer/src/store/settingsStore.ts` (add `claudeModel` + setter + load)

- [ ] **Step 1: Add the model type and store fields**

In `settingsStore.ts`, after the `type Theme` line (line 4), add:

```tsx
export type ClaudeModel = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001'

export const CLAUDE_MODELS: { value: ClaudeModel; label: string }[] = [
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' }
]
```

Extend the `SettingsStore` interface — after `documentSplitRatio: number` (added in A3):

```tsx
  claudeModel: ClaudeModel
```

and after `setDocumentSplitRatio` in the interface:

```tsx
  setClaudeModel: (model: ClaudeModel) => void
```

Add the default in the store body (after `documentSplitRatio: 0.5,`):

```tsx
  claudeModel: 'claude-sonnet-4-6',
```

Add the setter (after `setDocumentSplitRatio`):

```tsx
  setClaudeModel: (model) => {
    set({ claudeModel: model })
    trpc.settings.set.mutate({ key: 'claudeModel', value: model }).catch(() => {})
  },
```

- [ ] **Step 2: Load the saved model on startup**

In `loadFromSettings`, extend the `Promise.all` to also fetch `claudeModel`:

```tsx
      const [savedTheme, savedCatSounds, savedSplit, savedModel] = await Promise.all([
        trpc.settings.get.query({ key: 'theme' }) as Promise<Theme | null>,
        trpc.settings.get.query({ key: 'catSounds' }) as Promise<boolean | null>,
        trpc.settings.get.query({ key: 'documentSplitRatio' }) as Promise<number | null>,
        trpc.settings.get.query({ key: 'claudeModel' }) as Promise<ClaudeModel | null>
      ])
```

and after the `savedSplit` apply block, add:

```tsx
      if (savedModel && CLAUDE_MODELS.some((m) => m.value === savedModel)) {
        set({ claudeModel: savedModel })
      }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/store/settingsStore.ts
git commit -m "feat(claude): add selectable claudeModel setting, default Sonnet 4.6"
```

---

## Task B2: Per-tab SDK session-id storage

This stores the SDK `session_id` so follow-up messages can resume the conversation. It compiles and is inert until wired in B3/B4.

**Files:**
- Modify: `src/main/services/chatHistory.ts` (persist `sdkSessionId` on `ChatSession`)
- Modify: `src/main/trpc/routers/chatHistory.ts` (accept `sdkSessionId` in `save`)
- Modify: `src/renderer/src/store/tabStore.ts` (add `sdkSessionId` field + `setSdkSessionId` + reset logic + include in save)

- [ ] **Step 1: chatHistory service**

In `src/main/services/chatHistory.ts`, add `sdkSessionId` to the `ChatSession` interface (after `messages: ChatMessage[]`, line 18):

```tsx
  sdkSessionId?: string
```

Change `saveSession`'s signature (line 27) to accept it and persist it. Replace the whole `saveSession` function (lines 27-46) with:

```tsx
export function saveSession(
  tabId: string,
  sessionId: string,
  messages: ChatMessage[],
  sdkSessionId?: string
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
    sdkSessionId: sdkSessionId ?? existing?.sdkSessionId,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now()
  }
  writeFileSync(filePath, JSON.stringify(session, null, 2))
  return session
}
```

- [ ] **Step 2: chatHistory router**

In `src/main/trpc/routers/chatHistory.ts`, add `sdkSessionId` to the `save` input object (after the `messages` array field, line 20) :

```tsx
        sdkSessionId: z.string().optional()
```

and pass it through (line 22):

```tsx
    .mutation(({ input }) => {
      return chatHistory.saveSession(input.tabId, input.sessionId, input.messages, input.sdkSessionId)
    }),
```

- [ ] **Step 3: tabStore field + action + reset**

In `src/renderer/src/store/tabStore.ts`:

Add to the `Tab` interface (after `chatSessionId: string`, line 34):

```tsx
  sdkSessionId?: string
```

In `createTab` return (after `chatSessionId: crypto.randomUUID()`, line 60), add:

```tsx
    sdkSessionId: undefined
```

(Add the same `sdkSessionId: undefined` line to the two inline tab literals in `openDatabaseTab` (after line 180) and `openConnectionTab` (after line 215), each after their `chatSessionId: crypto.randomUUID()`.)

Add the action to the `TabStore` interface (after `startNewChat: () => void`, line 99):

```tsx
  setSdkSessionId: (sessionId: string) => void
```

Implement it (after the `startNewChat` implementation, line 412):

```tsx
  setSdkSessionId: (sessionId) => {
    const tab = get().getActiveTab()
    if (tab) get().updateTab(tab.id, { sdkSessionId: sessionId })
  },
```

Reset it in `clearMessages` (line 389-392) — change the update to also clear the session:

```tsx
  clearMessages: () => {
    const tab = get().getActiveTab()
    if (tab) get().updateTab(tab.id, { messages: [], isStreaming: false, sdkSessionId: undefined })
  },
```

Reset and persist it in `startNewChat` — replace the body (lines 394-412) with:

```tsx
  startNewChat: () => {
    const tab = get().getActiveTab()
    if (!tab) return
    // Save current session first if it has messages
    if (tab.messages.length > 0) {
      trpc.chatHistory.save
        .mutate({
          tabId: tab.id,
          sessionId: tab.chatSessionId,
          messages: tab.messages,
          sdkSessionId: tab.sdkSessionId
        })
        .catch(() => {})
    }
    get().updateTab(tab.id, {
      messages: [],
      isStreaming: false,
      chatSessionId: crypto.randomUUID(),
      sdkSessionId: undefined
    })
  },
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/chatHistory.ts src/main/trpc/routers/chatHistory.ts src/renderer/src/store/tabStore.ts
git commit -m "feat(claude): store SDK session id per tab and in chat history"
```

---

## Task B3: Rewrite the Claude service — model, resume, streaming, permissions

This rewrites `sendMessage` in `claude.ts` (model default Sonnet 4.6, session resume, `includePartialMessages` streaming, `canUseTool` permissions, removing the dangerous bypass and the fragile turn-detection), and threads new options through the `claude` router's `sendMessage` procedure.

**Files:**
- Modify: `src/main/services/claude.ts` (`sendMessage` signature + options + message loop)
- Modify: `src/main/trpc/routers/claude.ts` (`sendMessage` input + call)

- [ ] **Step 1: New sendMessage signature & options type**

In `src/main/services/claude.ts`, add an options interface above `sendMessage` (before line 181):

```tsx
interface SendOptions {
  /** Model id (defaults to Sonnet 4.6). */
  model?: string
  /** SDK session id to resume, for conversation continuity. */
  resumeSessionId?: string
  /** When true, emit the SDK session id to the renderer (chat path only). */
  emitSessionId?: boolean
}
```

Change the `sendMessage` declaration (lines 181-185) to:

```tsx
export async function sendMessage(
  message: string,
  context: ChatContext,
  mcpPort: number = DEFAULT_MCP_PORT,
  opts: SendOptions = {}
): Promise<void> {
```

- [ ] **Step 2: New query options (model, resume, streaming, permissions)**

Replace the `claudeQuery({ ... })` options object (lines 197-243) with:

```tsx
    const q = claudeQuery({
      prompt: message,
      options: {
        pathToClaudeCodeExecutable: getClaudeExecutablePath(),
        ...getSpawnOverrides(),
        systemPrompt: buildSystemPrompt(context),
        model: opts.model || 'claude-sonnet-4-6',
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
```

- [ ] **Step 3: Rewrite the message loop**

Replace the entire message-processing block — from `let currentTurnText = ''` (line 245) down to and including the generator-exhausted fallback `emitToRenderer('claude:stream-end', { messageId, text: fullText || '' })` (line 351) — with:

```tsx
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
          .map((b) => (b as { text: string }).text)
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
        emitToRenderer('claude:stream-end', {
          messageId,
          text: finalText,
          lastTurnText,
          cost: 'total_cost_usd' in msg ? msg.total_cost_usd : undefined
        })
        return
      }
    }

    // Generator exhausted without a result message
    emitToRenderer('claude:stream-end', { messageId, text: assembledText || liveText || '' })
```

(The `catch`/`finally` blocks below, lines 352-368, stay unchanged.)

- [ ] **Step 4: Thread model + resume through the router**

In `src/main/trpc/routers/claude.ts`, extend the `sendMessage` input (lines 19-23) and call (line 26):

```tsx
  sendMessage: procedure
    .input(
      z.object({
        message: z.string(),
        context: ContextSchema,
        mcpPort: z.number().optional(),
        model: z.string().optional(),
        resumeSessionId: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      claudeService.sendMessage(input.message, input.context, input.mcpPort, {
        model: input.model,
        resumeSessionId: input.resumeSessionId,
        emitSessionId: true
      })
      return { started: true }
    }),
```

(`recommendIndexes` and `interpretExplain` are left unchanged — they call `sendMessage` without options, so they inherit the new Sonnet 4.6 default, run as fresh one-shot sessions, and do NOT emit a session id, so they cannot clobber a chat's continuity.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If TypeScript complains about `msg.message.content` typing on the `user` branch, the `Array.isArray` guard plus the `as Array<...>` cast shown above satisfies it; do not add `@ts-ignore`.

- [ ] **Step 6: Manual verification (streaming + permissions; memory verified in B4)**

Run: `npm run dev`. Open a collection, open the Claude panel, ask *"How many documents are in this collection?"*. Confirm: text streams in smoothly (token-by-token, not in big jumps); the tool call card appears and resolves to **success** (no longer stuck "running"); no permission prompt hangs the chat. On a non-production connection, ask Claude to update a document and confirm the write still succeeds; on a `[PRODUCTION]` or `[READ-ONLY]` connection confirm the write is still blocked by the MCP layer (Claude reports a BLOCKED error).

- [ ] **Step 7: Commit**

```bash
git add src/main/services/claude.ts src/main/trpc/routers/claude.ts
git commit -m "feat(claude): model option, session resume, partial-message streaming, canUseTool permissions"
```

---

## Task B4: Wire the renderer — model selector + conversation memory

**Files:**
- Modify: `src/renderer/src/components/claude/ClaudePanel.tsx` (session listener, model selector, `handleSend`, history-load + save include `sdkSessionId`)

- [ ] **Step 1: Imports**

In `ClaudePanel.tsx`, add after the existing imports (after line 11):

```tsx
import { useSettingsStore, CLAUDE_MODELS } from '@renderer/store/settingsStore'
```

Inside the component, after the `activeConnection` selector (line 25), read the model:

```tsx
  const claudeModel = useSettingsStore((s) => s.claudeModel)
  const setClaudeModel = useSettingsStore((s) => s.setClaudeModel)
```

- [ ] **Step 2: Listen for the session id**

In the IPC listener `useEffect` (lines 35-162), add a handler with the others (after `handleStreamEnd`, before the `electron.ipcRenderer.on(...)` calls):

```tsx
    const handleSession = (_: unknown, data: { messageId: string; sessionId: string }) => {
      if (data.sessionId) useTabStore.getState().setSdkSessionId(data.sessionId)
    }
```

Register and unregister it alongside the others:

```tsx
    electron.ipcRenderer.on('claude:session', handleSession)
```

and in the cleanup `return`:

```tsx
      electron.ipcRenderer.removeAllListeners('claude:session')
```

- [ ] **Step 3: Persist sdkSessionId when auto-saving on stream end**

In `handleStreamEnd`, the auto-save block (lines 136-144) — add `sdkSessionId`:

```tsx
      if (currentTab && currentTab.messages.length > 0) {
        trpc.chatHistory.save
          .mutate({
            tabId: currentTab.id,
            sessionId: currentTab.chatSessionId,
            messages: currentTab.messages,
            sdkSessionId: currentTab.sdkSessionId
          })
          .catch(() => {})
      }
```

- [ ] **Step 4: Restore sdkSessionId when loading history**

There are two history-load sites. In the tab-switch loader (lines 188-191) add `sdkSessionId`:

```tsx
                store.updateTab(tab.id, {
                  messages,
                  chatSessionId: session.id,
                  sdkSessionId: session.sdkSessionId
                })
```

and in the History-dropdown click loader (lines 334-337):

```tsx
                    store.updateTab(tab!.id, {
                      messages,
                      chatSessionId: session.id,
                      sdkSessionId: session.sdkSessionId
                    })
```

- [ ] **Step 5: Send model + resume on each message**

In `handleSend`, update the `trpc.claude.sendMessage.mutate` call (lines 215-227) to pass `model` and `resumeSessionId`:

```tsx
      await trpc.claude.sendMessage.mutate({
        message: userMessage.content,
        model: claudeModel,
        resumeSessionId: tab.sdkSessionId,
        context: {
          connectionName: activeProfile?.name,
          database: tab.database || undefined,
          collection: tab.collection || undefined,
          currentFilter: Object.keys(tab.filter).length > 0 ? tab.filter : undefined,
          resultCount: tab.results?.documents.length,
          page: tab.page + 1,
          totalPages: tab.results ? Math.ceil(tab.results.totalCount / tab.pageSize) : 1,
          openDocumentId: tab.selectedDocument?._id ? String(tab.selectedDocument._id) : undefined
        }
      })
```

Also add `claudeModel` to the `useCallback` dependency array (line 232): `}, [input, isStreaming, tab, profiles, activeConnection, claudeModel])`.

- [ ] **Step 6: Add the model selector to the header**

In the header's right-side button group (`<div className="flex shrink-0 items-center gap-1">`, line 276), add as the FIRST child (before the History button):

```tsx
          <select
            className="h-6 rounded border border-border bg-transparent px-1 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-ring"
            value={claudeModel}
            onChange={(e) => setClaudeModel(e.target.value as typeof claudeModel)}
            title="Model used by the assistant"
          >
            {CLAUDE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Manual verification (conversation memory + model switch)**

Run: `npm run dev`. Open a collection chat.
1. **Memory:** Ask *"Show me 3 documents."* After it responds, ask a follow-up that depends on context, e.g. *"What fields do those share?"* — confirm Claude understands "those" refers to the previous result (it would not, before this change).
2. **Model switch:** Change the header dropdown to **Opus 4.8**; send a message; confirm it still works. Fully restart the app → the dropdown still shows Opus 4.8 (persisted).
3. **New Chat resets memory:** Click **New Chat**, then ask the follow-up again — Claude should have no memory of the earlier turn.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/claude/ClaudePanel.tsx
git commit -m "feat(claude): model selector + resume-based conversation memory in chat panel"
```

---

## Final verification

- [ ] Run `npm run typecheck` once more — clean.
- [ ] Run `npm run dev` and exercise all four features end to end (A1 refresh, A2 collapse, A3 resize-persist, B chat memory + model switch + write-blocking intact).
- [ ] Optional: `npm run build` to confirm a production bundle compiles (the SDK path logic in `getClaudeExecutablePath` is unchanged, so packaged behavior is unaffected).

## Notes / known limitations

- Session memory is best-effort across app restarts: if a stored `sdkSessionId` is no longer resumable by the SDK, the next message errors; **New Chat** clears the session id and recovers. (A future enhancement could auto-retry without `resume` on a "session not found" error.)
- `recommendIndexes` / `interpretExplain` run on the default Sonnet 4.6 model and as fresh one-shot sessions; they intentionally do not join or alter the chat's session. Passing the selected model to them is a possible future tweak.
- Chat streaming remains active-tab-bound (pre-existing behavior); switching tabs mid-stream is not handled differently here.
