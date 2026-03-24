# Core MongoDB Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sort/projection/limit UI to the query builder, index management, query history, bulk operations, and codebase context for Claude AI.

**Architecture:** Layered approach following existing patterns — action functions (pure DB ops) → tRPC routers (validation + changelog) → MCP tools (write-access gating + changelog) → React UI (Zustand stores + components). Each feature is independently shippable.

**Tech Stack:** Electron 35, React 19, TypeScript, Tailwind CSS 4, Zustand, tRPC, AG Grid, MongoDB Driver 6, MCP SDK, Claude Agent SDK

**Spec:** `docs/superpowers/specs/2026-03-24-core-mongodb-features-design.md`

---

## File Structure

### New Files
```
src/main/services/queryHistory.ts          — Query history persistence (debounced writes)
src/main/services/codebaseContext.ts       — File scanning for Claude context injection
src/renderer/src/components/query/SortBuilder.tsx        — Sort row builder
src/renderer/src/components/query/ProjectionBuilder.tsx  — Field include/exclude builder
src/renderer/src/components/query/QueryFooter.tsx        — Skip/Limit/Run/History bar
src/renderer/src/components/query/QueryHistoryPanel.tsx  — History dropdown panel
src/renderer/src/components/indexes/IndexPanel.tsx       — Index list + management tab
src/renderer/src/components/indexes/CreateIndexDialog.tsx — Index creation modal
src/renderer/src/components/data/BulkToolbar.tsx         — Floating selection toolbar
src/renderer/src/components/data/InsertDocumentsDialog.tsx — Bulk insert modal
src/renderer/src/components/data/UpdateManyDialog.tsx    — Bulk update modal
```

### Modified Files
```
src/shared/types.ts                        — Add codebasePath to ConnectionProfile
src/main/constants.ts                      — Add QUERY_HISTORY_FILE path
src/main/actions/admin.ts                  — Add createIndex, dropIndex, getIndexStats
src/main/actions/mutation.ts               — Add insertMany, updateMany
src/main/trpc/routers/admin.ts             — Add index CRUD routes
src/main/trpc/routers/mutation.ts          — Add bulk mutation routes
src/main/trpc/routers/query.ts             — Add 5 history routes
src/main/mcp/tools.ts                      — Add 6 new MCP tools
src/main/services/claude.ts                — Inject codebase context into system prompt
src/main/services/config.ts                — Persist codebasePath
src/renderer/src/store/tabStore.ts         — Add setSort, setProjection, selectedDocIds
src/renderer/src/components/query/QueryBuilder.tsx — Refactor into accordion, fix handleRun
src/renderer/src/components/data/MainPanel.tsx     — Add Documents/Indexes sub-tabs
src/renderer/src/components/data/DocumentTable.tsx — Add checkbox column, multi-select
src/renderer/src/components/layout/Sidebar.tsx     — Add Insert Documents context menu
src/renderer/src/components/explorer/ConnectionDialog.tsx — Add codebasePath field
```

### Deleted Files
```
src/renderer/src/store/queryStore.ts       — Unused legacy store
```

---

## Phase 1: Enhanced Query Builder

### Task 1: Add setSort and setProjection to tabStore

**Files:**
- Modify: `src/renderer/src/store/tabStore.ts:58-91`
- Delete: `src/renderer/src/store/queryStore.ts`

- [ ] **Step 1: Add setSort and setProjection to TabStore interface**

In `src/renderer/src/store/tabStore.ts`, add two new actions to the `TabStore` interface after `setPageSize` (line 71):

```typescript
  setSort: (sort: Record<string, number> | null) => void
  setProjection: (projection: Record<string, number> | null) => void
```

- [ ] **Step 2: Implement setSort and setProjection**

Add the implementations after the `setPageSize` implementation (after line 168).

**IMPORTANT:** These do NOT call `executeQuery()` — they only update tab state, matching the `setFilter` pattern. The user clicks Run to execute. This avoids firing queries on every keystroke in the sort/projection builders.

```typescript
  setSort: (sort) => {
    const tab = get().getActiveTab()
    if (!tab) return
    get().updateTab(tab.id, { sort, page: 0 })
  },

  setProjection: (projection) => {
    const tab = get().getActiveTab()
    if (!tab) return
    get().updateTab(tab.id, { projection, page: 0 })
  },
```

- [ ] **Step 3: Delete the unused queryStore.ts**

```bash
rm src/renderer/src/store/queryStore.ts
```

Verify no imports reference it:

```bash
grep -r "queryStore" src/renderer/
```

If any imports exist, remove them.

- [ ] **Step 4: Run the dev server to verify no compilation errors**

```bash
pnpm dev
```

