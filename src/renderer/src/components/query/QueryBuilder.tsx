import { useState, useMemo } from 'react'
import {
  Plus,
  X,
  Code,
  GripVertical,
  Eraser,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { SortBuilder } from './SortBuilder'
import { ProjectionBuilder } from './ProjectionBuilder'
import { QueryFooter } from './QueryFooter'

// --- Types ---

interface FilterRow {
  id: string
  field: string
  operator: string
  value: string
  type: FieldType
}

type FieldType = 'String' | 'Number' | 'Boolean' | 'Date' | 'ObjectId' | 'Auto'
type MatchMode = '$and' | '$or'

// --- Operators per type ---

const STRING_OPERATORS = [
  { label: 'equals', value: 'eq' },
  { label: 'not equals', value: 'ne' },
  { label: 'contains', value: 'contains' },
  { label: 'not contains', value: 'not_contains' },
  { label: 'starts with', value: 'starts_with' },
  { label: 'ends with', value: 'ends_with' },
  { label: 'matches regex', value: 'regex' },
  { label: 'in', value: 'in' },
  { label: 'not in', value: 'nin' },
  { label: 'exists', value: 'exists' },
  { label: 'not exists', value: 'not_exists' }
]

const NUMBER_OPERATORS = [
  { label: 'equals', value: 'eq' },
  { label: 'not equals', value: 'ne' },
  { label: 'greater than', value: 'gt' },
  { label: 'greater or equal', value: 'gte' },
  { label: 'less than', value: 'lt' },
  { label: 'less or equal', value: 'lte' },
  { label: 'in', value: 'in' },
  { label: 'exists', value: 'exists' },
  { label: 'not exists', value: 'not_exists' }
]

const BOOLEAN_OPERATORS = [
  { label: 'equals', value: 'eq' },
  { label: 'exists', value: 'exists' },
  { label: 'not exists', value: 'not_exists' }
]

const DATE_OPERATORS = [
  { label: 'equals', value: 'eq' },
  { label: 'before', value: 'lt' },
  { label: 'after', value: 'gt' },
  { label: 'on or before', value: 'lte' },
  { label: 'on or after', value: 'gte' },
  { label: 'exists', value: 'exists' },
  { label: 'not exists', value: 'not_exists' }
]

function getOperators(type: FieldType) {
  switch (type) {
    case 'Number':
      return NUMBER_OPERATORS
    case 'Boolean':
      return BOOLEAN_OPERATORS
    case 'Date':
      return DATE_OPERATORS
    default:
      return STRING_OPERATORS
  }
}

// --- Value parsing ---

function parseValue(value: string, type: FieldType): unknown {
  const trimmed = value.trim()
  if (type === 'Number') return Number(trimmed) || 0
  if (type === 'Boolean') return trimmed === 'true'
  if (type === 'Date') return trimmed // Will be wrapped in $date if needed
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      /* fall through */
    }
  }
  return trimmed
}

function buildRowFilter(row: FilterRow): Record<string, unknown> | null {
  if (!row.field.trim()) return null
  const val = parseValue(row.value, row.type)

  switch (row.operator) {
    case 'eq':
      return { [row.field]: val }
    case 'ne':
      return { [row.field]: { $ne: val } }
    case 'gt':
      return { [row.field]: { $gt: val } }
    case 'gte':
      return { [row.field]: { $gte: val } }
    case 'lt':
      return { [row.field]: { $lt: val } }
    case 'lte':
      return { [row.field]: { $lte: val } }
    case 'contains':
      return { [row.field]: { $regex: String(val), $options: 'i' } }
    case 'not_contains':
      return { [row.field]: { $not: { $regex: String(val), $options: 'i' } } }
    case 'starts_with':
      return { [row.field]: { $regex: `^${String(val)}`, $options: 'i' } }
    case 'ends_with':
      return { [row.field]: { $regex: `${String(val)}$`, $options: 'i' } }
    case 'regex':
      return { [row.field]: { $regex: String(val) } }
    case 'in':
      return { [row.field]: { $in: Array.isArray(val) ? val : String(val).split(',').map((s) => s.trim()) } }
    case 'nin':
      return { [row.field]: { $nin: Array.isArray(val) ? val : String(val).split(',').map((s) => s.trim()) } }
    case 'exists':
      return { [row.field]: { $exists: true } }
    case 'not_exists':
      return { [row.field]: { $exists: false } }
    default:
      return { [row.field]: val }
  }
}

function buildFilter(rows: FilterRow[], matchMode: MatchMode): Record<string, unknown> {
  const conditions = rows
    .map(buildRowFilter)
    .filter((c): c is Record<string, unknown> => c !== null)

  if (conditions.length === 0) return {}
  if (conditions.length === 1) return conditions[0]
  return { [matchMode]: conditions }
}

