# Core MongoDB Features Update — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Goal:** Close the feature gap on query capabilities, index management, query history, bulk operations, and AI context — to match/exceed competing MongoDB clients.

---

## Review Resolutions

Issues identified during spec review and their resolutions:

1. **`tabStore` missing `setSort`/`setProjection`** — Tab interface has `sort`/`projection` fields but no setter actions. Phase 1 must add `setSort()` and `setProjection()` to the TabStore interface.
2. **Skip/limit vs pagination** — User-entered limit replaces `pageSize`. Skip is derived from `page * limit`. The skip input in the footer is read-only, showing the computed value. The limit input updates `pageSize`. Pagination controls (prev/next page) continue to work by updating `page`, which recalculates skip.
3. **`queryStore.ts` overlap** — `queryStore.ts` is unused legacy from an earlier iteration. It should be deleted during Phase 1 cleanup.
4. **Action layer does not use `connId`** — All new actions follow the existing pattern: no `connId` parameter, use implicit active connection via `mongoService.getDb(database)`.
5. **Missing tRPC routes** — `query.saveHistory` and `query.deleteHistory` added to section 3.
6. **Changelog logging** — Follows existing pattern: changelog logging happens at the MCP tool and tRPC route layers, not in the action functions themselves.
7. **AG Grid selection mode** — Checkbox column uses `checkboxSelection: true` on a dedicated first column. Row click still opens the document editor (no change). Selection only via checkboxes. `rowSelection` changes to `{ mode: 'multiRow', enableClickSelection: false }`.
8. **Sort type** — Keep existing `Record<string, number>` and `z.record(z.number())` for compatibility. UI constrains to 1/-1 visually.
9. **Accordion expand** — Multiple sections can be expanded simultaneously (independent toggles, not mutually exclusive).
10. **Indexes tab host** — `MainPanel.tsx` gets a sub-tab bar (`Documents | Indexes`) above the content area. Query builder hides when Indexes tab is active.
11. **`selectedDocIds` type** — Use `string[]` instead of `Set<string>` for JSON serialization compatibility. Excluded from tab persistence.
12. **Drag reorder for sort** — Deferred. Use simple up/down arrow buttons instead. No new dependency needed.
13. **Projection nested fields** — Field list shows top-level fields from schema. A manual text input is also available for typing nested paths like `address.city`.
14. **Query history connection filter** — History dropdown shows entries for the current connection only. A "Show all connections" toggle at the bottom shows everything.
15. **Bulk ops rollback** — Bulk operations (insertMany, updateMany) do NOT capture `documentsBefore`. The changelog logs the operation metadata (filter, count) but not individual document snapshots. This is stated in the UI confirmation dialogs.
16. **Concurrent history writes** — Use a debounced write (500ms) with an in-memory buffer. The buffer is the source of truth; disk writes are eventual.
17. **Insert Documents from sidebar** — Add "Insert Documents..." to the existing collection context menu in `Sidebar.tsx`.

---

## 1. Enhanced Query Builder

### Current State
- Visual filter builder with row-based conditions, AND/OR logic, type-aware operators
- Raw JSON mode toggle
- Backend supports sort, projection, skip, limit — but NO UI exposes them
- `tabStore` holds `sort` and `projection` on the Tab interface but has no setter actions
- `queryStore.ts` exists as unused legacy — delete it

### Design: Stacked Accordion Sections

Expand `QueryBuilder.tsx` into four independently collapsible sections stacked vertically:

**Filter section** (existing — minor enhancements)
- Keep the current row-based filter builder as-is
- Collapsed summary: "3 conditions" or "No filter"
- Fix existing bug: `handleRun` references undeclared `selectedDatabase`/`selectedCollection` — remove these, `executeQuery()` takes zero arguments

