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
  Hash,
  Plus,
  Check,
  X
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
  const effectiveTheme = useSettingsStore((s) => s.effectiveTheme)
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [contextDoc, setContextDoc] = useState<Record<string, unknown> | null>(null)
  const [contextCell, setContextCell] = useState<{ field: string; value: unknown } | null>(null)
  const [editingPage, setEditingPage] = useState(false)
  const [pageInput, setPageInput] = useState('')
  const pageInputRef = useRef<HTMLInputElement>(null)
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
            editable: (params: { data?: Record<string, unknown> }) => {
              // Add row: all fields except _id are editable
              if (params.data?.__isAddRow) return key !== '_id'
              // Normal rows: editable except _id and views
              return key !== '_id' && !tab.isView
            },
            minWidth: key === '_id' ? 200 : 120,
            width: key === '_id' ? 240 : undefined,
            flex: key === '_id' ? 0 : 1,
            suppressSizeToFit: key === '_id',
            valueFormatter: (params: { value: unknown; data?: Record<string, unknown> }) => {
              // Show "auto" for _id in add row
              if (params.data?.__isAddRow && key === '_id') return '(auto)'
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
            cellRenderer: (props: { value: unknown; data?: Record<string, unknown>; colDef: { field?: string } }) => {
              // Add row _id: show insert/cancel controls
              if (props.data?.__isAddRow && props.colDef?.field === '_id') {
                return (
                  <span className="flex items-center gap-1">
                    <button
                      className="rounded px-1.5 py-0.5 text-[11px] text-emerald-400 hover:bg-emerald-500/20"
                      onClick={(e) => { e.stopPropagation(); handleAddRowSubmit() }}
                    >
                      <Check className="inline h-3 w-3 mr-0.5" />Insert
                    </button>
                    <button
                      className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                      onClick={(e) => { e.stopPropagation(); setAddRowOpen(false); setAddRowValues({}) }}
                    >
                      <X className="inline h-3 w-3 mr-0.5" />Cancel
                    </button>
                  </span>
                )
              }
              // Add row other fields: show placeholder when empty
              if (props.data?.__isAddRow) {
                const val = props.value
                if (val === null || val === undefined || val === '') {
                  const fieldType = fieldTypes[props.colDef?.field || ''] || ''
                  return <span className="text-muted-foreground/40 italic text-xs">click to edit{fieldType ? ` (${fieldType})` : ''}</span>
                }
              }
              return <DraggableCell value={props.value} colDef={props.colDef as { field?: string }} />
            }
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

  // Inline add row (pinned bottom row in AG Grid)
  const [addRowOpen, setAddRowOpen] = useState(false)
  const [addRowValues, setAddRowValues] = useState<Record<string, string>>({})
  const [addRowSaving, setAddRowSaving] = useState(false)

  const rowData = addRowOpen
    ? [...documents, { _id: '__new__', __isAddRow: true, ...addRowValues }]
    : documents

  const handleAddRowSubmit = async () => {
    if (!tab || addRowSaving) return
    const allFields = Object.keys(addRowValues).filter((k) => k !== '_id' && k !== '__isAddRow')
    setAddRowSaving(true)
    try {
      const doc: Record<string, unknown> = {}
      for (const key of allFields) {
        const raw = addRowValues[key]
        if (raw === undefined || raw === '') continue
        const type = fieldTypes[key] || 'String'
        doc[key] = parseEditValue(raw, type === 'Number' ? 0 : type === 'Boolean' ? true : '')
      }
      if (Object.keys(doc).length === 0) {
        setAddRowOpen(false)
        return
      }
      await trpc.mutation.insertOne.mutate({
        database: tab.database,
        collection: tab.collection,
        document: doc
      })
      setAddRowOpen(false)
      setAddRowValues({})
      executeQuery()
    } catch (err) {
      alert(`Failed to insert: ${err instanceof Error ? err.message : err}`)
    } finally {
      setAddRowSaving(false)
    }
  }

  const onPinnedCellEditingStopped = (event: CellEditingStoppedEvent) => {
    if (!event.data?.__isAddRow) return
    const field = event.colDef.field
    if (!field || field === '_id') return
    setAddRowValues((prev) => ({ ...prev, [field]: event.newValue ?? '' }))
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
          {editingPage ? (
            <input
              ref={pageInputRef}
              type="number"
              className="h-6 w-16 rounded border border-input bg-transparent px-1.5 text-center text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={pageInput}
              min={1}
              max={Math.max(totalPages, 1)}
              autoFocus
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = parseInt(pageInput, 10)
                  if (!isNaN(val) && val >= 1 && val <= Math.max(totalPages, 1)) {
                    setPage(val - 1)
                  }
                  setEditingPage(false)
                } else if (e.key === 'Escape') {
                  setEditingPage(false)
                }
              }}
              onBlur={() => {
                const val = parseInt(pageInput, 10)
                if (!isNaN(val) && val >= 1 && val <= Math.max(totalPages, 1)) {
                  setPage(val - 1)
                }
                setEditingPage(false)
              }}
            />
          ) : (
            <button
              className="cursor-pointer rounded px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                setPageInput(String(tab.page + 1))
                setEditingPage(true)
              }}
              title="Click to go to a specific page"
            >
              {tab.page + 1} / {Math.max(totalPages, 1)}
            </button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={tab.page >= totalPages - 1} onClick={() => setPage(tab.page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={tab.page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {viewMode === 'table' ? (
          <ContextMenu.Root>
            <ContextMenu.Trigger className="h-full w-full" asChild>
              <div className="h-full">
                <AgGridReact
                  ref={gridRef}
                  theme={effectiveTheme === 'dark' ? gridDarkTheme : gridLightTheme}
                  rowData={rowData}
                  columnDefs={columnDefs}
                  onRowClicked={(e) => {
                    if (e.data?.__isAddRow) return
                    selectDocument(e.data)
                  }}
                  onCellEditingStopped={(e) => {
                    if (e.data?.__isAddRow) {
                      const field = e.colDef.field
                      if (field && field !== '_id') {
                        setAddRowValues((prev) => ({ ...prev, [field]: e.newValue ?? '' }))
                      }
                    } else {
                      onCellEditingStopped(e)
                    }
                  }}
                  onCellContextMenu={(e) => {
                    if (e.data?.__isAddRow) return
                    setContextDoc(e.data)
                    setContextCell(e.colDef.field ? { field: e.colDef.field, value: e.value } : null)
                  }}
                  rowSelection={{ mode: 'multiRow', enableClickSelection: false, checkboxes: true, headerCheckbox: true }}
                  onSelectionChanged={(e) => {
                    const ids = e.api.getSelectedRows()
                      .filter((r: Record<string, unknown>) => !r.__isAddRow)
                      .map((r: Record<string, unknown>) => r._id)
                    setSelectedDocIds(ids)
                  }}
                  singleClickEdit={false}
                  enableCellTextSelection={true}
                  suppressContextMenu
                  getRowId={(params) => params.data._id ? String(params.data._id) : String(params.rowIndex)}
                  getRowStyle={(params) => {
                    if (params.data?.__isAddRow) {
                      return { fontStyle: 'italic', background: 'rgba(16, 185, 129, 0.05)' }
                    }
                    return undefined
                  }}
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

      {/* Add document button */}
      {!tab.isView && !addRowOpen && (
        <div className="border-t border-border">
          <button
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            onClick={() => setAddRowOpen(true)}
          >
            <Plus className="h-3 w-3" />
            Add document...
          </button>
        </div>
      )}
    </div>
  )
}
