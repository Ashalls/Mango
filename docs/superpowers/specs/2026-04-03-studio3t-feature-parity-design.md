# Studio 3T Feature Parity — Design Spec

**Date**: 2026-04-03
**Goal**: Systematically close feature gaps between Mango and Studio 3T, positioning Mango as a full replacement with superior AI integration.
**Approach**: Impact-weighted phases — Query & Analysis tools first, then Connection & Security, Monitor & Admin, Data Operations, and Enterprise & Collaboration.
**Cut**: SQL Query feature (Mango targets MongoDB-native users, not SQL migrants).

---

## Phase 1 — Query Power Tools

The daily-driver features power users expect from a serious MongoDB GUI.

### 1.1 Visual Aggregation Editor

**Location**: New tab view within collection tabs, alongside the existing query builder. A dedicated "Aggregation" tab or mode toggle (Find | Aggregate) in the query area.

**UI Structure**:

- **Stage List (left panel)**: Vertical stack of stage cards. Each card shows:
  - Drag handle for reorder (drag-and-drop via `dnd-kit` or similar)
  - Stage type badge (`$match`, `$group`, `$project`, `$lookup`, `$unwind`, `$sort`, `$limit`, `$skip`, `$addFields`, `$replaceRoot`, `$out`, `$merge`, and all other standard stages)
  - One-line summary of stage content (e.g., `status == "active"` for a `$match`)
  - Checkbox to toggle stage on/off (excluded from execution but config preserved)
  - Delete button (with confirmation for non-empty stages)
  - "Add Stage" button at bottom with dropdown of all stage types, inserting after the currently selected stage

- **Stage Editor (center panel)**: Monaco editor instance for the selected stage.
  - Pre-populated with stage template on creation (e.g., `{ "field": 1 }` for `$project`)
  - Syntax highlighting, bracket matching, JSON validation
  - Auto-completion for:
    - Field names (fetched from `collectionSchema` — existing action)
    - MongoDB aggregation operators (`$sum`, `$avg`, `$first`, `$last`, `$push`, `$addToSet`, etc.)
    - Expression operators (`$cond`, `$ifNull`, `$concat`, `$dateToString`, etc.)
  - Real-time validation — red underline for invalid JSON or unknown operators

- **Preview Panel (right panel)**: Two sub-tabs:
  - "Input" — documents entering this stage (runs pipeline up to but NOT including the selected stage)
  - "Output" — documents after this stage (runs pipeline up to and INCLUDING the selected stage)
  - Each shows: document count + sample documents in a mini JSON/table view
  - Configurable sample size (default 20)
  - "Refresh" button to re-run preview
  - Preview auto-refreshes when stage content changes (debounced 500ms)

- **Bottom Bar**:
  - "Run Pipeline" button — executes full pipeline (respecting toggled-off stages), results display in the main document table below
  - "Explain" button — runs explain on the pipeline, opens Visual Explain view
  - "Generate Code" button — opens Query Code Generation modal (Phase 2)
  - "Copy Pipeline JSON" button — copies the full pipeline array to clipboard
  - Result count display

**Behavior**:
- Adding a stage inserts after the currently selected stage (or at end if none selected)
- Drag-and-drop reorders stages; preview refreshes automatically
- Toggling a stage off grays it out, excludes from execution, preserves config
- Pipeline saved to query history (existing `queryHistory` service) alongside find queries, tagged as type `aggregate`
- Empty pipeline shows all documents (equivalent to `find({})`)
- Stage selection via click on stage card — highlights card, loads editor and preview

**Backend**:
- New tRPC route `query.aggregateWithStagePreview`:
  - Input: `{ database, collection, pipeline: Stage[], stageIndex: number, sampleSize: number }`
  - Behavior: runs pipeline stages `[0..stageIndex]` (only enabled stages) with `$limit` appended for preview
  - Returns: `{ documents: Document[], count: number }`
- Extend existing `query.aggregate` to support `hint` option for index hints
- New MCP tool `mongo_aggregate_preview` for Claude to preview pipeline stages

**New shared types**:
```typescript
interface AggregationStage {
  id: string           // unique ID for drag-and-drop
  type: string         // e.g., "$match", "$group"
  content: string      // JSON string of stage body
  enabled: boolean     // toggle on/off
  order: number        // position in pipeline
}

interface AggregationPipeline {
  stages: AggregationStage[]
  collectionName: string
  databaseName: string
}
```

---

### 1.2 Tree View

**Location**: Third view mode in collection tabs: Table | Tree | JSON.

**UI Structure**:
- Virtualized tree component (`react-arborist`) for performance
- Each document is a root-level expandable node showing `_id` value
- Expanding a document shows its fields as child nodes
- Field nodes show `fieldName: value` for leaf values, `fieldName {n keys}` for objects, `fieldName [n items]` for arrays
- Type-colored values:
  - Green: strings
  - Blue: numbers
  - Orange: ObjectId
  - Purple: dates
  - Red: booleans
  - Gray: null
