# CLAUDE.md

Guidance for working in this repository. Mango is an AI-native desktop MongoDB
client built on Electron.

## Commands

```bash
npm run dev            # electron-vite dev (hot reload, launches the app)
npm run build          # type-check + bundle main/preload/renderer to out/
npm run typecheck      # tsc for both node (main/preload) and web (renderer)
npm run typecheck:node # main + preload only  (tsconfig.node.json)
npm run typecheck:web  # renderer only        (tsconfig.web.json)
npm run dist           # build + electron-builder (current platform)
npm run dist:mac / dist:win
```

There is **no test runner and no linter** configured. `npm run typecheck` is the
only automated gate — run it before finishing any change. Release flow lives in
`release.sh` + `electron-builder.yml`; see `docs/RELEASING.md`.

## Architecture

Standard three-process Electron app under `src/`, bundled by `electron-vite`:

- **`src/main/`** — Node/main process. Owns all MongoDB, SSH, filesystem, and
  Claude access. The renderer has none of these directly.
- **`src/preload/`** — thin contextBridge. Keep it minimal.
- **`src/renderer/src/`** — React 19 + Zustand + Tailwind v4 UI. No Node access.
- **`src/shared/`** — types (`types.ts`) and constants shared across processes.

### Main ↔ renderer communication: tRPC over IPC

All renderer→main calls go through **electron-trpc**, not raw `ipcRenderer`.

- Renderer calls `trpc.<router>.<proc>.query/mutate` via `@renderer/lib/trpc`.
- `src/main/trpc/router.ts` composes one router per domain from
  `src/main/trpc/routers/*` (`connection`, `explorer`, `query`, `mutation`,
  `admin`, `migration`, `exportImport`, `settings`, `claude`, `chatHistory`,
  `mongosh`, `profiler`).
- Routers are thin: validate input with **zod**, then delegate to the business
  logic in **`src/main/actions/*`**. Reusable infrastructure lives in
  **`src/main/services/*`** (mongodb, sshTunnel, serialize, config, claude, …).

Add a new endpoint by: extending an action in `actions/`, exposing it through
the matching router in `trpc/routers/` with a zod input schema, then calling it
from the renderer via the typed `trpc` client.

### MongoDB connections

`services/mongodb.ts` holds a `Map<connectionId, MongoClient>` and supports
**multiple simultaneous connections**. `getDb(name, connectionId?)` resolves the
db; **when `connectionId` is omitted it falls back to a single global
`activeConnectionId`**. Because the app is multi-connection, any query/mutation
that omits `connectionId` can hit the wrong server — always thread the owning
tab's `connectionId` through. (This is audit finding C1; see below.)

### Claude / MCP

`services/claude.ts` drives the `@anthropic-ai/claude-agent-sdk`. Mongo
capabilities are exposed to the model through an MCP server in
`src/main/mcp/*`, token-gated on loopback. Write access is enforced at the MCP
tool layer (read-only / production connection flags block mutations).

### Path aliases

- `@shared` → `src/shared` (main, preload, renderer)
- `@renderer` → `src/renderer/src` (renderer only)

## Critical conventions

### BSON type fidelity — there are TWO serialization paths, don't mix them

`services/serialize.ts` is load-bearing. It has two distinct paths:

1. **Lossy display path** — `serializeDocument` / `serializeDocuments`.
   ObjectId→hex string, Date→ISO string, Decimal128→string, `Long→toNumber()`.
   Used to ship rows to the grid/tree for *display*. Values that survive this
   path have **lost their BSON type** — never write them back to Mongo as-is.
2. **Lossless round-trip path** — `serializeToEJSON` / `reviveExtended` (with
   the shell-source helpers `serializeToShellSource` / `parseShellDocument`).
   Emits/consumes EJSON markers (`$oid`, `$date`, `$numberDecimal`, `$numberLong`,
   `$binary`, `$regex`, …). This is the ONLY path safe for edits, mutations, and
   export/import.

Rule: **any value that will be written back to the database must travel the
lossless path.** Inline edits, filters, dialogs, and export must not send the
lossy display representation to `mutation`/`query` actions. Mutations run
`reviveExtended` on the update body — apply it to **filters** too, or typed
filters silently match nothing.

### Renderer

- **Zustand: subscribe with selectors.** `useTabStore((s) => s.setPage)`, not a
  bare `useTabStore()` — the stores are written on every Claude streaming token
  and every drag pointermove, so no-selector subscriptions cause re-render
  storms. Actions are referentially stable.
- **ag-grid (`DocumentTable.tsx`): memoize `columnDefs`/`rowData`** and keep the
  grid at one stable tree position (don't remount it on layout changes). A rebuilt
  columnDefs identity or a 0-height mount is what makes the table go blank. See
  the "grid disappears until right-click" root cause in `docs/AUDIT-2026-07.md §0`.
- Hooks before early returns; register long-lived IPC listeners once (in
  `App.tsx`), not inside panels that unmount.

### Secrets

Connection URIs and SSH/TLS passwords are persisted to `~/.mango/` encrypted via
Electron `safeStorage`. Do not log secrets or write them in cleartext; when
`safeStorage` is unavailable, refuse rather than silently persisting plaintext.

## Known issues

A full audit lives in **`docs/AUDIT-2026-07.md`** (severity-ranked, with
file:line and fixes). Read it before touching data flow, connections, the grid,
or serialization. Headline unfixed criticals as of this writing:

- **C2** — aggregation `$out`/`$merge` bypasses write guards (incl. the Claude tool).
- **C3** — TreeView pending edits keyed by row index, can save to the wrong doc.
- **C4** — grid inline edits flatten BSON types (lossy path written back).
- **C5** — invalid aggregation JSON throws in render; no top-level ErrorBoundary.
