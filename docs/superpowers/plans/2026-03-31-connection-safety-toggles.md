# Connection Safety Toggles & Truncate Collection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new connection-level safety toggles (Protect from Drop & Truncate, Read Only) and a Truncate Collection action with type-to-confirm dialogs for both Drop and Truncate.

**Architecture:** New boolean fields on `ConnectionProfile` flow through the existing tRPC/Zustand pipeline. The connection dialog gets two new toggle cards. A new `ConfirmDestructiveDialog` component handles type-to-confirm for both Drop and Truncate. Backend enforcement is added to tRPC routers and action files. The MCP `checkWriteAccess` function gains `isReadOnly` awareness.

**Tech Stack:** React 19, TypeScript, Radix UI, Tailwind CSS, tRPC, Zustand, MongoDB driver

---

### Task 1: Add new fields to ConnectionProfile type

**Files:**
- Modify: `src/shared/types.ts:1-13`

- [ ] **Step 1: Add `protectDropTruncate` and `isReadOnly` to ConnectionProfile**

```typescript
export interface ConnectionProfile {
  id: string
  name: string
  uri: string
  color?: string
  isProduction?: boolean
  /** When true, hides Drop/Truncate from collection context menu */
  protectDropTruncate?: boolean
  /** When true, blocks all manual write operations on this connection */
  isReadOnly?: boolean
  /** Default Claude access for all databases on this connection */
  claudeAccess?: 'readonly' | 'readwrite'
  /** Per-database Claude access overrides (key = database name) */
  claudeDbOverrides?: Record<string, 'readonly' | 'readwrite'>
  /** Per-database codebase paths for Claude context (key = database name) */
  databaseCodebasePaths?: Record<string, string>
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add protectDropTruncate and isReadOnly fields to ConnectionProfile"
```

---

### Task 2: Update connection save logic to persist new fields

**Files:**
- Modify: `src/main/actions/connection.ts:10-41`

- [ ] **Step 1: Add new fields to saveConnection input type and profile construction**

In `src/main/actions/connection.ts`, update `saveConnection` to accept and persist the new fields:

```typescript
export function saveConnection(input: {
  id?: string
  name: string
  uri: string
  color?: string
  isProduction?: boolean
  protectDropTruncate?: boolean
  isReadOnly?: boolean
  claudeAccess?: 'readonly' | 'readwrite'
  claudeDbOverrides?: Record<string, 'readonly' | 'readwrite'>
  databaseCodebasePaths?: Record<string, string>
}): ConnectionProfile {
  const connections = configService.loadConnections()
  const profile: ConnectionProfile = {
    id: input.id || randomUUID(),
    name: input.name,
    uri: input.uri,
    color: input.color,
    isProduction: input.isProduction,
    protectDropTruncate: input.protectDropTruncate,
    isReadOnly: input.isReadOnly,
    claudeAccess: input.claudeAccess ?? (input.isProduction ? 'readonly' : 'readwrite'),
    claudeDbOverrides: input.claudeDbOverrides,
    databaseCodebasePaths: input.databaseCodebasePaths
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/main/actions/connection.ts
git commit -m "feat: persist protectDropTruncate and isReadOnly in connection save"
```

---

### Task 3: Update ConnectionDialog UI with new toggles

**Files:**
- Modify: `src/renderer/src/components/explorer/ConnectionDialog.tsx`

- [ ] **Step 1: Update the editProfile prop type to include new fields**

In `ConnectionDialog.tsx`, update the `ConnectionDialogProps` interface:

```typescript
interface ConnectionDialogProps {
  onClose: () => void
  editProfile?: { id: string; name: string; uri: string; color?: string; isProduction?: boolean; protectDropTruncate?: boolean; isReadOnly?: boolean; claudeAccess?: 'readonly' | 'readwrite' }
}
```

- [ ] **Step 2: Add state for new toggles and import new icons**

Update the import to add `Lock` and `Trash2`:

```typescript
import { X, Eye, EyeOff, ShieldAlert, Trash2, Lock } from 'lucide-react'
```

Add state hooks after the existing `isProduction` state (around line 16):

```typescript
const [protectDropTruncate, setProtectDropTruncate] = useState(editProfile?.protectDropTruncate || false)
const [isReadOnly, setIsReadOnly] = useState(editProfile?.isReadOnly || false)
```

- [ ] **Step 3: Update handleSave to include new fields**

Update the `saveProfile` call inside `handleSave` to pass the new fields:

```typescript
await saveProfile({
  id: editProfile?.id,
  name: name.trim(),
  uri: uri.trim(),
  color,
  isProduction,
  protectDropTruncate,
  isReadOnly,
  claudeAccess
})
```

- [ ] **Step 4: Update the Read Only toggle to force Claude access**