- Arrays expand to indexed children (`[0]`, `[1]`, etc.)
- Nested objects expand recursively

**Editing**:
- Double-click a leaf value → inline text input with type-aware parsing (auto-detects string/number/boolean/null/ObjectId/date)
- Right-click context menu on any node:
  - **Edit Value** (leaf nodes) — opens inline editor
  - **Copy Value** — copies value to clipboard
  - **Copy Field Path** — copies dot-notation path (e.g., `address.city`)
  - **Delete Field** — removes field via `$unset`
  - **Add Field** — dialog to enter field name + value + type
  - **Add Array Element** (array nodes) — appends to array via `$push`
  - **Expand All** / **Collapse All** — for nested structures
- Changes staged locally with diff highlighting (yellow background for modified, green for added, red strikethrough for deleted)
- "Save" button commits all pending changes via `mutation.updateOne` with accumulated `$set`/`$unset`/`$push` operators
- "Discard" button reverts to server state

**Performance**:
- Virtualized rendering — only visible nodes in DOM
- Lazy expansion — nested structures rendered on expand, not pre-loaded
- Same pagination as table view (50 docs per page, controlled by existing pagination)
- Large arrays (>100 items): show first 100 with "Load more" button

**Integration**:
- Switching between Table/Tree/JSON preserves the current query and pagination state
- Selected document in Tree View can be opened in Document Editor (Monaco) via double-click on root node or context menu
- Drag-and-drop from Tree View field values into query builder filter (extending existing drag-and-drop behavior)

---

### 1.3 Visual Explain

**Location**: "Explain" tab in collection tabs, accessible after running any find or aggregate query. Also accessible from the Aggregation Editor's "Explain" button and the Query Profiler's "Explain This" action.

**UI Structure**:

- **Flow Diagram**: Horizontal left-to-right pipeline of stage boxes connected by arrows.
  - Each box shows: stage type (e.g., `IXSCAN`, `FETCH`, `SORT`, `COLLSCAN`, `MERGE_SORT`), key metric
  - Arrows show document flow between stages, labeled with document count passed
  - Color coding:
    - Green: efficient (index scan, low examine-to-return ratio)
    - Yellow: moderate (index scan but high ratio, or in-memory sort within limits)
    - Red: collection scan, or examined >> returned, or exceeded memory limits
  - Rendering: `reactflow` library for the diagram (supports custom nodes, edges, auto-layout)

- **Stage Detail Panel**: Click a stage box to expand details below the diagram:
  - Index used (name + key pattern) or "No index (COLLSCAN)"
  - Filter / key pattern applied
  - Documents examined vs. documents returned
  - Keys examined
  - Execution time (ms)
  - Memory usage (if sort stage)
  - Whether sort was in-memory or index-backed

- **Summary Bar** (top of Explain tab):
  - Total execution time (ms)
  - Winning plan description
  - Number of rejected plans
  - Index recommendation: if COLLSCAN detected, suggest "Consider creating an index on [fields]"
  - "Show Raw JSON" toggle to see the raw explain output in Monaco editor

**Backend**:
- Extend existing `query.explain` to return `allPlansExecution` verbosity (currently uses `executionStats`)
- New utility `parseExplainPlan(explainResult)` → `ExplainPlanTree`:
  - Recursively walks `executionStages` / `stages` (for aggregation)
  - Flattens into ordered list of `ExplainStageNode` for rendering
  - Extracts winning plan vs. rejected plans

**New shared types**:
```typescript
interface ExplainStageNode {
  id: string
  type: string              // IXSCAN, FETCH, SORT, COLLSCAN, etc.
  executionTimeMs: number
  docsExamined: number
  docsReturned: number
  keysExamined: number
  indexName?: string
  indexKeyPattern?: Record<string, 1 | -1>
  filter?: object
  memoryUsageBytes?: number
  children: ExplainStageNode[]
  efficiency: 'good' | 'moderate' | 'poor'
}

interface ExplainPlan {
  stages: ExplainStageNode[]
  totalExecutionTimeMs: number
  winningPlan: string
  rejectedPlansCount: number
  indexSuggestion?: string
}
```

---

### 1.4 Value Search

**Location**: Top bar — new "Search Values" button/icon next to existing search, or extend existing search with a "Search in Data" mode. Also accessible via keyboard shortcut (e.g., `Ctrl+Shift+F`).

**UI Structure**:

- **Search Dialog** (modal or slide-out panel):
  - Text input for search term
  - Scope selector: Server (all databases) / Database (dropdown) / Collection (dropdown)
  - Toggles: Regex mode, Case-insensitive
  - Field filter (optional): limit search to specific field names
  - "Search" button + "Cancel" button for long-running searches
  - Max results input (default 200)

- **Results Panel**:
  - Grouped by collection: `database.collection` header with match count
  - Each result row: document `_id`, field path (dot notation), matched value with search term highlighted
  - Double-click a result → opens collection tab, navigates to that document
  - "Export Results" button → copy results as JSON/CSV