Expected: App launches without errors. Existing query functionality unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/tabStore.ts
git rm src/renderer/src/store/queryStore.ts
git commit -m "feat: add setSort/setProjection to tabStore, delete unused queryStore"
```

---

### Task 2: Create SortBuilder component

**Files:**
- Create: `src/renderer/src/components/query/SortBuilder.tsx`

- [ ] **Step 1: Create the SortBuilder component**

Create `src/renderer/src/components/query/SortBuilder.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { Plus, X, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'

interface SortField {
  id: string
  field: string
  direction: 1 | -1
}

export function SortBuilder() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const setSort = useTabStore((s) => s.setSort)
  const results = activeTab?.results

  // Infer available fields from results
  const availableFields = results?.documents?.length
    ? [...new Set(results.documents.flatMap((d) => Object.keys(d)))]
    : []

  const [fields, setFields] = useState<SortField[]>([])

  // Sync from tab state when tab changes
  useEffect(() => {
    if (!activeTab?.sort) {
      setFields([])
      return
    }
    setFields(
      Object.entries(activeTab.sort).map(([field, dir]) => ({
        id: crypto.randomUUID(),
        field,
        direction: dir as 1 | -1
      }))
    )
  }, [activeTab?.id])

  function applySort(updatedFields: SortField[]) {
    setFields(updatedFields)
    if (updatedFields.length === 0) {
      setSort(null)
      return
    }
    const sortObj: Record<string, number> = {}
    for (const f of updatedFields) {
      if (f.field.trim()) sortObj[f.field.trim()] = f.direction
    }
    if (Object.keys(sortObj).length > 0) setSort(sortObj)
  }

  function addField() {
    applySort([...fields, { id: crypto.randomUUID(), field: '', direction: 1 }])
  }

  function removeField(id: string) {
    applySort(fields.filter((f) => f.id !== id))
  }

  function updateField(id: string, updates: Partial<SortField>) {
    applySort(fields.map((f) => (f.id === id ? { ...f, ...updates } : f)))
  }

  function moveField(index: number, direction: -1 | 1) {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= fields.length) return
    const arr = [...fields]
    ;[arr[index], arr[newIndex]] = [arr[newIndex], arr[index]]
    applySort(arr)
  }

  return (
    <div className="space-y-1.5 p-2">
      {fields.map((f, i) => (
        <div key={f.id} className="flex items-center gap-1.5">
          <div className="flex flex-col">
            <button
              className="text-muted-foreground hover:text-foreground disabled:opacity-20"
              disabled={i === 0}
              onClick={() => moveField(i, -1)}
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              className="text-muted-foreground hover:text-foreground disabled:opacity-20"
              disabled={i === fields.length - 1}
              onClick={() => moveField(i, 1)}
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>

          <input
            className="h-7 flex-1 rounded border border-border bg-background px-2 text-xs"
            placeholder="Field name"
            value={f.field}
            onChange={(e) => updateField(f.id, { field: e.target.value })}
            list="sort-fields"
          />

          <button
            className={`rounded px-2 py-1 text-xs font-semibold ${
              f.direction === 1
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }`}
            onClick={() => updateField(f.id, { direction: f.direction === 1 ? -1 : 1 })}
          >
            {f.direction === 1 ? 'ASC' : 'DESC'}
          </button>

          <button
            className="text-muted-foreground hover:text-destructive"
            onClick={() => removeField(f.id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <datalist id="sort-fields">
        {availableFields.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={addField}>
        <Plus className="mr-1 h-3 w-3" /> Add sort field
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm build
```

Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/query/SortBuilder.tsx
git commit -m "feat: create SortBuilder component"
```

---

### Task 3: Create ProjectionBuilder component

**Files:**
- Create: `src/renderer/src/components/query/ProjectionBuilder.tsx`

- [ ] **Step 1: Create the ProjectionBuilder component**

Create `src/renderer/src/components/query/ProjectionBuilder.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'

type Mode = 'include' | 'exclude'

export function ProjectionBuilder() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const setProjection = useTabStore((s) => s.setProjection)
  const results = activeTab?.results

  const detectedFields = results?.documents?.length
    ? [...new Set(results.documents.flatMap((d) => Object.keys(d)))]
    : []

  const [mode, setMode] = useState<Mode>('include')
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [includeId, setIncludeId] = useState(true)
  const [manualField, setManualField] = useState('')

  // Initialize from tab state
  useEffect(() => {
    if (!activeTab?.projection) {
      setSelectedFields(new Set())
      return
    }
    const vals = Object.values(activeTab.projection)
    const isInclude = vals.some((v) => v === 1)
    setMode(isInclude ? 'include' : 'exclude')
    const fields = new Set(
      Object.entries(activeTab.projection)
        .filter(([k, v]) => k !== '_id' && (isInclude ? v === 1 : v === 0))
        .map(([k]) => k)
    )
    setSelectedFields(fields)
    if ('_id' in activeTab.projection) {
      setIncludeId(activeTab.projection._id !== 0)
    }
  }, [activeTab?.id])

  function applyProjection(fields: Set<string>, m: Mode, inclId: boolean) {
    if (fields.size === 0 && inclId) {
      setProjection(null)
      return
    }
    const proj: Record<string, number> = {}
    if (!inclId) proj._id = 0
    for (const f of fields) {
      proj[f] = m === 'include' ? 1 : 0
    }
    setProjection(Object.keys(proj).length > 0 ? proj : null)
  }

  function toggleField(field: string) {
    const next = new Set(selectedFields)
    if (next.has(field)) next.delete(field)
    else next.add(field)
    setSelectedFields(next)
    applyProjection(next, mode, includeId)
  }

  function toggleMode() {
    const newMode = mode === 'include' ? 'exclude' : 'include'
    setMode(newMode)
    setSelectedFields(new Set())
    applyProjection(new Set(), newMode, includeId)
  }

  function toggleId() {
    const next = !includeId
    setIncludeId(next)
    applyProjection(selectedFields, mode, next)
  }

  function addManualField() {
    const f = manualField.trim()
    if (!f) return
    const next = new Set(selectedFields)
    next.add(f)
    setSelectedFields(next)
    setManualField('')
    applyProjection(next, mode, includeId)
  }

  const allFields = [...new Set([...detectedFields, ...selectedFields])]

  return (
    <div className="space-y-2 p-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Mode:</span>
        <button
          className={`rounded px-2 py-0.5 font-medium ${
            mode === 'include'
              ? 'bg-green-500/20 text-green-400'
              : 'bg-red-500/20 text-red-400'
          }`}
          onClick={toggleMode}
        >
          {mode === 'include' ? 'Include selected' : 'Exclude selected'}
        </button>
        <span className="text-muted-foreground">|</span>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={includeId}
            onChange={toggleId}
            className="h-3 w-3 rounded"
          />
          <span className="text-muted-foreground">Include _id</span>
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {allFields
          .filter((f) => f !== '_id')
          .map((f) => (
            <button
              key={f}
              className={`rounded px-2 py-0.5 text-xs border ${
                selectedFields.has(f)
                  ? mode === 'include'
                    ? 'border-green-500/50 bg-green-500/20 text-green-300'
                    : 'border-red-500/50 bg-red-500/20 text-red-300'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => toggleField(f)}
            >
              {f}
            </button>
          ))}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          className="h-6 flex-1 rounded border border-border bg-background px-2 text-xs"
          placeholder="Nested field path (e.g. address.city)"
          value={manualField}
          onChange={(e) => setManualField(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addManualField()}
        />
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={addManualField}>
          <Plus className="mr-1 h-3 w-3" /> Add
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/query/ProjectionBuilder.tsx
git commit -m "feat: create ProjectionBuilder component"
```

---

### Task 4: Create QueryFooter component

**Files:**
- Create: `src/renderer/src/components/query/QueryFooter.tsx`

- [ ] **Step 1: Create the QueryFooter component**

Create `src/renderer/src/components/query/QueryFooter.tsx`:

```tsx
import { Play, Clock, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'

interface QueryFooterProps {
  onRun: () => void
  onToggleHistory: () => void
  loading: boolean
}

export function QueryFooter({ onRun, onToggleHistory, loading }: QueryFooterProps) {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const setPageSize = useTabStore((s) => s.setPageSize)

  const limit = activeTab?.pageSize ?? 50
  const skip = (activeTab?.page ?? 0) * limit

  return (
    <div className="flex items-center gap-3 border-t border-border px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Skip:</span>
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-muted-foreground">
          {skip}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Limit:</span>
        <input
          type="number"
          className="h-6 w-16 rounded border border-border bg-background px-2 text-center text-xs"
          value={limit}
          min={1}
          max={1000}
          onChange={(e) => {
            const val = parseInt(e.target.value)
            if (!isNaN(val) && val > 0 && val <= 1000) setPageSize(val)
          }}
        />
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onToggleHistory}>
          <Clock className="mr-1 h-3.5 w-3.5" /> History
        </Button>
        <Button
          size="sm"
          className="h-7 bg-green-600 text-xs text-white hover:bg-green-700"
          onClick={onRun}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="mr-1 h-3.5 w-3.5" />
          )}
          Run
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/query/QueryFooter.tsx
git commit -m "feat: create QueryFooter component with skip/limit/run/history"
```

---

### Task 5: Refactor QueryBuilder into accordion layout

**Files:**
- Modify: `src/renderer/src/components/query/QueryBuilder.tsx`

- [ ] **Step 1: Refactor QueryBuilder.tsx**

This is the largest change. The existing QueryBuilder keeps its filter UI but gets wrapped in an accordion section. Sort, Projection, and Footer sections are added. Key changes:

1. Import the new components at the top
2. Add accordion state for each section (`filterExpanded`, `sortExpanded`, `projectionExpanded`)
3. Wrap the existing filter rows in a collapsible section header
4. Add Sort and Projection sections below filter
5. Replace the existing Run button with QueryFooter
6. Fix the `handleRun` bug: remove `selectedDatabase`/`selectedCollection` references, just call `executeQuery()` directly
7. Add History panel state (toggle)

The section headers follow this pattern:
```tsx
<button
  className="flex w-full items-center justify-between px-3 py-1.5 text-xs font-semibold"
  onClick={() => setSortExpanded(!sortExpanded)}
>
  <span className="text-blue-400">Sort</span>
  <span className="text-muted-foreground text-[10px]">
    {activeTab?.sort ? Object.entries(activeTab.sort).map(([k,v]) => `${k} ${v===1?'ASC':'DESC'}`).join(', ') : 'None'}
  </span>
</button>
{sortExpanded && <SortBuilder />}
```

Read the current `QueryBuilder.tsx` fully, then:
- Keep all existing filter logic (lines 1-500)
- Remove the Run/Clear button bar from the bottom of the filter section
- Add `SortBuilder`, `ProjectionBuilder`, `QueryFooter` sections
- Add `QueryHistoryPanel` placeholder (will be empty for now, implemented in Phase 2)
- Fix `handleRun`: replace the body with `executeQuery()` — remove any references to `selectedDatabase`/`selectedCollection`

- [ ] **Step 2: Verify the app runs correctly**

```bash
pnpm dev
```

Test: Open a collection → filter section should show as before. Sort and Projection sections should be visible (collapsed by default). Footer with Skip/Limit/Run should appear at the bottom.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/query/QueryBuilder.tsx
git commit -m "feat: refactor QueryBuilder into accordion with sort/projection/footer"
```

---

## Phase 2: Query History

### Task 6: Create query history backend service

**Files:**
- Modify: `src/main/constants.ts`
- Create: `src/main/services/queryHistory.ts`

- [ ] **Step 1: Add QUERY_HISTORY_FILE constant**

In `src/main/constants.ts`, add after line 7:

```typescript
export const QUERY_HISTORY_FILE = join(CONFIG_DIR, 'query-history.json')
```

- [ ] **Step 2: Create the query history service**

Create `src/main/services/queryHistory.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { QUERY_HISTORY_FILE, CONFIG_DIR } from '../constants'

export interface QueryHistoryEntry {
  id: string
  connectionId: string
  database: string
  collection: string
  filter: Record<string, unknown>
  sort: Record<string, number> | null
  projection: Record<string, number> | null
  limit: number
  resultCount: number
  timestamp: number
  pinned: boolean
}

const MAX_ENTRIES = 200

let buffer: QueryHistoryEntry[] | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
}

function readFromDisk(): QueryHistoryEntry[] {
  ensureDir()
  if (!existsSync(QUERY_HISTORY_FILE)) return []
  try {
    return JSON.parse(readFileSync(QUERY_HISTORY_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function flush(): void {
  if (!buffer) return
  ensureDir()
  writeFileSync(QUERY_HISTORY_FILE, JSON.stringify(buffer, null, 2))
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flush()
    flushTimer = null
  }, 500)
}

function getBuffer(): QueryHistoryEntry[] {
  if (!buffer) buffer = readFromDisk()
  return buffer
}

export function loadHistory(): QueryHistoryEntry[] {
  return getBuffer().slice().reverse()
}

export function saveEntry(entry: Omit<QueryHistoryEntry, 'id' | 'timestamp' | 'pinned'>): QueryHistoryEntry {
  const buf = getBuffer()
  const full: QueryHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    pinned: false
  }
  buf.push(full)
  // Prune: keep pinned + most recent unpinned
  const pinned = buf.filter((e) => e.pinned)
  const unpinned = buf.filter((e) => !e.pinned)
  if (pinned.length + unpinned.length > MAX_ENTRIES) {
    const keep = MAX_ENTRIES - pinned.length
    buffer = [...pinned, ...unpinned.slice(-keep)]
  }
  scheduleFlush()
  return full
}

export function togglePin(id: string): void {
  const buf = getBuffer()
  const entry = buf.find((e) => e.id === id)
  if (entry) {
    entry.pinned = !entry.pinned
    scheduleFlush()
  }
}

export function deleteEntry(id: string): void {
  buffer = getBuffer().filter((e) => e.id !== id)
  scheduleFlush()
}

export function clearHistory(): void {
  buffer = getBuffer().filter((e) => e.pinned)
  scheduleFlush()
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/constants.ts src/main/services/queryHistory.ts
git commit -m "feat: query history backend service with debounced writes"
```

---

### Task 7: Add query history tRPC routes

**Files:**
- Modify: `src/main/trpc/routers/query.ts`

- [ ] **Step 1: Add history routes to the query router**

In `src/main/trpc/routers/query.ts`, add import at top:

```typescript
import * as queryHistory from '../../services/queryHistory'
```

Then add these routes inside the `router({})` call, after the `explain` route:

```typescript
  getHistory: procedure
    .query(async () => {
      return queryHistory.loadHistory()
    }),

  saveHistory: procedure
    .input(
      z.object({
        connectionId: z.string(),
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()),
        sort: z.record(z.number()).nullable(),
        projection: z.record(z.number()).nullable(),
        limit: z.number(),
        resultCount: z.number()
      })
    )
    .mutation(async ({ input }) => {
      return queryHistory.saveEntry(input)
    }),

  deleteHistory: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      queryHistory.deleteEntry(input.id)
      return { deleted: true }
    }),

  togglePinHistory: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      queryHistory.togglePin(input.id)
      return { toggled: true }
    }),

  clearHistory: procedure
    .mutation(async () => {
      queryHistory.clearHistory()
      return { cleared: true }
    }),
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/query.ts
git commit -m "feat: add query history tRPC routes"
```

---

### Task 8: Create QueryHistoryPanel UI and wire auto-save

**Files:**
- Create: `src/renderer/src/components/query/QueryHistoryPanel.tsx`
- Modify: `src/renderer/src/store/tabStore.ts` — auto-save after query
- Modify: `src/renderer/src/components/query/QueryBuilder.tsx` — wire history panel

- [ ] **Step 1: Create the QueryHistoryPanel component**

Create `src/renderer/src/components/query/QueryHistoryPanel.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { Star, X, Trash2 } from 'lucide-react'
import { trpc } from '@renderer/lib/trpc'
import { useTabStore } from '@renderer/store/tabStore'

interface HistoryEntry {
  id: string
  connectionId: string
  database: string
  collection: string
  filter: Record<string, unknown>
  sort: Record<string, number> | null
  projection: Record<string, number> | null
  limit: number
  resultCount: number
  timestamp: number
  pinned: boolean
}

interface Props {
  onClose: () => void
}

export function QueryHistoryPanel({ onClose }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [showAll, setShowAll] = useState(false)
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { setFilter, setSort, setProjection, setPageSize, executeQuery } = useTabStore()

  useEffect(() => {
    trpc.query.getHistory.query().then(setEntries).catch(() => {})
  }, [])

  const filtered = showAll
    ? entries
    : entries.filter((e) => e.connectionId === activeTab?.connectionId)

  const pinned = filtered.filter((e) => e.pinned)
  const recent = filtered.filter((e) => !e.pinned)

  function replay(entry: HistoryEntry) {
    // Batch state updates — none of these trigger queries (see Task 1)
    setFilter(entry.filter)
    setSort(entry.sort)
    setProjection(entry.projection)
    if (entry.limit) setPageSize(entry.limit)
    // Single query after all state is set
    executeQuery()
    onClose()
  }

  async function togglePin(id: string) {
    await trpc.query.togglePinHistory.mutate({ id })
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e))
    )
  }

  async function deleteEntry(id: string) {
    await trpc.query.deleteHistory.mutate({ id })
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  async function clearAll() {
    await trpc.query.clearHistory.mutate()
    setEntries((prev) => prev.filter((e) => e.pinned))
  }

  function timeAgo(ts: number): string {
    const diff = Date.now() - ts
    if (diff < 60_000) return 'just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return `${Math.floor(diff / 86_400_000)}d ago`
  }

  function filterSummary(filter: Record<string, unknown>): string {
    const json = JSON.stringify(filter)
    return json.length > 60 ? json.slice(0, 57) + '...' : json
  }

  function renderEntry(entry: HistoryEntry) {
    return (
      <div
        key={entry.id}
        className="flex items-start gap-2 border-b border-border px-3 py-2 hover:bg-accent/50"
      >
        <button
          className={`mt-0.5 ${entry.pinned ? 'text-yellow-400' : 'text-muted-foreground/40 hover:text-yellow-400'}`}
          onClick={() => togglePin(entry.id)}
        >
          <Star className="h-3.5 w-3.5" fill={entry.pinned ? 'currentColor' : 'none'} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="truncate font-mono text-xs text-foreground">
            {entry.collection} &rarr; {filterSummary(entry.filter)}
          </div>
          <div className="flex gap-2 text-[10px] text-muted-foreground">
            <span>{timeAgo(entry.timestamp)}</span>
            <span>{entry.resultCount} results</span>
            {entry.sort && <span>sorted</span>}
          </div>
        </div>
        <button
          className="mt-0.5 text-green-400 hover:text-green-300 text-xs px-2 py-0.5 rounded bg-green-500/10"
          onClick={() => replay(entry)}
        >
          Run
        </button>
        <button
          className="mt-0.5 text-muted-foreground hover:text-destructive"
          onClick={() => deleteEntry(entry.id)}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-[420px] max-h-[400px] overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold">Query History</span>
        <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={clearAll}>
          Clear all
        </button>
      </div>

      {pinned.length > 0 && (
        <>
          <div className="px-3 py-1 text-[10px] font-semibold uppercase text-yellow-400 bg-muted/50">
            Pinned
          </div>
          {pinned.map(renderEntry)}
        </>
      )}

      {recent.length > 0 && (
        <>
          <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted-foreground bg-muted/50">
            Recent
          </div>
          {recent.map(renderEntry)}
        </>
      )}

      {filtered.length === 0 && (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">No history yet</div>
      )}

      <div className="border-t border-border px-3 py-1.5">
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={showAll} onChange={() => setShowAll(!showAll)} className="h-3 w-3" />
          Show all connections
        </label>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire auto-save into tabStore.executeQuery**

In `src/renderer/src/store/tabStore.ts`, add after `get().updateTab(tab.id, { results, loading: false })` on line 185:

```typescript
      // Auto-save to query history
      try {
        trpc.query.saveHistory.mutate({
          connectionId: tab.connectionId,
          database: tab.database,
          collection: tab.collection,
          filter: tab.filter,
          sort: tab.sort,
          projection: tab.projection,
          limit: tab.pageSize,
          resultCount: results.totalCount
        })
      } catch { /* history save is best-effort */ }
```

- [ ] **Step 3: Wire QueryHistoryPanel into QueryBuilder**

In `QueryBuilder.tsx`, add state `const [historyOpen, setHistoryOpen] = useState(false)` and pass `onToggleHistory={() => setHistoryOpen(!historyOpen)}` to `QueryFooter`. Render `{historyOpen && <QueryHistoryPanel onClose={() => setHistoryOpen(false)} />}` in a relative-positioned wrapper near the footer.

- [ ] **Step 4: Test the full flow**

```bash
pnpm dev
```

Test: Run a query → open History panel → entry should appear → click Run to replay → click star to pin.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/query/QueryHistoryPanel.tsx src/renderer/src/store/tabStore.ts src/renderer/src/components/query/QueryBuilder.tsx
git commit -m "feat: query history panel with auto-save and replay"
```

---

## Phase 3: Index Management

### Task 9: Add index backend actions

**Files:**
- Modify: `src/main/actions/admin.ts`

- [ ] **Step 1: Add createIndex, dropIndex, getIndexStats**

Append to `src/main/actions/admin.ts`:

```typescript
export async function createIndex(
  database: string,
  collection: string,
  fields: Record<string, number | string>,
  options: {
    unique?: boolean
    sparse?: boolean
    expireAfterSeconds?: number
    partialFilterExpression?: Record<string, unknown>
    name?: string
  } = {}
): Promise<string> {
  const db = mongoService.getDb(database)
  return db.collection(collection).createIndex(fields, options)
}

export async function dropIndex(
  database: string,
  collection: string,
  indexName: string
): Promise<void> {
  const db = mongoService.getDb(database)
  await db.collection(collection).dropIndex(indexName)
}

export async function getIndexStats(
  database: string,
  collection: string
): Promise<Record<string, unknown>[]> {
  const db = mongoService.getDb(database)
  return db.collection(collection).aggregate([{ $indexStats: {} }]).toArray()
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/actions/admin.ts
git commit -m "feat: add createIndex, dropIndex, getIndexStats actions"
```

---

### Task 10: Add index tRPC routes

**Files:**
- Modify: `src/main/trpc/routers/admin.ts`

- [ ] **Step 1: Add routes**

Append inside the `router({})` call in `src/main/trpc/routers/admin.ts`:

```typescript
  createIndex: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        fields: z.record(z.union([z.number(), z.string()])),
        options: z.object({
          unique: z.boolean().optional(),
          sparse: z.boolean().optional(),
          expireAfterSeconds: z.number().optional(),
          partialFilterExpression: z.record(z.unknown()).optional(),
          name: z.string().optional()
        }).optional().default({})
      })
    )
    .mutation(async ({ input }) => {
      const name = await adminActions.createIndex(
        input.database, input.collection, input.fields, input.options
      )
      return { created: true, indexName: name }
    }),

  dropIndex: procedure
    .input(z.object({ database: z.string(), collection: z.string(), indexName: z.string() }))
    .mutation(async ({ input }) => {
      await adminActions.dropIndex(input.database, input.collection, input.indexName)
      return { dropped: true }
    }),

  indexStats: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .query(async ({ input }) => {
      return adminActions.getIndexStats(input.database, input.collection)
    }),
```

- [ ] **Step 2: Commit**

```bash
git add src/main/trpc/routers/admin.ts
git commit -m "feat: add index management tRPC routes"
```

---

### Task 11: Add index MCP tools

**Files:**
- Modify: `src/main/mcp/tools.ts`

- [ ] **Step 1: Add 4 index MCP tools**

In `src/main/mcp/tools.ts`, add import for admin actions at the top:

```typescript
import * as adminActions from '../actions/admin'
```

Then add these tools after the `mongo_collection_schema` tool (around line 134), before the mutation tools section:

```typescript
  // --- Index tools ---
  server.registerTool('mongo_list_indexes', {
    description: 'List all indexes on a collection',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, collection }) => {
    const indexes = await adminActions.listIndexes(database, collection)
    return { content: [{ type: 'text', text: JSON.stringify(indexes, null, 2) }] }
  })

  server.registerTool('mongo_index_stats', {
    description: 'Get index usage statistics for a collection',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, collection }) => {
    const stats = await adminActions.getIndexStats(database, collection)
    return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] }
  })

  server.registerTool('mongo_create_index', {
    description: 'Create an index on a collection. BLOCKED on readonly connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      fields: z.record(z.union([z.number(), z.string()])).describe('Index fields and directions (1, -1, "text", "2dsphere")'),
      unique: z.boolean().optional().default(false),
      sparse: z.boolean().optional().default(false),
      expireAfterSeconds: z.number().optional(),
      name: z.string().optional()
    }
  }, async ({ database, collection, fields, unique, sparse, expireAfterSeconds, name }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const options: Record<string, unknown> = {}
    if (unique) options.unique = true
    if (sparse) options.sparse = true
    if (expireAfterSeconds !== undefined) options.expireAfterSeconds = expireAfterSeconds
    if (name) options.name = name
    const indexName = await adminActions.createIndex(database, collection, fields, options)
    return { content: [{ type: 'text', text: `Created index: ${indexName}` }] }
  })

  server.registerTool('mongo_drop_index', {
    description: 'Drop an index by name. BLOCKED on readonly connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      indexName: z.string().describe('Name of the index to drop')
    }
  }, async ({ database, collection, indexName }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    await adminActions.dropIndex(database, collection, indexName)
    return { content: [{ type: 'text', text: `Dropped index: ${indexName}` }] }
  })
```

Also update `allowedTools` in `src/main/services/claude.ts` to include the new tools:

```typescript
'mcp__mango__mongo_list_indexes',
'mcp__mango__mongo_index_stats',
'mcp__mango__mongo_create_index',
'mcp__mango__mongo_drop_index',
```

- [ ] **Step 2: Commit**

```bash
git add src/main/mcp/tools.ts src/main/services/claude.ts
git commit -m "feat: add index MCP tools (list, stats, create, drop)"
```

---

### Task 12: Create IndexPanel and CreateIndexDialog UI

**Files:**
- Create: `src/renderer/src/components/indexes/IndexPanel.tsx`
- Create: `src/renderer/src/components/indexes/CreateIndexDialog.tsx`
- Modify: `src/renderer/src/components/data/MainPanel.tsx`

- [ ] **Step 1: Create IndexPanel.tsx**

Create `src/renderer/src/components/indexes/IndexPanel.tsx` — a table listing all indexes for the current collection. Uses `trpc.admin.listIndexes` to fetch, `trpc.admin.indexStats` for usage counts. Shows: Name, Fields, Type badge, Size, Usage, Drop button. "Create Index" button opens the dialog.

Key implementation details:
- Fetch indexes and stats on mount and after create/drop operations
- Type detection: check `unique`, `sparse`, count of fields (compound), key values (`text`, `2dsphere`)
- Disable drop for `_id_` index
- Confirmation dialog before drop (use `window.confirm` for simplicity)

- [ ] **Step 2: Create CreateIndexDialog.tsx**

Create `src/renderer/src/components/indexes/CreateIndexDialog.tsx` — a modal dialog with:
- Field rows: `[name input] [direction: 1/-1/text/2dsphere select] [remove button]`
- Add field button
- Options: unique checkbox, sparse checkbox, TTL number input, name text input
- Create button calls `trpc.admin.createIndex`

Use the existing `@radix-ui/react-dialog` pattern from `ConnectionDialog.tsx`.

- [ ] **Step 3: Add Documents/Indexes sub-tabs to MainPanel**

Modify `src/renderer/src/components/data/MainPanel.tsx` to add a sub-tab bar:

```tsx
import { useState } from 'react'
import { useTabStore } from '@renderer/store/tabStore'
import { TabBar } from '@renderer/components/layout/TabBar'
import { QueryBuilder } from '@renderer/components/query/QueryBuilder'
import { DocumentTable } from './DocumentTable'
import { DocumentEditor } from './DocumentEditor'
import { IndexPanel } from '@renderer/components/indexes/IndexPanel'

export function MainPanel() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [subTab, setSubTab] = useState<'documents' | 'indexes'>('documents')

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      {activeTab ? (
        <>
          {/* Sub-tab bar */}
          <div className="flex border-b border-border">
            <button
              className={`px-4 py-1.5 text-xs font-medium ${
                subTab === 'documents'
                  ? 'text-green-400 border-b-2 border-green-400'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setSubTab('documents')}
            >
              Documents
            </button>
            <button
              className={`px-4 py-1.5 text-xs font-medium ${
                subTab === 'indexes'
                  ? 'text-green-400 border-b-2 border-green-400'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setSubTab('indexes')}
            >
              Indexes
            </button>
          </div>

          {subTab === 'documents' ? (
            <>
              <QueryBuilder />
              <div className={activeTab.selectedDocument ? 'h-1/2 min-h-0' : 'flex-1 min-h-0'}>
                <DocumentTable />
              </div>
              {activeTab.selectedDocument && (
                <div className="h-1/2 min-h-0">
                  <DocumentEditor />
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <IndexPanel />
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Select a collection to view documents
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Test the full index management flow**

```bash
pnpm dev
```

Test: Open a collection → switch to Indexes tab → see list of indexes → Create a test index → verify it appears → Drop it → verify it's gone.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/indexes/ src/renderer/src/components/data/MainPanel.tsx
git commit -m "feat: index management UI with list, create, drop"
```

---

## Phase 4: Bulk Operations

### Task 13: Add insertMany and updateMany backend

**Files:**
- Modify: `src/main/actions/mutation.ts`
- Modify: `src/main/trpc/routers/mutation.ts`
- Modify: `src/main/mcp/tools.ts`

- [ ] **Step 1: Add action functions**

Append to `src/main/actions/mutation.ts`:

```typescript
export async function insertMany(
  database: string,
  collection: string,
  documents: Record<string, unknown>[]
): Promise<{ insertedCount: number }> {
  const db = mongoService.getDb(database)
  const result = await db.collection(collection).insertMany(documents)
  return { insertedCount: result.insertedCount }
}

export async function updateMany(
  database: string,
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>
): Promise<{ matchedCount: number; modifiedCount: number }> {
  const db = mongoService.getDb(database)
  const updateDoc = Object.keys(update).some((k) => k.startsWith('$'))
    ? update
    : { $set: update }
  const result = await db.collection(collection).updateMany(filter, updateDoc)
  return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }
}
```

- [ ] **Step 2: Add tRPC routes with changelog**

Append to the mutation router in `src/main/trpc/routers/mutation.ts`:

```typescript
  insertMany: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        documents: z.array(z.record(z.unknown()))
      })
    )
    .mutation(async ({ input }) => {
      const result = await mutationActions.insertMany(input.database, input.collection, input.documents)
      // Changelog at tRPC level so UI-initiated bulk ops are logged
      const changelog = await import('../../services/changelog')
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
      const result = await mutationActions.updateMany(
        input.database, input.collection, input.filter, input.update
      )
      const changelog = await import('../../services/changelog')
      changelog.appendChangeLog({
        source: 'user', connectionId: '', connectionName: '',
        database: input.database, collection: input.collection,
        operation: 'update', filter: input.filter, changes: input.update,
        count: result.modifiedCount
      })
      return result
    }),
```

- [ ] **Step 3: Add MCP tools**

In `src/main/mcp/tools.ts`, add after the existing mutation tools:

```typescript
  server.registerTool('mongo_insert_many', {
    description: 'Insert multiple documents. BLOCKED on readonly connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      documents: z.array(z.record(z.unknown())).describe('Array of documents to insert')
    }
  }, async ({ database, collection, documents }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const conn = getActiveConnectionInfo()
    const result = await mutationActions.insertMany(database, collection, documents)
    changelog.appendChangeLog({
      source: 'claude', ...conn, database, collection,
      operation: 'insert', count: result.insertedCount
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })

  server.registerTool('mongo_update_many', {
    description: 'Update all documents matching filter. BLOCKED on readonly connections.',
    inputSchema: {
      database: z.string(),
      collection: z.string(),
      filter: z.record(z.unknown()),
      update: z.record(z.unknown())
    }
  }, async ({ database, collection, filter, update }) => {
    const blocked = checkWriteAccess(database)
    if (blocked) return { content: [{ type: 'text', text: blocked }], isError: true }
    const conn = getActiveConnectionInfo()
    const result = await mutationActions.updateMany(database, collection, filter, update)
    changelog.appendChangeLog({
      source: 'claude', ...conn, database, collection,
      operation: 'update', filter, changes: update, count: result.modifiedCount
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })
```

Also add to `allowedTools` in `claude.ts`:
```typescript
'mcp__mango__mongo_insert_many',
'mcp__mango__mongo_update_many',
```

**Pre-existing bug fix:** In `tools.ts`, the `mongo_rollback` tool (line 321) references an undefined `database` variable. Fix it: change `checkWriteAccess(database)` to `checkWriteAccess(entry.database)` and move it AFTER the `const entry = entries.find(...)` line.

Also add these existing but missing tools to the `allowedTools` array in `claude.ts`:
```typescript
'mcp__mango__mongo_changelog',
'mcp__mango__mongo_rollback',
```

- [ ] **Step 4: Commit**

```bash
git add src/main/actions/mutation.ts src/main/trpc/routers/mutation.ts src/main/mcp/tools.ts src/main/services/claude.ts
git commit -m "feat: add insertMany/updateMany backend, tRPC routes, and MCP tools"
```

---

### Task 14: Add document table multi-select and BulkToolbar

**Files:**
- Modify: `src/renderer/src/store/tabStore.ts`
- Modify: `src/renderer/src/components/data/DocumentTable.tsx`
- Create: `src/renderer/src/components/data/BulkToolbar.tsx`

- [ ] **Step 1: Add selectedDocIds to Tab interface and store**

In `src/renderer/src/store/tabStore.ts`:

Add `selectedDocIds: unknown[]` to the `Tab` interface (after `isDirty` on line 27). We use `unknown[]` because MongoDB `_id` values can be ObjectId, string, number, etc. — we must preserve the original type for `$in` queries to work.

Add `selectedDocIds: []` to the `createTab` return (after `isDirty: false` on line 52).

Add to `TabStore` interface:
```typescript
setSelectedDocIds: (ids: unknown[]) => void
```

Add implementation:
```typescript
setSelectedDocIds: (ids) => {
  const tab = get().getActiveTab()
  if (tab) get().updateTab(tab.id, { selectedDocIds: ids })
},
```

Exclude `selectedDocIds` from `saveTabs` — it's already excluded since `saveTabs` only persists `id, connectionId, database, collection`.

- [ ] **Step 2: Add checkbox column to DocumentTable**

In `src/renderer/src/components/data/DocumentTable.tsx`:

Change `rowSelection` on line 292 from:
```typescript
rowSelection={{ mode: 'singleRow', enableClickSelection: true }}
```
to:
```typescript
rowSelection={{ mode: 'multiRow', enableClickSelection: false, checkboxes: true, headerCheckbox: true }}
```

Add `onSelectionChanged` handler — preserve raw `_id` types (ObjectId, string, etc.):
```typescript
onSelectionChanged={(e) => {
  const ids = e.api.getSelectedRows().map((r: Record<string, unknown>) => r._id)
  setSelectedDocIds(ids)
}}
```

Keep the existing `onRowClicked` handler — clicking a row still opens the editor.

Import `setSelectedDocIds` from `useTabStore`.

- [ ] **Step 3: Create BulkToolbar component**

Create `src/renderer/src/components/data/BulkToolbar.tsx`:

```tsx
import { Trash2, Pencil, Download, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { trpc } from '@renderer/lib/trpc'

export function BulkToolbar() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { setSelectedDocIds, executeQuery } = useTabStore()

  const ids = activeTab?.selectedDocIds ?? []
  if (ids.length === 0) return null

  async function deleteSelected() {
    if (!activeTab) return
    if (!window.confirm(`Delete ${ids.length} document(s)? This cannot be undone.`)) return
    // ids preserves raw _id types (ObjectId, string, etc.) so $in filter matches correctly
    await trpc.mutation.deleteMany.mutate({
      database: activeTab.database,
      collection: activeTab.collection,
      filter: { _id: { $in: ids } }
    })
    setSelectedDocIds([])
    executeQuery()
  }

  function exportSelected() {
    if (!activeTab?.results) return
    const idSet = new Set(ids.map(String))
    const docs = activeTab.results.documents.filter((d) => idSet.has(String(d._id)))
    const blob = new Blob([JSON.stringify(docs, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeTab.collection}-${ids.length}docs.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex items-center gap-2 border-b border-green-500/30 bg-green-500/10 px-3 py-1.5">
      <span className="text-xs font-semibold text-green-400">{ids.length} selected</span>
      <span className="text-border">|</span>
      <Button variant="ghost" size="sm" className="h-6 text-xs text-red-400 hover:text-red-300" onClick={deleteSelected}>
        <Trash2 className="mr-1 h-3 w-3" /> Delete
      </Button>
      <Button variant="ghost" size="sm" className="h-6 text-xs text-purple-400 hover:text-purple-300" onClick={exportSelected}>
        <Download className="mr-1 h-3 w-3" /> Export
      </Button>
      <div className="ml-auto">
        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedDocIds([])}>
          Clear
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire BulkToolbar into MainPanel or DocumentTable area**

In `MainPanel.tsx`, add `<BulkToolbar />` above `<DocumentTable />`:

```tsx
import { BulkToolbar } from './BulkToolbar'
// ...
<BulkToolbar />
<div className={activeTab.selectedDocument ? 'h-1/2 min-h-0' : 'flex-1 min-h-0'}>
  <DocumentTable />
</div>
```

- [ ] **Step 5: Test multi-select**

```bash
pnpm dev
```

Test: Open a collection → check boxes appear on each row → select multiple → toolbar appears → Export works → Delete works with confirmation.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/tabStore.ts src/renderer/src/components/data/DocumentTable.tsx src/renderer/src/components/data/BulkToolbar.tsx src/renderer/src/components/data/MainPanel.tsx
git commit -m "feat: document table multi-select with bulk delete and export"
```

---

### Task 15: Create InsertDocumentsDialog and UpdateManyDialog

**Files:**
- Create: `src/renderer/src/components/data/InsertDocumentsDialog.tsx`
- Create: `src/renderer/src/components/data/UpdateManyDialog.tsx`
- Modify: `src/renderer/src/components/data/BulkToolbar.tsx` — add Insert/UpdateMany buttons
- Modify: `src/renderer/src/components/layout/Sidebar.tsx` — add Insert Documents context menu (collection context menus may be in a child component like DatabaseTree — check which component renders the collection right-click menu and modify that)

- [ ] **Step 1: Create InsertDocumentsDialog**

A modal with a Monaco editor for pasting a JSON array. "Insert" button validates JSON (must be an array), calls `trpc.mutation.insertMany`, shows result count toast, closes, refreshes table.

Use `@radix-ui/react-dialog` for the modal shell. Use `@monaco-editor/react` for the editor (already a dependency).

- [ ] **Step 2: Create UpdateManyDialog**

A modal with:
- Filter input (Monaco editor, pre-filled with current tab filter as JSON)
- Update expression input (Monaco editor, placeholder: `{ "$set": { "status": "archived" } }`)
- "Preview" button shows count of matching documents via `trpc.query.count`
- "Update" button calls `trpc.mutation.updateMany`, shows modified count, closes, refreshes table

- [ ] **Step 3: Wire dialogs into BulkToolbar**

Add state for dialog visibility in BulkToolbar. Add "Insert Documents..." and "Update Many..." buttons.

- [ ] **Step 4: Add "Insert Documents..." to Sidebar collection context menu**

In `src/renderer/src/components/layout/Sidebar.tsx`, find the collection context menu section. Add a new menu item:
```tsx
<ContextMenu.Item onSelect={() => setInsertDialogOpen(true)}>
  Insert Documents...
</ContextMenu.Item>
```

This will require lifting the InsertDocumentsDialog state up or using a global event/store.

- [ ] **Step 5: Test both dialogs**

```bash
pnpm dev
```

Test: Insert 3 documents via dialog → verify they appear in table. Update many → verify count preview → execute → verify changes.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/data/InsertDocumentsDialog.tsx src/renderer/src/components/data/UpdateManyDialog.tsx src/renderer/src/components/data/BulkToolbar.tsx src/renderer/src/components/layout/Sidebar.tsx
git commit -m "feat: insert documents and update many dialogs"
```

---

## Phase 5: Codebase Context for Claude

### Task 16: Add codebasePath to ConnectionProfile

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/components/explorer/ConnectionDialog.tsx`

- [ ] **Step 1: Update ConnectionProfile type**

In `src/shared/types.ts`, add to `ConnectionProfile` interface after `claudeDbOverrides`:

```typescript
  /** Root path to an associated codebase for Claude context */
  codebasePath?: string
```

- [ ] **Step 2: Add folder picker to ConnectionDialog**

In `src/renderer/src/components/explorer/ConnectionDialog.tsx`, add a "Codebase Path" field with a text input and a "Browse" button. The Browse button calls `window.electron?.showOpenDialog({ properties: ['openDirectory'] })` or falls back to a manual text input.

Add to the form fields, after the Claude access selector:

```tsx
<div className="space-y-1">
  <label className="text-xs text-muted-foreground">Codebase Path (for Claude context)</label>
  <div className="flex gap-1.5">
    <input
      className="h-8 flex-1 rounded border border-border bg-background px-2 text-sm"
      placeholder="/path/to/your/project/src"
      value={form.codebasePath || ''}
      onChange={(e) => setForm({ ...form, codebasePath: e.target.value })}
    />
  </div>
  <p className="text-[10px] text-muted-foreground">
    Claude will scan this folder for code that references your collections
  </p>
</div>
```

Make sure `codebasePath` is included when saving the connection.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts src/renderer/src/components/explorer/ConnectionDialog.tsx
git commit -m "feat: add codebasePath to connection profile"
```

---

### Task 17: Create codebase context service and inject into Claude prompt

**Files:**
- Create: `src/main/services/codebaseContext.ts`
- Modify: `src/main/services/claude.ts`

- [ ] **Step 1: Create the codebase scanning service**

Create `src/main/services/codebaseContext.ts`:

```typescript
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname } from 'path'

const DEFAULT_EXTENSIONS = ['.ts', '.js', '.py', '.go', '.java', '.rs', '.rb']
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'target', 'vendor'])
const MAX_CONTEXT_BYTES = 20_000

interface CodebaseContext {
  summary: string
  matchedFiles: { path: string; excerpts: string[] }[]
}

let cache: { key: string; context: CodebaseContext; timestamp: number } | null = null
const CACHE_TTL = 300_000 // 5 minutes

function walkDir(dir: string, extensions: string[], files: string[] = [], depth = 0): string[] {
  if (depth > 8) return files
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walkDir(join(dir, entry.name), extensions, files, depth + 1)
        }
      } else if (extensions.includes(extname(entry.name))) {
        files.push(join(dir, entry.name))
      }
    }
  } catch { /* permission errors, etc */ }
  return files
}