In the `onClick` handler for the Read Only toggle (to be added in Step 5), when `isReadOnly` is turned on, force claudeAccess to `'readonly'`:

```typescript
onClick={() => {
  const next = !isReadOnly
  setIsReadOnly(next)
  if (next) setClaudeAccess('readonly')
}}
```

- [ ] **Step 5: Add the two new toggle cards after the Production toggle**

Insert these two toggle cards between the Production toggle (line 146) and the Claude access control section (line 148). They follow the exact same visual pattern as the Production toggle:

```tsx
{/* Protect from Drop & Truncate toggle */}
<div
  className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 ${
    protectDropTruncate
      ? 'border-amber-500/50 bg-amber-500/10'
      : 'border-border'
  }`}
  onClick={() => setProtectDropTruncate(!protectDropTruncate)}
>
  <Trash2
    className={`h-5 w-5 ${protectDropTruncate ? 'text-amber-400' : 'text-muted-foreground'}`}
  />
  <div className="flex-1">
    <p className={`text-sm font-medium ${protectDropTruncate ? 'text-amber-400' : ''}`}>
      Protect from Drop & Truncate
    </p>
    <p className="text-xs text-muted-foreground">
      Hide drop and truncate options from collection context menu
    </p>
  </div>
  <div
    className={`h-5 w-9 rounded-full transition-colors ${
      protectDropTruncate ? 'bg-amber-500' : 'bg-secondary'
    }`}
  >
    <div
      className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
        protectDropTruncate ? 'translate-x-4' : 'translate-x-0'
      }`}
    />
  </div>
</div>

{/* Read Only toggle */}
<div
  className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 ${
    isReadOnly
      ? 'border-blue-500/50 bg-blue-500/10'
      : 'border-border'
  }`}
  onClick={() => {
    const next = !isReadOnly
    setIsReadOnly(next)
    if (next) setClaudeAccess('readonly')
  }}
>
  <Lock
    className={`h-5 w-5 ${isReadOnly ? 'text-blue-400' : 'text-muted-foreground'}`}
  />
  <div className="flex-1">
    <p className={`text-sm font-medium ${isReadOnly ? 'text-blue-400' : ''}`}>
      Read Only
    </p>
    <p className="text-xs text-muted-foreground">
      Prevent all manual write operations on this connection
    </p>
  </div>
  <div
    className={`h-5 w-9 rounded-full transition-colors ${
      isReadOnly ? 'bg-blue-500' : 'bg-secondary'
    }`}
  >
    <div
      className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
        isReadOnly ? 'translate-x-4' : 'translate-x-0'
      }`}
    />
  </div>
</div>
```

- [ ] **Step 6: Disable Claude "Read & Write" button when Read Only is on**

Update the "Read & Write" button's `onClick` to be a no-op when `isReadOnly` is true, and add visual disabled styling:

```tsx
<button
  className={`flex-1 rounded-md border px-3 py-2 text-xs ${
    claudeAccess === 'readwrite'
      ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
      : 'border-border text-muted-foreground hover:bg-accent'
  } ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
  onClick={() => { if (!isReadOnly) setClaudeAccess('readwrite') }}
>
  <div className="font-medium">Read & Write</div>
  <div className="mt-0.5 text-[10px] opacity-75">Claude can query and modify data</div>
</button>
```

- [ ] **Step 7: Verify the dialog renders correctly**

Run: `npm run dev`
Expected: Open Edit Connection dialog. See three toggle cards (Production, Protect from Drop & Truncate, Read Only) followed by Claude AI Access. Toggling Read Only should force Claude to Read Only.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/explorer/ConnectionDialog.tsx
git commit -m "feat: add Protect from Drop & Truncate and Read Only toggles to connection dialog"
```

---

### Task 4: Create ConfirmDestructiveDialog component

**Files:**
- Create: `src/renderer/src/components/ui/confirm-destructive-dialog.tsx`

- [ ] **Step 1: Create the type-to-confirm dialog component**

```tsx
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

interface ConfirmDestructiveDialogProps {
  title: string
  description: string
  confirmText: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDestructiveDialog({
  title,
  description,
  confirmText,
  confirmLabel,
  onConfirm,
  onCancel
}: ConfirmDestructiveDialogProps) {
  const [input, setInput] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[420px] rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{description}</p>
        <div className="mb-4">
          <label className="mb-1 block text-sm text-muted-foreground">
            Type <span className="font-mono font-medium text-foreground">{confirmText}</span> to confirm
          </label>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={confirmText}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && input === confirmText) onConfirm()
              if (e.key === 'Escape') onCancel()
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={input !== confirmText}
            onClick={onConfirm}
          >
            {confirmLabel || title}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/ui/confirm-destructive-dialog.tsx
git commit -m "feat: add ConfirmDestructiveDialog component with type-to-confirm"
```

