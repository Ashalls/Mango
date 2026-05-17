# Mango — Remaining work (post `security-and-features-pass`)

Status as of branch `security-and-features-pass`:

**Shipped on this branch (12 items):**
- A: Dependabot config (`.github/dependabot.yml`)
- Security audit + feature audit baseline docs
- B (9 items): C2 MCP token + Origin gate, H6 valueSearch regex guard, H7 sandbox + will-navigate + will-attach-webview, H8 strict CSP via onHeadersReceived, H9 react-markdown raw-HTML verified safe, L1 GitHub release zod-parsed + SHA256 verified, L3 jittered auto-update polling, M2 splash setStatus escaping, M5 codebaseContext realpath + secret deny-list
- C (5 items): H3 mongosh launcher rewritten with argv spawn, H4 worker tempfiles in userData with random suffix + URI via env, M1 mongo tool URI via --config file, M7 import regex deserializer bounded, M8 worker SIGTERM with SIGKILL fallback
- G (C1 scaffolding): electron-builder.yml signing+notarization config, entitlements.mac.plist, release workflow with secret-driven signing, SHA256SUMS published, docs/RELEASING.md
- Feature 19: claude.recommendIndexes tRPC procedure + "Recommend with Claude" button in IndexPanel
- Feature 23: claude.interpretExplain tRPC procedure + "Explain with Claude" button in VisualExplain
- Feature 4: ValidationPanel with getValidator/setValidator/validateSample + Validation sub-tab in MainPanel

**Six pre-existing typecheck failures on `main` fixed as collateral** (mongo IndexSpecification, CollectionInfo.options, exportImport narrowing, query.sort, claude.ts result narrowing + fullText scope, ChatSession export).

---

## Security items still to do (11)

### H1 — Optional master password protecting connection store

**Why:** `safeStorage` is reversible by any process running as the same OS user. Studio 3T / Compass both offer a master-password option.

**Files:**
- New: `src/main/services/masterPassword.ts`
- Modify: `src/main/services/config.ts` to wrap encrypt/decrypt with the master key when set
- Modify: tRPC `settings` router to add `setMasterPassword`, `unlockMasterPassword`, `removeMasterPassword`, `isMasterPasswordSet`
- New renderer: `src/renderer/src/components/settings/MasterPasswordDialog.tsx`

**Design:**
- KDF: `crypto.scrypt` with N=2^17, r=8, p=1, dklen=32 (Argon2id would be better but is not in Node stdlib; scrypt is the next safest stdlib KDF). Salt: 16 random bytes, stored alongside ciphertext.
- Cipher: AES-256-GCM, 12-byte nonce, ciphertext+tag stored as `{salt,nonce,ct}` base64-encoded.
- The master key wraps a per-launch random data key that's used to decrypt the existing `safeStorage`-encrypted blob — i.e. the master password is an *additional* layer, not a replacement.
- File layout in `~/.mango/connections.json`: when master password is set, top-level wrapper is `{ "mango": { "v": 1, "kdf": {salt, n, r, p}, "wrappedKey": { "nonce", "ct" }, "data": "<existing encrypted-blob array, in cleartext after this layer>" } }`.
- Unlocking: prompt once per session; cache the data key in memory. App restart re-prompts.
- Add a "skip / use OS keychain only" path so existing users aren't forced to set one.

**Estimated effort:** 1 session.

### Batch D — Claude destructive-tool confirmation (C3)

**Why:** Prompt injection in document content can chain into destructive writes.

**Files:**
- Modify: `src/main/mcp/tools.ts`
- New: `src/main/services/confirmationBridge.ts`
- Modify: `src/main/index.ts` (register IPC handler)
- New renderer: `src/renderer/src/components/claude/ConfirmDestructiveDialog.tsx`

**Design:**
- Wrap `mongo_delete_many`, `mongo_drop_index`, `mongo_rename_collection`, `mongo_delete_one` with broad filter (no `_id` in filter), and any future drop/rename tools, with a confirmation gate.
- `confirmationBridge.awaitUserConfirm(toolName, args)` returns `Promise<{ approved: boolean; remember?: 'session' | 'never' }>`. It posts an IPC event to renderer → renders a modal → renderer posts back via `ipcMain.handle('claude:confirm:response', ...)`.
- Rate-limit: refuse `mongo_delete_many({})` outright. Cap deletes per session (e.g. 10).
- Session memory: if user picks "remember for session", store `{tool, args-hash}` in a Set so re-runs of the same call don't re-prompt.

