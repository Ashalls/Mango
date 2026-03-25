import { useMemo, useCallback, useState, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeAlpine } from 'ag-grid-community'
import type { CellEditingStoppedEvent } from 'ag-grid-community'
import {
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  RefreshCw,
  Loader2,
  Table2,
  Braces,
  Trash2,
  Copy,
  Hash
} from 'lucide-react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { useTabStore } from '@renderer/store/tabStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { trpc } from '@renderer/lib/trpc'

ModuleRegistry.registerModules([AllCommunityModule])

// Custom header: name on top, type dot + abbreviation below. Draggable.
function TypedHeader(props: { displayName: string; type?: string; typeColor?: string }) {
  const fieldName = props.displayName
  const type = props.type || ''
  const color = props.typeColor || '#6b7280'

  return (
    <div
      className="flex items-center gap-1 w-full cursor-grab overflow-hidden"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/field-name', fieldName)
        e.dataTransfer.setData('text/plain', fieldName)
      }}
      title={`${fieldName} (${type})`}
    >
      <span className="truncate font-medium">{fieldName}</span>
      {type && (
        <span
          className="shrink-0 inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          title={type}
        />
      )}
    </div>
  )
}

const gridDarkTheme = themeAlpine.withParams({
  backgroundColor: 'oklch(0.145 0 0)',
  foregroundColor: 'oklch(0.85 0 0)',
  headerBackgroundColor: 'oklch(0.17 0 0)',
  headerFontSize: 13,
  fontSize: 13,
  borderColor: 'oklch(0.3 0 0)',
  rowHoverColor: 'oklch(0.2 0 0)',
  selectedRowBackgroundColor: 'oklch(0.22 0.03 160)',
  columnBorder: true
})

const gridLightTheme = themeAlpine.withParams({
  backgroundColor: '#ffffff',
  foregroundColor: '#1a1a1a',
  headerBackgroundColor: '#f5f5f5',
  headerFontSize: 13,
  fontSize: 13,
  borderColor: '#e0e0e0',
  rowHoverColor: '#f0f0f0',
  selectedRowBackgroundColor: '#e0f2e9',
  columnBorder: true
})

type ViewMode = 'table' | 'json'

const TYPE_COLORS: Record<string, string> = {
  String: '#3b82f6',
  Number: '#f59e0b',
  Boolean: '#8b5cf6',
  Date: '#ec4899',
  ObjectId: '#6b7280',
  Array: '#10b981',
  Object: '#06b6d4',
  null: '#6b7280'
}

function inferType(values: unknown[]): string {
  for (const v of values) {
    if (v === null || v === undefined) continue
    if (typeof v === 'boolean') return 'Boolean'
    if (typeof v === 'number') return 'Number'
    if (Array.isArray(v)) return 'Array'
    if (typeof v === 'string') {
      if (/^[0-9a-f]{24}$/.test(v)) return 'ObjectId'
      if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return 'Date'
      return 'String'
    }
    if (typeof v === 'object') return 'Object'
  }
  return 'null'
}

function parseEditValue(newValue: string, oldValue: unknown): unknown {
  if (newValue === 'null') return null
  if (newValue === 'true') return true
  if (newValue === 'false') return false
  if (typeof oldValue === 'number') {
    const n = Number(newValue)
    return isNaN(n) ? newValue : n
  }
  if (newValue.startsWith('{') || newValue.startsWith('[')) {
    try { return JSON.parse(newValue) } catch { /* fall through */ }
  }
  return newValue
}

function DraggableCell(props: { value: unknown; colDef: { field?: string } }) {
  const text = props.value === null || props.value === undefined
    ? ''
    : typeof props.value === 'object'
      ? JSON.stringify(props.value)
      : String(props.value)
  const field = props.colDef?.field || ''

  return (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', text)
        e.dataTransfer.setData('text/cell-value', text)
        e.dataTransfer.setData('text/field-name', field)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      className="cursor-grab active:cursor-grabbing"
      title={`Drag to filter: ${text.slice(0, 50)}`}
    >
      {text}
    </span>
  )
}