// --- Infer field types from current results ---

function inferFieldType(values: unknown[]): FieldType {
  for (const v of values) {
    if (v === null || v === undefined) continue
    if (typeof v === 'number') return 'Number'
    if (typeof v === 'boolean') return 'Boolean'
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) return 'Date'
      if (/^[0-9a-f]{24}$/.test(v)) return 'ObjectId'
    }
  }
  return 'String'
}

// --- Component ---

export function QueryBuilder() {
  const [rows, setRows] = useState<FilterRow[]>([])
  const [matchMode, setMatchMode] = useState<MatchMode>('$and')
  const [rawMode, setRawMode] = useState(false)
  const [rawJson, setRawJson] = useState('{}')
  const [expanded, setExpanded] = useState(true)
  const [sortExpanded, setSortExpanded] = useState(false)
  const [projExpanded, setProjExpanded] = useState(false)
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { setFilter, setPage, executeQuery } = useTabStore()
  const loading = tab?.loading ?? false

  // Collect available fields from current result set
  const availableFields = useMemo(() => {
    if (!tab?.results?.documents.length) return []
    const results = tab.results
    const fieldMap: Record<string, unknown[]> = {}
    for (const doc of results.documents) {
      for (const [key, value] of Object.entries(doc)) {
        if (!fieldMap[key]) fieldMap[key] = []
        fieldMap[key].push(value)
      }
    }
    return Object.entries(fieldMap).map(([name, values]) => ({
      name,
      type: inferFieldType(values)
    }))
  }, [tab?.results])

  const addRow = (field?: string, type?: FieldType) => {
    const t = type || 'Auto'
    const ops = getOperators(t)
    setRows([
      ...rows,
      {
        id: crypto.randomUUID(),
        field: field || '',
        operator: ops[0].value,
        type: t,
        value: ''
      }
    ])
  }

  const removeRow = (id: string) => {
    setRows(rows.filter((r) => r.id !== id))
  }

  const updateRow = (id: string, updates: Partial<FilterRow>) => {
    setRows(
      rows.map((r) => {
        if (r.id !== id) return r
        const updated = { ...r, ...updates }
        // If field changed, re-infer type
        if (updates.field && !updates.type) {
          const fieldInfo = availableFields.find((f) => f.name === updates.field)
          if (fieldInfo) {
            updated.type = fieldInfo.type
            const ops = getOperators(fieldInfo.type)
            if (!ops.find((o) => o.value === updated.operator)) {
              updated.operator = ops[0].value
            }
          }
        }
        // If type changed, reset operator if incompatible
        if (updates.type) {
          const ops = getOperators(updates.type)
          if (!ops.find((o) => o.value === updated.operator)) {
            updated.operator = ops[0].value
          }
        }
        return updated
      })
    )
  }

  const handleRun = () => {
    if (!tab) return
    let filter: Record<string, unknown>
    if (rawMode) {
      try {
        filter = JSON.parse(rawJson)
      } catch {
        alert('Invalid JSON filter')
        return
      }
    } else {
      filter = buildFilter(rows, matchMode)
    }
    setFilter(filter)
    setPage(0)
    executeQuery()
  }

  const handleClear = () => {
    setRows([])
    setRawJson('{}')
    if (tab) {
      setFilter({})
      setPage(0)
    }
  }

  const toggleMode = () => {
    if (!rawMode) {
      setRawJson(JSON.stringify(buildFilter(rows, matchMode), null, 2))
    }
    setRawMode(!rawMode)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const field = e.dataTransfer.getData('text/field-name')
    if (field) {
      const fieldInfo = availableFields.find((f) => f.name === field)
      addRow(field, fieldInfo?.type)
    }
  }

  if (!tab) return null

  // Compute summary texts for accordion headers
  const sortSummary = tab?.sort
    ? Object.entries(tab.sort)
        .map(([k, v]) => `${k} ${v === 1 ? 'ASC' : 'DESC'}`)
        .join(', ')
    : 'None'

  const projSummary = tab?.projection
    ? `${Object.keys(tab.projection).length} fields`
    : 'All fields'

  return (
    <div className="border-b border-border bg-card">
      {/* FILTER section header */}
      <div className="flex w-full items-center justify-between px-4 py-1.5">
        <button
          className="flex items-center gap-1.5 text-xs font-medium"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span className="text-green-400">Filter</span>
          {rows.length > 0 && (
            <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
              {rows.length}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleClear}>
            <Eraser className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={toggleMode}>
            <Code className="mr-1 h-3.5 w-3.5" />
            {rawMode ? 'Visual' : 'JSON'}
          </Button>
        </div>
      </div>

      {/* FILTER section body */}
      {expanded && (
        <div className="px-4 pb-3">
          {rawMode ? (
            <textarea
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              rows={4}
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              placeholder='{ "field": "value" }'
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) handleRun()
              }}
            />
          ) : (
            <div className="space-y-2">
              {/* Available fields — draggable chips, double-click to add */}
              {availableFields.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-[10px] text-muted-foreground">Fields:</span>
                  {availableFields.map((f) => (
                    <button
                      key={f.name}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/field-name', f.name)
                        e.dataTransfer.setData('text/plain', f.name)
                      }}
                      onDoubleClick={() => addRow(f.name, f.type)}
                      className="cursor-grab rounded border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] text-foreground hover:border-primary/50 hover:bg-secondary active:cursor-grabbing"
                      title={`${f.type} — drag to filter or double-click`}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Match mode */}
              <div className="flex items-center gap-2">
                <select
                  className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  value={matchMode}
                  onChange={(e) => setMatchMode(e.target.value as MatchMode)}
                >
                  <option value="$and">Match all ($and)</option>
                  <option value="$or">Match any ($or)</option>
                </select>
                <span className="text-[10px] text-muted-foreground">Where</span>
              </div>

              {/* Filter rows */}
              {rows.map((row) => {
                const operators = getOperators(row.type)
                const isExistsOp = row.operator === 'exists' || row.operator === 'not_exists'

                return (
                  <div key={row.id} className="flex items-center gap-1.5">
                    <GripVertical className="h-3.5 w-3.5 cursor-grab text-muted-foreground" />

                    {/* Field dropdown */}
                    <select
                      className="h-7 w-[130px] rounded border border-input bg-transparent px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      value={row.field}
                      onChange={(e) => updateRow(row.id, { field: e.target.value })}
                    >
                      <option value="">-- field --</option>
                      {availableFields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                    </select>

                    {/* Operator dropdown */}
                    <select
                      className="h-7 w-[130px] rounded border border-input bg-transparent px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      value={row.operator}
                      onChange={(e) => updateRow(row.id, { operator: e.target.value })}
                    >
                      {operators.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>

                    {/* Type badge */}
                    <select
                      className="h-7 w-[80px] rounded border border-input bg-transparent px-1 text-[10px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      value={row.type}
                      onChange={(e) => updateRow(row.id, { type: e.target.value as FieldType })}
                    >
                      <option value="Auto">Auto</option>
                      <option value="String">String</option>
                      <option value="Number">Number</option>
                      <option value="Boolean">Boolean</option>
                      <option value="Date">Date</option>
                      <option value="ObjectId">ObjectId</option>
                    </select>

                    {/* Value input */}
                    {!isExistsOp && (
                      <input
                        className="h-7 flex-1 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder={
                          row.operator === 'in' || row.operator === 'nin'
                            ? 'val1, val2, val3'
                            : 'value'
                        }
                        value={row.value}
                        onChange={(e) => updateRow(row.id, { value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRun()
                        }}
                      />
                    )}

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => removeRow(row.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )
              })}

              {/* Drop zone / add row */}
              <div
                className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
                onDragOver={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.add('border-primary', 'bg-primary/5')
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('border-primary', 'bg-primary/5')
                }}
                onDrop={(e) => {
                  e.currentTarget.classList.remove('border-primary', 'bg-primary/5')
                  handleDrop(e)
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                <button className="hover:text-foreground" onClick={() => addRow()}>
                  Drag and drop field here or click to add
                </button>
                {rows.length > 0 && (
                  <>
                    <span className="text-border">|</span>
                    <button
                      className="text-primary hover:underline"
                      onClick={() => addRow()}
                    >
                      Add {matchMode === '$and' ? 'AND' : 'OR'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SORT section header */}
      <button
        className="flex w-full items-center justify-between border-t border-border px-4 py-1.5"
        onClick={() => setSortExpanded(!sortExpanded)}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium">
          {sortExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span className="text-blue-400">Sort</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{sortSummary}</span>
      </button>

      {/* SORT section body */}
      {sortExpanded && (
        <div className="px-4 pb-3">
          <SortBuilder />
        </div>
      )}

      {/* PROJECTION section header */}
      <button
        className="flex w-full items-center justify-between border-t border-border px-4 py-1.5"
        onClick={() => setProjExpanded(!projExpanded)}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium">
          {projExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span className="text-purple-400">Projection</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{projSummary}</span>
      </button>

      {/* PROJECTION section body */}
      {projExpanded && <ProjectionBuilder />}

      {/* FOOTER — always visible */}
      <QueryFooter onRun={handleRun} onToggleHistory={() => {}} loading={loading} />
    </div>
  )
}
