import { useState, useCallback } from 'react'
import { ChevronRight, ChevronDown, Save, Undo2 } from 'lucide-react'
import { useTabStore } from '@renderer/store/tabStore'
import { useConnectionStore } from '@renderer/store/connectionStore'
import { trpc } from '@renderer/lib/trpc'

// --- Type detection ---

function detectType(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') {
    if (/^[0-9a-f]{24}$/.test(value)) return 'objectid'
    if (value.includes('T') && /^\d{4}-\d{2}-\d{2}T/.test(value)) return 'date'
    return 'string'
  }
  if (typeof value === 'object') return 'object'
  return 'string'
}

function typeColorClass(type: string): string {
  switch (type) {
    case 'string': return 'text-green-400'
    case 'number': return 'text-blue-400'
    case 'boolean': return 'text-red-400'
    case 'null': return 'text-gray-500'
    case 'objectid': return 'text-orange-400'
    case 'date': return 'text-purple-400'
    case 'object': return 'text-foreground'
    case 'array': return 'text-foreground'
    default: return 'text-foreground'
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return `"${value}"`
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object') return `{${Object.keys(value as object).length} fields}`
  return String(value)
}

function isExpandable(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return true
  if (typeof value === 'object') return true
  return false
}

// --- Parse edited value ---

function parseEditValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  const num = Number(trimmed)
  if (trimmed !== '' && !isNaN(num)) return num
  return raw
}

// --- Summary display for objects/arrays ---

function summaryDisplay(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object' && value !== null) return `{${Object.keys(value).length} fields}`
  return ''
}

// --- Tree Node ---

interface TreeNodeProps {
  fieldKey: string
  value: unknown
  depth: number
  path: string
  docIndex: number
  isReadOnly: boolean
  pendingEdits: Map<string, unknown>
  onEdit: (key: string, value: unknown) => void
}

function TreeNode({ fieldKey, value, depth, path, docIndex, isReadOnly, pendingEdits, onEdit }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const editKey = `${docIndex}.${path}`
  const hasPendingEdit = pendingEdits.has(editKey)
  const displayValue = hasPendingEdit ? pendingEdits.get(editKey) : value
  const expandable = isExpandable(displayValue)
  const type = detectType(displayValue)

  const handleDoubleClick = useCallback(() => {
    if (isReadOnly || expandable) return
    const raw = displayValue === null ? 'null' : typeof displayValue === 'string' ? displayValue : String(displayValue)
    setEditValue(raw)
    setEditing(true)
  }, [isReadOnly, expandable, displayValue])

  const commitEdit = useCallback(() => {
    const parsed = parseEditValue(editValue)
    onEdit(editKey, parsed)
    setEditing(false)
  }, [editValue, editKey, onEdit])

  const cancelEdit = useCallback(() => {
    setEditing(false)
  }, [])

  return (
    <div>
      <div
        className={`flex items-center min-h-[28px] hover:bg-accent/50 group ${hasPendingEdit ? 'bg-yellow-500/10' : ''}`}
        style={{ paddingLeft: depth * 16 }}
      >
        {/* Expand/collapse chevron */}
        {expandable ? (
          <button
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        {/* Field key */}
        <span className="mr-1.5 text-xs font-medium text-muted-foreground shrink-0">
          {fieldKey}
          <span className="text-muted-foreground/50">:</span>
        </span>

        {/* Value */}
        {editing ? (
          <input
            className="flex-1 min-w-0 rounded border border-border bg-background px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') cancelEdit()
            }}
            onBlur={commitEdit}
            autoFocus
          />
        ) : (
          <span
            className={`text-xs font-mono truncate ${typeColorClass(type)} ${!isReadOnly && !expandable ? 'cursor-text' : ''}`}
            onDoubleClick={handleDoubleClick}
          >
            {formatValue(displayValue)}
          </span>
        )}
      </div>

      {/* Children (only rendered when expanded) */}
      {expanded && expandable && displayValue != null && (
        <div>
          {Array.isArray(displayValue)
            ? displayValue.map((item, idx) => (
                <TreeNode
                  key={idx}
                  fieldKey={String(idx)}
                  value={item}
                  depth={depth + 1}
                  path={`${path}.${idx}`}
                  docIndex={docIndex}
                  isReadOnly={isReadOnly}
                  pendingEdits={pendingEdits}
                  onEdit={onEdit}
                />
              ))
            : Object.entries(displayValue as Record<string, unknown>).map(([key, val]) => (
                <TreeNode
                  key={key}
                  fieldKey={key}
                  value={val}
                  depth={depth + 1}
                  path={`${path}.${key}`}
                  docIndex={docIndex}
                  isReadOnly={isReadOnly}
                  pendingEdits={pendingEdits}
                  onEdit={onEdit}
                />
              ))}
        </div>
      )}
    </div>
  )
}

