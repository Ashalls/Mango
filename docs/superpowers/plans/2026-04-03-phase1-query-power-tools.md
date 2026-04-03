# Phase 1: Query Power Tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Visual Aggregation Editor, Tree View, Visual Explain, and Value Search to reach feature parity with Studio 3T's daily-driver query tools.

**Architecture:** Each feature adds backend actions + tRPC routes + MCP tools + React components. All integrate into the existing tab system via `MainPanel.tsx` sub-tabs and `tabStore.ts` state. New shared types in `src/shared/types.ts`. All work happens on a feature branch off `main`.

**Tech Stack:** React 19, TypeScript, Zustand, tRPC, Monaco Editor (existing), AG Grid (existing), `@dnd-kit/core` + `@dnd-kit/sortable` (new), `@xyflow/react` (new), `react-arborist` (new)

**Branch:** `feat/phase1-query-power-tools`

---

## Task 1: Create Feature Branch and Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Create feature branch**

```bash
cd "D:/Git Repos/Mango"
git checkout -b feat/phase1-query-power-tools
```

- [ ] **Step 2: Install new dependencies**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @xyflow/react react-arborist
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install Phase 1 dependencies (dnd-kit, xyflow, react-arborist)"
```

---

## Task 2: Add Shared Types for Aggregation and Explain

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add AggregationStage and ExplainPlan types**

Append to the end of `src/shared/types.ts`:

```typescript
// --- Aggregation Editor types ---

export interface AggregationStage {
  id: string
  type: string        // e.g., "$match", "$group", "$project"
  content: string     // JSON string of stage body
  enabled: boolean
  order: number
}

export interface StagePreviewResult {
  documents: Record<string, unknown>[]
  count: number
}

// --- Visual Explain types ---

export interface ExplainStageNode {
  id: string
  type: string              // IXSCAN, FETCH, SORT, COLLSCAN, etc.
  executionTimeMs: number
  docsExamined: number
  docsReturned: number
  keysExamined: number
  indexName?: string
  indexKeyPattern?: Record<string, 1 | -1>
  filter?: Record<string, unknown>
  memoryUsageBytes?: number
  children: ExplainStageNode[]
  efficiency: 'good' | 'moderate' | 'poor'
}

export interface ExplainPlan {
  stages: ExplainStageNode[]
  totalExecutionTimeMs: number
  winningPlan: string
  rejectedPlansCount: number
  indexSuggestion?: string
  raw: Record<string, unknown>
}

// --- Value Search types ---

export interface ValueSearchResult {
  database: string
  collection: string
  documentId: string
  fieldPath: string
  matchedValue: string
}

export interface ValueSearchProgress {
  collectionsScanned: number
  collectionsTotal: number
  resultsFound: number
  currentCollection: string
  done: boolean
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared types for aggregation editor, visual explain, and value search"
```

---

## Task 3: Backend — Aggregation Stage Preview Action

**Files:**
- Modify: `src/main/actions/query.ts`

- [ ] **Step 1: Add aggregateWithStagePreview function**

Add this function after the existing `aggregate` function (after line 71) in `src/main/actions/query.ts`:

```typescript
export async function aggregateWithStagePreview(
  database: string,
  collection: string,
  pipeline: Record<string, unknown>[],
  stageIndex: number,
  sampleSize: number = 20
): Promise<{ documents: Record<string, unknown>[]; count: number }> {
  const db = mongoService.getDb(database)
  const stagesUpTo = pipeline.slice(0, stageIndex + 1)
  const countPipeline = [...stagesUpTo, { $count: 'total' }]
  const previewPipeline = [...stagesUpTo, { $limit: sampleSize }]

  const [previewResults, countResults] = await Promise.all([
    db.collection(collection).aggregate(previewPipeline).toArray(),
    db.collection(collection).aggregate(countPipeline).toArray()
  ])

  return {
    documents: serializeDocuments(previewResults as Record<string, unknown>[]),
    count: countResults[0]?.total ?? 0
  }
}
```

- [ ] **Step 2: Extend explain to support aggregation pipelines**

Replace the existing `explain` function (lines 83-94) in `src/main/actions/query.ts`:

```typescript
export async function explain(
  database: string,
  collection: string,
  filter: Record<string, unknown>,
  pipeline?: Record<string, unknown>[]
): Promise<Record<string, unknown>> {
  const db = mongoService.getDb(database)
  if (pipeline && pipeline.length > 0) {
    const result = await db
      .collection(collection)
      .aggregate(pipeline)
      .explain('allPlansExecution')
    return result as unknown as Record<string, unknown>
  }
  const result = await db
    .collection(collection)
    .find(convertObjectIds(filter))
    .explain('allPlansExecution')
  return result as unknown as Record<string, unknown>
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/actions/query.ts
git commit -m "feat: add aggregateWithStagePreview action and extend explain for pipelines"
```

---

## Task 4: Backend — tRPC Routes for Aggregation Preview and Extended Explain

**Files:**
- Modify: `src/main/trpc/routers/query.ts`

- [ ] **Step 1: Add aggregateWithStagePreview route**

Add before the `getHistory` route (before line 71) in `src/main/trpc/routers/query.ts`:

```typescript
  aggregateWithStagePreview: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        pipeline: z.array(z.record(z.unknown())),
        stageIndex: z.number(),
        sampleSize: z.number().optional().default(20)
      })
    )
    .query(async ({ input }) => {
      return queryActions.aggregateWithStagePreview(
        input.database,
        input.collection,
        input.pipeline,
        input.stageIndex,
        input.sampleSize
      )
    }),
```

- [ ] **Step 2: Update the explain route to accept pipeline**

Replace the existing `explain` route (lines 59-69) in `src/main/trpc/routers/query.ts`:

```typescript
  explain: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()).optional().default({}),
        pipeline: z.array(z.record(z.unknown())).optional()
      })
    )
    .query(async ({ input }) => {
      return queryActions.explain(input.database, input.collection, input.filter, input.pipeline)
    }),
```

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/query.ts
git commit -m "feat: add tRPC routes for aggregation stage preview and pipeline explain"
```

---

## Task 5: Backend — MCP Tools for Aggregation Preview

**Files:**
- Modify: `src/main/mcp/tools.ts`

- [ ] **Step 1: Add mongo_aggregate_preview tool**

Add after the existing `mongo_explain` tool registration in `src/main/mcp/tools.ts`:

```typescript
  server.registerTool('mongo_aggregate_preview', {
    description: 'Preview the output of an aggregation pipeline up to a specific stage index. Useful for debugging pipelines stage by stage.',
    inputSchema: {
      database: z.string().describe('Database name'),
      collection: z.string().describe('Collection name'),
      pipeline: z.array(z.record(z.unknown())).describe('Full aggregation pipeline array'),
      stageIndex: z.number().describe('Zero-based index of the stage to preview up to'),
      sampleSize: z.number().default(10).describe('Max documents to return in preview')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, collection, pipeline, stageIndex, sampleSize }) => {
    const result = await queryActions.aggregateWithStagePreview(
      database, collection, pipeline, stageIndex, sampleSize
    )
    return {
      content: [{ type: 'text', text: `Stage ${stageIndex} output (${result.count} total docs):\n${JSON.stringify(result.documents, null, 2)}` }]
    }
  })
```

- [ ] **Step 2: Commit**

```bash
git add src/main/mcp/tools.ts
git commit -m "feat: add mongo_aggregate_preview MCP tool"
```

---

## Task 6: Frontend — Aggregation Stage Card and Stage List

**Files:**
- Create: `src/renderer/src/components/aggregation/StageCard.tsx`
- Create: `src/renderer/src/components/aggregation/StageList.tsx`

- [ ] **Step 1: Create the StageCard component**

Create `src/renderer/src/components/aggregation/StageCard.tsx`:

```tsx
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'
import type { AggregationStage } from '@shared/types'

const STAGE_TYPES = [
  '$match', '$group', '$project', '$sort', '$limit', '$skip',
  '$unwind', '$lookup', '$addFields', '$replaceRoot', '$out',
  '$merge', '$count', '$set', '$unset', '$sample', '$bucket',
  '$bucketAuto', '$facet', '$graphLookup', '$redact', '$replaceWith',
  '$sortByCount', '$unionWith'
]

interface StageCardProps {
  stage: AggregationStage
  isSelected: boolean
  onSelect: () => void
  onToggle: () => void
  onDelete: () => void
  onChangeType: (type: string) => void
}

export { STAGE_TYPES }

export function StageCard({ stage, isSelected, onSelect, onToggle, onDelete, onChangeType }: StageCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stage.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: stage.enabled ? 1 : 0.4
  }

  const summary = (() => {
    try {
      const parsed = JSON.parse(stage.content)
      const keys = Object.keys(parsed)
      return keys.length > 0 ? keys.slice(0, 3).join(', ') + (keys.length > 3 ? '...' : '') : 'empty'
    } catch {
      return 'invalid JSON'
    }
  })()

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 rounded border px-2 py-1.5 cursor-pointer text-xs transition-colors ${
        isSelected
          ? 'border-emerald-500 bg-emerald-500/10'
          : 'border-border bg-card hover:border-muted-foreground/30'
      }`}
      onClick={onSelect}
    >
      <button
        className="cursor-grab text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <input
        type="checkbox"
        checked={stage.enabled}
        onChange={(e) => { e.stopPropagation(); onToggle() }}
        className="h-3 w-3 accent-emerald-500"
      />

      <select
        value={stage.type}
        onChange={(e) => { e.stopPropagation(); onChangeType(e.target.value) }}
        onClick={(e) => e.stopPropagation()}
        className="bg-transparent font-mono text-xs font-semibold text-emerald-400 outline-none"
      >
        {STAGE_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <span className="flex-1 truncate text-muted-foreground">{summary}</span>

      <button
        className="text-muted-foreground hover:text-red-400"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Create the StageList component**

Create `src/renderer/src/components/aggregation/StageList.tsx`:

```tsx
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { StageCard, STAGE_TYPES } from './StageCard'
import type { AggregationStage } from '@shared/types'

interface StageListProps {
  stages: AggregationStage[]
  selectedStageId: string | null
  onSelectStage: (id: string) => void
  onUpdateStages: (stages: AggregationStage[]) => void
}

export function StageList({ stages, selectedStageId, onSelectStage, onUpdateStages }: StageListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  function handleDragEnd(event: { active: { id: string }; over: { id: string } | null }) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = stages.findIndex((s) => s.id === active.id)
    const newIndex = stages.findIndex((s) => s.id === over.id)
    const reordered = arrayMove(stages, oldIndex, newIndex).map((s, i) => ({ ...s, order: i }))
    onUpdateStages(reordered)
  }

  function addStage() {
    const newStage: AggregationStage = {
      id: crypto.randomUUID(),
      type: '$match',
      content: '{}',
      enabled: true,
      order: stages.length
    }
    const selectedIndex = stages.findIndex((s) => s.id === selectedStageId)
    const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : stages.length
    const updated = [...stages]
    updated.splice(insertAt, 0, newStage)
    onUpdateStages(updated.map((s, i) => ({ ...s, order: i })))
    onSelectStage(newStage.id)
  }

  function toggleStage(id: string) {
    onUpdateStages(stages.map((s) => s.id === id ? { ...s, enabled: !s.enabled } : s))
  }

  function deleteStage(id: string) {
    const updated = stages.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i }))
    onUpdateStages(updated)
    if (selectedStageId === id) {
      onSelectStage(updated[0]?.id ?? '')
    }
  }

  function changeType(id: string, type: string) {
    onUpdateStages(stages.map((s) => s.id === id ? { ...s, type } : s))
  }

  return (
    <div className="flex h-full w-56 flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Pipeline Stages</span>
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-emerald-400 hover:bg-emerald-500/10"
          onClick={addStage}
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {stages.map((stage) => (
              <StageCard
                key={stage.id}
                stage={stage}
                isSelected={stage.id === selectedStageId}
                onSelect={() => onSelectStage(stage.id)}
                onToggle={() => toggleStage(stage.id)}
                onDelete={() => deleteStage(stage.id)}
                onChangeType={(type) => changeType(stage.id, type)}
              />
            ))}
          </SortableContext>
        </DndContext>
        {stages.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No stages. Click + Add to start.
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/aggregation/
git commit -m "feat: add StageCard and StageList components for aggregation editor"
```

---

## Task 7: Frontend — Aggregation Stage Editor (Monaco)

**Files:**
- Create: `src/renderer/src/components/aggregation/StageEditor.tsx`

- [ ] **Step 1: Create the StageEditor component**

Create `src/renderer/src/components/aggregation/StageEditor.tsx`:

```tsx
import Editor from '@monaco-editor/react'
import { useSettingsStore } from '@renderer/store/settingsStore'
import type { AggregationStage } from '@shared/types'

interface StageEditorProps {
  stage: AggregationStage | null
  onChange: (content: string) => void
}

export function StageEditor({ stage, onChange }: StageEditorProps) {
  const theme = useSettingsStore((s) => s.effectiveTheme)

  if (!stage) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Select a stage to edit
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground">
          Stage Editor — <span className="font-mono text-emerald-400">{stage.type}</span>
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <Editor
          key={stage.id}
          defaultValue={stage.content}
          language="json"
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          onChange={(value) => onChange(value ?? '')}
          options={{
            minimap: { enabled: false },
            lineNumbers: 'off',
            scrollBeyondLastLine: false,
            fontSize: 12,
            tabSize: 2,
            wordWrap: 'on',
            automaticLayout: true,
            formatOnPaste: true,
            bracketPairColorization: { enabled: true }
          }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/aggregation/StageEditor.tsx
git commit -m "feat: add StageEditor Monaco component for aggregation pipeline"
```

---

## Task 8: Frontend — Aggregation Stage Preview Panel

**Files:**
- Create: `src/renderer/src/components/aggregation/StagePreview.tsx`

- [ ] **Step 1: Create the StagePreview component**

Create `src/renderer/src/components/aggregation/StagePreview.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { trpc } from '@renderer/lib/trpc'
import type { AggregationStage } from '@shared/types'

interface StagePreviewProps {
  database: string
  collection: string
  stages: AggregationStage[]
  selectedStageId: string | null
}

export function StagePreview({ database, collection, stages, selectedStageId }: StagePreviewProps) {
  const [previewMode, setPreviewMode] = useState<'input' | 'output'>('output')
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedIndex = stages.findIndex((s) => s.id === selectedStageId)
  const enabledStages = stages.filter((s) => s.enabled)

  const fetchPreview = useCallback(async () => {
    if (selectedIndex < 0) return

    // Build pipeline from enabled stages only
    const enabledUpTo = stages.slice(0, selectedIndex + 1).filter((s) => s.enabled)
    const stageIdx = previewMode === 'output'
      ? enabledUpTo.length - 1
      : enabledUpTo.length - 2

    if (stageIdx < 0 && previewMode === 'input') {
      // Input to first stage = raw collection
      setLoading(true)
      setError(null)
      try {
        const result = await trpc.query.find.query({ database, collection, limit: 20 })
        setDocuments(result.documents)
        setCount(result.totalCount)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Preview failed')
      } finally {
        setLoading(false)
      }
      return
    }

    if (stageIdx < 0) return

    const pipeline = enabledUpTo.slice(0, stageIdx + 1).map((s) => {
      try { return { [s.type]: JSON.parse(s.content) } }
      catch { return { [s.type]: {} } }
    })

    setLoading(true)
    setError(null)
    try {
      const result = await trpc.query.aggregateWithStagePreview.query({
        database,
        collection,
        pipeline,
        stageIndex: pipeline.length - 1,
        sampleSize: 20
      })
      setDocuments(result.documents)
      setCount(result.count)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setLoading(false)
    }
  }, [database, collection, stages, selectedIndex, previewMode])

  useEffect(() => {
    const timer = setTimeout(fetchPreview, 500)
    return () => clearTimeout(timer)
  }, [fetchPreview])

  if (selectedIndex < 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Select a stage to preview
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <button
          className={`text-xs px-2 py-0.5 rounded ${previewMode === 'input' ? 'bg-emerald-500/20 text-emerald-400' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setPreviewMode('input')}
        >
          Input
        </button>
        <button
          className={`text-xs px-2 py-0.5 rounded ${previewMode === 'output' ? 'bg-emerald-500/20 text-emerald-400' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setPreviewMode('output')}
        >
          Output
        </button>
        <span className="flex-1" />
        {!loading && <span className="text-xs text-muted-foreground">{count} docs</span>}
      </div>
      <div className="flex-1 overflow-auto p-2 font-mono text-xs">
        {loading && <p className="text-muted-foreground">Loading preview...</p>}
        {error && <p className="text-red-400">{error}</p>}
        {!loading && !error && documents.length === 0 && (
          <p className="text-muted-foreground">No documents</p>
        )}
        {!loading && !error && documents.map((doc, i) => (
          <pre key={i} className="mb-2 whitespace-pre-wrap rounded border border-border bg-background p-2 text-foreground">
            {JSON.stringify(doc, null, 2)}
          </pre>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/aggregation/StagePreview.tsx
git commit -m "feat: add StagePreview component with debounced live preview"
```

---

## Task 9: Frontend — AggregationEditor Main Component

**Files:**
- Create: `src/renderer/src/components/aggregation/AggregationEditor.tsx`

- [ ] **Step 1: Create the AggregationEditor component**

Create `src/renderer/src/components/aggregation/AggregationEditor.tsx`:

```tsx
import { useState, useCallback } from 'react'
import { Play, FileJson, Copy } from 'lucide-react'
import { useTabStore } from '@renderer/store/tabStore'
import { trpc } from '@renderer/lib/trpc'
import { StageList } from './StageList'
import { StageEditor } from './StageEditor'
import { StagePreview } from './StagePreview'
import type { AggregationStage } from '@shared/types'

export function AggregationEditor() {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const updateTab = useTabStore((s) => s.updateTab)

  const [stages, setStages] = useState<AggregationStage[]>([])
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedStage = stages.find((s) => s.id === selectedStageId) ?? null

  if (!tab || tab.scope !== 'collection') return null

  function handleStageContentChange(content: string) {
    if (!selectedStageId) return
    setStages((prev) => prev.map((s) => s.id === selectedStageId ? { ...s, content } : s))
  }

  function buildPipeline(): Record<string, unknown>[] {
    return stages
      .filter((s) => s.enabled)
      .map((s) => {
        try { return { [s.type]: JSON.parse(s.content) } }
        catch { return { [s.type]: {} } }
      })
  }

  async function runPipeline() {
    setRunning(true)
    setError(null)
    try {
      const pipeline = buildPipeline()
      const results = await trpc.query.aggregate.query({
        database: tab.database,
        collection: tab.collection,
        pipeline
      })
      updateTab(tab.id, {
        results: { documents: results, totalCount: results.length },
        loading: false,
        error: null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pipeline execution failed')
    } finally {
      setRunning(false)
    }
  }

  function copyPipelineJson() {
    const pipeline = buildPipeline()
    navigator.clipboard.writeText(JSON.stringify(pipeline, null, 2))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 min-h-0">
        {/* Stage list — left panel */}
        <StageList
          stages={stages}
          selectedStageId={selectedStageId}
          onSelectStage={setSelectedStageId}
          onUpdateStages={setStages}
        />
        {/* Stage editor — center */}
        <div className="flex-1 min-w-0">
          <StageEditor
            stage={selectedStage}
            onChange={handleStageContentChange}
          />
        </div>
        {/* Stage preview — right panel */}
        <div className="w-72 border-l border-border">
          <StagePreview
            database={tab.database}
            collection={tab.collection}
            stages={stages}
            selectedStageId={selectedStageId}
          />
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-1.5">
        <button
          className="flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          onClick={runPipeline}
          disabled={running || stages.length === 0}
        >
          <Play className="h-3 w-3" />
          {running ? 'Running...' : 'Run Pipeline'}
        </button>
        <button
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={copyPipelineJson}
        >
          <Copy className="h-3 w-3" /> Copy JSON
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
        {tab.results && !error && (
          <span className="text-xs text-muted-foreground">
            {tab.results.totalCount} documents returned
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/aggregation/AggregationEditor.tsx
git commit -m "feat: add AggregationEditor main component with pipeline execution"
```

---

## Task 10: Integrate Aggregation Editor into MainPanel

**Files:**
- Modify: `src/renderer/src/components/data/MainPanel.tsx`

- [ ] **Step 1: Add Aggregation sub-tab**

Replace the entire content of `src/renderer/src/components/data/MainPanel.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useTabStore } from '@renderer/store/tabStore'
import { TabBar } from '@renderer/components/layout/TabBar'
import { QueryBuilder } from '@renderer/components/query/QueryBuilder'
import { DocumentTable } from './DocumentTable'
import { BulkToolbar } from './BulkToolbar'
import { DocumentEditor } from './DocumentEditor'
import { IndexPanel } from '@renderer/components/indexes/IndexPanel'
import { AggregationEditor } from '@renderer/components/aggregation/AggregationEditor'
import { MessageSquare } from 'lucide-react'

type SubTab = 'documents' | 'aggregation' | 'indexes'

export function MainPanel() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [subTab, setSubTab] = useState<SubTab>('documents')

  useEffect(() => {
    setSubTab('documents')
  }, [activeTab?.id])

  const subTabs: { key: SubTab; label: string }[] = [
    { key: 'documents', label: 'Documents' },
    { key: 'aggregation', label: 'Aggregation' },
    { key: 'indexes', label: 'Indexes' }
  ]

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      {activeTab ? (
        <>
          {activeTab.scope !== 'collection' ? (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-3">
              <MessageSquare className="h-10 w-10 opacity-30" />
              <p className="text-sm">Chat with Claude in the side panel &rarr;</p>
            </div>
          ) : (
            <>
              {/* Sub-tab bar */}
              <div className="flex h-8 items-center gap-0 border-b border-border bg-card px-2">
                {subTabs.map((t) => (
                  <button
                    key={t.key}
                    className={`relative px-3 py-1 text-xs font-medium transition-colors ${
                      subTab === t.key
                        ? 'text-emerald-400'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setSubTab(t.key)}
                  >
                    {t.label}
                    {subTab === t.key && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400" />
                    )}
                  </button>
                ))}
              </div>

              {subTab === 'documents' && (
                <>
                  <QueryBuilder />
                  <BulkToolbar />
                  <div className={activeTab.selectedDocument ? 'h-1/2 min-h-0' : 'flex-1 min-h-0'}>
                    <DocumentTable />
                  </div>
                  {activeTab.selectedDocument && (
                    <div className="h-1/2 min-h-0">
                      <DocumentEditor />
                    </div>
                  )}
                </>
              )}

              {subTab === 'aggregation' && (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex-1 min-h-0">
                    <AggregationEditor />
                  </div>
                  {/* Show results table below aggregation editor */}
                  {activeTab.results && activeTab.results.documents.length > 0 && (
                    <div className="h-2/5 min-h-0 border-t border-border">
                      <DocumentTable />
                    </div>
                  )}
                </div>
              )}

              {subTab === 'indexes' && (
                <div className="flex-1 overflow-auto">
                  <IndexPanel />
                </div>
              )}
            </>
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

