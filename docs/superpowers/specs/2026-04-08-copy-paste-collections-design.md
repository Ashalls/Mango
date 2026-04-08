# Copy/Paste Collections

**Status:** Approved design
**Date:** 2026-04-08

## Problem

Mango supports copy/paste at the database level: right-click a database, choose "Copy Database", then right-click another database node and "Paste Database Here" to clone it (optionally cross-connection, optionally overwriting). There is no equivalent for individual collections. Users who want to duplicate a single collection — within the same database, across databases, or across connections — must copy the entire parent database or use mongosh.

This spec adds collection-level copy/paste that mirrors the database flow.

## Goals

- Copy a single collection to the clipboard from the collection context menu
- Paste a copied collection into any (non-production, non-read-only) target database, with a rename/overwrite dialog
- Support cross-connection paste, same as database paste
- Reuse the existing per-collection copy worker and progress UI
- Keep production/read-only safety checks consistent with database paste

## Non-Goals

- Copying multiple collections at once (single-item clipboard)
- Copying views (views are tied to a database; they travel with `Copy Database`)
- Pasting onto an existing collection node to overwrite it (the paste dialog already handles name conflicts and overwrite mode — no need to clutter the collection context menu)

## Design

### 1. Clipboard model

The clipboard state in `src/renderer/src/components/layout/Sidebar.tsx` becomes a tagged union:

```ts
type ClipboardItem =
  | { type: 'database'; connectionId: string; database: string }
  | { type: 'collection'; connectionId: string; database: string; collection: string }
```

Single shared clipboard: copying a collection replaces whatever was there (and vice versa). The "Copied: ..." chip at the bottom of the sidebar reads:

- `Copied: mydb` for a database
- `Copied: mydb.users` for a collection

### 2. Context menu wiring

**`DatabaseTree.tsx`** gains three new props that mirror the database ones:

```ts
onCopyCollection?: (dbName: string, colName: string) => void
canPasteCollection?: boolean
onPasteCollection?: (dbName: string) => void
```

**Collection context menu** — add a "Copy Collection" item (Copy icon) in the existing separator block alongside Rename/Drop.

**Database context menu** — when `canPasteCollection && !isProduction && !isReadOnly`, show "Paste Collection Here" below the existing "Paste Database Here". In practice only one clipboard type exists at a time, so typically only one entry renders.

**`Sidebar.tsx`** — new handlers:

- `handleCopyCollection(connectionId, database, collection)` — sets clipboard to `{ type: 'collection', ... }`
- `handlePasteCollection(targetConnectionId, targetDatabase)` — validates production/read-only, opens `pasteCollectionTarget` state `{ connectionId, database }`
- `canPaste` (database) becomes `clipboard?.type === 'database'`
- `canPasteCollection` becomes `clipboard?.type === 'collection'`

### 3. `PasteCollectionDialog` component

New file: `src/renderer/src/components/explorer/PasteCollectionDialog.tsx`

**Props:**

```ts
interface PasteCollectionDialogProps {
  sourceCollection: string        // "users"
  sourceDatabase: string          // "myapp"
  sourceConnection: string        // "Local"
  targetDatabase: string          // "myapp_staging" (the DB that was right-clicked)
  targetConnection: string        // "Staging"
  existingCollections: string[]   // collections in target DB
  isSameLocation: boolean         // same connection AND same db
  onSubmit: (result: PasteCollectionResult) => void
  onCancel: () => void
}

export interface PasteCollectionResult {
  targetCollection: string
  dropTarget: boolean  // true = overwrite
}
```

**Layout** — mirrors `PasteDatabaseDialog` for visual consistency:

- **Header:** "Paste Collection"
- **Subheader:** `myapp.users` (when same connection) or `myapp.users from Local → Staging`
- **Target database chip:** `→ myapp_staging` (read-only, determined by where the user right-clicked)
- **Mode radio 1 — Create new collection:** name input. Default = `users` (cross-db) or `users_copy` (same location). Shows an amber name-conflict warning if the name exists in `existingCollections`, identical to `PasteDatabaseDialog`.
- **Mode radio 2 — Overwrite existing collection:** dropdown of `existingCollections`, pre-selected to `users` if present. Red warning: "This will drop and replace the collection." Disabled entirely when same-location and the only selectable target is the source collection itself.
- **Buttons:** Cancel / "Paste Collection" (default variant) or "Overwrite & Paste" (destructive variant)

**Fetching existing collections:** the paste target database is always under the *active connection* in the current UI (the database tree only renders for the active connection). `Sidebar.tsx` reads collections from `useExplorerStore.collections[${connectionId}:${database}]` synchronously when opening the dialog, loading them via `loadCollections` if not cached, and passes them to the dialog.

### 4. Backend — `copyCollection` action

**New function** in `src/main/actions/migration.ts`:

```ts
export interface CopyCollectionOptions {
  sourceConnectionId: string
  sourceDatabase: string
  sourceCollection: string
  targetConnectionId: string
  targetDatabase: string
  targetCollection: string
  dropTarget?: boolean
}

export async function copyCollection(options: CopyCollectionOptions): Promise<void>
```

**Structure** (mirrors `copyDatabase`):

1. Load connections, resolve source/target profiles
2. Safety checks — reject if target is production or read-only (identical to `copyDatabase`)
3. Resolve source/target URIs
4. Build an `OperationProgress`:
   ```ts
   {
     id: `copy-col-${++opCounter}-${Date.now()}`,
     type: 'copy',
     label: `Copy ${sourceDatabase}.${sourceCollection} → ${targetDatabase}.${targetCollection} on ${targetProfile.name}`,
     status: 'running',
     currentStep: `Copying ${sourceCollection}...`,
     processed: 0,
     total: 1,
     collections: [{ name: sourceCollection, status: 'running', copied: 0, total: 0 }],
     startedAt: Date.now(),
   }
   ```
5. Emit initial `operation:progress`
6. Call `copyCollectionInProcess` — extended to accept separate source and target collection names (see below)
7. After worker completes, emit final `operation:progress` with `status: 'done' | 'error'` and a `migration:complete` event

**Worker script extension** — `COPY_WORKER_SCRIPT` currently expects `{ sourceUri, targetUri, sourceDatabase, targetDatabase, colName, dropTarget }` and uses the same `colName` for both source and target. Extend the config to:

```ts
{ sourceUri, targetUri, sourceDatabase, targetDatabase, sourceColName, targetColName, dropTarget }
```

Inside the worker, read from `sourceDb.collection(sourceColName)` and write to `targetDb.collection(targetColName)`. The TypeScript wrapper `copyCollectionInProcess` also updates its parameter list from `colName: string` to `sourceColName: string, targetColName: string`, and the `copyDatabase` call site is updated to pass the same name twice — preserving identical behaviour for whole-database copies.

**tRPC** — new procedure in `src/main/trpc/routers/migration.ts`:

```ts
copyCollection: procedure
  .input(
    z.object({
      sourceConnectionId: z.string(),
      sourceDatabase: z.string(),
      sourceCollection: z.string(),
      targetConnectionId: z.string(),
      targetDatabase: z.string(),
      targetCollection: z.string(),
      dropTarget: z.boolean().optional(),
    }),
  )
  .mutation(async ({ input }) => {
    migrationActions.copyCollection(input)
    return { started: true }
  })
```

**Progress UI** — no changes. `copyCollection` emits the same `operation:progress` events as `copyDatabase`, so the existing operations panel renders it automatically with a one-collection progress bar.

**Shared types** — add `CopyCollectionOptions` to `src/shared/types.ts` alongside `CopyDatabaseOptions`.

## Error handling & edge cases

- **Target DB does not exist** — MongoDB creates the database on first write. The target DB appears in the tree after `loadDatabases()` runs on completion.
- **Same location, same name** — blocked by the name-conflict warning; the user must rename or switch to overwrite. When the only selectable overwrite target is the source collection itself (same conn, same db), overwrite mode is disabled.
- **Views** — out of scope for per-collection copy. Views travel with `Copy Database`.
- **Production target** — rejected in both the sidebar handler (alert) and the backend action (throws), matching `copyDatabase`.
- **Read-only target** — same dual check.
- **Indexes** — already copied by the existing worker (see `migration.ts` lines 81-89). Works unchanged.
- **Cancel** — `cancelOperation(opId)` path works unchanged since the same child process is used.

## Testing

Manual verification checklist:

1. Copy collection → paste in same DB with default `users_copy` name → new collection with same docs + indexes
2. Copy collection → paste in different DB on same connection → collection appears with original name
3. Copy collection → paste in different connection → collection appears on the target connection
4. Copy collection → paste with overwrite on existing collection → target is replaced, doc count matches source
5. Copy collection → try to paste into production connection → blocked with alert
6. Copy collection → try to paste into read-only connection → blocked with alert
7. Copy a collection with 10k+ documents → progress bar updates, cancel button works
8. Copying a database still works unchanged (regression check on the shared worker)
9. Paste menu shows "Paste Collection Here" only when a collection is copied; "Paste Database Here" only when a database is copied
10. Copying a collection then a database (or vice versa) replaces the clipboard — the chip label updates accordingly

## Files touched

- `src/shared/types.ts` — add `CopyCollectionOptions`
- `src/main/actions/migration.ts` — add `copyCollection`, extend worker script config
- `src/main/trpc/routers/migration.ts` — add `copyCollection` procedure
- `src/renderer/src/components/explorer/PasteCollectionDialog.tsx` — new file
- `src/renderer/src/components/explorer/DatabaseTree.tsx` — add context menu items + props
- `src/renderer/src/components/layout/Sidebar.tsx` — update clipboard shape, add handlers, render `PasteCollectionDialog`