**Sort section** (new)
- Row-based: each row is `[field dropdown] [ASC/DESC toggle] [remove button]`
- "Add sort field" button to append rows
- Multiple sort fields supported (compound sort)
- Up/down arrow buttons for reordering priority (no drag-and-drop)
- Collapsed summary: "name ASC, createdAt DESC"
- Maps to `Record<string, number>` (UI constrains to 1/-1), passed to new `tabStore.setSort()`

**Projection section** (new)
- Two modes toggled by a switch:
  - **Include mode**: only return checked fields (projection `{ field: 1 }`)
  - **Exclude mode**: return all except checked fields (projection `{ field: 0 }`)
- Field list auto-populated from the current collection's schema (via `collection-schema` action)
- Manual text input for typing nested field paths (e.g. `address.city`)
- Checkboxes per field, "Select All / None" controls
- `_id` always shown with its own toggle (MongoDB allows `_id: 0` independently)
- Collapsed summary: "5 fields included" or "All fields"
- Maps to `Record<string, 0 | 1>` passed to new `tabStore.setProjection()`

**Footer row** (new)
- Limit input (number, default 50) — updates `tabStore.setPageSize()`
- Skip display (read-only, computed from `page * limit`)
- **Run** button (existing, relocated)
- **History** button (clock icon, opens query history dropdown)

### Tab Store Changes
Add to `TabStore` interface:
- `setSort(sort: Record<string, number> | null): void`
- `setProjection(projection: Record<string, number> | null): void`
These update the active tab's `sort`/`projection` fields and trigger a re-query.

### Data Flow
1. User configures filter/sort/projection/limit in accordion sections
2. Click Run → `executeQuery()` in tabStore calls `trpc.query.find` with all params
3. Results render in DocumentTable
4. Query auto-saved to history (see section 3)

### Files to Modify
- `src/renderer/src/components/query/QueryBuilder.tsx` — major expansion, fix `handleRun` bug
- `src/renderer/src/store/tabStore.ts` — add `setSort()`, `setProjection()` actions
- Delete: `src/renderer/src/store/queryStore.ts` — unused legacy
- New: `src/renderer/src/components/query/SortBuilder.tsx`
- New: `src/renderer/src/components/query/ProjectionBuilder.tsx`
- New: `src/renderer/src/components/query/QueryFooter.tsx`

---

## 2. Index Management

### Current State
- Backend `admin.ts` has `listIndexes()` — read-only
- tRPC exposes `admin.listIndexes` query
- No create/drop index support
- No UI whatsoever
- No MCP tools for indexes

### Design: Collection Tab

Add an **Indexes** tab to `MainPanel.tsx` alongside the existing Documents view. A sub-tab bar (`Documents | Indexes`) sits above the content area. When Indexes tab is active, the query builder and document table are hidden; the IndexPanel is shown instead.

**Index List View**
- Table columns: Name, Fields (with direction), Type badge, Size, Usage count, Actions
- Type badges: Default, Unique, Compound, Text, TTL, Sparse, Partial, 2dsphere
- Actions column: "Drop" button (with confirmation dialog) — disabled for `_id_` index
- Toolbar: index count label + "Create Index" button

**Create Index Dialog** (modal)
- Field rows: `[field name input] [direction: 1/-1/text/2dsphere dropdown]`
- "Add field" button for compound indexes
- Options section (collapsible):
  - Unique (checkbox)
  - Sparse (checkbox)
  - TTL — expireAfterSeconds (number input, shown when single field selected)
  - Partial filter expression (JSON input)
  - Custom name (text input, auto-generated if blank)
- "Create" button executes and refreshes the list

**Drop Index Dialog**
- Confirmation: "Drop index `email_1` from `users`? This cannot be undone."
- Cannot drop `_id_` index (button disabled)

### Backend Additions

**Actions** (`src/main/actions/admin.ts`) — follow existing pattern, no `connId` param:
- `createIndex(db, collection, fields, options)` — calls `collection.createIndex()`
- `dropIndex(db, collection, indexName)` — calls `collection.dropIndex()`
- `getIndexStats(db, collection)` — calls `collection.aggregate([{ $indexStats: {} }])`