---

### Task 5: Add truncateCollection backend action and tRPC route

**Files:**
- Modify: `src/main/actions/admin.ts`
- Modify: `src/main/trpc/routers/admin.ts`

- [ ] **Step 1: Add truncateCollection to admin actions**

Add this function at the end of `src/main/actions/admin.ts`:

```typescript
export async function truncateCollection(database: string, collection: string): Promise<{ deletedCount: number }> {
  const db = mongoService.getDb(database)
  const result = await db.collection(collection).deleteMany({})
  return { deletedCount: result.deletedCount }
}
```

- [ ] **Step 2: Add truncateCollection to admin tRPC router**

Add this route to `src/main/trpc/routers/admin.ts`, after the `dropCollection` route:

```typescript
truncateCollection: procedure
  .input(z.object({ database: z.string(), collection: z.string() }))
  .mutation(async ({ input }) => {
    const result = await adminActions.truncateCollection(input.database, input.collection)
    return { truncated: true, deletedCount: result.deletedCount }
  }),
```

- [ ] **Step 3: Commit**

```bash
git add src/main/actions/admin.ts src/main/trpc/routers/admin.ts
git commit -m "feat: add truncateCollection backend action and tRPC route"
```

---

### Task 6: Add Truncate Collection to context menu and upgrade Drop to type-to-confirm

**Files:**
- Modify: `src/renderer/src/components/explorer/DatabaseTree.tsx`

- [ ] **Step 1: Add new props for the new connection flags**

Update the `DatabaseTreeProps` interface to accept the new flags:

```typescript
interface DatabaseTreeProps {
  databases: DatabaseInfo[]
  searchFilter: string
  connectionId: string
  onCopyDatabase?: (dbName: string) => void
  canPaste?: boolean
  onPasteDatabase?: () => void
  isProduction?: boolean
  protectDropTruncate?: boolean
  isReadOnly?: boolean
  claudeAccess?: 'readonly' | 'readwrite'
  claudeDbOverrides?: Record<string, 'readonly' | 'readwrite'>
  onToggleDbClaude?: (dbName: string) => void
  databaseCodebasePaths?: Record<string, string>
  onSetDbCodebasePath?: (dbName: string) => void
  onClearDbCodebasePath?: (dbName: string) => void
}
```

Update the destructured props on line 29 to include the new ones:

```typescript
export function DatabaseTree({ databases, searchFilter, connectionId, onCopyDatabase, canPaste, onPasteDatabase, isProduction, protectDropTruncate, isReadOnly, claudeAccess, claudeDbOverrides, onToggleDbClaude, databaseCodebasePaths, onSetDbCodebasePath, onClearDbCodebasePath }: DatabaseTreeProps) {
```

- [ ] **Step 2: Import the ConfirmDestructiveDialog and add state for confirmation dialogs**

Add to imports:

```typescript
import { ConfirmDestructiveDialog } from '@renderer/components/ui/confirm-destructive-dialog'
```

Add new icon import — add `Eraser` to the existing lucide import:

```typescript
import { ChevronRight, Database, Table2, Plus, Trash2, Loader2, Copy, ClipboardPaste, Eye, Download, Upload, Bot, FileUp, FolderOpen, X, MessageSquare, Terminal, Pencil, ExternalLink, RefreshCw, Eraser } from 'lucide-react'
```

Add state for the confirmation dialogs, after the existing state declarations (after line 38):

```typescript
const [dropTarget, setDropTarget] = useState<{ db: string; col: string } | null>(null)
const [truncateTarget, setTruncateTarget] = useState<{ db: string; col: string } | null>(null)
const [dropDbTarget, setDropDbTarget] = useState<string | null>(null)
```

- [ ] **Step 3: Add handleTruncateCollection function**

Add after `handleDropCollection` (around line 109):

```typescript
const handleTruncateCollection = async (dbName: string, colName: string) => {
  try {
    const result = await trpc.admin.truncateCollection.mutate({ database: dbName, collection: colName })
    alert(`Truncated "${colName}": ${result.deletedCount} documents deleted`)
    await loadCollections(dbName, connectionId)
  } catch (err) {
    alert(`Failed to truncate collection: ${err instanceof Error ? err.message : err}`)
  }
}
```

- [ ] **Step 4: Update handleDropCollection to remove inline confirm (now uses dialog)**

Replace the existing `handleDropCollection` function:

```typescript
const handleDropCollection = async (dbName: string, colName: string) => {
  try {
    await trpc.admin.dropCollection.mutate({ database: dbName, collection: colName })
    await loadCollections(dbName, connectionId)
  } catch (err) {
    alert(`Failed to drop collection: ${err instanceof Error ? err.message : err}`)
  }
}
```