- **Progress**:
  - Progress bar showing collections scanned / total
  - Streaming results — results appear as they're found, search continues in background
  - Cancel button to stop mid-search

**Backend**:
- New tRPC route `query.valueSearch`:
  - Input: `{ searchTerm, scope: { type: 'server' | 'database' | 'collection', database?, collection? }, regex: boolean, caseInsensitive: boolean, maxResults: number }`
  - Implementation:
    1. List collections in scope
    2. For each collection, run schema inference (sample) to get string fields
    3. Build `$or` query with `$regex` on each string field
    4. Stream results back via IPC events (reuse existing operation progress pattern)
    5. Each result includes: `{ database, collection, documentId, fieldPath, matchedValue }`
  - Performance consideration: uses `$regex` which can be slow on large collections without text indexes. For collections with text indexes, optionally use `$text` search instead.
- New MCP tool: `mongo_value_search` for Claude

---

## Phase 2 — Connect Anywhere + Profiling

Unblock users who need SSH/SSL, and add profiling + code generation.

### 2.1 SSH Tunnel Connections

**Location**: Connection dialog — new "SSH" tab/section.

**UI**:
- Toggle: "Connect via SSH Tunnel"
- When enabled, show fields:
  - SSH Host (required)
  - SSH Port (default 22)
  - SSH Username (required)
  - Auth method radio: Password | Private Key
    - Password mode: password input
    - Private Key mode: file picker for `.pem`/`.ppk` + optional passphrase input
  - "Test SSH" button — validates SSH connection independently
- Visual flow indicator: `[Your Machine] → SSH → [SSH Host] → [MongoDB Host]`

**Backend**:
- Dependency: `ssh2` npm package
- Connection flow:
  1. Establish SSH connection to `ssh.host:ssh.port` with credentials
  2. Create local TCP port forward: `localhost:<randomAvailablePort>` → `<mongoHost>:<mongoPort>`
  3. Connect MongoDB driver to `localhost:<forwardedPort>`
  4. Store tunnel reference for cleanup on disconnect
- Tunnel lifecycle: created on `connection.connect`, destroyed on `connection.disconnect`
- Error handling: SSH connection failure surfaces as clear error ("SSH tunnel failed: [reason]") before attempting MongoDB connection
- Connection profile schema additions:
  ```typescript
  interface SSHConfig {
    enabled: boolean
    host: string
    port: number
    username: string
    authMethod: 'password' | 'privateKey'
    password?: string          // encrypted via safeStorage
    privateKeyPath?: string
    passphrase?: string        // encrypted via safeStorage
  }
  ```

### 2.2 SSL/TLS Certificate UI

**Location**: Connection dialog — new "TLS" tab/section.

**UI**:
- Toggle: "Use TLS/SSL"
- When enabled:
  - CA Certificate: file picker (`.pem`, `.crt`) + clear button
  - Client Certificate: file picker + clear button
  - Client Private Key: file picker + clear button
  - Private Key Passphrase: password input
  - Checkbox: "Allow invalid hostnames"
  - Checkbox: "Allow invalid certificates" (warning icon: "Only for self-signed certs in development")
  - SNI Hostname: text input (optional, advanced)
  - "Verify Certificates" button — validates cert files are readable and valid

**Backend**:
- Map to MongoDB driver `MongoClientOptions`:
  - `tls: true`
  - `tlsCAFile` → CA cert path
  - `tlsCertificateKeyFile` → client cert path
  - `tlsCertificateKeyFilePassword` → passphrase
  - `tlsAllowInvalidHostnames`
  - `tlsAllowInvalidCertificates`
- Connection profile schema additions:
  ```typescript
  interface TLSConfig {
    enabled: boolean
    caFile?: string
    certificateKeyFile?: string
    certificateKeyFilePassword?: string  // encrypted
    allowInvalidHostnames: boolean
    allowInvalidCertificates: boolean
    sniHostname?: string
  }
  ```

### 2.3 Connection Folders

**Location**: Sidebar connection list.

**UI**:
- Right-click sidebar background → "New Folder" (name input)
- Drag connections into/out of folders
- Drag folders to reorder
- Folder context menu: Rename, Delete (moves connections to root, does NOT delete them)
- Folders render as collapsible groups above ungrouped connections
- Visual: folder icon + name + connection count badge

**Backend**:
- New data in `connections.json`:
  ```typescript
  interface ConnectionFolder {
    id: string
    name: string
    order: number
  }
  ```
- Connection profile gets optional `folderId: string` field
- Explorer store updated to group connections by folder

### 2.4 Query Profiler

**Location**: Database context menu → "Query Profiler" (opens as a new tab type).

**UI**:

- **Controls Bar**:
  - Profiling level dropdown: Off (0) / Slow Operations Only (1) / All Operations (2)
  - Slow operation threshold input (ms, default 100) — only shown when level = 1
  - "Apply" button to set profiling level
  - Current status indicator: "Profiling: OFF / SLOW > 100ms / ALL"

- **Results Table** (AG Grid):
  - Columns: Timestamp, Operation (find/aggregate/update/etc.), Namespace (db.collection), Duration (ms), Plan Summary (IXSCAN/COLLSCAN), Docs Examined, Keys Examined
  - Default sort: duration descending (slowest first)
  - Color coding: red for COLLSCAN, orange for slow (>threshold), green for fast indexed
  - Auto-refresh toggle with interval selector (5s / 10s / 30s / off)
  - "Clear Profile Data" button (drops and recreates `system.profile`)

- **Row Actions**:
  - Click row → expand to show full profile document as formatted JSON
  - "Explain This Query" button → reconstructs the query and opens Visual Explain
  - "Copy Query" button → copies the captured query to clipboard
  - "Open in Collection Tab" → opens the relevant collection with the captured query pre-filled

**Backend**:
- New tRPC routes:
  - `admin.setProfilingLevel`: wraps `db.command({ profile: level, slowms: threshold })`
  - `admin.getProfilingStatus`: wraps `db.command({ profile: -1 })`
  - `admin.getProfilingData`: queries `system.profile` with sort, limit, optional namespace filter
  - `admin.clearProfilingData`: drops `system.profile` collection (re-created automatically by MongoDB)
- New MCP tool: `mongo_query_profiler` — read profiling data, set profiling level

### 2.5 Query Code Generation

**Location**: Button in query builder toolbar ("</> Code") and aggregation editor ("Generate Code").

**UI**:
- Modal with:
  - Language tabs: JavaScript (Node.js) | Python | Java | C# | PHP | Ruby
  - Monaco editor (read-only) showing generated code with per-language syntax highlighting
  - "Copy to Clipboard" button
  - "Download as File" button (e.g., `query.js`, `query.py`)
  - Toggle: "Include connection boilerplate" (adds connection setup code) vs. "Query only"

**Supported Inputs**:
- Find queries: filter, projection, sort, skip, limit
- Aggregation pipelines: full pipeline array
- Connection info: host, database, collection names for boilerplate

**Backend**:
- New module `src/main/services/queryCodegen.ts`
- Template-based generation per language:
  ```typescript
  interface CodegenInput {
    type: 'find' | 'aggregate'
    database: string
    collection: string
    // For find:
    filter?: object
    projection?: object
    sort?: object
    skip?: number
    limit?: number
    // For aggregate:
    pipeline?: object[]
    // Options:
    includeBoilerplate: boolean
  }

  function generateCode(input: CodegenInput, language: Language): string
  ```
- Each language module exports `generateFind()` and `generateAggregate()` using template literals
- Generated code uses each language's official MongoDB driver API:
  - JavaScript: `mongodb` (Node.js driver)
  - Python: `pymongo`
  - Java: `com.mongodb.client`
  - C#: `MongoDB.Driver`
  - PHP: `MongoDB\Client`
  - Ruby: `Mongo::Client`
- No external dependencies — pure string template interpolation with JSON serialization per language's conventions

---

## Phase 3 — Monitor & Admin

Server health, user management, and schema tooling.

### 3.1 Server Status Charts

**Location**: Connection context menu → "Server Status" (opens as a new tab type). Also accessible from top bar when connected.

**UI**:
- Dashboard layout with 6-8 chart cards in a responsive grid (2-3 columns):
  - **Operations/sec**: line chart showing insert/query/update/delete/getmore/command rates
  - **Connections**: line chart showing current/available/total created
  - **Network I/O**: line chart showing bytes in/out per second
  - **Memory**: area chart showing resident/virtual/mapped memory
  - **Document Operations**: line chart showing returned/inserted/updated/deleted per sec
  - **Page Faults**: line chart for page fault rate
  - **Cursors**: open/timed-out cursor counts
  - **Queue Lengths**: readers/writers queue (for WiredTiger)
- Auto-refresh interval selector: 1s / 2s / 5s / 10s (default 2s)
- Time window selector: last 1min / 5min / 15min / 1hr
- Each chart card: title, current value, sparkline or full chart, min/max over window
- Pause/resume button

**Charting**: Use `recharts` (React-native, lightweight, composable, good for real-time data).

**Backend**:
- New tRPC route `admin.serverStatus`: wraps `db.admin().serverStatus()`
- Renderer polls at configured interval, stores data points in local state (ring buffer capped at time window)
- Computed metrics: deltas between successive `serverStatus` calls for rate calculations (ops/sec, bytes/sec)
- Data stays in memory (no persistence needed — ephemeral monitoring)
- New MCP tool: `mongo_server_status` — returns current server metrics

### 3.2 User Management

**Location**: Database context menu → "Manage Users" or connection-level → "Manage Users" (for admin database).