// --- Document Root Node ---

interface DocumentNodeProps {
  doc: Record<string, unknown>
  docIndex: number
  isReadOnly: boolean
  pendingEdits: Map<string, unknown>
  onEdit: (key: string, value: unknown) => void
}

function DocumentNode({ doc, docIndex, isReadOnly, pendingEdits, onEdit }: DocumentNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const idValue = doc._id !== undefined ? String(doc._id) : `doc-${docIndex}`
  const fieldCount = Object.keys(doc).length

  return (
    <div className="border-b border-border last:border-b-0">
      <div
        className="flex items-center min-h-[32px] hover:bg-accent/50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <button className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent ml-1">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <span className="text-xs font-mono text-orange-400 mr-2">{idValue}</span>
        <span className="text-xs text-muted-foreground">{`{${fieldCount} fields}`}</span>
      </div>

      {expanded && (
        <div>
          {Object.entries(doc).map(([key, value]) => (
            <TreeNode
              key={key}
              fieldKey={key}
              value={value}
              depth={1}
              path={key}
              docIndex={docIndex}
              isReadOnly={isReadOnly}
              pendingEdits={pendingEdits}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// --- Main TreeView ---

export function TreeView() {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { executeQuery } = useTabStore()
  const activeProfile = useConnectionStore((s) => {
    const activeId = s.activeConnection?.profileId
    return activeId ? s.profiles.find((p) => p.id === activeId) : undefined
  })

  const [pendingEdits, setPendingEdits] = useState<Map<string, unknown>>(new Map())
  const [saving, setSaving] = useState(false)

  const isReadOnly = tab?.isView || activeProfile?.isReadOnly || false

  const documents = tab?.results?.documents ?? []

  const handleEdit = useCallback((key: string, value: unknown) => {
    setPendingEdits((prev) => {
      const next = new Map(prev)
      next.set(key, value)
      return next
    })
  }, [])

  const handleDiscard = useCallback(() => {
    setPendingEdits(new Map())
  }, [])

  const handleSave = useCallback(async () => {
    if (!tab || pendingEdits.size === 0) return
    setSaving(true)

    try {
      // Group edits by document index
      const editsByDoc = new Map<number, Record<string, unknown>>()

      for (const [key, value] of pendingEdits) {
        const dotIdx = key.indexOf('.')
        const docIndex = parseInt(key.substring(0, dotIdx), 10)
        const fieldPath = key.substring(dotIdx + 1)

        if (!editsByDoc.has(docIndex)) editsByDoc.set(docIndex, {})
        editsByDoc.get(docIndex)![fieldPath] = value
      }

      // Apply each document's edits
      for (const [docIndex, fields] of editsByDoc) {
        const doc = documents[docIndex]
        if (!doc?._id) continue

        await trpc.mutation.updateOne.mutate({
          database: tab.database,
          collection: tab.collection,
          filter: { _id: doc._id },
          update: { $set: fields }
        })
      }

      setPendingEdits(new Map())
      executeQuery()
    } catch (err) {
      alert(`Failed to save: ${err instanceof Error ? err.message : err}`)
    } finally {
      setSaving(false)
    }
  }, [tab, pendingEdits, documents, executeQuery])

  if (!tab) return null

  if (documents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No documents to display
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Save/Discard bar */}
      {pendingEdits.size > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-yellow-500/5 px-4 py-1.5">
          <span className="text-xs text-yellow-400">
            {pendingEdits.size} pending edit{pendingEdits.size !== 1 ? 's' : ''}
          </span>
          <div className="flex-1" />
          <button
            className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            onClick={handleDiscard}
            disabled={saving}
          >
            <Undo2 className="h-3 w-3" />
            Discard
          </button>
          <button
            className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            <Save className="h-3 w-3" />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {/* Tree content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {documents.map((doc, index) => (
          <DocumentNode
            key={doc._id ? String(doc._id) : index}
            doc={doc}
            docIndex={index}
            isReadOnly={isReadOnly}
            pendingEdits={pendingEdits}
            onEdit={handleEdit}
          />
        ))}
      </div>
    </div>
  )
}