- [ ] **Step 5: Update handleDropDatabase to remove inline confirm (now uses dialog)**

Replace the existing `handleDropDatabase` function:

```typescript
const handleDropDatabase = async (dbName: string) => {
  try {
    await trpc.admin.dropDatabase.mutate({ database: dbName })
    await loadDatabases()
  } catch (err) {
    alert(`Failed to drop database: ${err instanceof Error ? err.message : err}`)
  }
}
```

- [ ] **Step 6: Update the collection context menu — apply read-only greying and drop/truncate visibility**

Replace the collection context menu items section (lines 403-492) inside `<ContextMenu.Content>`. The key changes are:
1. Insert Documents, Import JSON, Rename Collection get greyed out when `isReadOnly`
2. Drop Collection uses `setDropTarget` instead of inline confirm, hidden when `protectDropTruncate`
3. Truncate Collection added, hidden when `protectDropTruncate`

```tsx
<ContextMenu.Content className="min-w-[160px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
  <ContextMenu.Item
    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
    onSelect={() => openNewTab(connectionId, db.name, col.name, col.type === 'view')}
  >
    <ExternalLink className="h-3.5 w-3.5" />
    Open in New Tab
  </ContextMenu.Item>
  <ContextMenu.Separator className="my-1 h-px bg-border" />
  <ContextMenu.Item
    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
    onSelect={async () => {
      const result = await trpc.exportImport.exportCollection.mutate({
        database: db.name, collection: col.name, format: 'json'
      })
      if (result) alert(`Exported ${result.count} documents to ${result.path}`)
    }}
  >
    <Download className="h-3.5 w-3.5" />
    Export as JSON
  </ContextMenu.Item>
  <ContextMenu.Item
    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
    onSelect={async () => {
      const result = await trpc.exportImport.exportCollection.mutate({
        database: db.name, collection: col.name, format: 'csv'
      })
      if (result) alert(`Exported ${result.count} documents to ${result.path}`)
    }}
  >
    <Download className="h-3.5 w-3.5" />
    Export as CSV
  </ContextMenu.Item>
  {!isProduction && !isReadOnly && (
    <ContextMenu.Item
      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
      onSelect={async () => {
        try {
          const result = await trpc.exportImport.importCollection.mutate({
            database: db.name, collection: col.name
          })
          if (result) alert(`Imported ${result.count} documents`)
        } catch (err) {
          alert(`Import failed: ${err instanceof Error ? err.message : err}`)
        }
      }}
    >
      <Upload className="h-3.5 w-3.5" />
      Import JSON
    </ContextMenu.Item>
  )}
  {isReadOnly && (
    <ContextMenu.Item
      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground cursor-not-allowed"
      disabled
    >
      <Upload className="h-3.5 w-3.5" />
      Import JSON
    </ContextMenu.Item>
  )}
  <ContextMenu.Separator className="my-1 h-px bg-border" />
  {isReadOnly ? (
    <ContextMenu.Item
      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground cursor-not-allowed"
      disabled
    >
      <FileUp className="h-3.5 w-3.5" />
      Insert Documents...
    </ContextMenu.Item>
  ) : (
    <ContextMenu.Item
      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
      onSelect={() => setInsertTarget({ db: db.name, col: col.name })}
    >
      <FileUp className="h-3.5 w-3.5" />
      Insert Documents...
    </ContextMenu.Item>
  )}
  <ContextMenu.Item
    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
    onSelect={async () => {
      try {
        await trpc.mongosh.open.mutate({ connectionId, database: db.name, collection: col.name })
      } catch (err) {
        alert(`Failed to open mongosh: ${err instanceof Error ? err.message : err}`)
      }
    }}
  >
    <Terminal className="h-3.5 w-3.5" />
    Open mongosh
  </ContextMenu.Item>
  <ContextMenu.Separator className="my-1 h-px bg-border" />
  {isReadOnly ? (
    <ContextMenu.Item
      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground cursor-not-allowed"
      disabled
    >
      <Pencil className="h-3.5 w-3.5" />
      Rename Collection
    </ContextMenu.Item>
  ) : (
    <ContextMenu.Item
      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
      onSelect={() => {
        setRenameTarget({ db: db.name, col: col.name })
        setRenameInput(col.name)
      }}
    >
      <Pencil className="h-3.5 w-3.5" />
      Rename Collection
    </ContextMenu.Item>
  )}
  {!protectDropTruncate && (
    <>
      {isReadOnly ? (
        <ContextMenu.Item
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground cursor-not-allowed"
          disabled
        >
          <Eraser className="h-3.5 w-3.5" />
          Truncate Collection
        </ContextMenu.Item>
      ) : (
        <ContextMenu.Item
          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-amber-500 outline-none hover:bg-amber-500/10"
          onSelect={() => setTruncateTarget({ db: db.name, col: col.name })}
        >
          <Eraser className="h-3.5 w-3.5" />
          Truncate Collection
        </ContextMenu.Item>
      )}
      {isReadOnly ? (
        <ContextMenu.Item
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground cursor-not-allowed"
          disabled
        >
          <Trash2 className="h-3.5 w-3.5" />
          Drop Collection
        </ContextMenu.Item>
      ) : (
        <ContextMenu.Item
          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-destructive outline-none hover:bg-destructive/10"
          onSelect={() => setDropTarget({ db: db.name, col: col.name })}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Drop Collection
        </ContextMenu.Item>
      )}
    </>
  )}
</ContextMenu.Content>
```