export function scanCodebase(
  codebasePath: string,
  searchTerms: string[],
  extensions?: string[]
): CodebaseContext {
  const cacheKey = `${codebasePath}:${searchTerms.join(',')}`
  if (cache && cache.key === cacheKey && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.context
  }

  const exts = extensions ?? DEFAULT_EXTENSIONS
  const files = walkDir(codebasePath, exts)

  const matchedFiles: { path: string; excerpts: string[] }[] = []
  let totalBytes = 0
  const lowerTerms = searchTerms.map((t) => t.toLowerCase())

  for (const filePath of files) {
    if (totalBytes >= MAX_CONTEXT_BYTES) break
    try {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')
      const excerpts: string[] = []

      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase()
        if (lowerTerms.some((term) => lower.includes(term))) {
          // Include surrounding context (3 lines before/after)
          const start = Math.max(0, i - 3)
          const end = Math.min(lines.length, i + 4)
          const excerpt = lines.slice(start, end).join('\n')
          const excerptBytes = Buffer.byteLength(excerpt)
          if (totalBytes + excerptBytes > MAX_CONTEXT_BYTES) break
          excerpts.push(`Lines ${start + 1}-${end}:\n${excerpt}`)
          totalBytes += excerptBytes
          i = end // skip ahead to avoid overlapping excerpts
        }
      }

      if (excerpts.length > 0) {
        const relPath = filePath.replace(codebasePath, '').replace(/\\/g, '/')
        matchedFiles.push({ path: relPath, excerpts })
      }
    } catch { /* read errors */ }
  }

  const summary = `Scanned ${files.length} files in ${codebasePath}, found ${matchedFiles.length} files referencing the target collections/database.`

  const context = { summary, matchedFiles }
  cache = { key: cacheKey, context, timestamp: Date.now() }
  return context
}