**Estimated effort:** half session.

### Batch E — Consolidate write-access check (H5) + expand audit log

**Why:** Today the access check lives in `mcp/tools.ts` only. The tRPC mutation router uses a separate `checkReadOnly`. Two checks means drift risk; only one source logs to changelog.

**Files:**
- New: `src/main/services/accessControl.ts` exporting `assertWriteAllowed(connectionId, database, opts: { source: 'user'|'claude'|'import' }): { ok: true } | { ok: false; reason: string }`.
- Modify: `src/main/mcp/tools.ts` to call shared helper.
- Modify: `src/main/trpc/routers/mutation.ts`, `routers/exportImport.ts`, `routers/admin.ts` to call the same helper.
- Modify: `src/main/services/changelog.ts` to accept the `source` discriminator. Extend the changelog UI in renderer to filter by source.

**Estimated effort:** half session.

### Batch F — TLS / SSH warning gates (M3, M4)

**Why:** `tlsAllowInvalidHostnames`/`tlsAllowInvalidCertificates` and a world-readable SSH key file are accepted silently. Should require an explicit "I know" toggle.

**Files:**
- Modify: `src/renderer/src/components/explorer/TLSForm.tsx`, `SSHForm.tsx` — add a warning banner when invalid-cert flags are toggled on or when the chosen key file fails a strict-mode check.
- Modify: `src/main/services/sshTunnel.ts` to warn (not block) when private key file has loose POSIX permissions, mirroring OpenSSH's `StrictModes`.
- Persist a `tlsAcknowledgedAt` timestamp on the connection profile when the user accepts the warning.

**Estimated effort:** half session.

---

## Feature items still to do (21)

For each: the path I'd take, the files to touch, and the rough effort. Items already broken out in the original `feature-audit.md` — this file adds concrete implementation hooks.

### F1 — Schema explorer with field stats

**Files:**
- Server: `src/main/actions/explorer.ts` — extend `collectionSchema` (or add `collectionSchemaStats`) to compute per-field presence %, type breakdown, min/max/quantile for numerics, top-N values for low-cardinality strings, and type-mismatch outlier flag (`isMixedType` when >1 type present).
- Router: `src/main/trpc/routers/explorer.ts` — `schemaStats` query.
- Renderer: new `src/renderer/src/components/schema/SchemaPanel.tsx`. Add a "Schema" sub-tab in `MainPanel.tsx` (the file already has the sub-tab pattern — add it next to Indexes/Validation).
- Charts: add `recharts` dependency (`pnpm add recharts`); use BarChart for type breakdown and Histogram (BarChart with custom bins) for numeric distribution.

**Effort:** 1 session.

### F2 — SQL → MongoDB translator

**Files:**
- Router: extend `src/main/trpc/routers/claude.ts` with `translateSql({ sql, database, collection })`. Prompt instructs Claude to return ONLY a JSON pipeline (no prose).
- Renderer: new `src/renderer/src/components/aggregation/SqlInputCard.tsx`. SQL textarea + "Translate" button. On result, parse the streaming response, extract the first ` ```json ... ``` ` block, parse, and call `tabStore.setAggregationPipeline(pipeline)`.
- Tab store: confirm there's already a setter — there's an `AggregationEditor` so the state plumbing exists.

**Effort:** half session.

### F3 — Collection compare / diff

**Files:**
- Worker: new `src/main/actions/compare.ts` modelled after `actions/migration.ts`. fork() a worker that iterates two collections by `_id`, classifies each into `onlyA / onlyB / different`, and emits a sample diff for the first N "different" docs.
- Router: new `src/main/trpc/routers/compare.ts` with `start`, `cancel`, `getProgress`.
- Renderer: new `src/renderer/src/components/compare/CompareDialog.tsx` (two connection+db+collection pickers, run button) + `CompareResultsPanel.tsx` (three columns, expandable diffs).
- Tab integration: a new tab type `compare` with its own `compareId`.