- [ ] **Step 7: Update the database context menu — apply read-only greying and drop visibility**

In the database context menu, update the following items:

For "New Collection" (around line 195), wrap with read-only check:

```tsx
{isReadOnly ? (
  <ContextMenu.Item
    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground cursor-not-allowed"
    disabled
  >
    <Plus className="h-3.5 w-3.5" />
    New Collection
  </ContextMenu.Item>
) : (
  <ContextMenu.Item
    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
    onSelect={() => {
      setNewCollName({ db: db.name })
      if (!expandedDbs.has(db.name)) toggleDb(db.name)
    }}
  >
    <Plus className="h-3.5 w-3.5" />
    New Collection
  </ContextMenu.Item>
)}
```

For "Import Database (from dump)" (around line 311), add `!isReadOnly` to the condition:

```tsx
{!isProduction && !isReadOnly && (
```

For "Drop Database" (around line 330), update to use the new dialog and handle read-only:

```tsx
{isReadOnly ? (
  <ContextMenu.Item
    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground cursor-not-allowed"
    disabled
  >
    <Trash2 className="h-3.5 w-3.5" />
    Drop Database
  </ContextMenu.Item>
) : (
  <ContextMenu.Item
    className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none ${
      isProduction
        ? 'text-muted-foreground'
        : 'text-destructive hover:bg-destructive/10'
    }`}
    onSelect={() => {
      if (isProduction) {
        alert('Cannot drop a database on a production connection.')
        return
      }
      setDropDbTarget(db.name)
    }}
  >
    <Trash2 className="h-3.5 w-3.5" />
    Drop Database {isProduction && '(blocked)'}
  </ContextMenu.Item>
)}
```

- [ ] **Step 8: Add the confirmation dialogs at the end of the component return**

Add these just before the closing `</div>` of the component's return, after the existing `ImportDatabaseDialog` render (around line 627):

```tsx
{dropTarget && (
  <ConfirmDestructiveDialog
    title="Drop Collection"
    description={`This will permanently delete the collection "${dropTarget.col}" and all its documents from database "${dropTarget.db}". This cannot be undone.`}
    confirmText={dropTarget.col}
    confirmLabel="Drop Collection"
    onConfirm={() => {
      handleDropCollection(dropTarget.db, dropTarget.col)
      setDropTarget(null)
    }}
    onCancel={() => setDropTarget(null)}
  />
)}
{truncateTarget && (
  <ConfirmDestructiveDialog
    title="Truncate Collection"
    description={`This will delete ALL documents from "${truncateTarget.col}" in database "${truncateTarget.db}". The collection, its indexes, and metadata will be preserved. This cannot be undone.`}
    confirmText={truncateTarget.col}
    confirmLabel="Truncate Collection"
    onConfirm={() => {
      handleTruncateCollection(truncateTarget.db, truncateTarget.col)
      setTruncateTarget(null)
    }}
    onCancel={() => setTruncateTarget(null)}
  />
)}
{dropDbTarget && (
  <ConfirmDestructiveDialog
    title="Drop Database"
    description={`This will permanently delete the database "${dropDbTarget}" and ALL its collections. This cannot be undone.`}
    confirmText={dropDbTarget}
    confirmLabel="Drop Database"
    onConfirm={() => {
      handleDropDatabase(dropDbTarget)
      setDropDbTarget(null)
    }}
    onCancel={() => setDropDbTarget(null)}
  />
)}
```

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/explorer/DatabaseTree.tsx
git commit -m "feat: add Truncate Collection to context menu, type-to-confirm for Drop/Truncate, read-only greying"
```

---

### Task 7: Pass new props from Sidebar to DatabaseTree

