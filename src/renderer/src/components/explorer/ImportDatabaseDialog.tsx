import { useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Table2, AlertTriangle } from 'lucide-react'

interface ImportDatabaseDialogProps {
  database: string
  collections: string[]
  onSubmit: (collections: string[] | undefined, dropExisting: boolean) => void
  onCancel: () => void
}

export function ImportDatabaseDialog({
  database,
  collections,
  onSubmit,
  onCancel
}: ImportDatabaseDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(collections))
  const [dropExisting, setDropExisting] = useState(false)

  const allSelected = selected.size === collections.length
  const noneSelected = selected.size === 0

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(collections))
    }
  }

  const toggle = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelected(next)
  }

  const handleSubmit = () => {
    const cols = allSelected ? undefined : Array.from(selected)
    onSubmit(cols, dropExisting)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[460px] rounded-lg border border-border bg-card p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">Import Database</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Select collections to import into <span className="font-medium text-foreground">{database}</span>
        </p>

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
              key={col}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent"
            >
              <input
                type="checkbox"
                checked={selected.has(col)}
                onChange={() => toggle(col)}
                className="rounded"
              />
              <Table2 className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-sm">{col}</span>
            </label>
          ))}
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dropExisting}
            onChange={(e) => setDropExisting(e.target.checked)}
            className="rounded"
          />
          <span>Drop existing collections before import</span>
        </label>
        {dropExisting && (
          <p className="mt-1 ml-6 flex items-center gap-1 text-xs text-red-400">
            <AlertTriangle className="h-3 w-3" />
            Matching collections will be dropped and recreated from the dump.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={noneSelected}
            variant={dropExisting ? 'destructive' : 'default'}
          >
            Import {!noneSelected && !allSelected && `(${selected.size})`}
          </Button>
        </div>
      </div>
    </div>
  )
}