export function formatContext(ctx: CodebaseContext): string {
  if (ctx.matchedFiles.length === 0) return ''

  const lines = ['## Codebase Context', ctx.summary, '']
  for (const file of ctx.matchedFiles) {
    lines.push(`### ${file.path}`)
    for (const excerpt of file.excerpts) {
      lines.push('```')
      lines.push(excerpt)
      lines.push('```')
    }
    lines.push('')
  }
  return lines.join('\n')
}
```

- [ ] **Step 2: Inject codebase context into Claude's system prompt**

In `src/main/services/claude.ts`, inside `buildSystemPrompt()`, after the "Current Focus" section (around line 100), add:

```typescript
  // Codebase context
  const activeConn = connections.find((c) => c.id === activeId)
  if (activeConn?.codebasePath && context.database) {
    const { scanCodebase, formatContext } = await import('./codebaseContext')
    const searchTerms = [context.database]
    if (context.collection) searchTerms.push(context.collection)
    const ctx = scanCodebase(activeConn.codebasePath, searchTerms)
    const formatted = formatContext(ctx)
    if (formatted) {
      lines.push('')
      lines.push(formatted)
    }
  }
```

Note: `buildSystemPrompt` will need to become `async` for the dynamic import, or import `codebaseContext` statically at the top. Static import is simpler:

Add at top of `claude.ts`:
```typescript
import { scanCodebase, formatContext } from './codebaseContext'
```

Then in `buildSystemPrompt`, no async needed:
```typescript
  if (activeConn?.codebasePath && context.database) {
    const searchTerms = [context.database]
    if (context.collection) searchTerms.push(context.collection)
    const formatted = formatContext(scanCodebase(activeConn.codebasePath, searchTerms))
    if (formatted) {
      lines.push('')
      lines.push(formatted)
    }
  }