**Effort:** 1–1.5 sessions.

### F5 — Charts on aggregation results

**Files:**
- Dependency: `recharts` (shared with F1).
- Renderer: new `src/renderer/src/components/aggregation/ResultsChart.tsx`. Inspect aggregation result rows, detect numeric vs categorical fields, present axis selectors. Bar/Line/Pie selectable.
- Wire into `AggregationEditor.tsx` — add a "Chart" toggle alongside "Documents".

**Effort:** half session. Pairs with F1.

### F6 — Real-time cluster metrics

**Files:**
- Server: new `src/main/actions/serverStatus.ts` calling `db.command({ serverStatus: 1 })`. Filter to opcounters, network.bytesIn/Out, connections, globalLock.activeClients, opLatencies.
- Router: new `src/main/trpc/routers/perf.ts` with a polling-friendly `snapshot` query.
- Renderer: new `src/renderer/src/components/perf/PerformancePanel.tsx`. Sparklines using recharts. New "Performance" tab at the connection level (similar to how `__profiler__` is handled).
- Add to TreeView context menu: "Show performance".

**Effort:** 1 session.

### F7 — Replica/shard topology view

**Files:**
- Server: `src/main/actions/topology.ts` — `db.admin().command({ replSetGetStatus: 1 })` and `db.admin().command({ listShards: 1 })`. Tolerate "not authorized" / "not a replica set" gracefully.
- Router: `topology` router.
- Renderer: new `src/renderer/src/components/topology/TopologyPanel.tsx`. `@xyflow/react` is already a dep — draw nodes as a star (primary in centre, secondaries around it) with lag labels.

**Effort:** half-1 session.

### F8 — In-app mongosh terminal (node-pty + xterm.js)

**Blocker:** `node-pty` is a native dep. On a path with spaces (current dev env), node-gyp fails. Pre-requisite: either move the repo out of the `Git Repos` folder or set `npm_config_cache` / use a junction.

**Files:**
- Dependency: `pnpm add node-pty xterm xterm-addon-fit`.
- Server: new `src/main/services/ptyHost.ts` — spawn mongosh via node-pty, expose start/write/resize/kill via tRPC subscriptions (electron-trpc subscriptions are documented).
- Renderer: new `src/renderer/src/components/terminal/MongoshTerminal.tsx` using xterm.js, fit-addon, the standard "subscribe to PTY data, write input back" pattern.
- Replace the existing `mongosh.ts` launcher (or keep it as fallback when node-pty isn't available, e.g. when the user is on a path that didn't build).

**Effort:** 1.5–2 sessions, plus environment setup.

### F9 — Saved queries / bookmarks