- [ ] **Step 2: Verify the app compiles**

```bash
cd "D:/Git Repos/Mango" && npm run build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/data/MainPanel.tsx
git commit -m "feat: integrate Aggregation Editor as sub-tab in MainPanel"
```

---

## Task 11: Backend — Explain Plan Parser

**Files:**
- Create: `src/main/services/explainParser.ts`

- [ ] **Step 1: Create the explain parser service**

Create `src/main/services/explainParser.ts`:

```typescript
import type { ExplainStageNode, ExplainPlan } from '@shared/types'

function classifyEfficiency(node: {
  type: string
  docsExamined: number
  docsReturned: number
}): 'good' | 'moderate' | 'poor' {
  if (node.type === 'COLLSCAN') return 'poor'
  if (node.docsReturned === 0) return 'good'
  const ratio = node.docsExamined / Math.max(node.docsReturned, 1)
  if (ratio <= 2) return 'good'
  if (ratio <= 10) return 'moderate'
  return 'poor'
}

let nodeCounter = 0

function parseExecutionStage(stage: Record<string, unknown>): ExplainStageNode {
  const id = `node-${nodeCounter++}`
  const type = (stage.stage as string) ?? (stage.inputStage ? 'UNKNOWN' : 'ROOT')

  const docsExamined = (stage.docsExamined as number) ?? (stage.totalDocsExamined as number) ?? 0
  const docsReturned = (stage.nReturned as number) ?? 0
  const keysExamined = (stage.totalKeysExamined as number) ?? (stage.keysExamined as number) ?? 0
  const executionTimeMs = (stage.executionTimeMillisEstimate as number) ?? 0
  const memoryUsageBytes = (stage.memUsage as number) ?? (stage.usedDisk ? -1 : undefined)

  const indexName = (stage.indexName as string) ?? undefined
  const indexKeyPattern = (stage.keyPattern as Record<string, number>) ?? undefined
  const filter = (stage.filter as Record<string, unknown>) ?? undefined

  const children: ExplainStageNode[] = []
  if (stage.inputStage) {
    children.push(parseExecutionStage(stage.inputStage as Record<string, unknown>))
  }
  if (stage.inputStages) {
    for (const child of stage.inputStages as Record<string, unknown>[]) {
      children.push(parseExecutionStage(child))
    }
  }

  const node: ExplainStageNode = {
    id,
    type,
    executionTimeMs,
    docsExamined,
    docsReturned,
    keysExamined,
    indexName,
    indexKeyPattern,
    filter,
    memoryUsageBytes,
    children,
    efficiency: 'good'
  }
  node.efficiency = classifyEfficiency(node)
  return node
}

function flattenNodes(node: ExplainStageNode): ExplainStageNode[] {
  const result: ExplainStageNode[] = []
  for (const child of node.children) {
    result.push(...flattenNodes(child))
  }
  result.push(node)
  return result
}

function suggestIndex(root: ExplainStageNode): string | undefined {
  const allNodes = flattenNodes(root)
  const collScan = allNodes.find((n) => n.type === 'COLLSCAN')
  if (!collScan || !collScan.filter) return undefined

  const fields = Object.keys(collScan.filter)
    .filter((k) => !k.startsWith('$'))
    .flatMap((k) => {
      const val = collScan.filter![k]
      if (typeof val === 'object' && val !== null) {
        return Object.keys(val as object).filter((sk) => !sk.startsWith('$')).length > 0 ? [k] : [k]
      }
      return [k]
    })

  if (fields.length === 0) return undefined
  return `Consider creating an index on { ${fields.map((f) => `"${f}": 1`).join(', ')} }`
}

export function parseExplainResult(raw: Record<string, unknown>): ExplainPlan {
  nodeCounter = 0

  // Handle find explain
  const executionStats = raw.executionStats as Record<string, unknown> | undefined
  const queryPlanner = raw.queryPlanner as Record<string, unknown> | undefined

  let root: ExplainStageNode
  let totalExecutionTimeMs = 0
  let winningPlan = ''
  let rejectedPlansCount = 0

  if (executionStats?.executionStages) {
    root = parseExecutionStage(executionStats.executionStages as Record<string, unknown>)
    totalExecutionTimeMs = (executionStats.executionTimeMillis as number) ?? 0
  } else if (raw.stages) {
    // Aggregation explain — walk stages array
    const aggStages = raw.stages as Record<string, unknown>[]
    const firstStage = aggStages[0]
    if (firstStage?.$cursor) {
      const cursor = firstStage.$cursor as Record<string, unknown>
      const cursorExecStats = cursor.executionStats as Record<string, unknown> | undefined
      if (cursorExecStats?.executionStages) {
        root = parseExecutionStage(cursorExecStats.executionStages as Record<string, unknown>)
        totalExecutionTimeMs = (cursorExecStats.executionTimeMillis as number) ?? 0
      } else {
        root = { id: 'root', type: 'PIPELINE', executionTimeMs: 0, docsExamined: 0, docsReturned: 0, keysExamined: 0, children: [], efficiency: 'good' }
      }
    } else {
      root = { id: 'root', type: 'PIPELINE', executionTimeMs: 0, docsExamined: 0, docsReturned: 0, keysExamined: 0, children: [], efficiency: 'good' }
    }
  } else {
    root = { id: 'root', type: 'UNKNOWN', executionTimeMs: 0, docsExamined: 0, docsReturned: 0, keysExamined: 0, children: [], efficiency: 'good' }
  }

  if (queryPlanner) {
    const wp = queryPlanner.winningPlan as Record<string, unknown> | undefined
    winningPlan = wp?.stage ? String(wp.stage) : 'unknown'
    const rejected = queryPlanner.rejectedPlans as unknown[]
    rejectedPlansCount = Array.isArray(rejected) ? rejected.length : 0
  }

  const stages = flattenNodes(root)

  return {
    stages,
    totalExecutionTimeMs,
    winningPlan,
    rejectedPlansCount,
    indexSuggestion: suggestIndex(root),
    raw
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/explainParser.ts
git commit -m "feat: add explain plan parser for visual explain"
```