**tRPC routes** (`src/main/trpc/routers/admin.ts`):
- `admin.createIndex` mutation
- `admin.dropIndex` mutation
- `admin.indexStats` query

**MCP tools** (`src/main/mcp/tools.ts`):
- `mongo_create_index` — create index with fields and options (write-access gated)
- `mongo_drop_index` — drop index by name (write-access gated)
- `mongo_list_indexes` — list all indexes on a collection (read-only)
- `mongo_index_stats` — get index usage statistics (read-only)

### Files to Create/Modify
- New: `src/renderer/src/components/indexes/IndexPanel.tsx` — main index tab
- New: `src/renderer/src/components/indexes/CreateIndexDialog.tsx`
- Modify: `src/renderer/src/components/data/MainPanel.tsx` — add sub-tab bar (Documents | Indexes)
- Modify: `src/main/actions/admin.ts` — add createIndex, dropIndex, indexStats
- Modify: `src/main/trpc/routers/admin.ts` — add routes
- Modify: `src/main/mcp/tools.ts` — add 4 MCP tools

---

## 3. Query History

### Current State
- No query history of any kind
- Changelog tracks mutations but not reads
- Tab state preserves current filter but not history

### Design: Dropdown Panel + Persistent Storage

**Storage** (`~/.mango/query-history.json`):
```typescript
interface QueryHistoryEntry {
  id: string                          // UUID
  connectionId: string
  database: string
  collection: string
  filter: Record<string, unknown>
  sort: Record<string, number> | null
  projection: Record<string, number> | null
  limit: number
  resultCount: number
  timestamp: number                   // Unix ms
  pinned: boolean
}
```
- Max 200 entries (auto-prune oldest unpinned on overflow)
- Auto-saved on every query execution
- In-memory buffer is source of truth; disk writes debounced (500ms)

**Backend Service** (`src/main/services/queryHistory.ts`):
- `loadHistory()` → `QueryHistoryEntry[]`
- `saveEntry(entry)` — append to buffer + debounced flush + prune
- `togglePin(id)` — pin/unpin
- `deleteEntry(id)` — remove single entry
- `clearHistory()` — remove all unpinned

**tRPC Routes** (`src/main/trpc/routers/query.ts`):
- `query.getHistory` — returns all entries
- `query.saveHistory` — save a new entry
- `query.deleteHistory` — delete single entry by id
- `query.togglePinHistory` — pin/unpin
- `query.clearHistory` — clear unpinned

**UI: Dropdown Panel**
- Clock icon button in QueryFooter (next to Run button)
- Opens a positioned dropdown panel (not a modal)
- Sections: Pinned (starred) at top, Recent below
- Filtered to current connection by default; "Show all connections" toggle at bottom
- Each entry shows: `collection → filter summary`, sort/projection indicators, relative timestamp, result count
- Click "Run" on any entry → loads filter/sort/projection/limit into current tab and executes
- Star icon toggles pin, X button deletes entry
- "Clear all" link in header

**Auto-save trigger:**
- After `executeQuery()` succeeds in tabStore, call `trpc.query.saveHistory` with the full query state + result count

### Files to Create/Modify
- New: `src/main/services/queryHistory.ts` — persistence with debounced writes
- New: `src/renderer/src/components/query/QueryHistoryPanel.tsx` — dropdown UI
- Modify: `src/main/trpc/routers/query.ts` — add 5 history routes
- Modify: `src/renderer/src/store/tabStore.ts` — auto-save after query execution
- Modify: `src/renderer/src/components/query/QueryFooter.tsx` — history button

---

## 4. Bulk Operations

### Current State
- `insertOne`, `updateOne`, `deleteOne`, `deleteMany` in actions + tRPC + MCP
- `insertMany` used internally by migration/export but not exposed
- No multi-select in document table
- Context menu has single-doc delete only

