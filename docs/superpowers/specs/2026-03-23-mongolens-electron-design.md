# MongoLens — Electron + TypeScript Design Spec

## Overview

MongoLens is a native desktop MongoDB client with Claude Code built directly into the interface. Users can visually browse data, run queries, edit documents, and copy databases, with an embedded Claude assistant that sees and acts on everything in the UI. It also exposes MongoDB operations as an MCP server for external Claude Code sessions.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Electron | Single language (TS), all SDKs available natively, fastest path to ship |
| Build tooling | electron-vite | Vite-based, fast HMR, pairs with React frontend |
| Frontend | React + TypeScript | Standard, wide ecosystem |
| Styling | Tailwind CSS + shadcn/ui | Accessible components, no dependency lock-in, fast UI development |
| Package manager | pnpm | Fast, strict dependency resolution |
| IPC | tRPC v11 over Electron IPC (via `trpc-electron`) | Type-safe RPC, large API surface benefits from inference. `trpc-electron` is the v11-compatible Electron IPC adapter. |
| State | Zustand (multiple stores per domain) | Lightweight, one store per domain (connection, query, document, etc.), works well with external events |
| Claude integration | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) | Uses existing Claude Code subscription, no API key needed |
| Tool protocol | MCP (Streamable HTTP on localhost) | Current MCP standard (replaced deprecated SSE transport). Works for embedded chat AND external Claude Code. |
| Architecture | Main process as action layer | Simple, single process, async MongoDB driver. Heavy operations can be moved to `utilityProcess` if needed. |

## Architecture

```
Electron App
├── Main Process (Node.js)
│   ├── tRPC v11 Router (IPC) ── called by React UI
│   ├── Claude Agent SDK ──────── spawns claude subprocess, uses existing auth
│   ├── MCP Server (Streamable HTTP) ── exposes MongoDB tools on localhost
│   │                                    used by embedded chat + external Claude Code
│   ├── Actions Layer ─────────── shared business logic (query, mutate, migrate, admin)
│   └── MongoDB Node Driver ───── async, connection pool management
│
├── Renderer Process (React)
│   ├── Sidebar ─── connection tree explorer
│   ├── Main Panel ─ table / editor / query builder / migration
│   ├── Claude Panel ── chat UI with streaming + tool call cards
│   └── Zustand Stores ── per-domain stores (connection, query, document, claude, etc.)
│
└── Preload Script ─── exposes IPC transport for trpc-electron
```

### Key Design Principle: One Action Layer

Every MongoDB operation is a function in `src/main/actions/`. The tRPC routers and MCP tools are thin wrappers that delegate to these shared functions. The UI calls them via tRPC client. Claude Code calls them via MCP. External Claude Code sessions call them via the same MCP server. They all go through the same path:

- When Claude runs a query, results render in the table automatically
- When you edit a document in the UI, Claude can see the change in context
- Query history captures everything regardless of who initiated it

### Data Flow — Three Callers, One Path

```
React UI ──── tRPC client ──────▶ tRPC Router ──▶ Actions ──▶ MongoDB Driver
Claude Code ── MCP tool call ──▶ MCP Server ───▶ Actions ──▶ MongoDB Driver
Terminal CC ── MCP tool call ──▶ MCP Server ───▶ Actions ──▶ MongoDB Driver
```

When Claude calls a tool:
1. MCP server receives the call, delegates to actions layer
2. Actions layer executes against MongoDB
3. Result goes back to Claude Code (for conversation)
4. Main process emits IPC event to renderer (UI updates)
5. Chat shows tool call as collapsible card; table/editor updates with results

## Claude Integration

### No API Key Required

Uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) which leverages the user's existing Claude Code subscription (OAuth auth). No Anthropic API key, no separate billing.

### Embedded Chat Flow

1. User types message in chat panel
2. Renderer sends via tRPC to main process
3. Main process passes to Claude Agent SDK with context (active connection, database, collection, current results)
4. Claude Code calls MCP tools as needed (mongo_find, mongo_aggregate, etc.)
5. MCP server delegates to actions layer, executes against MongoDB
6. Results stream back: tool call info + Claude's text → renderer
7. Chat shows response + tool cards; data panels update

### Context Injection

Every message includes structured app state so Claude knows what the user is looking at:

```json
{
  "connection": { "name": "production", "uri": "mongodb+srv://..." },
  "database": "thecodezone",
  "collection": "CmsFormDataArchive",
  "currentFilter": { "Type": "Contacts" },
  "resultCount": 50,
  "page": 1,
  "totalPages": 128,
  "openDocument": "5cdb10bf60579c..."
}
```

This is passed as structured context in the system prompt to the Claude Agent SDK.