---

## Task 12: Backend — tRPC Route for Parsed Explain

**Files:**
- Modify: `src/main/trpc/routers/query.ts`

- [ ] **Step 1: Add parsedExplain route**

Add the import at the top of `src/main/trpc/routers/query.ts`:

```typescript
import { parseExplainResult } from '../../services/explainParser'
```

Add the new route after the `explain` route:

```typescript
  parsedExplain: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()).optional().default({}),
        pipeline: z.array(z.record(z.unknown())).optional()
      })
    )
    .query(async ({ input }) => {
      const raw = await queryActions.explain(input.database, input.collection, input.filter, input.pipeline)
      return parseExplainResult(raw)
    }),
```

- [ ] **Step 2: Commit**

```bash
git add src/main/trpc/routers/query.ts
git commit -m "feat: add parsedExplain tRPC route returning structured explain plan"
```

---

## Task 13: Frontend — Visual Explain Component

**Files:**
- Create: `src/renderer/src/components/explain/VisualExplain.tsx`

- [ ] **Step 1: Create the VisualExplain component**

Create `src/renderer/src/components/explain/VisualExplain.tsx`:

```tsx
import { useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import Editor from '@monaco-editor/react'
import { useSettingsStore } from '@renderer/store/settingsStore'
import type { ExplainPlan, ExplainStageNode } from '@shared/types'

const EFFICIENCY_COLORS = {
  good: { bg: '#065f46', border: '#10b981', text: '#6ee7b7' },
  moderate: { bg: '#78350f', border: '#f59e0b', text: '#fcd34d' },
  poor: { bg: '#7f1d1d', border: '#ef4444', text: '#fca5a5' }
}

function buildNodes(stages: ExplainStageNode[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  stages.forEach((stage, i) => {
    const colors = EFFICIENCY_COLORS[stage.efficiency]
    nodes.push({
      id: stage.id,
      position: { x: i * 220, y: 100 },
      data: {
        label: (
          <div className="text-center">
            <div className="text-xs font-bold" style={{ color: colors.text }}>{stage.type}</div>
            <div className="text-[10px] opacity-70">{stage.executionTimeMs}ms</div>
            <div className="text-[10px] opacity-70">{stage.docsReturned} docs</div>
            {stage.indexName && <div className="text-[10px] opacity-70">{stage.indexName}</div>}
          </div>
        )
      },
      style: {
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: '6px',
        padding: '8px 12px',
        width: 160
      }
    })

    if (i > 0) {
      edges.push({
        id: `e-${stages[i - 1].id}-${stage.id}`,
        source: stages[i - 1].id,
        target: stage.id,
        label: `${stage.docsExamined}`,
        style: { stroke: '#6b7280' },
        labelStyle: { fontSize: 10, fill: '#9ca3af' }
      })
    }
  })

  return { nodes, edges }
}

interface VisualExplainProps {
  plan: ExplainPlan
}

export function VisualExplain({ plan }: VisualExplainProps) {
  const [showRaw, setShowRaw] = useState(false)
  const [selectedStage, setSelectedStage] = useState<ExplainStageNode | null>(null)
  const theme = useSettingsStore((s) => s.effectiveTheme)

  const { nodes, edges } = buildNodes(plan.stages)

  return (
    <div className="flex h-full flex-col">
      {/* Summary bar */}
      <div className="flex items-center gap-4 border-b border-border bg-card px-3 py-2">
        <span className="text-xs">
          <span className="text-muted-foreground">Total:</span>{' '}
          <span className="font-mono font-semibold">{plan.totalExecutionTimeMs}ms</span>
        </span>
        <span className="text-xs">
          <span className="text-muted-foreground">Plan:</span>{' '}
          <span className="font-mono">{plan.winningPlan}</span>
        </span>
        {plan.rejectedPlansCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {plan.rejectedPlansCount} rejected plan{plan.rejectedPlansCount > 1 ? 's' : ''}
          </span>
        )}
        {plan.indexSuggestion && (
          <span className="text-xs text-amber-400">{plan.indexSuggestion}</span>
        )}
        <span className="flex-1" />
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowRaw(!showRaw)}
        >
          {showRaw ? 'Show Diagram' : 'Show Raw JSON'}
        </button>
      </div>

      {showRaw ? (
        <div className="flex-1 min-h-0">
          <Editor
            value={JSON.stringify(plan.raw, null, 2)}
            language="json"
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            options={{ readOnly: true, minimap: { enabled: false }, lineNumbers: 'off', scrollBeyondLastLine: false, fontSize: 11 }}
          />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-h-0" style={{ background: theme === 'dark' ? '#0a0a0a' : '#fafafa' }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodeClick={(_, node) => {
                const stage = plan.stages.find((s) => s.id === node.id)
                setSelectedStage(stage ?? null)
              }}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>

          {/* Stage detail panel */}
          {selectedStage && (
            <div className="w-64 overflow-y-auto border-l border-border bg-card p-3 text-xs space-y-2">
              <h3 className="font-bold text-sm">{selectedStage.type}</h3>
              <div><span className="text-muted-foreground">Execution Time:</span> {selectedStage.executionTimeMs}ms</div>
              <div><span className="text-muted-foreground">Docs Examined:</span> {selectedStage.docsExamined}</div>
              <div><span className="text-muted-foreground">Docs Returned:</span> {selectedStage.docsReturned}</div>
              <div><span className="text-muted-foreground">Keys Examined:</span> {selectedStage.keysExamined}</div>
              {selectedStage.indexName && (
                <div><span className="text-muted-foreground">Index:</span> {selectedStage.indexName}</div>
              )}
              {selectedStage.indexKeyPattern && (
                <div><span className="text-muted-foreground">Key Pattern:</span> {JSON.stringify(selectedStage.indexKeyPattern)}</div>
              )}
              {selectedStage.filter && (
                <div>
                  <span className="text-muted-foreground">Filter:</span>
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-background p-1">{JSON.stringify(selectedStage.filter, null, 2)}</pre>
                </div>
              )}
              {selectedStage.memoryUsageBytes != null && selectedStage.memoryUsageBytes > 0 && (
                <div><span className="text-muted-foreground">Memory:</span> {(selectedStage.memoryUsageBytes / 1024).toFixed(1)} KB</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/explain/
git commit -m "feat: add VisualExplain component with reactflow diagram and stage details"
```

