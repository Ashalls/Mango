# Explorer UX improvements & Claude integration modernization

**Date:** 2026-05-30
**Status:** Approved (design)
**Author:** Ashley + Claude

## Overview

Four changes to Mango, an AI-native MongoDB client (Electron + React + TypeScript, electron-vite, tRPC over IPC, zustand stores):

1. **Refresh Databases** item in the connection context menu.
2. **Click-to-collapse** a connection's database tree, with a chevron affordance.
3. **Resizable height** for the document table vs. document editor split, persisted globally.
4. **Claude integration modernization** — model selector, conversation memory, robust streaming, and safer permissions — against a newer `@anthropic-ai/claude-agent-sdk`.

Features 1–3 are small, self-contained UI changes. Feature 4 is the substantial one and reworks the core query loop in `claude.ts`.

## Key architectural decisions

- **Session memory uses resume-by-session-id**, not a long-lived streaming-input generator. Each message remains a normal request/response through tRPC. We capture the SDK `session_id` from the first turn, store it per chat tab, and pass `resume` on subsequent turns. This fits the existing IPC shape and per-tab chats, and keeps per-message model selection trivial. Trade-off: depends on the SDK's on-disk session store (we enable persistence); cross-restart resume is best-effort.
- **Resize uses a flex-ratio drag handle, no new dependency.** The panes already live in a `flex flex-col`. We drive them with `flexGrow` ratios and a thin drag handle. Trade-off: a library (`react-resizable-panels`) would generalize to the sidebar/Claude-panel widths, but that is out of scope (YAGNI).
- **Model selector is a global setting**, not per-chat-tab — simplest and matches expectations. Persisted like `theme`.
- **MCP-layer write-blocking remains the authoritative security boundary.** The `canUseTool` callback is added as defense-in-depth; it does not replace or weaken the existing enforcement in `src/main/mcp/tools.ts`.

## Feature 1 — Refresh Databases menu item

**Where:** `src/renderer/src/components/layout/Sidebar.tsx`, `renderConnection()` — the connection-level `ContextMenu`.

**Behavior:** New `ContextMenu.Item` ("Refresh Databases", `RefreshCw` icon), shown when `isThisConnected`, placed near the top of the menu (above or beside Connect/Disconnect). On select:
- If the connection is not active, `setActive(profile.id)` first.
- Then call `loadDatabases()` from the explorer store.

This mirrors the existing Explorer-header refresh button (`Sidebar.tsx:497-501`) but per-connection and discoverable via right-click.

## Feature 2 — Click-to-collapse + chevron

**Where:** `src/renderer/src/components/layout/Sidebar.tsx`, `renderConnection()`.

**State:** A per-connection collapsed set in the Sidebar component, e.g. `collapsedConnections: Set<string>` (connection id). In-session state is sufficient; no persistence required (only the active connection shows a tree, and nothing is connected at startup).

**Affordance:** Add a `ChevronRight` at the start of the connection row that rotates 90° when the tree is expanded — matching the database-row pattern in `DatabaseTree.tsx:175-181`.

**Click behavior** on the connection row:
- Not connected → `connect(profile.id)` (tree appears on success).
- Connected, not active → `setActive(profile.id)` and ensure expanded.
- Active and expanded → collapse (add to `collapsedConnections`).
- Active and collapsed → expand (remove from set).

**Tree render condition** changes from `isThisActive && isConnected` to `isThisActive && isConnected && !collapsed`.

## Feature 3 — Resizable table / document-editor split

**Where:** `src/renderer/src/components/data/MainPanel.tsx` (documents sub-tab), `src/renderer/src/store/settingsStore.ts`.

**Current:** When a document is selected, the table pane is `h-1/2 min-h-0` and the editor pane is `h-1/2 min-h-0` (`MainPanel.tsx:131-138`) — a fixed 50/50.

**Change:**
- Wrap the table pane and editor pane so both are flex children of the existing `flex h-full flex-col` container.
- Table pane: `style={{ flexGrow: tableRatio }}`, editor pane: `style={{ flexGrow: 1 - tableRatio }}`, each with `min-h-0` and a minimum pixel height (e.g. `minHeight: 80`).
- Insert a 6px-tall drag handle between them: `cursor-row-resize`, subtle hover highlight, full width. On pointer-drag, compute the new `tableRatio` from the pointer's Y position relative to the combined table+editor area (measure via a ref on the wrapping container). Clamp to a sane range (e.g. 0.15–0.85).
- The handle only renders when the editor is visible (`viewMode === 'table' && activeTab.selectedDocument`).

**Persistence (global):** Add `documentSplitRatio: number` (default `0.5`) to `settingsStore`, loaded/saved via `trpc.settings.get`/`set` exactly like `theme` and `catSounds` (`settingsStore.ts:35-62`). The ratio applies across all tabs and survives restart.

**Out of scope:** The aggregation sub-tab's results split (`MainPanel.tsx:145-149`) uses a similar fixed `h-2/5`; not changing it now, but the same approach could be reused later.