### External Access

When MongoLens is running, any Claude Code session can use the MCP server:

```json
{
  "mcpServers": {
    "mongolens": {
      "url": "http://localhost:27088/mcp"
    }
  }
}
```

Default port is 27088 (configurable in settings). MongoLens writes this config to `~/.claude/settings.json` during auto-registration (Phase 3).

## Project Structure

```
mongolens/
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
│
├── src/
│   ├── main/                          # Electron main process
│   │   ├── index.ts                   # App entry, window creation, tRPC setup
│   │   ├── trpc/
│   │   │   ├── router.ts             # Root tRPC router (merges sub-routers)
│   │   │   ├── context.ts            # tRPC context (injects services)
│   │   │   └── routers/
│   │   │       ├── connection.ts      # Thin wrapper → actions/connection
│   │   │       ├── explorer.ts        # Thin wrapper → actions/explorer
│   │   │       ├── query.ts           # Thin wrapper → actions/query
│   │   │       ├── mutation.ts        # Thin wrapper → actions/mutation
│   │   │       ├── migration.ts       # Thin wrapper → actions/migration
│   │   │       ├── admin.ts           # Thin wrapper → actions/admin
│   │   │       └── claude.ts          # Chat message handling
│   │   ├── actions/                   # Shared business logic (the action layer)
│   │   │   ├── connection.ts          # Connect, disconnect, list, save profiles
│   │   │   ├── explorer.ts            # List DBs, collections, schema sampling
│   │   │   ├── query.ts               # Find, aggregate, count, distinct, explain
│   │   │   ├── mutation.ts            # Insert, update, delete
│   │   │   ├── migration.ts           # Copy, export, import with progress
│   │   │   └── admin.ts               # Indexes, currentOp, killOp
│   │   ├── services/
│   │   │   ├── mongodb.ts            # Connection pool, client management
│   │   │   ├── claude.ts             # Claude Agent SDK integration
│   │   │   └── config.ts             # ~/.mongolens/ settings (uses safeStorage for creds)
│   │   └── mcp/
│   │       ├── server.ts             # MCP Streamable HTTP server on localhost
│   │       └── tools.ts              # Tool definitions → delegate to actions/
│   │
│   ├── renderer/                      # React frontend
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── AppShell.tsx       # 3-panel layout
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── TopBar.tsx
│   │   │   ├── explorer/
│   │   │   │   ├── DatabaseTree.tsx
│   │   │   │   └── CollectionNode.tsx
│   │   │   ├── data/
│   │   │   │   ├── DocumentTable.tsx  # AG Grid
│   │   │   │   ├── DocumentEditor.tsx # Monaco
│   │   │   │   └── InlineEditor.tsx
│   │   │   ├── query/
│   │   │   │   ├── QueryBuilder.tsx
│   │   │   │   ├── FilterRow.tsx
│   │   │   │   ├── ProjectionPicker.tsx
│   │   │   │   ├── SortPicker.tsx
│   │   │   │   └── QueryHistory.tsx
│   │   │   ├── migration/
│   │   │   │   └── MigrationPanel.tsx
│   │   │   ├── operations/
│   │   │   │   └── OperationsViewer.tsx
│   │   │   └── claude/
│   │   │       ├── ClaudePanel.tsx
│   │   │       ├── MessageBubble.tsx
│   │   │       ├── ToolCallCard.tsx
│   │   │       └── ContextBanner.tsx
│   │   ├── store/
│   │   │   ├── connectionStore.ts
│   │   │   ├── explorerStore.ts
│   │   │   ├── queryStore.ts
│   │   │   ├── documentStore.ts
│   │   │   ├── migrationStore.ts
│   │   │   └── claudeStore.ts
│   │   ├── lib/
│   │   │   ├── trpc.ts               # tRPC client (trpc-electron IPC link)
│   │   │   └── utils.ts              # shadcn cn() helper
│   │   └── styles/
│   │       └── globals.css
│   │
│   ├── shared/                        # Types shared between main + renderer
│   │   ├── types.ts
│   │   └── constants.ts
│   │
│   └── preload/
│       └── index.ts                   # Exposes IPC for trpc-electron
│
└── resources/                         # App icons, assets
```

## MCP Tool Catalogue

All tools exposed via the MCP Streamable HTTP server on localhost:

**Connection:** `mongo_list_connections`, `mongo_connect`, `mongo_connection_status`

**Exploration:** `mongo_list_databases`, `mongo_list_collections`, `mongo_collection_schema`, `mongo_collection_stats`, `mongo_list_indexes`

**Query:** `mongo_find`, `mongo_aggregate`, `mongo_count`, `mongo_distinct`, `mongo_explain`