---

## Task 14: Integrate Visual Explain into MainPanel

**Files:**
- Modify: `src/renderer/src/components/data/MainPanel.tsx`

- [ ] **Step 1: Add Explain sub-tab**

In `src/renderer/src/components/data/MainPanel.tsx`, add import:

```typescript
import { VisualExplain } from '@renderer/components/explain/VisualExplain'
```

Add `'explain'` to the `SubTab` type:

```typescript
type SubTab = 'documents' | 'aggregation' | 'indexes' | 'explain'
```

Add explain to the `subTabs` array:

```typescript
  const subTabs: { key: SubTab; label: string }[] = [
    { key: 'documents', label: 'Documents' },
    { key: 'aggregation', label: 'Aggregation' },
    { key: 'explain', label: 'Explain' },
    { key: 'indexes', label: 'Indexes' }
  ]
```

Add state for the explain plan and render the Explain tab. Add a state variable at the top of MainPanel:

```typescript
  const [explainPlan, setExplainPlan] = useState<import('@shared/types').ExplainPlan | null>(null)
```

Add an `onExplain` handler that fetches the explain plan and switches to the explain tab:

```typescript
  async function runExplain() {
    if (!activeTab) return
    const { trpc } = await import('@renderer/lib/trpc')
    try {
      const plan = await trpc.query.parsedExplain.query({
        database: activeTab.database,
        collection: activeTab.collection,
        filter: activeTab.filter
      })
      setExplainPlan(plan)
      setSubTab('explain')
    } catch (e) {
      console.error('Explain failed:', e)
    }
  }
```

Add the explain tab render block alongside the other subTab conditions:

```tsx
              {subTab === 'explain' && (
                <div className="flex-1 min-h-0">
                  {explainPlan ? (
                    <VisualExplain plan={explainPlan} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      Run a query first, then click Explain
                    </div>
                  )}
                </div>
              )}
```

- [ ] **Step 2: Verify build**

```bash
cd "D:/Git Repos/Mango" && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/data/MainPanel.tsx
git commit -m "feat: integrate Visual Explain as sub-tab in MainPanel"
```

---

## Task 15: Frontend — Tree View Component

**Files:**
- Create: `src/renderer/src/components/data/TreeView.tsx`

- [ ] **Step 1: Create the TreeView component**

Create `src/renderer/src/components/data/TreeView.tsx`:

```tsx
import { useState, useMemo, useCallback } from 'react'
import { ChevronRight, ChevronDown, Save, Undo2 } from 'lucide-react'
import { useTabStore } from '@renderer/store/tabStore'
import { trpc } from '@renderer/lib/trpc'

type NodeType = 'string' | 'number' | 'boolean' | 'null' | 'objectId' | 'date' | 'object' | 'array'

interface TreeNodeData {
  key: string
  value: unknown
  path: string
  type: NodeType
  depth: number
}

const TYPE_COLORS: Record<NodeType, string> = {
  string: 'text-green-400',
  number: 'text-blue-400',
  boolean: 'text-red-400',
  null: 'text-gray-500',
  objectId: 'text-orange-400',
  date: 'text-purple-400',
  object: 'text-foreground',
  array: 'text-foreground'
}

function inferType(value: unknown): NodeType {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') {
    if (/^[0-9a-f]{24}$/i.test(value)) return 'objectId'
    if (!isNaN(Date.parse(value)) && value.includes('T')) return 'date'
    return 'string'
  }
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return 'string'
}

function formatValue(value: unknown, type: NodeType): string {
  if (type === 'null') return 'null'
  if (type === 'string' || type === 'objectId' || type === 'date') return `"${String(value)}"`
  if (type === 'object') {
    const keys = Object.keys(value as object)
    return `{${keys.length} field${keys.length !== 1 ? 's' : ''}}`
  }
  if (type === 'array') return `[${(value as unknown[]).length} item${(value as unknown[]).length !== 1 ? 's' : ''}]`
  return String(value)
}

interface TreeNodeProps {
  node: TreeNodeData
  expanded: Set<string>
  onToggle: (path: string) => void
  pendingEdits: Map<string, unknown>
  onEdit: (path: string, value: unknown) => void
}

function TreeNode({ node, expanded, onToggle, pendingEdits, onEdit }: TreeNodeProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const isExpandable = node.type === 'object' || node.type === 'array'
  const isExpanded = expanded.has(node.path)
  const hasPendingEdit = pendingEdits.has(node.path)

  function startEdit() {
    if (isExpandable) return
    setEditValue(node.type === 'string' ? String(node.value) : JSON.stringify(node.value))
    setEditing(true)
  }

  function commitEdit() {
    setEditing(false)
    let parsed: unknown = editValue
    if (editValue === 'null') parsed = null
    else if (editValue === 'true') parsed = true
    else if (editValue === 'false') parsed = false
    else if (/^-?\d+(\.\d+)?$/.test(editValue)) parsed = Number(editValue)
    onEdit(node.path, parsed)
  }

  const children = useMemo(() => {
    if (!isExpanded || !isExpandable) return []
    if (node.type === 'object' && typeof node.value === 'object' && node.value !== null) {
      return Object.entries(node.value as Record<string, unknown>).map(([k, v]) => ({
        key: k,
        value: v,
        path: `${node.path}.${k}`,
        type: inferType(v),
        depth: node.depth + 1
      }))
    }
    if (node.type === 'array' && Array.isArray(node.value)) {
      return (node.value as unknown[]).map((v, i) => ({
        key: `[${i}]`,
        value: v,
        path: `${node.path}.${i}`,
        type: inferType(v),
        depth: node.depth + 1
      }))
    }
    return []
  }, [isExpanded, isExpandable, node])

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-0.5 hover:bg-muted/30 cursor-pointer ${hasPendingEdit ? 'bg-yellow-500/10' : ''}`}
        style={{ paddingLeft: node.depth * 16 + 4 }}
        onDoubleClick={startEdit}
      >
        {isExpandable ? (
          <button onClick={() => onToggle(node.path)} className="text-muted-foreground">
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-3" />
        )}
        <span className="text-xs text-muted-foreground">{node.key}:</span>
        {editing ? (
          <input
            autoFocus
            className="flex-1 bg-transparent text-xs outline-none border-b border-emerald-500"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
          />
        ) : (
          <span className={`text-xs font-mono ${TYPE_COLORS[node.type]}`}>
            {formatValue(pendingEdits.has(node.path) ? pendingEdits.get(node.path) : node.value, node.type)}
          </span>
        )}
      </div>
      {children.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          expanded={expanded}
          onToggle={onToggle}
          pendingEdits={pendingEdits}
          onEdit={onEdit}
        />
      ))}
    </div>
  )
}

