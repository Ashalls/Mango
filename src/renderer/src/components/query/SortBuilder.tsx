import { useState, useEffect, useMemo } from 'react'
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
  const { setSort } = useTabStore()
  const results = activeTab?.results

  const [fields, setFields] = useState<SortField[]>([])

  // Sync local state from activeTab?.sort when tabs change
  useEffect(() => {
    if (activeTab?.sort) {
      const restored: SortField[] = Object.entries(activeTab.sort).map(([field, direction]) => ({
        id: crypto.randomUUID(),
        field,
        direction: direction === -1 ? -1 : 1
      }))
      setFields(restored)
    } else {
      setFields([])
    }
  }, [activeTab?.id])

  // Infer available fields from results.documents
  const availableFields = useMemo(() => {
    if (!results?.documents?.length) return []
    const keys = new Set<string>()
    for (const doc of results.documents) {
      for (const key of Object.keys(doc)) {
        keys.add(key)
      }
    }
    return Array.from(keys).sort()
  }, [results])

  const applySort = (updatedFields: SortField[]) => {
    setFields(updatedFields)
    const nonEmpty = updatedFields.filter((f) => f.field.trim() !== '')
    if (nonEmpty.length === 0) {
      setSort(null)
      return
    }
    const sortObj: Record<string, number> = {}
    for (const f of nonEmpty) {
      sortObj[f.field] = f.direction
    }
    setSort(sortObj)
  }

  const addField = () => {
    applySort([...fields, { id: crypto.randomUUID(), field: '', direction: 1 }])
  }

  const removeField = (id: string) => {
    applySort(fields.filter((f) => f.id !== id))
  }

  const updateField = (id: string, updates: Partial<SortField>) => {
    applySort(fields.map((f) => (f.id === id ? { ...f, ...updates } : f)))
  }

  const moveField = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= fields.length) return
    const updated = [...fields]
    const temp = updated[index]
    updated[index] = updated[targetIndex]
    updated[targetIndex] = temp
    applySort(updated)
  }

  const datalistId = `sort-fields-${activeTab?.id ?? 'none'}`

  return (
    <div className="space-y-1.5">
      <datalist id={datalistId}>
        {availableFields.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      {fields.map((field, index) => (
        <div key={field.id} className="flex items-center gap-1">
          {/* Up/Down reorder buttons */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === 0}
            onClick={() => moveField(index, 'up')}
            title="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === fields.length - 1}
            onClick={() => moveField(index, 'down')}
            title="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>

          {/* Field name input with datalist suggestions */}
          <input
            className="h-7 flex-1 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="field name"
            value={field.field}
            list={datalistId}
            onChange={(e) => updateField(field.id, { field: e.target.value })}
          />

          {/* ASC/DESC toggle */}
          <Button
            variant="outline"
            size="sm"
            className={`h-7 w-16 text-xs font-medium ${
              field.direction === 1
                ? 'border-green-600 text-green-500 hover:bg-green-950/30 hover:text-green-400'
                : 'border-red-600 text-red-500 hover:bg-red-950/30 hover:text-red-400'
            }`}
            onClick={() => updateField(field.id, { direction: field.direction === 1 ? -1 : 1 })}
          >
            {field.direction === 1 ? 'ASC' : 'DESC'}
          </Button>

          {/* Remove button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => removeField(field.id)}
            title="Remove sort field"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {/* Add sort field button */}
      <button
        className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
        onClick={addField}
      >
        <Plus className="h-3.5 w-3.5" />
        Add sort field
      </button>
    </div>
  )
}