### Design: Selection Toolbar + Bulk Dialogs

**Document Table Selection**
- Add checkbox column as first column in AG Grid with `checkboxSelection: true`
- Change `rowSelection` to `{ mode: 'multiRow', enableClickSelection: false }`
- Row click still opens document editor (unchanged behavior)
- Header checkbox for select all (current page)
- Selected rows tracked in tabStore: `selectedDocIds: string[]` (not persisted)

**Floating Toolbar** (appears when selection > 0)
- Positioned above the document table
- Shows: "{N} selected | Delete | Update Field... | Export | Select All · Clear"
- **Delete Selected** — confirmation dialog, then calls `deleteMany` with `{ _id: { $in: [...ids] } }`
- **Update Field** — dialog with field name + new value, calls `updateMany` with same `$in` filter (depends on new `updateMany` action)
- **Export Selected** — exports selected docs to JSON file

**Insert Documents Dialog** (accessible from toolbar or collection context menu in Sidebar)
- Monaco editor for pasting a JSON array of documents
- Validate JSON before submit
- Calls `insertMany`, shows count of inserted docs
- Refreshes the document table

**Update Many Dialog** (accessible from toolbar)
- Filter input (JSON, pre-filled with current query filter)
- Update expression input (JSON, e.g. `{ $set: { status: "archived" } }`)
- Preview: shows count of matching documents before executing
- Calls `updateMany`, shows modified count

**Changelog for bulk ops:** Logs operation metadata (filter used, document count affected) but NOT individual document snapshots. Confirmation dialogs state this clearly: "This operation cannot be undone."

### Backend Additions

**Actions** (`src/main/actions/mutation.ts`) — no `connId` param, no changelog in action layer:
- `insertMany(db, collection, documents)` — calls `collection.insertMany()`
- `updateMany(db, collection, filter, update)` — calls `collection.updateMany()`

**tRPC routes** (`src/main/trpc/routers/mutation.ts`):
- `mutation.insertMany` — changelog logging at route level
- `mutation.updateMany` — changelog logging at route level

**MCP tools** (`src/main/mcp/tools.ts`):
- `mongo_insert_many` — insert array of documents (write-access gated, changelog at tool level)
- `mongo_update_many` — filter-based bulk update (write-access gated, changelog at tool level)

### Files to Create/Modify
- Modify: `src/renderer/src/components/data/DocumentTable.tsx` — add checkbox column, change selection mode
- Modify: `src/renderer/src/components/layout/Sidebar.tsx` — add "Insert Documents..." to collection context menu
- New: `src/renderer/src/components/data/BulkToolbar.tsx` — floating selection toolbar
- New: `src/renderer/src/components/data/InsertDocumentsDialog.tsx`
- New: `src/renderer/src/components/data/UpdateManyDialog.tsx`
- Modify: `src/main/actions/mutation.ts` — add insertMany, updateMany
- Modify: `src/main/trpc/routers/mutation.ts` — add routes with changelog
- Modify: `src/main/mcp/tools.ts` — add 2 MCP tools with changelog
- Modify: `src/renderer/src/store/tabStore.ts` — add `selectedDocIds: string[]`

---

## 5. Codebase Context for Claude

### Current State
- Claude's system prompt includes: connected databases, current focus (connection/db/collection), query filters, result counts, access levels
- No awareness of the user's application code that queries these databases
- Claude can help with MongoDB queries but can't understand the data model's relationship to the codebase

### Design: Per-Database Codebase Path

Allow the user to associate a local folder path with a database. When set, Claude's system prompt includes relevant code context so it can understand how the application uses the data — making query suggestions, schema understanding, and migration advice significantly more informed.