**Mutation (destructive):** `mongo_insert_one`, `mongo_insert_many`, `mongo_update_one`, `mongo_update_many`, `mongo_delete_one`, `mongo_delete_many`, `mongo_replace_one`

**Admin:** `mongo_create_index`, `mongo_drop_index`, `mongo_create_collection`, `mongo_drop_collection`, `mongo_current_ops`, `mongo_kill_op`

**Migration:** `mongo_copy_collection`, `mongo_copy_database`, `mongo_export`, `mongo_import`

## Implementation Phases

### Phase 1 — Skeleton + Core + Claude (Vertical Slice)

Goal: Connect to MongoDB, see documents, ask Claude to query them.

1. Scaffold electron-vite + React + Tailwind + shadcn/ui + pnpm
2. Electron main process with tRPC v11 over IPC (trpc-electron)
3. Connection manager — save/load/connect/disconnect profiles
4. Database explorer sidebar — tree view of DBs and Collections
5. Document table view — AG Grid with pagination
6. JSON document editor — Monaco, read-only initially
7. MCP Streamable HTTP server on localhost with core query tools
8. Claude chat panel — streaming messages, tool call cards
9. Claude Agent SDK integration — tool routing via MCP, context injection

End state: Working app where you connect, browse, and ask Claude to query data.

### Phase 2 — Query Builder + Mutations

1. Visual query builder (filter/projection/sort panels)
2. Toggle between visual and raw JSON mode
3. Document editing — Monaco with save/update
4. Inline cell editing in the table
5. Insert/delete documents from UI
6. Mutation MCP tools (update, insert, delete)
7. Query history with replay

### Phase 3 — Migration + External MCP

1. Migration panel — copy collection/database between connections
2. Progress tracking with IPC events
3. Export/import JSON/CSV
4. CLI flag for headless MCP-only mode
5. Auto-registration in Claude Code settings (writes port to ~/.claude/settings.json)

### Phase 4 — Operations + Polish

1. Live operations viewer (currentOp, killOp)
2. Index management panel
3. Dark/light theme
4. Keyboard shortcuts
5. Collection search/filter
6. Saved queries library

## Security

- **Credential storage:** Connection URIs (which may contain passwords) are encrypted at rest using Electron's `safeStorage` API (backed by OS keychain: macOS Keychain, Windows DPAPI, Linux libsecret). Stored in `~/.mongolens/connections.encrypted`.
- **No API keys needed:** Claude Code handles its own auth via OAuth.
- **MCP server:** Binds to localhost only (127.0.0.1). Unauthenticated by design — localhost binding is the security boundary. Port defaults to 27088, configurable in settings. If the port is in use, the app tries the next available port and logs the actual port.
- **MCP tool annotations:** Read-only tools (find, aggregate, count, list, schema, explain) are annotated with `readOnlyHint: true` and `destructiveHint: false`. Mutation/admin tools use the default (`destructiveHint: true`) so MCP clients like Claude Code can distinguish safe tools from mutating ones.
- **Renderer isolation:** Preload script uses `contextBridge.exposeInMainWorld` with minimal surface area. Renderer runs with `contextIsolation: true` and `nodeIntegration: false`.
- **No telemetry:** No analytics, no external calls except MongoDB connections and Claude Code subprocess.

## Error Handling

- **MongoDB connection drops:** Actions layer catches connection errors and emits a `connection:lost` event to the renderer. The UI shows a reconnection banner with exponential backoff retry. Queries in flight return an error to the caller (tRPC error for UI, MCP error result for Claude).
- **Claude Agent SDK failures:** If the subprocess fails to start (e.g., Claude Code not installed, subscription inactive), the chat panel shows an actionable error message. The rest of the app continues working — Claude is a panel, not a dependency.
- **MCP tool failures:** Returned as standard MCP error results to Claude, which can explain the failure to the user in natural language. Simultaneously, the renderer shows a toast notification.
- **Validation:** All inputs validated at the actions layer via Zod schemas (shared with tRPC and MCP tool definitions). Invalid input never reaches the MongoDB driver.

## Performance Considerations

- **Pagination enforced at the action layer:** All find/aggregate operations enforce a maximum result size (default 1000 documents) regardless of caller. This prevents large result serialization from blocking the main process event loop.
- **Escape hatch:** If main-process blocking becomes an issue under load (simultaneous MCP + UI requests, large aggregations), the MCP server and/or MongoDB operations can be moved to Electron's `utilityProcess` — a separate Node.js process with IPC to the main process. This is not needed for Phase 1 but is a documented upgrade path.
- **Streaming:** Large result sets stream to the renderer in batches rather than serializing the full result at once.