## Feature 4 — Claude integration modernization

**Files:** `src/main/services/claude.ts` (core), `src/main/trpc/routers/claude.ts`, `src/renderer/src/components/claude/ClaudePanel.tsx`, `src/renderer/src/store/settingsStore.ts`, `src/main/services/chatHistory.ts`, `src/renderer/src/store/tabStore.ts`, `src/shared/types.ts`, `package.json`.

### 4a. Model selector (default Sonnet 4.6)

- Add `claudeModel` to `settingsStore` with type `'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001'`, default `'claude-sonnet-4-6'`, persisted via `trpc.settings` (same pattern as `theme`).
- Compact dropdown in the `ClaudePanel` header listing Opus 4.8 / Sonnet 4.6 / Haiku 4.5 (labels), global across all chats.
- Thread the selected model id through `trpc.claude.sendMessage` input → `claudeService.sendMessage(..., { model })` → `options.model`, replacing the hardcoded `claude.ts:203`. The `recommendIndexes` / `interpretExplain` procedures pass the same model.

### 4b. Conversation memory (session continuity)

- **Capture:** In `claude.ts`, read the SDK init/system message's `session_id` at stream start and emit a new renderer event (e.g. `claude:session`, carrying `{ messageId, sessionId }`).
- **Store:** Add `sdkSessionId?: string` to the per-tab chat state in `tabStore.ts` and persist it on `ChatSession` in `chatHistory.ts` / `shared/types.ts` so a reopened session can attempt resume.
- **Resume:** `sendMessage` accepts an optional `resumeSessionId`; when present, pass it to the SDK (`resume`) instead of starting fresh. Enable the SDK's session persistence (remove/replace `persistSession: false`).
- **Reset:** "New chat"/clear-messages drops `sdkSessionId` so the next message starts a fresh session.
- **Best-effort restart:** If a stored session id is no longer resumable, fall back to a fresh session while preserving the UI history that `chatHistory.ts` already restores.

### 4c. Robust streaming

- Set `includePartialMessages: true`.
- Render assistant text from partial-message deltas; detect `tool_use` / `tool_result` and turn completion from typed SDK messages.
- Delete the fragile prefix-matching turn-boundary logic (`claude.ts:245-296`).
- Keep the existing renderer event names (`claude:stream-start`, `claude:text-delta`, `claude:tool-use`, `claude:tool-result`, `claude:stream-end`) so `ClaudePanel.tsx` needs minimal change — it just receives cleaner, true token-by-token data.

### 4d. Permissions (defense-in-depth)

- Remove `allowDangerouslySkipPermissions: true` and `permissionMode: 'bypassPermissions'`.
- Add a `canUseTool(toolName, input)` callback that allows the `mcp__mango__*` tools and otherwise denies, mirroring the current effective allowlist.
- **The MCP tool layer (`src/main/mcp/tools.ts`) remains the authoritative enforcer** of production / read-only / per-database-override write rules. `canUseTool` is additive and must not relax those rules.

### SDK upgrade

- **No package bump needed.** The `^0.1.0` range already resolves to the installed **0.1.77**, whose `Options` type natively provides every API this work uses: `model`, `resume`, `continue`, `includePartialMessages`, `canUseTool`, `persistSession` (default `true`; the current code's `false` is exactly what blocks resume), plus `fallbackModel`/`maxThinkingTokens`. Modernizing against the installed version avoids a risky dependency bump and leaves the packaged-build path logic (`getClaudeExecutablePath`, `app.asar.unpacked`, `ELECTRON_RUN_AS_NODE`) untouched.
- *(Decided during planning after reading the installed SDK's `.d.ts` files — supersedes the earlier "bump to current published version" intent.)*

## Risks & verification

- **Permissions regression is the top risk.** After switching off the bypass, explicitly verify: writes to a `[PRODUCTION]` connection are still blocked, `[READ-ONLY]` connections block all writes, and per-database `[claude:readwrite]` overrides still permit writes. The MCP-layer tests/paths must still fire.
- **SDK API drift.** Confirm against the *installed* SDK version's TypeScript types (not changelog research): the exact `resume` option, where `session_id` appears, the partial-message event shape, and that `canUseTool` fires for HTTP-MCP tools. Pin these before relying on them.
- **Packaged build.** No SDK version change, so the asar-unpacked CLI path is unaffected; a `npm run build` smoke-check is still worthwhile but low-risk.
- **Manual verification** (run the app): model switch takes effect; a two-message follow-up resolves correctly (memory works); drag-resize persists across restart; connection collapse/expand and the Refresh Databases item behave as specified.

## Out of scope

- Aggregation results-pane resize.
- Per-chat-tab model selection (global only).
- Replacing MCP-layer enforcement with SDK-only permissions.
- Adding a resizable-panels library for sidebar/Claude-panel widths.
- Extended-thinking / compaction / cost-cap UI (capabilities noted in evaluation but not built here).