**Connection Settings Extension**
- Add `codebasePath?: string` to the per-database override config (alongside the existing `claudeAccess` override)
- Alternatively, add it at the connection level: `codebasePath?: string` on the Connection interface
- UI: In the connection settings dialog, a "Codebase" field with a folder picker button per database (or per connection)
- Stores an absolute path like `D:\Git Repos\MyApp\src`

**Context Injection**
When Claude's system prompt is built (`buildSystemPrompt()` in `claude.ts`):
1. If the active database has a `codebasePath` set, scan that directory for relevant files
2. Include a `## Codebase Context` section in the system prompt with:
   - File tree summary (top-level structure)
   - Contents of files that reference the active database/collection names (grep for collection name strings)
   - Schema/model definitions if detectable (e.g., Mongoose schemas, TypeScript interfaces)
3. Limit total context to ~20KB to avoid bloating the prompt
4. Cache the scan result per codebase path — invalidate on re-connection or manual refresh

**Scanning Strategy**
- Use a lightweight file scan (not the full Claude Agent SDK codebase indexing)
- Glob for common patterns: `**/*.ts`, `**/*.js`, `**/*.py`, `**/*.go` (configurable file extensions)
- Grep for the active collection name and database name in those files
- Include matched files (or relevant excerpts) in the system prompt
- Skip `node_modules`, `.git`, `dist`, `build`, `__pycache__` etc.

**MCP Integration**
- No new MCP tools needed — this enhances the existing system prompt
- Claude automatically benefits from the richer context

### Data Model

Add to Connection interface in `src/shared/types.ts`:
```typescript
interface Connection {
  // ... existing fields
  codebasePath?: string              // Root path to associated codebase
  codebaseExtensions?: string[]      // File extensions to scan (default: ['.ts', '.js', '.py', '.go'])
}
```

Or per-database override in `claudeDbOverrides`:
```typescript
claudeDbOverrides?: Record<string, {
  access: 'readonly' | 'readwrite' | 'none'
  codebasePath?: string
}>
```

### Files to Create/Modify
- New: `src/main/services/codebaseContext.ts` — file scanning, grep, context building
- Modify: `src/main/services/claude.ts` — inject codebase context into system prompt
- Modify: `src/shared/types.ts` — add `codebasePath` to Connection or db override
- Modify: `src/renderer/src/components/explorer/ConnectionDialog.tsx` — add folder picker field
- Modify: `src/main/services/config.ts` — persist codebasePath in connections.json

---

## Summary of All New Files

```
src/
  main/
    services/queryHistory.ts              # Query history persistence
    services/codebaseContext.ts            # Codebase scanning for Claude context
    actions/admin.ts                      # + createIndex, dropIndex, indexStats
    actions/mutation.ts                   # + insertMany, updateMany
    trpc/routers/admin.ts                 # + index CRUD routes
    trpc/routers/mutation.ts              # + bulk mutation routes
    trpc/routers/query.ts                 # + history routes
    mcp/tools.ts                          # + 6 new MCP tools
  renderer/src/components/
    query/SortBuilder.tsx                 # Sort field rows
    query/ProjectionBuilder.tsx           # Field include/exclude
    query/QueryFooter.tsx                 # Skip/Limit/Run/History
    query/QueryHistoryPanel.tsx           # History dropdown
    indexes/IndexPanel.tsx                # Index list + management
    indexes/CreateIndexDialog.tsx         # Index creation dialog
    data/BulkToolbar.tsx                  # Selection floating toolbar
    data/InsertDocumentsDialog.tsx        # Bulk insert dialog
    data/UpdateManyDialog.tsx             # Bulk update dialog
```

## Implementation Order

1. **Query Builder expansion** — sort, projection, limit UI, delete queryStore.ts (fastest ROI, backend exists)
2. **Query History** — service + UI (builds on query builder changes)
3. **Index Management** — backend + tab UI (independent module)
4. **Bulk Operations** — backend + table selection + dialogs (touches most files)
5. **Codebase Context** — scanning service + system prompt injection + connection dialog update

Each phase is independently shippable.
