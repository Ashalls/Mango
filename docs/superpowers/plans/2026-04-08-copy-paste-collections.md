# Copy/Paste Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add copy/paste support for individual collections, mirroring the existing database copy/paste flow (cross-DB, cross-connection, overwrite mode, shared clipboard).

**Architecture:** Extend the shared Sidebar clipboard from `{connectionId, database}` to a tagged union that also supports collections. Add a dedicated `PasteCollectionDialog`. Backend adds a `copyCollection` action that reuses the existing per-collection child-process worker — the worker is extended so source and target collection names can differ, preserving the whole-DB copy flow.

**Tech Stack:** TypeScript, React 19, Electron, tRPC (electron-trpc 0.7.1, trpc 10.45.4), Zustand, MongoDB driver 6.x, Radix UI context menus, Tailwind. No test framework in project — verification is `npm run typecheck` + manual QA.

**Design doc:** `docs/superpowers/specs/2026-04-08-copy-paste-collections-design.md`

---

## File Structure

**Files to create:**
- `src/renderer/src/components/explorer/PasteCollectionDialog.tsx` — dedicated dialog for pasting a collection into a target database (mirrors `PasteDatabaseDialog` visually)

**Files to modify:**
- `src/shared/types.ts` — add `CopyCollectionOptions` interface
- `src/main/actions/migration.ts` — extend `COPY_WORKER_SCRIPT` config and `copyCollectionInProcess` signature to support distinct source/target collection names; add new `copyCollection` exported action
- `src/main/trpc/routers/migration.ts` — add `copyCollection` tRPC procedure
- `src/renderer/src/components/explorer/DatabaseTree.tsx` — add three new props (`onCopyCollection`, `canPasteCollection`, `onPasteCollection`) plus matching context menu items on collection nodes and database nodes
- `src/renderer/src/components/layout/Sidebar.tsx` — change clipboard shape to a tagged union, add copy/paste collection handlers, render `PasteCollectionDialog`, update the "Copied: …" chip

---

## Task 1: Add `CopyCollectionOptions` to shared types

**Files:**
- Modify: `src/shared/types.ts` (insert after existing `CopyDatabaseOptions` at line 80)

- [ ] **Step 1: Add the new interface**