**Files:**
- Modify: `src/renderer/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Pass protectDropTruncate and isReadOnly to DatabaseTree**

In `Sidebar.tsx`, update the `<DatabaseTree>` render (around line 176) to include the new props:

```tsx
<DatabaseTree
  databases={databases}
  searchFilter={search}
  connectionId={profile.id}
  onCopyDatabase={(db) => handleCopyDatabase(profile.id, db)}
  canPaste={clipboard !== null}
  onPasteDatabase={() => handlePasteDatabase(profile.id)}
  isProduction={profile.isProduction}
  protectDropTruncate={profile.protectDropTruncate}
  isReadOnly={profile.isReadOnly}
  claudeAccess={profile.claudeAccess}
  claudeDbOverrides={profile.claudeDbOverrides}
  databaseCodebasePaths={profile.databaseCodebasePaths}
```

- [ ] **Step 2: Update Sidebar connection context menu for read-only**

In the connection context menu, update "Create Database" and "Import Database from Dump" conditions to also check `isReadOnly`. Update the two conditions (lines 252 and 261):

```tsx
{isThisConnected && !profile.isProduction && !profile.isReadOnly && (
  <ContextMenu.Item
    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
    onSelect={() => setShowCreateDb(profile.id)}
  >
    <Database className="h-3.5 w-3.5" />
    Create Database
  </ContextMenu.Item>
)}
{isThisConnected && !profile.isProduction && !profile.isReadOnly && (
  <ContextMenu.Item
```

Also update `handlePasteDatabase` to check `isReadOnly`:

```typescript
const handlePasteDatabase = (targetConnectionId: string) => {
  if (!clipboard) return
  const targetProfile = profiles.find((p) => p.id === targetConnectionId)
  if (targetProfile?.isProduction) {
    alert('Cannot paste into a production connection. Production connections are protected from mass write operations.')
    return
  }
  if (targetProfile?.isReadOnly) {
    alert('Cannot paste into a read-only connection. Disable Read Only in connection settings to allow writes.')
    return
  }
  setPasteTarget(targetConnectionId)
}
```

Update the paste menu item in the connection context menu to also grey out for `isReadOnly`:

```tsx
{clipboard && isThisConnected && (
  <>
    <ContextMenu.Separator className="my-1 h-px bg-border" />
    <ContextMenu.Item
      className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent ${
        profile.isProduction || profile.isReadOnly ? 'text-muted-foreground' : ''
      }`}
      onSelect={() => handlePasteDatabase(profile.id)}
      disabled={profile.isProduction || profile.isReadOnly}
    >
      <ClipboardPaste className="h-3.5 w-3.5" />
      Paste "{clipboard.database}"
      {profile.isProduction && ' (blocked)'}
      {!profile.isProduction && profile.isReadOnly && ' (read-only)'}
    </ContextMenu.Item>
  </>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/layout/Sidebar.tsx
git commit -m "feat: pass new safety props to DatabaseTree, enforce read-only in Sidebar"
```

---

### Task 8: Add read-only enforcement to backend tRPC routers

**Files:**
- Modify: `src/main/trpc/routers/admin.ts`
- Modify: `src/main/trpc/routers/mutation.ts`
- Modify: `src/main/actions/exportImport.ts`
- Modify: `src/main/actions/migration.ts`

- [ ] **Step 1: Create a shared read-only check helper**

Add a helper function to `src/main/actions/connection.ts` at the end of the file:

```typescript
/**
 * Check if the active connection is marked as read-only.
 * Returns an error message if blocked, null if allowed.
 */
export function checkReadOnly(): string | null {
  const activeId = mongoService.getActiveConnectionId()
  if (!activeId) return null

  const connections = configService.loadConnections()
  const profile = connections.find((c) => c.id === activeId)
  if (!profile) return null

  if (profile.isReadOnly) {
    return `This connection ("${profile.name}") is read-only. Disable Read Only in connection settings to allow writes.`
  }
  return null
}
```

- [ ] **Step 2: Add read-only checks to admin router**

In `src/main/trpc/routers/admin.ts`, import the check and add it to write operations:

```typescript
import { router, procedure, z } from '../context'
import * as adminActions from '../../actions/admin'
import * as connectionActions from '../../actions/connection'

export const adminRouter = router({
  dropDatabase: procedure
    .input(z.object({ database: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      await adminActions.dropDatabase(input.database)
      return { dropped: true }
    }),

  dropCollection: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      await adminActions.dropCollection(input.database, input.collection)
      return { dropped: true }
    }),

  truncateCollection: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      const result = await adminActions.truncateCollection(input.database, input.collection)
      return { truncated: true, deletedCount: result.deletedCount }
    }),

  createCollection: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      await adminActions.createCollection(input.database, input.collection)
      return { created: true }
    }),

  renameCollection: procedure
    .input(z.object({ database: z.string(), oldName: z.string(), newName: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      await adminActions.renameCollection(input.database, input.oldName, input.newName)
      return { renamed: true }
    }),
```

Leave `listIndexes`, `createIndex`, `dropIndex`, `indexStats` unchanged (index management is not a document write operation, but `createIndex` and `dropIndex` are schema changes — leave them accessible for now as the spec only mentions document/collection-level operations).

- [ ] **Step 3: Add read-only checks to mutation router**

In `src/main/trpc/routers/mutation.ts`, import and add the check to all mutations:

```typescript
import { router, procedure, z } from '../context'
import * as mutationActions from '../../actions/mutation'
import * as changelog from '../../services/changelog'
import * as connectionActions from '../../actions/connection'

export const mutationRouter = router({
  insertOne: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        document: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      return mutationActions.insertOne(input.database, input.collection, input.document)
    }),

  updateOne: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()),
        update: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      return mutationActions.updateOne(input.database, input.collection, input.filter, input.update)
    }),

  deleteOne: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      return mutationActions.deleteOne(input.database, input.collection, input.filter)
    }),

  deleteMany: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      return mutationActions.deleteMany(input.database, input.collection, input.filter)
    }),

  insertMany: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        documents: z.array(z.record(z.unknown()))
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      const result = await mutationActions.insertMany(input.database, input.collection, input.documents)
      changelog.appendChangeLog({
        source: 'user', connectionId: '', connectionName: '',
        database: input.database, collection: input.collection,
        operation: 'insert', count: result.insertedCount
      })
      return result
    }),

  updateMany: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()),
        update: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      const result = await mutationActions.updateMany(
        input.database, input.collection, input.filter, input.update
      )
      changelog.appendChangeLog({
        source: 'user', connectionId: '', connectionName: '',
        database: input.database, collection: input.collection,
        operation: 'update', filter: input.filter, changes: input.update,
        count: result.modifiedCount
      })
      return result
    }),
})
```

- [ ] **Step 4: Add read-only checks to exportImport.ts**

In `src/main/actions/exportImport.ts`, add read-only checks alongside the existing `isProduction` checks.

At line 818 (in `importDatabaseDump`), add after the production check:

```typescript
if (profile?.isReadOnly) throw new Error('Cannot import to a read-only connection')
```

At line 939 (in `importDatabaseFromDump`), add after the production check:

```typescript
if (profile?.isReadOnly) throw new Error('Cannot import to a read-only connection')
```

- [ ] **Step 5: Add read-only checks to migration.ts**

In `src/main/actions/migration.ts`, at line 192 (in `copyDatabase`), add after the production check:

```typescript
if (targetProfile?.isReadOnly) {
  throw new Error(
    `Cannot copy to "${targetProfile.name}" — it is marked as read-only. ` +
      'Disable Read Only in connection settings to allow writes.'
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add src/main/actions/connection.ts src/main/trpc/routers/admin.ts src/main/trpc/routers/mutation.ts src/main/actions/exportImport.ts src/main/actions/migration.ts
git commit -m "feat: add backend read-only enforcement to all write operations"
```

---

### Task 9: Update MCP checkWriteAccess for isReadOnly

**Files:**
- Modify: `src/main/mcp/tools.ts:30-49`

- [ ] **Step 1: Add isReadOnly check to checkWriteAccess**

Update the `checkWriteAccess` function in `src/main/mcp/tools.ts` to also check `isReadOnly`:

```typescript
function checkWriteAccess(database?: string): string | null {
  const activeId = mongoService.getActiveConnectionId()
  if (!activeId) return 'No active connection'

  const connections = configService.loadConnections()
  const profile = connections.find((c) => c.id === activeId)
  if (!profile) return 'Connection profile not found'

  // Read-only connections block all writes, no per-database override
  if (profile.isReadOnly) {
    return `BLOCKED: connection "${profile.name}" is marked as read-only. All mutations are blocked. The user must disable Read Only in connection settings to allow writes.`
  }

  // Determine effective access: per-database override takes priority over connection default
  const connectionDefault = profile.claudeAccess || (profile.isProduction ? 'readonly' : 'readwrite')
  const effectiveAccess = (database && profile.claudeDbOverrides?.[database]) || connectionDefault

  if (effectiveAccess === 'readonly') {
    const overridden = database && profile.claudeDbOverrides?.[database]
    const source = overridden ? `database "${database}"` : `connection "${profile.name}"`
    return `BLOCKED: ${source} has Claude access set to "readonly". Mutations are not allowed. The user can change this by right-clicking the ${overridden ? 'database' : 'connection'} and toggling Claude access.`
  }

  return null
}
```

- [ ] **Step 2: Update getConnectionsSummary to include new flags**

Update `getConnectionsSummary` to show the new flags:

```typescript
function getConnectionsSummary(): string {
  const connections = configService.loadConnections()
  const connectedIds = mongoService.getConnectedIds()
  const activeId = mongoService.getActiveConnectionId()

  const lines = connections.map((c) => {
    const connected = connectedIds.includes(c.id) ? 'CONNECTED' : 'disconnected'
    const active = c.id === activeId ? ' (ACTIVE)' : ''
    const prod = c.isProduction ? ' [PRODUCTION]' : ''
    const readOnly = c.isReadOnly ? ' [READ-ONLY]' : ''
    const access = `claude:${c.claudeAccess || (c.isProduction ? 'readonly' : 'readwrite')}`
    return `- ${c.name}${active}: ${connected}${prod}${readOnly} (${access})`
  })

  return lines.join('\n')
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/mcp/tools.ts
git commit -m "feat: add isReadOnly check to MCP checkWriteAccess and connection summary"
```

---

### Task 10: Update Claude system prompt to mention read-only connections

**Files:**
- Modify: `src/main/services/claude.ts:82-95`

- [ ] **Step 1: Update the connections loop in buildSystemPrompt**

Update the loop that builds connection info (around line 82) to include read-only flag:

```typescript
for (const c of connections) {
  const connected = connectedIds.includes(c.id) ? 'CONNECTED' : 'disconnected'
  const active = c.id === activeId ? ' (ACTIVE - currently focused)' : ''
  const prod = c.isProduction ? ' [PRODUCTION]' : ''
  const readOnly = c.isReadOnly ? ' [READ-ONLY]' : ''
  const defaultAccess = c.claudeAccess || (c.isProduction ? 'readonly' : 'readwrite')
  lines.push(`- ${c.name} (id: ${c.id}): ${connected}${active}${prod}${readOnly} [claude-default:${defaultAccess}]`)
```

- [ ] **Step 2: Add read-only rule to WRITE ACCESS RULES**

In the system prompt rules section (around line 73), add a rule about read-only connections:

```typescript
'- Connections marked [READ-ONLY] block ALL writes regardless of Claude access settings or per-database overrides.',
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/claude.ts
git commit -m "feat: add read-only awareness to Claude system prompt"
```

---

### Task 11: Disable cell editing in DocumentTable when connection is read-only

**Files:**
- Modify: `src/renderer/src/components/data/DocumentTable.tsx`

- [ ] **Step 1: Access the active connection profile from the store**

Add the connection store import and get the active profile at the top of the component. In `DocumentTable.tsx`, add import:

```typescript
import { useConnectionStore } from '@renderer/store/connectionStore'
```

Inside the component function, after the existing store hooks, add:

```typescript
const activeProfile = useConnectionStore((s) => {
  const activeId = s.activeConnection?.profileId
  return activeId ? s.profiles.find((p) => p.id === activeId) : undefined
})
const isReadOnly = activeProfile?.isReadOnly ?? false
```

- [ ] **Step 2: Disable cell editing when read-only**

Find where ag-grid columns are set as editable. In the column definitions, the editable property needs to be conditional. Look for where `editable` is set (search for `editable: true` or the editable logic). Update it to:

```typescript
editable: !isView && !isReadOnly
```

This applies to regular cell editing. Also disable the "Add Row" button by conditioning it on `!isReadOnly`. Find the add-row button and update:

```tsx
{!isView && !isReadOnly && (
  <Button ... onClick={() => setAddRowOpen(true)}>
    <Plus className="h-3.5 w-3.5" />
  </Button>
)}
```

And the delete document handler:

```typescript
const handleDeleteDocument = async (doc: Record<string, unknown>) => {
  if (!tab || !doc._id || isReadOnly) return
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/data/DocumentTable.tsx
git commit -m "feat: disable cell editing, add row, and delete in DocumentTable when read-only"
```

---

### Task 12: Manual integration test

- [ ] **Step 1: Start the app and test new toggles**

Run: `npm run dev`

Test plan:
1. Open Edit Connection dialog — verify all three toggles render correctly
2. Toggle "Protect from Drop & Truncate" ON — verify Drop Collection and Truncate Collection are hidden from the context menu
3. Toggle "Read Only" ON — verify:
   - All write items in context menu are greyed out
   - Claude AI Access is forced to Read Only
   - Cell editing is disabled in the data grid
   - Insert Documents, Rename Collection, Import JSON are greyed out
4. Test Truncate Collection — right-click a collection, select Truncate, type the name, confirm
5. Test Drop Collection — right-click, select Drop, type the name, confirm
6. Verify both toggles persist after closing and reopening the dialog
7. Test that existing connections still work (no migration issues)

- [ ] **Step 2: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address integration test findings"
```