**Files:**
- Server: `src/main/services/queryHistory.ts` already exists — extend to mark "starred" entries and persist them separately from history (so clearHistory doesn't lose them).
- Router: extend `queryRouter` with `getBookmarks`, `saveBookmark(name, query)`, `deleteBookmark`.
- Renderer: extend `QueryHistoryPanel.tsx` (already exists) with a Bookmarks tab. Star-button on history rows promotes to bookmarks.

**Effort:** half session.

### F10 — Multi-tab querying

**Status:** tabs already exist in `tabStore.ts`. Confirm full coverage and add UX polish (drag-reorder, persistence across reloads, "Duplicate tab", "New tab from current"). Most likely 80% done already.

**Effort:** half session of UX work.

### F11 — In-place document grid editing

**Files:**
- Renderer: enable `editable: true` on AG Grid cells in `DocumentTable.tsx`. On `cellValueChanged`, call `mutationRouter.updateOne({ filter: { _id }, update: { $set: { [field]: newValue } } })`.
- Add type-aware cell editors for ObjectId, Date, numbers — small wrappers around AG Grid's `cellEditorSelector`.
- Pipe failures into a small toast.

**Effort:** half-1 session.

### F12 — Selection-driven bulk update

**Files:**
- Renderer: `BulkToolbar.tsx` already exists. Wire AG Grid's selection model (`onSelectionChanged`) into `tabStore`. When a non-empty selection exists, show "Update selected" / "Delete selected" buttons that pre-populate `UpdateManyDialog.tsx` with `{ _id: { $in: selectedIds } }`.

**Effort:** half session.

### F13 — GridFS browser

**Files:**
- Server: new `src/main/actions/gridfs.ts` using the MongoDB driver's `GridFSBucket`. List, download, upload, delete.
- Router: new `src/main/trpc/routers/gridfs.ts`.
- Renderer: detect `*.files` + `*.chunks` pairs in `DatabaseTree.tsx` and surface a "GridFS bucket" node with its own panel.

**Effort:** 1 session.

### F14 — Data masking on export

**Files:**
- Renderer: extend `ExportDocumentsDialog.tsx` with a "Masking" tab — per-field rules from a dropdown (hash sha256, redact, fake-email, fake-name, fake-uuid).
- Server: extend `serializeDocument` in `src/main/services/serialize.ts` to accept a masking config; hook into the export worker `EXPORT_WORKER_SCRIPT` so the same rules apply to mongodump-style exports.
- Faker: `pnpm add @faker-js/faker`.

**Effort:** 1 session.

### F15 — Atlas integration

**Blocker:** needs an Atlas API public+private key pair (per-user).

**Files:**
- New: `src/main/services/atlas.ts` — HTTP digest auth client for `cloud.mongodb.com/api/atlas/v2`. Methods: `listProjects`, `listClusters(projectId)`, `getConnectionString(projectId, clusterName)`.
- Settings UI: add Atlas API key inputs (stored via `safeStorage` like Mongo URIs).
- TreeView: add an "Atlas" node listing projects → clusters. Right-click "Save as connection" populates the connection dialog.

**Effort:** 1–1.5 sessions.

### F16 — LDAP / Kerberos / x509 auth UI

**Files:**
- Renderer: `ConnectionDialog.tsx` — add a "Mechanism" dropdown (SCRAM-SHA-256, MONGODB-AWS, GSSAPI, PLAIN, MONGODB-X509). Per-mechanism fields:
  - SCRAM: username/password (default — existing).
  - AWS: accessKeyId / secretAccessKey / optional sessionToken.
  - GSSAPI: serviceName (default "mongodb") / principal.
  - PLAIN: username/password.
  - X509: certificate file path.
- Types: extend `ConnectionProfile` with `authMechanism` + per-mechanism fields. Already encrypted at rest by `config.ts` so credentials are protected.
- Driver: pass `authMechanism` + `authMechanismProperties` into `MongoClient` options.

**Effort:** 1 session of UI work.

### F17 — Scheduled tasks / cron exports

**Files:**
- Dependency: `pnpm add node-cron`.
- New: `src/main/services/scheduler.ts` — persists cron entries to `userData/scheduled-tasks.json`, registers them at app boot, runs the same export/import/migration code paths.
- Router: `scheduler` router with CRUD.
- Renderer: new "Scheduled Tasks" panel in settings — cron expression input + recipe picker (export DB X to folder Y; copy collection A to B; etc.).
- Closed-app runs: on Windows, register a Task Scheduler entry that re-launches Mango with `--scheduler-only`. On macOS, write a launchd plist. Initial scope: in-app only.

**Effort:** 1.5–2 sessions.

### F20 — Schema drift detector

**Files:**
- Service: new `src/main/services/schemaDrift.ts` — periodically (e.g. once per hour while app is open) sample 200 docs per active collection, store the field+type fingerprint to `userData/schema-snapshots/<connId>-<db>-<col>.json`. Compare current to last and emit a `schema-drift:detected` IPC event with the diff.
- Renderer: new notifications panel showing recent drifts.
- Integrates with F1 (reuse the schema stats sampler).

**Effort:** 1 session, builds on F1.

### F21 — Natural-language query bar

**Files:**
- Router: extend `claude.ts` with `nlToQuery({ utterance, context })`. Constrained prompt that returns ONLY a JSON `{ filter, sort, projection, limit }` block.
- Renderer: new `src/renderer/src/components/query/NaturalQueryBar.tsx` above the document grid. On submit, parse Claude's first JSON code-block and call `tabStore.setFilter(...)`.

**Effort:** half session, mirrors F2.

### F22 — Conversational ETL

**Files:**
- Renderer: `src/renderer/src/components/migration/MigrationDialog.tsx` (or wherever the migration UI lives) — add an "Ask Claude" button. On click, opens an inline chat panel; Claude proposes a pipeline using `mongo_aggregate_preview`, shows results, user confirms.
- Server: no new tools needed — Claude already has `mongo_aggregate`, `mongo_aggregate_preview`, `mongo_update_many`, `mongo_insert_many`, all gated by the existing write-access check.

**Effort:** 1 session.

### F24 — Smart data fixer

**Files:**
- Renderer: add a "Fix outliers with Claude" button to the Schema Explorer (F1) panel. Sends the type-mismatch list to Claude with a prompt: "Propose bulk updates that normalize these. Use mongo_update_many with a preview-first flow."
- Pure UI + prompt; no new server logic.

**Effort:** half session, depends on F1.

---

## Cross-cutting issues to address

### Renderer typecheck (tRPC v10 reserved-word collision)

`src/main/trpc/router.ts` exports a router with `query: queryRouter` and `mutation: mutationRouter` as top-level keys. tRPC v10 reserves `query` and `mutation` as built-in method names, which collapses the inferred renderer type to a string error.

**Fix:** rename the router keys (e.g. `queries`, `mutations` or `find`, `mutate`). Then update 22 occurrences across 14 renderer files. Mechanical sed-style rename. Half session.

### `cpu-features` native build fails on path-with-spaces

Pre-existing dev-environment issue from `ssh2 → cpu-features → node-gyp`. Workaround: develop from a path without spaces (e.g. `D:\dev\Mango`), or use the `npm_config_cpu_features_skip_compilation=true` env var when supported. Not blocking the shipped builds — `cpu-features` is a JS fallback when the native module is missing.

### Electron 35 → 39 bump (high-severity advisories)

I reverted the Electron major bump after seeing the native-build failure compound with the typecheck baseline. Once the baseline is green and the native-build is sorted, re-attempt:

```
"electron": "^39.8.6"
```

Then verify `pnpm dist:win` and `pnpm dist:mac` produce working artifacts. Electron 35 → 39 is generally low-impact for apps using `contextIsolation: true` (which this app does post-Batch B), but there are minor API changes worth testing.

### Sandbox: true + preload refactor (H7 follow-up)

Batch B set `sandbox: true` initially but reverted because `src/preload/index.ts`
uses `process.once('loaded', ...)` which is unavailable in sandboxed preload
scripts. The other H7 mitigations (will-navigate, will-attach-webview,
webSecurity, allowRunningInsecureContent) are still in place.

To flip sandbox back on:
- Drop the `process.once('loaded', ...)` wrapper around `exposeElectronTRPC()`
  in `src/preload/index.ts` — `contextBridge` + `ipcRenderer` calls work
  unwrapped in sandboxed preload.
- Verify `@electron-toolkit/preload`'s `electronAPI` still works (it uses
  only sandbox-safe Electron APIs, should be fine).
- Set `sandbox: true` in `src/main/index.ts` createWindow.

Effort: <1 hour.

### Bundle Monaco locally (CSP hardening)

Batch B's CSP currently allows `https://cdn.jsdelivr.net` for script-src,
style-src, font-src, and connect-src because `@monaco-editor/react` fetches
the editor's runtime from jsdelivr by default. We should:
- Add `monaco-editor` as a direct dep (or rely on the transitive one).
- Install `vite-plugin-monaco-editor` (or use the loader.config pattern
  with the locally-bundled `monaco-editor`).
- Call `loader.config({ monaco })` at app boot so `@monaco-editor/react`
  uses the bundled copy.
- Drop the `cdn.jsdelivr.net` allowance from the CSP in
  `src/main/index.ts`.

This makes Monaco available offline (currently dev mode + auto-update
both need internet for Monaco to load) and tightens the CSP. Effort:
half session.

### Renderer code-signing publisher

Once you have an EV signing cert, set `nsis.publisherName` in `electron-builder.yml` to the exact Subject CN. Otherwise SmartScreen will treat each new cert as a fresh untrusted publisher.