**UI**:
- **User List**: table showing username, database, roles, auth mechanisms
- **Create User Dialog**:
  - Username, password (with strength indicator), confirm password
  - Database selector (where user is created)
  - Role assignment: multi-select from built-in roles (`read`, `readWrite`, `dbAdmin`, `dbOwner`, `userAdmin`, `clusterAdmin`, `root`, etc.) + custom roles
  - Per-database role scoping
- **Edit User**: modify roles, change password
- **Delete User**: with confirmation dialog
- **Refresh**: re-fetch user list

**Backend**:
- New tRPC routes:
  - `admin.listUsers`: wraps `db.command({ usersInfo: 1 })`
  - `admin.createUser`: wraps `db.command({ createUser: ... })`
  - `admin.updateUser`: wraps `db.command({ updateUser: ... })`
  - `admin.dropUser`: wraps `db.command({ dropUser: ... })`
  - `admin.listRoles`: wraps `db.command({ rolesInfo: 1, showBuiltinRoles: true })`
- Safety: operations blocked in read-only mode. Confirmation required for delete.
- New MCP tools: `mongo_list_users`, `mongo_create_user`, `mongo_drop_user`

### 3.3 Role Management

**Location**: Adjacent to User Management — tab within the same management view.

**UI**:
- **Role List**: table showing role name, database, privileges count, inherited roles
- **Create Role Dialog**:
  - Role name, database
  - Privileges: resource (database + collection) + actions multi-select (find, insert, update, remove, createIndex, etc.)
  - Inherited roles: multi-select from existing roles
- **Edit Role**: modify privileges and inherited roles
- **Delete Role**: with confirmation

**Backend**:
- New tRPC routes:
  - `admin.createRole`: wraps `db.command({ createRole: ... })`
  - `admin.updateRole`: wraps `db.command({ updateRole: ... })`
  - `admin.dropRole`: wraps `db.command({ dropRole: ... })`

### 3.4 Schema Validation Editor

**Location**: Collection context menu → "Schema Validation" or collection tab → "Validation" tab.

**UI**:
- Monaco editor for JSON Schema definition
- Validation level selector: Off / Strict / Moderate
- Validation action selector: Error (reject) / Warn (allow but log)
- "Validate Schema" button — checks that the JSON Schema itself is valid
- "Apply" button — saves validation rules to collection
- "Generate from Sample" button — uses schema inference to auto-generate a starting JSON Schema from sampled documents
- "Test Document" button — paste a document and check if it passes validation

**Backend**:
- New tRPC routes:
  - `admin.getValidationRules`: reads collection options (`listCollections` with name filter, extract `options.validator`)
  - `admin.setValidationRules`: wraps `db.command({ collMod: collection, validator: schema, validationLevel, validationAction })`
- Utility: `schemaToJsonSchema(inferredSchema)` — converts the existing schema inference output to a JSON Schema draft
- New MCP tool: `mongo_schema_validation` — get/set validation rules

### 3.5 MongoDB Views Creation

**Location**: Database context menu → "Create View" and collection context menu → "Create View from Collection".

**UI**:
- **Create View Dialog**:
  - View name input
  - Source collection selector (dropdown)
  - Aggregation pipeline editor (reuse Aggregation Editor component from Phase 1)
  - "Preview" button — runs the pipeline and shows sample results
  - "Create" button
- Views appear in the sidebar collection tree with a distinct icon (eye icon or similar)
- Views are queryable through the normal collection tab (read-only)
- View metadata visible in collection stats (source collection, pipeline)