```

- [ ] **Step 3: Test the integration**

```bash
pnpm dev
```

Test: Edit a connection, set a codebase path → open a collection → send a Claude message → verify Claude's response shows awareness of the codebase (check dev tools for the system prompt if needed).

- [ ] **Step 4: Commit**

```bash
git add src/main/services/codebaseContext.ts src/main/services/claude.ts src/shared/types.ts src/renderer/src/components/explorer/ConnectionDialog.tsx
git commit -m "feat: codebase context scanning for Claude AI prompts"
```

---

## Phase 6: Polish & Release

### Task 18: Final integration testing and release

**Files:**
- Modify: `resources/splash.html` (already updated with green glow)
- Modify: `package.json`, `src/main/index.ts` (version bump)

- [ ] **Step 1: Run the full app and test all features**

```bash
pnpm dev
```

Test checklist:
- [ ] Sort builder: add sort fields, toggle ASC/DESC, reorder with arrows
- [ ] Projection builder: toggle include/exclude mode, check fields, add nested path
- [ ] Limit input changes page size, skip shows computed value
- [ ] Query history auto-saves, pin/unpin, replay, delete, clear
- [ ] Index tab: list indexes, create new index (unique, compound), drop index
- [ ] Bulk: checkbox select rows, delete selected, export selected
- [ ] Insert Documents dialog: paste JSON array, insert
- [ ] Update Many dialog: filter preview count, execute update
- [ ] Codebase context: set path on connection, Claude mentions code files
- [ ] Splash screen: green glow visible, not washed out

- [ ] **Step 2: Build and release**

```bash
./release.sh minor
```

This bumps to v0.2.0, commits, tags, builds the installer, and creates the GitHub release.

- [ ] **Step 3: Verify the release**

Check https://github.com/Ashalls/Mango/releases — v0.2.0 should have the installer.

Install it, verify auto-update from v0.1.2 works, test one feature end-to-end in the packaged build.