export function DocumentTable() {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { selectDocument, setPage, setPageSize, executeQuery, setSelectedDocIds } = useTabStore()
  const themeMode = useSettingsStore((s) => s.theme)
  const effectiveTheme = themeMode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : themeMode
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [contextDoc, setContextDoc] = useState<Record<string, unknown> | null>(null)
  const [contextCell, setContextCell] = useState<{ field: string; value: unknown } | null>(null)
  const gridRef = useRef<AgGridReact>(null)

  if (!tab) return null

  const documents = tab.results?.documents ?? []
  const totalCount = tab.results?.totalCount ?? 0
  const totalPages = Math.ceil(totalCount / tab.pageSize)

  // Infer field types
  const fieldTypes: Record<string, string> = {}
  const fieldValues: Record<string, unknown[]> = {}
  for (const doc of documents) {
    for (const [key, value] of Object.entries(doc)) {
      if (!fieldValues[key]) fieldValues[key] = []
      fieldValues[key].push(value)
    }
  }
  for (const [key, values] of Object.entries(fieldValues)) {
    fieldTypes[key] = inferType(values)
  }

  const columnDefs = documents.length === 0
    ? []
    : (() => {
        const keys = new Set<string>()
        for (const doc of documents) {
          for (const key of Object.keys(doc)) keys.add(key)
        }
        return Array.from(keys).map((key) => {
          const type = fieldTypes[key] || 'String'
          const typeColor = TYPE_COLORS[type] || '#6b7280'
          return {
            field: key,
            headerName: key,
            headerTooltip: `${key} (${type})`,
            headerComponent: TypedHeader,
            headerComponentParams: { type, typeColor },
            resizable: true,
            sortable: true,
            filter: true,
            editable: key !== '_id' && !tab.isView,
            minWidth: key === '_id' ? 180 : 120,
            width: key === '_id' ? 220 : undefined,
            flex: key === '_id' ? 0 : 1,
            suppressSizeToFit: key === '_id',
            valueFormatter: (params: { value: unknown }) => {
              const val = params.value
              if (val === null || val === undefined) return ''
              if (typeof val === 'object') return JSON.stringify(val)
              return String(val)
            },
            valueSetter: (params: { data: Record<string, unknown>; newValue: string; oldValue: unknown; colDef: { field?: string } }) => {
              if (!params.colDef.field) return false
              params.data[params.colDef.field] = parseEditValue(params.newValue, params.oldValue)
              return true
            },
            cellRenderer: DraggableCell
          }
        })
      })()

  const onCellEditingStopped = async (event: CellEditingStoppedEvent) => {
    if (!tab || !event.data?._id || event.oldValue === event.newValue) return
    const field = event.colDef.field
    if (!field) return
    try {
      await trpc.mutation.updateOne.mutate({
        database: tab.database,
        collection: tab.collection,
        filter: { _id: event.data._id },
        update: { $set: { [field]: event.data[field] } }
      })
    } catch (err) {
      alert(`Failed to update: ${err instanceof Error ? err.message : err}`)
      executeQuery()
    }
  }

  const handleDeleteDocument = async (doc: Record<string, unknown>) => {
    if (!tab || !doc._id) return
    if (!confirm('Delete this document? This cannot be undone.')) return
    try {
      await trpc.mutation.deleteOne.mutate({
        database: tab.database,
        collection: tab.collection,
        filter: { _id: doc._id }
      })
      executeQuery()
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : err}`)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={executeQuery} disabled={tab.loading}>
            {tab.loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
          <span className="text-sm text-muted-foreground">
            {totalCount.toLocaleString()} documents
          </span>
          <div className="ml-2 h-4 w-px bg-border" />
          <div className="flex rounded-md border border-border">
            <button
              className={`flex items-center gap-1 px-2 py-1 text-xs ${viewMode === 'table' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setViewMode('table')}
            >
              <Table2 className="h-3.5 w-3.5" />
              Table
            </button>
            <button
              className={`flex items-center gap-1 border-l border-border px-2 py-1 text-xs ${viewMode === 'json' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setViewMode('json')}
            >
              <Braces className="h-3.5 w-3.5" />
              JSON
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-7 rounded border border-input bg-transparent px-1 text-xs"
            value={tab.pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            {[10, 25, 50, 100, 250].map((n) => (
              <option key={n} value={n}>{n} rows</option>
            ))}
          </select>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={tab.page === 0} onClick={() => setPage(0)}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={tab.page === 0} onClick={() => setPage(tab.page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">{tab.page + 1} / {Math.max(totalPages, 1)}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={tab.page >= totalPages - 1} onClick={() => setPage(tab.page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={tab.page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {/* Content */}
      <div className="flex-1">
        {viewMode === 'table' ? (
          <ContextMenu.Root>
            <ContextMenu.Trigger className="h-full w-full" asChild>
              <div className="h-full">
                <AgGridReact
                  ref={gridRef}
                  theme={effectiveTheme === 'dark' ? gridDarkTheme : gridLightTheme}
                  rowData={documents}
                  columnDefs={columnDefs}
                  onRowClicked={(e) => selectDocument(e.data)}
                  onCellEditingStopped={onCellEditingStopped}
                  onCellContextMenu={(e) => {
                    setContextDoc(e.data)
                    setContextCell(e.colDef.field ? { field: e.colDef.field, value: e.value } : null)
                  }}
                  rowSelection={{ mode: 'multiRow', enableClickSelection: false, checkboxes: true, headerCheckbox: true }}
                  onSelectionChanged={(e) => {
                    const ids = e.api.getSelectedRows().map((r: Record<string, unknown>) => r._id)
                    setSelectedDocIds(ids)
                  }}
                  singleClickEdit={false}
                  enableCellTextSelection={true}
                  suppressContextMenu
                  getRowId={(params) => params.data._id ? String(params.data._id) : String(params.rowIndex)}
                />
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="min-w-[200px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
                {/* Copy cell value */}
                {contextCell && (
                  <>
                    <ContextMenu.Item
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                      onSelect={() => {
                        const val = contextCell.value
                        const text = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
                        navigator.clipboard.writeText(text)
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy Value
                      <span className="ml-auto max-w-[100px] truncate text-[10px] text-muted-foreground">
                        {contextCell.value === null ? 'null' : typeof contextCell.value === 'object' ? '{...}' : String(contextCell.value).slice(0, 20)}
                      </span>
                    </ContextMenu.Item>
                    {contextCell.field === '_id' && contextDoc?._id && (
                      <ContextMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                        onSelect={() => navigator.clipboard.writeText(String(contextDoc!._id))}
                      >
                        <Hash className="h-3.5 w-3.5" />
                        Copy ID
                      </ContextMenu.Item>
                    )}
                    <ContextMenu.Separator className="my-1 h-px bg-border" />
                  </>
                )}
                {/* Always show Copy Document ID if doc has _id */}
                {contextDoc?._id && (!contextCell || contextCell.field !== '_id') && (
                  <>
                    <ContextMenu.Item
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                      onSelect={() => navigator.clipboard.writeText(String(contextDoc!._id))}
                    >
                      <Hash className="h-3.5 w-3.5" />
                      Copy Document ID
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="my-1 h-px bg-border" />
                  </>
                )}
                <ContextMenu.Item className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent" onSelect={() => {
                  if (contextDoc) navigator.clipboard.writeText(JSON.stringify(contextDoc, null, 2))
                }}>
                  <Braces className="h-3.5 w-3.5" /> Copy Document as JSON
                </ContextMenu.Item>
                <ContextMenu.Item className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent" onSelect={() => { if (contextDoc) selectDocument(contextDoc) }}>
                  <Braces className="h-3.5 w-3.5" /> Edit Document
                </ContextMenu.Item>
                <ContextMenu.Separator className="my-1 h-px bg-border" />
                <ContextMenu.Item className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-destructive outline-none hover:bg-destructive/10" onSelect={() => { if (contextDoc) handleDeleteDocument(contextDoc) }}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete Document
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        ) : (
          <ScrollArea className="h-full p-4">
            <div className="space-y-2">
              {documents.map((doc, i) => (
                <ContextMenu.Root key={doc._id ? String(doc._id) : i}>
                  <ContextMenu.Trigger asChild>
                    <div className="cursor-pointer rounded-md border border-border bg-card p-3 font-mono text-xs hover:border-primary/50" onClick={() => selectDocument(doc)}>
                      <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(doc, null, 2)}</pre>
                    </div>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="min-w-[160px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
                      <ContextMenu.Item className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent" onSelect={() => selectDocument(doc)}>
                        <Braces className="h-3.5 w-3.5" /> Edit Document
                      </ContextMenu.Item>
                      <ContextMenu.Separator className="my-1 h-px bg-border" />
                      <ContextMenu.Item className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-destructive outline-none hover:bg-destructive/10" onSelect={() => handleDeleteDocument(doc)}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete Document
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
