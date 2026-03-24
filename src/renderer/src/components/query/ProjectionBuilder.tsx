import { useState, useEffect, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'

type Mode = 'include' | 'exclude'

export function ProjectionBuilder() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { setProjection } = useTabStore()
  const results = activeTab?.results ?? null

  const [mode, setMode] = useState<Mode>('include')
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [includeId, setIncludeId] = useState(true)
  const [manualField, setManualField] = useState('')
  const [manualFields, setManualFields] = useState<string[]>([])

  // Detect available fields from results documents
  const detectedFields = useMemo(() => {
    if (!results?.documents?.length) return []
    const keys = new Set<string>()
    for (const doc of results.documents) {
      for (const key of Object.keys(doc)) {
        if (key !== '_id') keys.add(key)
      }
    }
    return Array.from(keys).sort()
  }, [results])

  // All fields = detected + manually added (deduplicated, excluding _id)
  const allFields = useMemo(() => {
    const set = new Set([...detectedFields, ...manualFields])
    return Array.from(set).sort()
  }, [detectedFields, manualFields])

  // Initialize from activeTab.projection when tab changes
  useEffect(() => {
    if (!activeTab) return
    const proj = activeTab.projection
    if (!proj) {
      setMode('include')
      setSelectedFields(new Set())
      setIncludeId(true)
      setManualFields([])
      return
    }

    const entries = Object.entries(proj)
    const idEntry = entries.find(([k]) => k === '_id')
    const fieldEntries = entries.filter(([k]) => k !== '_id')

    // Determine mode from field values (1 = include, 0 = exclude)
    const hasIncludes = fieldEntries.some(([, v]) => v === 1)
    const newMode: Mode = hasIncludes ? 'include' : 'exclude'
    setMode(newMode)

    const selected = new Set<string>()
    const manual: string[] = []
    for (const [key] of fieldEntries) {
      selected.add(key)
      if (!detectedFields.includes(key)) {
        manual.push(key)
      }
    }
    setSelectedFields(selected)
    setManualFields(manual)
    setIncludeId(idEntry ? idEntry[1] !== 0 : true)
  }, [activeTab?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMode = () => {
    setMode((prev) => (prev === 'include' ? 'exclude' : 'include'))
    setSelectedFields(new Set())
  }

  const toggleField = (field: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev)
      if (next.has(field)) {
        next.delete(field)
      } else {
        next.add(field)
      }
      return next
    })
  }

  const addManualField = () => {
    const trimmed = manualField.trim()
    if (!trimmed || trimmed === '_id') return
    if (!manualFields.includes(trimmed)) {
      setManualFields((prev) => [...prev, trimmed])
    }
    // Also select it
    setSelectedFields((prev) => new Set(prev).add(trimmed))
    setManualField('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addManualField()
    }
  }

  const applyProjection = () => {
    // If nothing selected and _id is included, clear projection
    if (selectedFields.size === 0 && includeId) {
      setProjection(null)
      return
    }

    const projection: Record<string, 0 | 1> = {}
    const value: 0 | 1 = mode === 'include' ? 1 : 0

    for (const field of selectedFields) {
      projection[field] = value
    }

    // _id handling: only add if explicitly excluding
    if (!includeId) {
      projection['_id'] = 0
    }

    setProjection(projection)
  }

  if (!activeTab) return null

  const modeColor = mode === 'include' ? 'green' : 'red'

  return (
    <div className="space-y-2 px-4 py-2">
      {/* Mode toggle + apply */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleMode}
          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
            mode === 'include'
              ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
              : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
          }`}
        >
          {mode === 'include' ? 'Include selected' : 'Exclude selected'}
        </button>
        <Button size="sm" className="h-6 text-xs" onClick={applyProjection}>
          Apply
        </Button>
      </div>

      {/* _id checkbox */}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={includeId}
          onChange={(e) => setIncludeId(e.target.checked)}
          className="rounded"
        />
        Include _id
      </label>

      {/* Field chips */}
      {allFields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {allFields.map((field) => {
            const isSelected = selectedFields.has(field)
            return (
              <button
                key={field}
                onClick={() => toggleField(field)}
                className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                  isSelected
                    ? modeColor === 'green'
                      ? 'border-green-500 bg-green-500/10 text-green-400'
                      : 'border-red-500 bg-red-500/10 text-red-400'
                    : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
                }`}
              >
                {field}
              </button>
            )
          })}
        </div>
      )}

      {/* Manual field input */}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={manualField}
          onChange={(e) => setManualField(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nested field path (e.g. address.city)"
          className="h-6 flex-1 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={addManualField}
          disabled={!manualField.trim()}
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>
    </div>
  )
}