**Backend**:
- New tRPC route `admin.createView`: wraps `db.createCollection(name, { viewOn, pipeline })`
- Views already appear in `listCollections` — just need the creation UI
- Edit view: drop and recreate (MongoDB doesn't support `ALTER VIEW`)
- MCP tool: `mongo_create_view`

### 3.6 Customizable Keyboard Shortcuts

**Location**: Settings → "Keyboard Shortcuts" tab.

**UI**:
- Two-column table: Action name | Shortcut(s)
- Actions: all major app actions (Run Query, New Tab, Close Tab, Switch View, Toggle Claude Panel, Search, Navigate to Collection, etc.)
- Click a shortcut cell → "Press new shortcut" capture mode
- "Reset to Defaults" button per action and globally
- Conflict detection: warns if a shortcut is already bound to another action

**Backend**:
- New file `~/.mango/keybindings.json` storing overrides
- Default keybindings defined in `src/shared/constants.ts`
- Hook into Electron's `globalShortcut` and React's keyboard event system
- Settings store updated to manage keybinding state

---

## Phase 4 — Data Operations

Comparing, transforming, masking, and managing data.

### 4.1 Data Compare & Sync

**Location**: Top menu or tools menu → "Compare Collections" (opens as a new tab type).

**UI**:

- **Setup Panel**:
  - Source: connection selector → database → collection (or query filter for subset)
  - Target: connection selector → database → collection (or query filter)
  - Match key: `_id` (default) or custom field(s) for document matching
  - "Compare" button

- **Results View**:
  - **Summary Bar**: total documents analyzed, identical count, different count, source-only count, target-only count, comparison duration
  - **Results Table** (AG Grid):
    - Each row is a document pair (matched by key)
    - Status column: color-coded badge (gray=identical, yellow=different, green=source-only, red=target-only)
    - Key column: matched `_id` or custom key value
    - Filter buttons: show All / Different Only / Source Only / Target Only
  - **Document Diff Panel** (below table, shown on row select):
    - Side-by-side JSON diff view (source left, target right)
    - Field-level highlighting: green (added), red (removed), yellow (changed)
    - Per-field sync buttons: "→" (copy source field to target), "←" (copy target field to source)
    - Whole-document sync: "Copy to Target" / "Copy to Source" / "Delete from Target" / "Delete from Source"

- **Bulk Sync Actions**:
  - "Sync All Differences → Target": apply all source values to target
  - "Sync All Differences → Source": apply all target values to source
  - Confirmation dialog showing count of documents to be modified
  - Progress tracking for bulk sync operations

- **Export**: "Export Diff as CSV" / "Export Diff as JSON"

**Backend**:
- New module `src/main/actions/compare.ts`:
  - Fetches all documents from source and target (batched, streamed)
  - Builds hash map by match key
  - Computes per-document and per-field diffs
  - Returns structured diff result
- New tRPC routes:
  - `compare.start`: begins comparison, returns operation ID
  - `compare.getResults`: fetches comparison results (paginated)
  - `compare.syncDocument`: syncs a single document (source→target or target→source)
  - `compare.syncField`: syncs a single field value
  - `compare.syncAll`: bulk sync operation with progress
  - `compare.cancel`: cancel in-progress comparison
- Comparison runs in a worker process (like existing migration) to avoid blocking UI
- Progress events streamed via IPC
- New MCP tool: `mongo_compare_collections` — run comparison and return summary

### 4.2 Reschema (Schema Transformation)

**Location**: Collection context menu → "Reschema" or tools menu → "Reschema" (opens as a new tab type).

**UI**:

- **Source Panel** (left): tree view of current schema (from schema inference), showing all fields with types
- **Target Panel** (right): editable tree view of the desired schema
- **Transformation Actions** (toolbar between panels):
  - **Rename Field**: select field, enter new name
  - **Move Field**: drag field to new location in target tree (including nesting/unnesting)
  - **Embed**: select multiple flat fields → combine into a nested document
  - **Flatten**: select a nested document → promote its fields to parent level
  - **Delete Field**: remove field from target schema (applies `$unset`)
  - **Add Field**: add a new computed or constant field
  - **Change Type**: convert field type (string→number, string→date, etc.)
- **Preview**: shows sample documents before/after transformation
- **Execution**:
  - Target: "Write to same collection" (in-place) or "Write to new collection" (name input)
  - "Execute" button with confirmation showing transformation summary
  - Progress tracking for large collections

**Backend**:
- New module `src/main/actions/reschema.ts`:
  - Compiles transformation actions into an aggregation pipeline:
    - Rename → `$project` / `$addFields` + `$unset`
    - Embed → `$addFields` with nested construction + `$unset` originals
    - Flatten → `$addFields` with dot-notation extraction + `$unset` parent
    - Delete → `$unset`
    - Change type → `$addFields` with `$convert` / `$toDate` / `$toInt` etc.
  - For "new collection": appends `$out` stage
  - For "same collection": runs `updateMany` with computed update pipeline per batch
- New tRPC routes:
  - `reschema.preview`: applies transformations to sample documents
  - `reschema.execute`: runs full transformation with progress
  - `reschema.cancel`: cancel in-progress transformation
- Worker process for execution to avoid UI blocking

### 4.3 Data Masking

**Location**: Export dialog → "Data Masking" section. Also available as standalone tool → "Mask Collection".

**UI**:
- **Field Rules Table**:
  - Add rules by selecting fields from schema inference
  - Per-field masking method:
    - **Redact**: replace with `[REDACTED]` or custom string
    - **Mask**: preserve format but replace characters (e.g., `john@email.com` → `j***@e****.com`)
    - **Pseudonymize**: replace with deterministic fake data (consistent across runs for same input)
    - **Randomize**: replace with random data of same type
    - **Hash**: SHA-256 hash of original value
    - **Nullify**: set to null
  - Preview column: shows sample original → masked value
- **Integration Points**:
  - Export dialog: toggle "Apply data masking" → shows field rules editor
  - Standalone: select source collection → configure rules → write to new collection or export
- **Execution**: progress bar, batch processing, log of fields masked per document count

**Backend**:
- New module `src/main/services/dataMasking.ts`:
  - Masking functions per method type
  - Processes documents in batches, applies masking rules per field
  - For pseudonymization: uses seeded PRNG or HMAC for deterministic output
- Integrated into existing export pipeline (additional transform step)
- New tRPC route `dataMasking.maskCollection`: standalone masking operation

### 4.4 GridFS Viewer

**Location**: Database context menu → "GridFS Buckets" (opens as a new tab type). Auto-detected when `*.files` and `*.chunks` collections exist.

**UI**:
- **Bucket Selector**: dropdown of detected GridFS buckets (default: `fs`)
- **File List** (AG Grid):
  - Columns: Filename, Size, Upload Date, Content Type, MD5, Metadata
  - Sortable, filterable
  - Multi-select for bulk operations
- **Actions**:
  - "Upload File" button → native file dialog, uploads via GridFS API
  - "Download File" → saves to local filesystem via native save dialog
  - "Delete File" → confirmation, deletes from `files` + `chunks`
  - "View Metadata" → shows file document in JSON editor
  - "Edit Metadata" → edit custom metadata fields
- **Preview**: for image files (jpg, png, gif, svg), show inline thumbnail/preview

**Backend**:
- New module `src/main/actions/gridfs.ts`:
  - Uses MongoDB driver's `GridFSBucket` API
  - `listFiles`: queries `*.files` collection
  - `uploadFile`: streams file from disk into GridFS
  - `downloadFile`: streams from GridFS to disk
  - `deleteFile`: deletes from both `*.files` and `*.chunks`
- New tRPC routes: `gridfs.listBuckets`, `gridfs.listFiles`, `gridfs.uploadFile`, `gridfs.downloadFile`, `gridfs.deleteFile`, `gridfs.getMetadata`, `gridfs.updateMetadata`
- New MCP tools: `mongo_gridfs_list`, `mongo_gridfs_upload`, `mongo_gridfs_download`

### 4.5 Export to Excel

**Location**: Existing export dialog — add "Excel (.xlsx)" to format selector.

**Backend**:
- Dependency: `exceljs` npm package
- Extends existing export pipeline:
  - Serialize documents to rows (flatten nested objects with dot-notation headers)
  - Write to `.xlsx` file with proper column types (dates, numbers, strings)
  - Optional: auto-width columns, header row styling
- No new UI beyond the format option in the existing export dialog

---

## Phase 5 — Enterprise & Collaboration

Advanced auth, automation, and team features.

### 5.1 Advanced Authentication Methods

**Location**: Connection dialog — extend existing authentication section.

**Supported Methods**:
- **X.509 Certificate**: select client certificate, specify X.509 user field
- **Kerberos (GSSAPI)**: service name, principal, canonicalize hostname toggle. Requires `kerberos` npm optional dependency.
- **LDAP (PLAIN)**: username + password sent as PLAIN SASL mechanism
- **AWS IAM**: AWS access key + secret key + session token (or auto-detect from environment)
- **OIDC**: OAuth 2.0 device code flow or authorization code flow, redirect URI handling

**UI per method**:
- Auth method dropdown with all options
- Dynamic form fields that change based on selected method
- "Test Authentication" button

**Backend**:
- Map each auth method to MongoDB driver's `authMechanism` + `authMechanismProperties`:
  - X.509: `authMechanism: 'MONGODB-X509'`
  - Kerberos: `authMechanism: 'GSSAPI'`, `authMechanismProperties: { SERVICE_NAME, CANONICALIZE_HOST_NAME }`
  - LDAP: `authMechanism: 'PLAIN'`
  - AWS: `authMechanism: 'MONGODB-AWS'`, credentials in `authMechanismProperties`
  - OIDC: `authMechanism: 'MONGODB-OIDC'`, callback-based flow
- Optional dependencies: `kerberos`, `mongodb-client-encryption` for OIDC
- Connection profile schema extended with `authMechanism` and `authProperties` fields

### 5.2 Task Scheduler

**Location**: Tools menu → "Task Scheduler" (opens as a new tab type).

**UI**:
- **Task List**: table showing task name, type, schedule, last run, next run, status (enabled/disabled)
- **Create Task Dialog**:
  - Task name
  - Task type: Export Collection, Export Database, Import, Data Masking, Reschema, Data Compare & Sync
  - Task configuration (reuses existing dialogs for each type, minus the "Execute" step)
  - Schedule configuration:
    - Recurrence: Daily / Weekly / Monthly / Custom cron expression
    - Time of day
    - Days of week (for weekly)
    - Day of month (for monthly)
  - Output configuration: file path with date placeholders (`{YYYY}`, `{MM}`, `{DD}`, `{HH}`, `{mm}`)
  - Enable/disable toggle
- **Task History**: expandable row showing past executions with status, duration, output file
- **Run Now**: manually trigger a scheduled task

**Backend**:
- New module `src/main/services/taskScheduler.ts`:
  - Uses `node-cron` for scheduling within the Electron process
  - Tasks stored in `~/.mango/scheduledTasks.json`
  - Each task references a saved configuration (connection, database, collection, operation params)
  - On trigger: spawns worker process (reuses existing export/import/reschema workers)
  - Logs execution results to `~/.mango/taskHistory.json`
- Tasks only run while Mango is open (same as Studio 3T)
- New tRPC routes: `scheduler.listTasks`, `scheduler.createTask`, `scheduler.updateTask`, `scheduler.deleteTask`, `scheduler.runNow`, `scheduler.getHistory`

### 5.3 Team Sharing

**Location**: New "Shared" section in sidebar, or toggle between "My Connections" and "Shared".

**Architecture Options**:

Since Mango is a desktop app without a central server, team sharing needs a sync mechanism:
- **Option A — File-based sharing**: Shared folder (network drive, Dropbox, OneDrive, Git repo) where team members point Mango to a shared `connections.json` and `queries/` folder. Simplest, no infrastructure needed.
- **Option B — Git-based sharing**: Built-in Git sync for shared connections and queries. Each team member clones a shared repo; Mango reads/writes to it. Slightly more complex but better conflict resolution.

**Recommended: Option A** (file-based sharing for v1, most practical).

**UI**:
- Settings → "Team Sharing":
  - "Shared Resources Folder" file picker — point to a folder accessible by team members
  - What to share: checkboxes for Connections / Saved Queries / Aggregation Pipelines
- Sidebar shows "Shared" section with connections/queries from the shared folder
- Shared items are read/write — changes saved back to the shared folder
- Conflict detection: if a file was modified since last read, show "conflict" and let user pick version

**Backend**:
- Reads/writes JSON files from the configured shared folder path
- File watcher (`chokidar` or Node `fs.watch`) for live updates when teammates save changes
- Shared connections stored separately from personal connections (no mixing)
- Encryption challenge: shared connections can't use Electron's safeStorage (machine-specific). Options:
  - Store shared connections without passwords (prompt on connect)
  - Use a shared encryption key (configured per team)
  - Store passwords locally, only share connection metadata

---

## Phase Summary

| Phase | Features | Theme |
|-------|----------|-------|
| **1** | Visual Aggregation Editor, Tree View, Visual Explain, Value Search | Query Power Tools |
| **2** | SSH Tunnels, SSL/TLS UI, Connection Folders, Query Profiler, Query Code Gen | Connect Anywhere + Profiling |
| **3** | Server Status Charts, User/Role Management, Schema Validation, MongoDB Views, Keyboard Shortcuts | Monitor & Admin |
| **4** | Data Compare & Sync, Reschema, Data Masking, GridFS, Export to Excel | Data Operations |
| **5** | Advanced Auth (X.509/Kerberos/LDAP/AWS/OIDC), Task Scheduler, Team Sharing | Enterprise & Collaboration |

## Dependencies & Libraries

New dependencies required across all phases:

| Package | Purpose | Phase |
|---------|---------|-------|
| `ssh2` | SSH tunnel connections | 2 |
| `recharts` | Server status charts | 3 |
| `react-arborist` | Tree view component | 1 |
| `reactflow` | Visual explain diagrams | 1 |
| `exceljs` | Excel export | 4 |
| `node-cron` | Task scheduler | 5 |
| `chokidar` | File watching for team sharing | 5 |
| `kerberos` (optional) | Kerberos auth | 5 |
| `dnd-kit` | Drag-and-drop (aggregation stages, reschema) | 1 |

## MCP Tool Additions

New tools to add to the MCP server (extending the current 26):

| Tool | Phase |
|------|-------|
| `mongo_aggregate_preview` | 1 |
| `mongo_value_search` | 1 |
| `mongo_query_profiler` | 2 |
| `mongo_server_status` | 3 |
| `mongo_list_users` | 3 |
| `mongo_create_user` | 3 |
| `mongo_drop_user` | 3 |
| `mongo_schema_validation` | 3 |
| `mongo_create_view` | 3 |
| `mongo_compare_collections` | 4 |
| `mongo_gridfs_list` | 4 |
| `mongo_gridfs_upload` | 4 |
| `mongo_gridfs_download` | 4 |

Total after all phases: ~39 MCP tools.

## Cross-Cutting Concerns

**Read-Only Mode**: All new write operations must respect the existing `isReadOnly` connection flag. New features that write (Reschema, Data Sync, User Management, Schema Validation) must check `checkWriteAccess()`.

**Production Safety**: Destructive operations in new features (drop user, sync data, reschema in-place) must respect the `isProduction` flag and use the existing `ConfirmDestructiveDialog` pattern.

**Claude Access**: New MCP tools must check `claudeAccess` permissions. Write-capable tools (create user, schema validation, data sync) follow existing `checkWriteAccess` pattern from `tools.ts`.

**Changelog**: New mutation operations (data sync, reschema, user management) should log to the existing changelog for audit trail and rollback where applicable.

**Error Handling**: Follow existing patterns — surface errors as toast notifications in renderer, structured error responses in tRPC, and clear error messages in MCP tool responses.
