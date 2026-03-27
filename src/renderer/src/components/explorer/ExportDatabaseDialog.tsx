import { useState, useEffect } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Table2, Eye, Loader2 } from 'lucide-react'
import { trpc } from '@renderer/lib/trpc'

interface ExportDatabaseDialogProps {
  connectionId: string
  database: string
  onSubmit: (collections?: string[]) => void
  onCancel: () => void
}

export function ExportDatabaseDialog({
  connectionId,
  database,
  onSubmit,
  onCancel
}: ExportDatabaseDialogProps) {
  const [collections, setCollections] = useState<{ name: string; type: string }[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    trpc.exportImport.listCollections.query({ connectionId, database }).then((cols) => {
      setCollections(cols)
      setSelected(new Set(cols.map((c) => c.name)))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [connectionId, database])

  const allSelected = selected.size === collections.length
  const noneSelected = selected.size === 0

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(collections.map((c) => c.name)))
    }
  }

  const toggle = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelected(next)
  }

  const handleSubmit = () => {
    if (allSelected) {
      onSubmit(undefined) // all collections — let backend handle it
    } else {
      onSubmit(Array.from(selected))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[460px] rounded-lg border border-border bg-card p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">Export Database</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Select collections to export from <span className="font-medium text-foreground">{database}</span>
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = !allSelected && !noneSelected }}
                  onChange={toggleAll}
                  className="rounded"
                />
                <span className="text-muted-foreground">Select all</span>
              </label>
              <span className="text-xs text-muted-foreground">
                {selected.size} of {collections.length} selected
              </span>
            </div>
            <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-border bg-muted/30 p-2">
              {collections.map((col) => (
                <label
                  key={col.name}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(col.name)}
                    onChange={() => toggle(col.name)}
                    className="rounded"
                  />
                  {col.type === 'view' ? (
                    <Eye className="h-3.5 w-3.5 text-purple-400" />
                  ) : (
                    <Table2 className="h-3.5 w-3.5 text-blue-400" />
                  )}
                  <span className="text-sm">{col.name}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={noneSelected || loading}>
            {noneSelected ? 'Export' : allSelected ? `Export All (${collections.length})` : `Export ${selected.size} Collection${selected.size !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