export function TreeView() {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const connectionStore = (window as unknown as { __connectionStore?: { getState: () => { profiles: { id: string; isReadOnly?: boolean }[] } } }).__connectionStore
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [pendingEdits, setPendingEdits] = useState<Map<string, unknown>>(new Map())
  const [saving, setSaving] = useState(false)

  const isReadOnly = useMemo(() => {
    if (!tab) return true
    if (tab.isView) return true
    // Check store for connection read-only flag
    return false
  }, [tab])

  if (!tab?.results) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No results</div>
  }

  function toggleExpand(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function handleEdit(path: string, value: unknown) {
    if (isReadOnly) return
    setPendingEdits((prev) => {
      const next = new Map(prev)
      next.set(path, value)
      return next
    })
  }

  async function saveEdits() {
    if (!tab || pendingEdits.size === 0) return
    setSaving(true)
    try {
      // Group edits by document (_id)
      const editsByDoc = new Map<string, Record<string, unknown>>()
      for (const [path, value] of pendingEdits) {
        const parts = path.split('.')
        const docIndex = parseInt(parts[0])
        const fieldPath = parts.slice(1).join('.')
        const doc = tab.results!.documents[docIndex]
        const docId = String(doc._id)
        if (!editsByDoc.has(docId)) editsByDoc.set(docId, {})
        editsByDoc.get(docId)![fieldPath] = value
      }

      for (const [docId, fields] of editsByDoc) {
        await trpc.mutation.updateOne.mutate({
          database: tab.database,
          collection: tab.collection,
          filter: { _id: docId },
          update: { $set: fields }
        })
      }
      setPendingEdits(new Map())
      // Refresh results
      useTabStore.getState().executeQuery()
    } catch (e) {
      console.error('Save failed:', e)
    } finally {
      setSaving(false)
    }
  }

  const documents = tab.results.documents

  return (
    <div className="flex h-full flex-col">
      {pendingEdits.size > 0 && !isReadOnly && (
        <div className="flex items-center gap-2 border-b border-border bg-yellow-500/5 px-3 py-1">
          <span className="text-xs text-yellow-400">{pendingEdits.size} pending edit{pendingEdits.size > 1 ? 's' : ''}</span>
          <span className="flex-1" />
          <button
            className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-xs text-white hover:bg-emerald-500"
            onClick={saveEdits}
            disabled={saving}
          >
            <Save className="h-3 w-3" /> Save
          </button>
          <button
            className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setPendingEdits(new Map())}
          >
            <Undo2 className="h-3 w-3" /> Discard
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto p-1 font-mono text-xs">
        {documents.map((doc, i) => (
          <div key={String(doc._id ?? i)} className="mb-1 rounded border border-border p-1">
            <TreeNode
              node={{
                key: String(doc._id ?? `doc-${i}`),
                value: doc,
                path: String(i),
                type: 'object',
                depth: 0
              }}
              expanded={expanded}
              onToggle={toggleExpand}
              pendingEdits={pendingEdits}
              onEdit={handleEdit}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/data/TreeView.tsx
git commit -m "feat: add TreeView component with expandable nodes and inline editing"
```

---

## Task 16: Integrate Tree View into MainPanel

**Files:**
- Modify: `src/renderer/src/components/data/MainPanel.tsx`

- [ ] **Step 1: Add view mode toggle to documents sub-tab**

In `src/renderer/src/components/data/MainPanel.tsx`, add import:

```typescript
import { TreeView } from './TreeView'
```

Add a state for the document view mode:

```typescript
  const [viewMode, setViewMode] = useState<'table' | 'tree'>('table')
```

Replace the documents sub-tab render block (the `{subTab === 'documents' && (...)}` section) with:

```tsx
              {subTab === 'documents' && (
                <>
                  <QueryBuilder />
                  <BulkToolbar />
                  {/* View mode toggle */}
                  <div className="flex items-center gap-1 border-b border-border bg-card px-2 py-0.5">
                    <span className="text-[10px] text-muted-foreground mr-1">View:</span>
                    {(['table', 'tree'] as const).map((mode) => (
                      <button
                        key={mode}
                        className={`px-2 py-0.5 text-[10px] rounded ${
                          viewMode === mode
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setViewMode(mode)}
                      >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </button>
                    ))}
                  </div>
                  <div className={activeTab.selectedDocument && viewMode === 'table' ? 'h-1/2 min-h-0' : 'flex-1 min-h-0'}>
                    {viewMode === 'table' ? <DocumentTable /> : <TreeView />}
                  </div>
                  {activeTab.selectedDocument && viewMode === 'table' && (
                    <div className="h-1/2 min-h-0">
                      <DocumentEditor />
                    </div>
                  )}
                </>
              )}
```

- [ ] **Step 2: Verify build**

```bash
cd "D:/Git Repos/Mango" && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/data/MainPanel.tsx
git commit -m "feat: integrate TreeView as document view mode alongside table"
```

---

## Task 17: Backend — Value Search Action

**Files:**
- Modify: `src/main/actions/query.ts`

- [ ] **Step 1: Add valueSearch function**

Add at the end of `src/main/actions/query.ts`:

```typescript
export async function valueSearch(
  searchTerm: string,
  scope: { type: 'server' | 'database' | 'collection'; database?: string; collection?: string },
  options: { regex: boolean; caseInsensitive: boolean; maxResults: number },
  onProgress?: (progress: { collectionsScanned: number; collectionsTotal: number; resultsFound: number; currentCollection: string; done: boolean }) => void
): Promise<{ database: string; collection: string; documentId: string; fieldPath: string; matchedValue: string }[]> {
  const results: { database: string; collection: string; documentId: string; fieldPath: string; matchedValue: string }[] = []

  // Determine which collections to search
  const collectionsToSearch: { database: string; collection: string }[] = []

  if (scope.type === 'collection' && scope.database && scope.collection) {
    collectionsToSearch.push({ database: scope.database, collection: scope.collection })
  } else if (scope.type === 'database' && scope.database) {
    const db = mongoService.getDb(scope.database)
    const cols = await db.listCollections().toArray()
    for (const col of cols) {
      if (col.type !== 'view') collectionsToSearch.push({ database: scope.database, collection: col.name })
    }
  } else {
    const admin = mongoService.getDb('admin').admin()
    const dbList = await admin.listDatabases()
    for (const dbInfo of dbList.databases) {
      if (['admin', 'local', 'config'].includes(dbInfo.name)) continue
      const db = mongoService.getDb(dbInfo.name)
      const cols = await db.listCollections().toArray()
      for (const col of cols) {
        if (col.type !== 'view') collectionsToSearch.push({ database: dbInfo.name, collection: col.name })
      }
    }
  }

  const total = collectionsToSearch.length
  let scanned = 0

  for (const { database, collection } of collectionsToSearch) {
    if (results.length >= options.maxResults) break

    onProgress?.({ collectionsScanned: scanned, collectionsTotal: total, resultsFound: results.length, currentCollection: `${database}.${collection}`, done: false })

    const db = mongoService.getDb(database)
    const col = db.collection(collection)

    // Get a schema sample to find string-like fields
    const sample = await col.aggregate([{ $sample: { size: 10 } }]).toArray()
    const stringFields = new Set<string>()
    for (const doc of sample) {
      for (const [key, val] of Object.entries(doc)) {
        if (typeof val === 'string') stringFields.add(key)
      }
    }

    if (stringFields.size === 0) { scanned++; continue }

    const regexFlags = options.caseInsensitive ? 'i' : ''
    const pattern = options.regex ? searchTerm : searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    const orConditions = Array.from(stringFields).map((field) => ({
      [field]: { $regex: pattern, $options: regexFlags }
    }))

    const remaining = options.maxResults - results.length
    const docs = await col.find({ $or: orConditions }).limit(remaining).toArray()

    for (const doc of docs) {
      const docId = String(doc._id)
      for (const field of stringFields) {
        const val = doc[field]
        if (typeof val !== 'string') continue
        const re = new RegExp(pattern, regexFlags)
        if (re.test(val)) {
          results.push({ database, collection, documentId: docId, fieldPath: field, matchedValue: val })
          if (results.length >= options.maxResults) break
        }
      }
      if (results.length >= options.maxResults) break
    }

    scanned++
  }

  onProgress?.({ collectionsScanned: total, collectionsTotal: total, resultsFound: results.length, currentCollection: '', done: true })

  return results
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/actions/query.ts
git commit -m "feat: add valueSearch action for global text search across collections"
```

---

## Task 18: Backend — Value Search tRPC Route and MCP Tool

**Files:**
- Modify: `src/main/trpc/routers/query.ts`
- Modify: `src/main/mcp/tools.ts`

- [ ] **Step 1: Add valueSearch tRPC route**

Add to `src/main/trpc/routers/query.ts` before the `getHistory` route:

```typescript
  valueSearch: procedure
    .input(
      z.object({
        searchTerm: z.string(),
        scope: z.object({
          type: z.enum(['server', 'database', 'collection']),
          database: z.string().optional(),
          collection: z.string().optional()
        }),
        regex: z.boolean().optional().default(false),
        caseInsensitive: z.boolean().optional().default(true),
        maxResults: z.number().optional().default(200)
      })
    )
    .query(async ({ input }) => {
      return queryActions.valueSearch(
        input.searchTerm,
        input.scope,
        { regex: input.regex, caseInsensitive: input.caseInsensitive, maxResults: input.maxResults }
      )
    }),
```

- [ ] **Step 2: Add mongo_value_search MCP tool**

Add to `src/main/mcp/tools.ts` after the `mongo_aggregate_preview` tool:

```typescript
  server.registerTool('mongo_value_search', {
    description: 'Search for a text value across all fields in collections. Useful for finding where a specific value appears in the database.',
    inputSchema: {
      searchTerm: z.string().describe('Text to search for'),
      scope: z.enum(['server', 'database', 'collection']).describe('Search scope'),
      database: z.string().optional().describe('Database name (required for database/collection scope)'),
      collection: z.string().optional().describe('Collection name (required for collection scope)'),
      caseInsensitive: z.boolean().default(true).describe('Case-insensitive search'),
      maxResults: z.number().default(50).describe('Maximum results to return')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ searchTerm, scope, database, collection, caseInsensitive, maxResults }) => {
    const results = await queryActions.valueSearch(
      searchTerm,
      { type: scope, database, collection },
      { regex: false, caseInsensitive, maxResults }
    )
    const summary = results.map((r) => `${r.database}.${r.collection} | _id:${r.documentId} | ${r.fieldPath}: ${r.matchedValue}`).join('\n')
    return {
      content: [{ type: 'text', text: `Found ${results.length} matches:\n${summary}` }]
    }
  })
```

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/query.ts src/main/mcp/tools.ts
git commit -m "feat: add valueSearch tRPC route and mongo_value_search MCP tool"
```

---

## Task 19: Frontend — Value Search Dialog

**Files:**
- Create: `src/renderer/src/components/search/ValueSearchDialog.tsx`

- [ ] **Step 1: Create the ValueSearchDialog component**

Create `src/renderer/src/components/search/ValueSearchDialog.tsx`:

```tsx
import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { trpc } from '@renderer/lib/trpc'
import { useTabStore } from '@renderer/store/tabStore'
import { useExplorerStore } from '@renderer/store/explorerStore'
import type { ValueSearchResult } from '@shared/types'

interface ValueSearchDialogProps {
  open: boolean
  onClose: () => void
}

export function ValueSearchDialog({ open, onClose }: ValueSearchDialogProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [scopeType, setScopeType] = useState<'server' | 'database' | 'collection'>('server')
  const [scopeDatabase, setScopeDatabase] = useState('')
  const [scopeCollection, setScopeCollection] = useState('')
  const [caseInsensitive, setCaseInsensitive] = useState(true)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState<ValueSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const databases = useExplorerStore((s) => s.databases)
  const collections = useExplorerStore((s) => s.collections[scopeDatabase] ?? [])
  const openTab = useTabStore((s) => s.openTab)
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))

  if (!open) return null

  async function handleSearch() {
    if (!searchTerm.trim()) return
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const result = await trpc.query.valueSearch.query({
        searchTerm,
        scope: {
          type: scopeType,
          database: scopeType !== 'server' ? scopeDatabase : undefined,
          collection: scopeType === 'collection' ? scopeCollection : undefined
        },
        regex,
        caseInsensitive,
        maxResults: 200
      })
      setResults(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  function navigateToResult(result: ValueSearchResult) {
    if (!activeTab) return
    openTab(activeTab.connectionId, result.database, result.collection)
    onClose()
  }

  // Group results by collection
  const grouped = results.reduce<Record<string, ValueSearchResult[]>>((acc, r) => {
    const key = `${r.database}.${r.collection}`
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50" onClick={onClose}>
      <div
        className="w-[600px] max-h-[70vh] flex flex-col rounded-lg border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search bar */}
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            className="flex-1 bg-transparent text-sm outline-none"
            placeholder="Search field values..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
          />
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Options */}
        <div className="flex items-center gap-3 border-b border-border px-3 py-2">
          <select
            className="rounded border border-border bg-background px-2 py-0.5 text-xs"
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value as 'server' | 'database' | 'collection')}
          >
            <option value="server">All databases</option>
            <option value="database">Database</option>
            <option value="collection">Collection</option>
          </select>
          {scopeType !== 'server' && (
            <select
              className="rounded border border-border bg-background px-2 py-0.5 text-xs"
              value={scopeDatabase}
              onChange={(e) => setScopeDatabase(e.target.value)}
            >
              <option value="">Select database</option>
              {databases.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          )}
          {scopeType === 'collection' && scopeDatabase && (
            <select
              className="rounded border border-border bg-background px-2 py-0.5 text-xs"
              value={scopeCollection}
              onChange={(e) => setScopeCollection(e.target.value)}
            >
              <option value="">Select collection</option>
              {collections.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          )}
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={caseInsensitive} onChange={(e) => setCaseInsensitive(e.target.checked)} className="h-3 w-3" />
            Case insensitive
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} className="h-3 w-3" />
            Regex
          </label>
          <button
            className="ml-auto rounded bg-emerald-600 px-3 py-0.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
            onClick={handleSearch}
            disabled={loading || !searchTerm.trim()}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-2 text-xs">
          {error && <p className="text-red-400 p-2">{error}</p>}
          {searched && !loading && results.length === 0 && !error && (
            <p className="p-2 text-muted-foreground">No results found</p>
          )}
          {Object.entries(grouped).map(([key, items]) => (
            <div key={key} className="mb-3">
              <div className="flex items-center gap-2 px-1 py-0.5">
                <span className="font-semibold text-emerald-400">{key}</span>
                <span className="text-muted-foreground">({items.length})</span>
              </div>
              {items.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30 cursor-pointer"
                  onDoubleClick={() => navigateToResult(item)}
                >
                  <span className="text-muted-foreground font-mono shrink-0 w-48 truncate">{item.documentId}</span>
                  <span className="text-blue-400 shrink-0">{item.fieldPath}:</span>
                  <span className="truncate">{item.matchedValue}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/search/
git commit -m "feat: add ValueSearchDialog component for global field value search"
```

---

## Task 20: Integrate Value Search into TopBar

**Files:**
- Modify: `src/renderer/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Read the current TopBar to understand its structure**

Read `src/renderer/src/components/layout/TopBar.tsx` to identify where to add the search button.

- [ ] **Step 2: Add the Value Search trigger**

Add import at the top of `TopBar.tsx`:

```typescript
import { ValueSearchDialog } from '@renderer/components/search/ValueSearchDialog'
```

Add state inside the TopBar component:

```typescript
const [valueSearchOpen, setValueSearchOpen] = useState(false)
```

Add a "Search Values" button in the top bar (next to existing elements — exact location depends on current layout, but add it near the search area):

```tsx
<button
  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30"
  onClick={() => setValueSearchOpen(true)}
  title="Search field values (Ctrl+Shift+F)"
>
  <SearchIcon className="h-3.5 w-3.5" />
  Search Values
</button>
```

Add the dialog at the end of the component's return, before the closing fragment/div:

```tsx
<ValueSearchDialog open={valueSearchOpen} onClose={() => setValueSearchOpen(false)} />
```

Add keyboard shortcut handler via useEffect:

```typescript
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault()
      setValueSearchOpen(true)
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [])
```

- [ ] **Step 3: Verify build**

```bash
cd "D:/Git Repos/Mango" && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/TopBar.tsx
git commit -m "feat: integrate Value Search into TopBar with Ctrl+Shift+F shortcut"
```

---

## Task 21: Final Build Verification and Integration Test

**Files:** None (verification only)

- [ ] **Step 1: Full build**

```bash
cd "D:/Git Repos/Mango" && npm run build
```

Expected: Clean build, no TypeScript errors.

- [ ] **Step 2: Manual smoke test**

Launch the app and verify:

1. **Aggregation tab**: Open a collection → click "Aggregation" sub-tab → add stages → stages appear in list → drag to reorder → toggle on/off → editor shows JSON → preview panel shows documents → "Run Pipeline" executes and shows results in table below
2. **Tree View**: Documents sub-tab → switch to "Tree" view mode → documents render as expandable trees → expand nested objects → double-click to edit values → save/discard works
3. **Visual Explain**: Run a find query → click "Explain" sub-tab → flow diagram renders with stage boxes and arrows → click a stage to see details → "Show Raw JSON" toggle works
4. **Value Search**: Click "Search Values" in top bar (or Ctrl+Shift+F) → dialog opens → type search term → select scope → click Search → results grouped by collection → double-click navigates to collection

- [ ] **Step 3: Commit any fixes from smoke test**

```bash
git add -A
git commit -m "fix: address issues found during Phase 1 smoke testing"
```

(Only if fixes were needed. Skip if clean.)

---

## Task Summary

| Task | Feature | Description |
|------|---------|-------------|
| 1 | Setup | Create branch, install dependencies |
| 2 | Shared | Add types for Aggregation, Explain, Value Search |
| 3 | Aggregation | Backend action: aggregateWithStagePreview + extend explain |
| 4 | Aggregation | tRPC routes for preview and pipeline explain |
| 5 | Aggregation | MCP tool: mongo_aggregate_preview |
| 6 | Aggregation | Frontend: StageCard + StageList with drag-and-drop |
| 7 | Aggregation | Frontend: StageEditor (Monaco) |
| 8 | Aggregation | Frontend: StagePreview with debounced live preview |
| 9 | Aggregation | Frontend: AggregationEditor main component |
| 10 | Aggregation | Integrate into MainPanel as sub-tab |
| 11 | Explain | Backend: explain plan parser service |
| 12 | Explain | tRPC route: parsedExplain |
| 13 | Explain | Frontend: VisualExplain component with reactflow |
| 14 | Explain | Integrate into MainPanel as sub-tab |
| 15 | Tree View | Frontend: TreeView with expandable nodes + editing |
| 16 | Tree View | Integrate as view mode toggle in documents tab |
| 17 | Value Search | Backend: valueSearch action |
| 18 | Value Search | tRPC route + MCP tool |
| 19 | Value Search | Frontend: ValueSearchDialog |
| 20 | Value Search | Integrate into TopBar + keyboard shortcut |
| 21 | All | Final build verification + smoke test |

**Parallel execution opportunities:** Tasks 3-5 (backend) can run in parallel with Tasks 6-9 (frontend aggregation). Tasks 11-12 (explain backend) can run parallel with Task 15 (tree view). Tasks 17-18 (value search backend) can run parallel with Task 19 (value search frontend).

---

## Spec Coverage Notes

Items from the design spec that are implemented with simplified scope in this plan. Address during implementation or as fast-follows:

1. **Aggregation Editor — Monaco auto-completion for field names and operators**: The spec calls for auto-completing field names (from schema inference) and MongoDB operators. This requires custom Monaco completion providers which are complex to set up. The plan ships a functional editor without auto-completion first. Add as a follow-up task by registering a `monaco.languages.registerCompletionItemProvider` for JSON that fetches schema via `trpc.explorer.collectionSchema`.

2. **Aggregation Editor — pipeline query history**: The spec says pipelines should save to query history. During implementation of Task 9, extend `saveHistory` to accept an optional `pipeline` field and save it alongside the existing find history. Requires extending `QueryHistoryEntry` with `type: 'find' | 'aggregate'` and `pipeline?: Record<string, unknown>[]`.

3. **Aggregation Editor — Explain button**: Task 9's toolbar should include an "Explain" button that calls `parsedExplain` with the current pipeline and switches to the Explain sub-tab. Wire this via the `runExplain` function from Task 14 (pass it down as a prop or use a shared callback).

4. **Tree View — right-click context menu**: The spec lists Copy Value, Copy Field Path, Delete Field, Add Field, Add Array Element, Expand All, Collapse All. During implementation of Task 15, add a context menu using `@radix-ui/react-context-menu` (already a dependency). The plan shows double-click editing; add the context menu with these actions.

5. **Tree View — virtualization**: The plan uses a custom recursive `TreeNode` component. For large result sets, replace with `react-arborist` to get windowed rendering. The custom component works fine for typical documents (<100 fields); optimize if performance is an issue.

6. **Tree View — large array truncation**: For arrays with >100 items, render only the first 100 with a "Load more" button. Add this check in the `TreeNode` children computation.

7. **Value Search — progress indicator**: The backend `valueSearch` accepts an `onProgress` callback. During implementation, stream progress via IPC events (same pattern as `OperationProgress`) and show a progress bar in the dialog.