Open `src/shared/types.ts` and insert immediately after the existing `CopyDatabaseOptions` interface (which ends at line 80 with `}`). Place the new block BEFORE the `CopyProgress` interface currently at line 82.

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
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS (no errors introduced — new type is not yet referenced anywhere).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add CopyCollectionOptions shared type"
```

---

## Task 2: Extend copy worker to support distinct source/target collection names

This refactor is a pure rename-in-place. The existing whole-DB copy continues to work because it will pass the same name twice.

**Files:**
- Modify: `src/main/actions/migration.ts:35-102` (the `COPY_WORKER_SCRIPT` template)
- Modify: `src/main/actions/migration.ts:107-187` (the `copyCollectionInProcess` TypeScript wrapper)
- Modify: `src/main/actions/migration.ts:257-273` (the `copyDatabase` call site that invokes `copyCollectionInProcess`)

- [ ] **Step 1: Update the worker script template**

Replace the existing `COPY_WORKER_SCRIPT` string at `src/main/actions/migration.ts:35` with this version. The change: the destructured config reads `sourceColName` and `targetColName` instead of `colName`; the `dropTarget` target is `targetColName`; the source cursor reads from `sourceColName`; the write target is `targetColName`; logged collection name is `targetColName`.

```ts
const COPY_WORKER_SCRIPT = `
try {
const { MongoClient } = require('mongodb');
const send = (msg) => process.send(msg);
const config = JSON.parse(process.argv[2]);

async function run() {
  const { sourceUri, targetUri, sourceDatabase, targetDatabase, sourceColName, targetColName, dropTarget } = config;
  let sourceClient, targetClient;
  try {
    sourceClient = new MongoClient(sourceUri);
    targetClient = sourceUri === targetUri ? sourceClient : new MongoClient(targetUri);
    await sourceClient.connect();
    if (sourceUri !== targetUri) await targetClient.connect();

    const sourceDb = sourceClient.db(sourceDatabase);
    const targetDb = targetClient.db(targetDatabase);

    if (dropTarget) {
      try { await targetDb.dropCollection(targetColName); } catch {}
    }

    const sourceCol = sourceDb.collection(sourceColName);
    const count = await sourceCol.estimatedDocumentCount().catch(() => 0);
    send({ type: 'total', total: count });

    const targetCol = targetDb.collection(targetColName);
    const batchSize = 2000;
    const cursor = sourceCol.find({});
    let batch = [], copied = 0;

    for await (const doc of cursor) {
      batch.push(doc);
      if (batch.length >= batchSize) {
        await targetCol.insertMany(batch, { ordered: false });
        copied += batch.length;
        send({ type: 'progress', copied });
        batch = [];
      }
    }
    if (batch.length > 0) {
      await targetCol.insertMany(batch, { ordered: false });
      copied += batch.length;
    }

    // Copy indexes
    try {
      const indexes = await sourceCol.indexes();
      for (const idx of indexes) {
        if (idx.name === '_id_') continue;
        const { key, ...opts } = idx;
        delete opts.v; delete opts.ns;
        try { await targetCol.createIndex(key, opts); } catch {}
      }
    } catch {}

    send({ type: 'done', copied, total: count || copied });
  } catch (err) {
    send({ type: 'error', error: err.message || 'Copy failed' });
  } finally {
    if (sourceClient) await sourceClient.close().catch(() => {});
    if (targetClient && config.sourceUri !== config.targetUri) await targetClient.close().catch(() => {});
    process.exit(0);
  }
}
run();
} catch (e) { console.error('Copy worker error:', e); process.exit(1); }
`
```

- [ ] **Step 2: Update `copyCollectionInProcess` signature**

Replace the function signature and the `JSON.stringify` payload line. The existing function starts at line 107 with `function copyCollectionInProcess(`. Change the `colName: string` parameter to two parameters `sourceColName: string, targetColName: string`, and update the JSON payload and the progress string.

Change the signature from:

```ts
function copyCollectionInProcess(
  sourceUri: string,
  targetUri: string,
  sourceDatabase: string,
  targetDatabase: string,
  colName: string,
  dropTarget: boolean,
  colProgress: CollectionProgress,
  op: OperationProgress
): Promise<number> {
```

to:

```ts
function copyCollectionInProcess(
  sourceUri: string,
  targetUri: string,
  sourceDatabase: string,
  targetDatabase: string,
  sourceColName: string,
  targetColName: string,
  dropTarget: boolean,
  colProgress: CollectionProgress,
  op: OperationProgress
): Promise<number> {
```

Inside the function body, change the `fork` args line from:

```ts
    const child = fork(COPY_SCRIPT_PATH, [
      JSON.stringify({ sourceUri, targetUri, sourceDatabase, targetDatabase, colName, dropTarget })
    ], {
```

to:

```ts
    const child = fork(COPY_SCRIPT_PATH, [
      JSON.stringify({ sourceUri, targetUri, sourceDatabase, targetDatabase, sourceColName, targetColName, dropTarget })
    ], {
```

And change the `op.currentStep` assignment inside the `'progress'` case from:

```ts
          op.currentStep = `Copying ${colName} (${msg.copied.toLocaleString()}/${colProgress.total.toLocaleString()})`
```

to:

```ts
          op.currentStep = `Copying ${targetColName} (${msg.copied.toLocaleString()}/${colProgress.total.toLocaleString()})`
```

And the legacy `migration:progress` events — in the `'progress'` case:

```ts
          emitProgress('migration:progress', {
            collection: colName, copied: msg.copied, total: colProgress.total, status: 'copying'
          })
```

becomes:

```ts
          emitProgress('migration:progress', {
            collection: targetColName, copied: msg.copied, total: colProgress.total, status: 'copying'
          })
```

And in the `'done'` case:

```ts
          emitProgress('migration:progress', {
            collection: colName, copied: msg.copied, total: msg.total, status: 'done'
          })
```

becomes:

```ts
          emitProgress('migration:progress', {
            collection: targetColName, copied: msg.copied, total: msg.total, status: 'done'
          })
```

- [ ] **Step 3: Update the `copyDatabase` call site**

The existing loop in `copyDatabase` at approximately line 257 calls `copyCollectionInProcess`. Update it to pass `colName` twice (once for source, once for target). Change:

```ts
    await copyCollectionInProcess(
      sourceUri, targetUri,
      options.sourceDatabase, options.targetDatabase,
      colName, options.dropTarget || false,
      colProgress, op
    )
```

to:

```ts
    await copyCollectionInProcess(
      sourceUri, targetUri,
      options.sourceDatabase, options.targetDatabase,
      colName, colName, options.dropTarget || false,
      colProgress, op
    )
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS. If you get `Parameter 'targetColName' is declared but never used` — double-check that you renamed every `colName` usage inside the TypeScript wrapper function body (not the worker script string — that's checked at runtime only).

- [ ] **Step 5: Manual smoke test — whole-DB copy regression**

Run: `npm run dev`
In the app:
1. Right-click any database → "Copy Database"
2. Right-click another database node → "Paste Database Here"
3. In the dialog, pick "Create new database" with a new name, click Paste
4. Verify the operation completes and all collections appear in the new database with matching document counts

This confirms Task 2's refactor didn't break the existing flow. If it fails, stop and fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/main/actions/migration.ts
git commit -m "refactor(migration): allow distinct source/target collection names in copy worker"
```

---

## Task 3: Add `copyCollection` backend action

**Files:**
- Modify: `src/main/actions/migration.ts` (add new exported function at the end of the file, and update the `CopyCollectionOptions` import)

- [ ] **Step 1: Update the shared-types import**

At the top of `src/main/actions/migration.ts` (line 8), the current import is:

```ts
import type { CopyDatabaseOptions, CopyProgress, OperationProgress, CollectionProgress } from '@shared/types'
```

Change it to:

```ts
import type { CopyDatabaseOptions, CopyCollectionOptions, CopyProgress, OperationProgress, CollectionProgress } from '@shared/types'
```

- [ ] **Step 2: Add the `copyCollection` function**

Append this new function at the end of `src/main/actions/migration.ts` (after the closing brace of `copyDatabase`):

```ts
export async function copyCollection(options: CopyCollectionOptions): Promise<void> {
  // Production safety check
  const connections = configService.loadConnections()
  const targetProfile = connections.find((c) => c.id === options.targetConnectionId)
  if (targetProfile?.isProduction) {
    throw new Error(
      `Cannot copy to "${targetProfile.name}" — it is tagged as production. ` +
        'Production connections are protected from mass write operations.'
    )
  }
  if (targetProfile?.isReadOnly) {
    throw new Error(
      `Cannot copy to "${targetProfile.name}" — it is marked as read-only. ` +
        'Disable Read Only in connection settings to allow writes.'
    )
  }

  const sourceProfile = connections.find((c) => c.id === options.sourceConnectionId)
  if (!sourceProfile || !targetProfile) throw new Error('Connection not found')

  const sourceUri = sourceProfile.uri
  const targetUri = targetProfile.uri

  const opId = `copy-col-${++opCounter}-${Date.now()}`
  const op: OperationProgress = {
    id: opId,
    type: 'copy',
    label: `Copy ${options.sourceDatabase}.${options.sourceCollection} → ${options.targetDatabase}.${options.targetCollection} on ${targetProfile.name}`,
    status: 'running',
    currentStep: `Copying ${options.sourceCollection}...`,
    processed: 0,
    total: 1,
    collections: [
      {
        name: options.targetCollection,
        status: 'running',
        copied: 0,
        total: 0
      }
    ],
    startedAt: Date.now()
  }
  emitProgress('operation:progress', op)

  const colProgress = op.collections[0]

  await copyCollectionInProcess(
    sourceUri,
    targetUri,
    options.sourceDatabase,
    options.targetDatabase,
    options.sourceCollection,
    options.targetCollection,
    options.dropTarget || false,
    colProgress,
    op
  )

  const wasCancelled = colProgress.error === 'Cancelled'
  op.status = wasCancelled ? 'error' : colProgress.status === 'error' ? 'error' : 'done'
  op.currentStep = wasCancelled
    ? 'Cancelled'
    : op.status === 'done'
      ? 'Complete'
      : 'Completed with errors'
  if (wasCancelled) op.error = 'Operation cancelled'
  emitProgress('operation:progress', op)

  emitProgress('migration:complete', {
    sourceDatabase: options.sourceDatabase,
    targetDatabase: options.targetDatabase
  })
}
```

Note: `CopyProgress` is imported but not used in this new function — that's fine, it was already imported by `copyDatabase` usage elsewhere in the file and we're not touching that.

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS. Any error means a typo in the function body or a mismatched signature from Task 2 — compare line-by-line with the `copyDatabase` function above it.

- [ ] **Step 4: Commit**

```bash
git add src/main/actions/migration.ts
git commit -m "feat(migration): add copyCollection action"
```

---

## Task 4: Expose `copyCollection` via tRPC

**Files:**
- Modify: `src/main/trpc/routers/migration.ts` (entire file — it's ~20 lines)

- [ ] **Step 1: Add the procedure**

Replace the entire contents of `src/main/trpc/routers/migration.ts` with:

```ts
import { router, procedure, z } from '../context'
import * as migrationActions from '../../actions/migration'

export const migrationRouter = router({
  copyDatabase: procedure
    .input(
      z.object({
        sourceConnectionId: z.string(),
        sourceDatabase: z.string(),
        targetConnectionId: z.string(),
        targetDatabase: z.string(),
        collections: z.array(z.string()).optional(),
        dropTarget: z.boolean().optional()
      })
    )
    .mutation(async ({ input }) => {
      // Runs async — progress emitted via IPC events
      migrationActions.copyDatabase(input)
      return { started: true }
    }),

  copyCollection: procedure
    .input(
      z.object({
        sourceConnectionId: z.string(),
        sourceDatabase: z.string(),
        sourceCollection: z.string(),
        targetConnectionId: z.string(),
        targetDatabase: z.string(),
        targetCollection: z.string(),
        dropTarget: z.boolean().optional()
      })
    )
    .mutation(async ({ input }) => {
      // Runs async — progress emitted via IPC events
      migrationActions.copyCollection(input)
      return { started: true }
    })
})
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS. If TypeScript complains that `migrationActions.copyCollection` is not exported, verify Task 3's function uses the `export` keyword.

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/migration.ts
git commit -m "feat(trpc): expose migration.copyCollection procedure"
```

---

## Task 5: Create `PasteCollectionDialog` component

**Files:**
- Create: `src/renderer/src/components/explorer/PasteCollectionDialog.tsx`

This component mirrors `PasteDatabaseDialog.tsx` visually but operates on collections. It does NOT fetch data — the parent passes in `existingCollections`.

- [ ] **Step 1: Create the file**

Create `src/renderer/src/components/explorer/PasteCollectionDialog.tsx` with this content:

```tsx
import { useState, useEffect, useRef } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { AlertTriangle, Database, Table2 } from 'lucide-react'

export interface PasteCollectionResult {
  targetCollection: string
  dropTarget: boolean
}

interface PasteCollectionDialogProps {
  sourceCollection: string
  sourceDatabase: string
  sourceConnection: string
  targetDatabase: string
  targetConnection: string
  existingCollections: string[]
  isSameLocation: boolean
  onSubmit: (result: PasteCollectionResult) => void
  onCancel: () => void
}

type PasteMode = 'new' | 'overwrite'

export function PasteCollectionDialog({
  sourceCollection,
  sourceDatabase,
  sourceConnection,
  targetDatabase,
  targetConnection,
  existingCollections,
  isSameLocation,
  onSubmit,
  onCancel
}: PasteCollectionDialogProps) {
  const defaultName = isSameLocation ? `${sourceCollection}_copy` : sourceCollection
  const existsAlready = existingCollections.includes(sourceCollection)
  const [mode, setMode] = useState<PasteMode>(
    existsAlready && !isSameLocation ? 'overwrite' : 'new'
  )
  const [newColName, setNewColName] = useState(defaultName)
  const [selectedCol, setSelectedCol] = useState(
    existsAlready ? sourceCollection : existingCollections[0] || ''
  )
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode === 'new') nameRef.current?.focus()
  }, [mode])

  const nameConflicts = mode === 'new' && existingCollections.includes(newColName.trim())

  // When same-location, the only candidate for overwrite would be the source collection itself.
  // Overwriting yourself is nonsensical — disable overwrite mode in that case unless there are
  // other collections in the target DB to pick.
  const overwriteDisabled =
    existingCollections.length === 0 ||
    (isSameLocation && existingCollections.length === 1 && existingCollections[0] === sourceCollection)

  const canSubmit =
    mode === 'overwrite'
      ? selectedCol !== '' && !(isSameLocation && selectedCol === sourceCollection)
      : newColName.trim() !== '' && !nameConflicts

  const handleSubmit = () => {
    if (!canSubmit) return
    if (mode === 'overwrite') {
      onSubmit({ targetCollection: selectedCol, dropTarget: true })
    } else {
      onSubmit({ targetCollection: newColName.trim(), dropTarget: false })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[460px] rounded-lg border border-border bg-card p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">Paste Collection</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {sourceDatabase}.{sourceCollection}
          </span>
          {isSameLocation ? (
            <> (same location)</>
          ) : (
            <>
              {' '}
              from <span className="font-medium text-foreground">{sourceConnection}</span> →{' '}
              <span className="font-medium text-foreground">{targetConnection}</span>
            </>
          )}
        </p>

        {/* Target database chip (read-only, determined by right-click target) */}
        <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <Database className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs text-muted-foreground">Target database:</span>
          <span className="font-medium">{targetDatabase}</span>
        </div>

        {/* Mode selection */}
        <div className="space-y-2">
          {/* Create new collection */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
              mode === 'new'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/30'
            }`}
            onClick={() => setMode('new')}
          >
            <input
              type="radio"
              name="pasteColMode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Create new collection</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Creates a fresh collection with all documents and indexes copied over.
              </p>
              {mode === 'new' && (
                <div className="mt-2">
                  <Input
                    ref={nameRef}
                    placeholder="Collection name"
                    value={newColName}
                    onChange={(e) => setNewColName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSubmit()
                      if (e.key === 'Escape') onCancel()
                    }}
                    className="h-8 text-sm"
                  />
                  {nameConflicts && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      A collection with this name already exists in the target database. Choose a
                      different name or use overwrite mode.
                    </p>
                  )}
                </div>
              )}
            </div>
          </label>

          {/* Overwrite existing collection */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
              overwriteDisabled
                ? 'border-border opacity-50 cursor-not-allowed'
                : mode === 'overwrite'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30'
            }`}
            onClick={() => {
              if (!overwriteDisabled) setMode('overwrite')
            }}
          >
            <input
              type="radio"
              name="pasteColMode"
              checked={mode === 'overwrite'}
              onChange={() => setMode('overwrite')}
              disabled={overwriteDisabled}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Overwrite existing collection</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Drops the target collection before copying.
              </p>
              {mode === 'overwrite' && !overwriteDisabled && (
                <div className="mt-2">
                  <select
                    value={selectedCol}
                    onChange={(e) => setSelectedCol(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {existingCollections.map((col) => {
                      const disabled = isSameLocation && col === sourceCollection
                      return (
                        <option key={col} value={col} disabled={disabled}>
                          {col}
                          {disabled ? ' (source — cannot overwrite)' : ''}
                        </option>
                      )
                    })}
                  </select>
                  <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    This will drop and replace the selected collection.
                  </p>
                </div>
              )}
              {overwriteDisabled && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {existingCollections.length === 0
                    ? 'No existing collections in the target database.'
                    : 'No other collections available to overwrite.'}
                </p>
              )}
            </div>
          </label>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Table2 className="h-3 w-3 text-blue-400" />
            {sourceCollection}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              variant={mode === 'overwrite' ? 'destructive' : 'default'}
            >
              {mode === 'overwrite' ? 'Overwrite & Paste' : 'Paste Collection'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS. If you hit errors, the most likely cause is a missing import — check that `Database` and `Table2` are in the `lucide-react` import line.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/explorer/PasteCollectionDialog.tsx
git commit -m "feat(ui): add PasteCollectionDialog component"
```

---

## Task 6: Wire new props and context menu items into `DatabaseTree`

**Files:**
- Modify: `src/renderer/src/components/explorer/DatabaseTree.tsx`

Three edits:
1. Add three props to the interface and destructure them
2. Add a "Copy Collection" item to the collection context menu
3. Add a "Paste Collection Here" item to the database context menu

- [ ] **Step 1: Add new props to `DatabaseTreeProps`**

In `src/renderer/src/components/explorer/DatabaseTree.tsx`, locate the `DatabaseTreeProps` interface at line 14. Add three new optional props after `onPasteDatabase`:

Find:

```ts
interface DatabaseTreeProps {
  databases: DatabaseInfo[]
  searchFilter: string
  connectionId: string
  onCopyDatabase?: (dbName: string) => void
  canPaste?: boolean
  onPasteDatabase?: () => void
  isProduction?: boolean
```

Replace with:

```ts
interface DatabaseTreeProps {
  databases: DatabaseInfo[]
  searchFilter: string
  connectionId: string
  onCopyDatabase?: (dbName: string) => void
  canPaste?: boolean
  onPasteDatabase?: () => void
  onCopyCollection?: (dbName: string, colName: string) => void
  canPasteCollection?: boolean
  onPasteCollection?: (dbName: string) => void
  isProduction?: boolean
```

- [ ] **Step 2: Destructure the new props**

The function signature starts at line 32. Find:

```ts
export function DatabaseTree({ databases, searchFilter, connectionId, onCopyDatabase, canPaste, onPasteDatabase, isProduction, claudeAccess, claudeDbOverrides, onToggleDbClaude, databaseCodebasePaths, onSetDbCodebasePath, onClearDbCodebasePath, isReadOnly, connectionName }: DatabaseTreeProps) {
```

Replace with:

```ts
export function DatabaseTree({ databases, searchFilter, connectionId, onCopyDatabase, canPaste, onPasteDatabase, onCopyCollection, canPasteCollection, onPasteCollection, isProduction, claudeAccess, claudeDbOverrides, onToggleDbClaude, databaseCodebasePaths, onSetDbCodebasePath, onClearDbCodebasePath, isReadOnly, connectionName }: DatabaseTreeProps) {
```

- [ ] **Step 3: Add "Paste Collection Here" to the database context menu**

Find the existing "Paste Database Here" block (around line 264):

```tsx
                {canPaste && onPasteDatabase && !isProduction && (
                  <ContextMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                    onSelect={onPasteDatabase}
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    Paste Database Here
                  </ContextMenu.Item>
                )}
```

Immediately after that block (before the `{onToggleDbClaude && (` block), add:

```tsx
                {canPasteCollection && onPasteCollection && !isProduction && !isReadOnly && (
                  <ContextMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                    onSelect={() => onPasteCollection(db.name)}
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    Paste Collection Here
                  </ContextMenu.Item>
                )}
```

- [ ] **Step 4: Add "Copy Collection" to the collection context menu**

Find the collection context menu's "Rename Collection" block (around line 545). Just BEFORE the `isReadOnly ? (` ternary that renders Rename Collection, add a new item (not conditional on `isReadOnly` — copying is a read operation and should work on read-only connections):

Locate this section:

```tsx
                      <ContextMenu.Separator className="my-1 h-px bg-border" />
                      {isReadOnly ? (
                        <ContextMenu.Item
                          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground cursor-not-allowed"
                          disabled
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Rename Collection
                        </ContextMenu.Item>
```

Replace with:

```tsx
                      <ContextMenu.Separator className="my-1 h-px bg-border" />
                      {onCopyCollection && (
                        <ContextMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                          onSelect={() => onCopyCollection(db.name, col.name)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy Collection
                        </ContextMenu.Item>
                      )}
                      {isReadOnly ? (
                        <ContextMenu.Item
                          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground cursor-not-allowed"
                          disabled
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Rename Collection
                        </ContextMenu.Item>
```

(The `Copy` icon is already imported from `lucide-react` at the top of the file — verify line 2 includes `Copy` in the import list. It does in the current file.)

- [ ] **Step 5: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS. Any unused-prop warning means you missed the destructure in Step 2.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/explorer/DatabaseTree.tsx
git commit -m "feat(ui): add Copy Collection and Paste Collection Here context menu items"
```

---

## Task 7: Update `Sidebar` clipboard model and wire the new dialog

**Files:**
- Modify: `src/renderer/src/components/layout/Sidebar.tsx`

Six edits: change clipboard type, add collection handlers, pass new props to `DatabaseTree`, update the "Copied" chip, render `PasteCollectionDialog`, import the new component.

- [ ] **Step 1: Import `PasteCollectionDialog`**

At the top of `src/renderer/src/components/layout/Sidebar.tsx`, the existing import is at line 3:

```ts
import { PasteDatabaseDialog, type PasteDatabaseResult } from '@renderer/components/explorer/PasteDatabaseDialog'
```

Add immediately below it:

```ts
import { PasteCollectionDialog, type PasteCollectionResult } from '@renderer/components/explorer/PasteCollectionDialog'
```

- [ ] **Step 2: Change the clipboard state type**

The existing state at line 23:

```ts
  const [clipboard, setClipboard] = useState<{
    connectionId: string
    database: string
  } | null>(null)
```

Replace with:

```ts
  const [clipboard, setClipboard] = useState<
    | { type: 'database'; connectionId: string; database: string }
    | { type: 'collection'; connectionId: string; database: string; collection: string }
    | null
  >(null)
  const [pasteCollectionTarget, setPasteCollectionTarget] = useState<{
    connectionId: string
    database: string
  } | null>(null)
```

- [ ] **Step 3: Update `handleCopyDatabase` to set the tagged clipboard**

The existing handler at line 119:

```ts
  const handleCopyDatabase = (connectionId: string, database: string) => {
    setClipboard({ connectionId, database })
  }
```

Replace with:

```ts
  const handleCopyDatabase = (connectionId: string, database: string) => {
    setClipboard({ type: 'database', connectionId, database })
  }

  const handleCopyCollection = (connectionId: string, database: string, collection: string) => {
    setClipboard({ type: 'collection', connectionId, database, collection })
  }

  const handlePasteCollection = async (targetConnectionId: string, targetDatabase: string) => {
    if (!clipboard || clipboard.type !== 'collection') return
    const targetProfile = profiles.find((p) => p.id === targetConnectionId)
    if (targetProfile?.isProduction) {
      alert('Cannot paste into a production connection. Production connections are protected from mass write operations.')
      return
    }
    if (targetProfile?.isReadOnly) {
      alert('Cannot paste into a read-only connection. Disable Read Only in connection settings to allow writes.')
      return
    }
    // Ensure we have the target database's collection list cached (for the overwrite dropdown)
    const colKey = `${targetConnectionId}:${targetDatabase}`
    const { collections, loadCollections } = useExplorerStore.getState()
    if (!collections[colKey]) {
      try {
        await loadCollections(targetDatabase, targetConnectionId)
      } catch (err) {
        alert(`Failed to load collections for ${targetDatabase}: ${err instanceof Error ? err.message : err}`)
        return
      }
    }
    setPasteCollectionTarget({ connectionId: targetConnectionId, database: targetDatabase })
  }
```

- [ ] **Step 4: Update `handlePasteDatabase` guard and `handlePasteSubmit`**

The existing `handlePasteDatabase` at line 123:

```ts
  const handlePasteDatabase = (targetConnectionId: string) => {
    if (!clipboard) return
    const targetProfile = profiles.find((p) => p.id === targetConnectionId)
```

Replace with:

```ts
  const handlePasteDatabase = (targetConnectionId: string) => {
    if (!clipboard || clipboard.type !== 'database') return
    const targetProfile = profiles.find((p) => p.id === targetConnectionId)
```

The existing `handlePasteSubmit` at line 137:

```ts
  const handlePasteSubmit = async (result: PasteDatabaseResult) => {
    if (!clipboard || !pasteTarget) return
    try {
      await trpc.migration.copyDatabase.mutate({
        sourceConnectionId: clipboard.connectionId,
        sourceDatabase: clipboard.database,
        targetConnectionId: pasteTarget,
        targetDatabase: result.targetDatabase,
        dropTarget: result.dropTarget
      })
```

Replace with:

```ts
  const handlePasteSubmit = async (result: PasteDatabaseResult) => {
    if (!clipboard || clipboard.type !== 'database' || !pasteTarget) return
    try {
      await trpc.migration.copyDatabase.mutate({
        sourceConnectionId: clipboard.connectionId,
        sourceDatabase: clipboard.database,
        targetConnectionId: pasteTarget,
        targetDatabase: result.targetDatabase,
        dropTarget: result.dropTarget
      })
```

And immediately AFTER the `handlePasteSubmit` function (which ends with its closing brace), add:

```ts
  const handlePasteCollectionSubmit = async (result: PasteCollectionResult) => {
    if (!clipboard || clipboard.type !== 'collection' || !pasteCollectionTarget) return
    try {
      await trpc.migration.copyCollection.mutate({
        sourceConnectionId: clipboard.connectionId,
        sourceDatabase: clipboard.database,
        sourceCollection: clipboard.collection,
        targetConnectionId: pasteCollectionTarget.connectionId,
        targetDatabase: pasteCollectionTarget.database,
        targetCollection: result.targetCollection,
        dropTarget: result.dropTarget
      })
      // Refresh the target database's collection list
      await useExplorerStore
        .getState()
        .loadCollections(pasteCollectionTarget.database, pasteCollectionTarget.connectionId)
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setPasteCollectionTarget(null)
    }
  }
```

- [ ] **Step 5: Pass new props to `DatabaseTree`**

The existing `<DatabaseTree ...>` usage is inside `renderConnection` at around line 197. Find the existing prop lines:

```tsx
                <DatabaseTree
                  databases={databases}
                  searchFilter={search}
                  connectionId={profile.id}
                  onCopyDatabase={(db) => handleCopyDatabase(profile.id, db)}
                  canPaste={clipboard !== null}
                  onPasteDatabase={() => handlePasteDatabase(profile.id)}
                  isProduction={profile.isProduction}
```

Replace with:

```tsx
                <DatabaseTree
                  databases={databases}
                  searchFilter={search}
                  connectionId={profile.id}
                  onCopyDatabase={(db) => handleCopyDatabase(profile.id, db)}
                  canPaste={clipboard?.type === 'database'}
                  onPasteDatabase={() => handlePasteDatabase(profile.id)}
                  onCopyCollection={(db, col) => handleCopyCollection(profile.id, db, col)}
                  canPasteCollection={clipboard?.type === 'collection'}
                  onPasteCollection={(db) => handlePasteCollection(profile.id, db)}
                  isProduction={profile.isProduction}
```

Note: `canPaste` changes from `clipboard !== null` to `clipboard?.type === 'database'`. This ensures "Paste Database Here" only shows when a database is copied, and "Paste Collection Here" only shows when a collection is copied (spec requirement).

- [ ] **Step 6: Update the "Copied:" chip**

The existing chip at line 563:

```tsx
        {clipboard && (
          <div className="mt-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-2 py-1.5 text-[10px] text-primary">
            Copied: {clipboard.database}
          </div>
        )}
```

Replace with:

```tsx
        {clipboard && (
          <div className="mt-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-2 py-1.5 text-[10px] text-primary">
            Copied:{' '}
            {clipboard.type === 'database'
              ? clipboard.database
              : `${clipboard.database}.${clipboard.collection}`}
          </div>
        )}
```

- [ ] **Step 7: Render `PasteCollectionDialog`**

The existing `pasteTarget && clipboard` block at line 604 renders `PasteDatabaseDialog`. Immediately AFTER the closing `})()}` of that block (the IIFE), add a new block for `PasteCollectionDialog`:

Locate the end of the existing block:

```tsx
      {pasteTarget && clipboard && (() => {
        const targetProfile = profiles.find((p) => p.id === pasteTarget)
        const sourceProfile = profiles.find((p) => p.id === clipboard.connectionId)
        const isSameConnection = clipboard.connectionId === pasteTarget
        const existingDbNames = databases.map((d) => d.name)
        return (
          <PasteDatabaseDialog
            sourceName={clipboard.database}
            sourceConnection={sourceProfile?.name || 'Unknown'}
            targetConnection={targetProfile?.name || 'Unknown'}
            existingDatabases={existingDbNames}
            isSameConnection={isSameConnection}
            onSubmit={handlePasteSubmit}
            onCancel={() => setPasteTarget(null)}
          />
        )
      })()}
```

Note: the existing block references `clipboard.database` — TypeScript's narrowing may need a hint. Update the guard condition from `pasteTarget && clipboard && (() => {` to `pasteTarget && clipboard?.type === 'database' && (() => {`. This is a safe narrowing — `pasteTarget` is only set by `handlePasteDatabase` which is only callable when `clipboard.type === 'database'`.

So the block becomes:

```tsx
      {pasteTarget && clipboard?.type === 'database' && (() => {
        const targetProfile = profiles.find((p) => p.id === pasteTarget)
        const sourceProfile = profiles.find((p) => p.id === clipboard.connectionId)
        const isSameConnection = clipboard.connectionId === pasteTarget
        const existingDbNames = databases.map((d) => d.name)
        return (
          <PasteDatabaseDialog
            sourceName={clipboard.database}
            sourceConnection={sourceProfile?.name || 'Unknown'}
            targetConnection={targetProfile?.name || 'Unknown'}
            existingDatabases={existingDbNames}
            isSameConnection={isSameConnection}
            onSubmit={handlePasteSubmit}
            onCancel={() => setPasteTarget(null)}
          />
        )
      })()}

      {pasteCollectionTarget && clipboard?.type === 'collection' && (() => {
        const targetProfile = profiles.find((p) => p.id === pasteCollectionTarget.connectionId)
        const sourceProfile = profiles.find((p) => p.id === clipboard.connectionId)
        const isSameLocation =
          clipboard.connectionId === pasteCollectionTarget.connectionId &&
          clipboard.database === pasteCollectionTarget.database
        const colKey = `${pasteCollectionTarget.connectionId}:${pasteCollectionTarget.database}`
        const existingCols =
          useExplorerStore.getState().collections[colKey]?.map((c) => c.name) ?? []
        return (
          <PasteCollectionDialog
            sourceCollection={clipboard.collection}
            sourceDatabase={clipboard.database}
            sourceConnection={sourceProfile?.name || 'Unknown'}
            targetDatabase={pasteCollectionTarget.database}
            targetConnection={targetProfile?.name || 'Unknown'}
            existingCollections={existingCols}
            isSameLocation={isSameLocation}
            onSubmit={handlePasteCollectionSubmit}
            onCancel={() => setPasteCollectionTarget(null)}
          />
        )
      })()}
```

Note on reactivity: this reads from `useExplorerStore.getState()` directly which is non-reactive. That's fine here because `handlePasteCollection` (Step 3) ensures collections are loaded into the store BEFORE setting `pasteCollectionTarget`, so by the time this block renders, the data is already present. If the list later changes, the dialog won't update — but the dialog is short-lived and captures the names on mount.

- [ ] **Step 8: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS. Likely failure modes:
- Missing destructure of `onCopyCollection`/`canPasteCollection`/`onPasteCollection` in `DatabaseTree` (fixed in Task 6)
- `clipboard.database` used outside a type guard → add the `?.type === 'database'` check
- `PasteCollectionResult` not exported → verify Task 5 exports it

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/layout/Sidebar.tsx
git commit -m "feat(ui): wire copy/paste collection flow in Sidebar"
```

---

## Task 8: Manual verification

No automated tests exist in this project. Work through this checklist against `npm run dev`. If any step fails, investigate and fix before moving on.

**Prerequisites:** a local MongoDB with at least two databases, one with multiple collections (including one with 10k+ documents for step 7). Optionally a second connection profile for cross-connection tests.

- [ ] **Step 1: Copy → paste in same DB with default rename**

1. Right-click a collection (e.g. `users`) → "Copy Collection"
2. Bottom of sidebar shows `Copied: <db>.users`
3. Right-click the same database → "Paste Collection Here"
4. Dialog opens. Default name is `users_copy`, mode is "Create new collection"
5. Click "Paste Collection"
6. Operations panel shows progress; after completion, a new `users_copy` collection appears in the database tree with the same document count as `users`
7. Open `users_copy` — documents and indexes match `users`

- [ ] **Step 2: Copy → paste in a different DB on same connection**

1. Right-click `users` → "Copy Collection"
2. Right-click a *different* database → "Paste Collection Here"
3. Dialog opens. Default name is `users` (not `users_copy` — cross-db)
4. Click "Paste Collection"
5. New `users` collection appears in the target database

- [ ] **Step 3: Copy → paste to a different connection**

1. Right-click `users` on connection A → "Copy Collection"
2. Switch to connection B
3. Right-click any database on B → "Paste Collection Here"
4. Dialog subheader reads `<db>.users from <A> → <B>`
5. Click "Paste Collection"
6. Collection appears on B's target database

- [ ] **Step 4: Overwrite existing collection**

1. Ensure the target DB already has a collection named `orders`
2. Copy a different `orders` collection (from another DB or connection)
3. Right-click the target DB → "Paste Collection Here"
4. Switch to "Overwrite existing collection" mode
5. Dropdown shows `orders`; leave it selected
6. Click "Overwrite & Paste" (button should be red/destructive)
7. Target `orders` is dropped and replaced; doc count now matches the source

- [ ] **Step 5: Production connection is blocked**

1. Copy any collection
2. Right-click a database on a production-tagged connection
3. "Paste Collection Here" should NOT appear in the context menu (guard is `!isProduction`)
4. If testing the backend guard directly: force-call via devtools; it should throw the production error

- [ ] **Step 6: Read-only connection is blocked**

1. Copy any collection
2. Right-click a database on a read-only connection
3. "Paste Collection Here" should NOT appear (`!isReadOnly` guard added in Task 6)

- [ ] **Step 7: Large collection progress + cancel**

1. Copy a collection with 10k+ documents
2. Paste it somewhere
3. While copying, the operations panel shows "Copying <name> (X/Y)" with live updates
4. Click the cancel button on the operation
5. The operation stops; partial target collection may exist (expected — same as database paste behaviour)

- [ ] **Step 8: Database copy regression**

1. Right-click a database → "Copy Database"
2. Right-click another DB node → "Paste Database Here"
3. Confirm the whole flow still works (this exercises the Task 2 worker refactor)

- [ ] **Step 9: Clipboard disambiguation**

1. Copy a database → "Paste Collection Here" should NOT appear on DB context menus; "Paste Database Here" SHOULD appear
2. Copy a collection → "Paste Database Here" should NOT appear; "Paste Collection Here" SHOULD appear
3. The "Copied:" chip label switches between `<db>` and `<db>.<col>` as you switch

- [ ] **Step 10: Same-DB overwrite-yourself guard**

1. In a database with only one collection `only_one`, copy `only_one`
2. Right-click the same database → "Paste Collection Here"
3. Overwrite mode should be disabled (greyed out) with the message "No other collections available to overwrite"
4. "Create new collection" with default name `only_one_copy` should still work

- [ ] **Step 11: Commit any final fixes**

If any of the above steps surfaced bugs and you fixed them, commit:

```bash
git add -u
git commit -m "fix: <describe the bug found during manual verification>"
```

If no fixes were needed, nothing to commit here.

---

## Wrap-up

- [ ] **Final typecheck**

```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Push when ready**

The branch is ready for review or merge. Follow the project's normal PR flow.
