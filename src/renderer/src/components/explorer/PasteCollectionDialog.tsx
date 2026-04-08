import { useState, useEffect, useRef } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { AlertTriangle, Database, Table2 } from 'lucide-react'

export interface PasteCollectionResult {
  targetCollection: string
  dropTarget: boolean
}

interface PasteCollectionDialogProps {
  sourceCollection: string
  sourceDatabase: string
  sourceConnection: string
  targetDatabase: string
  targetConnection: string
  existingCollections: string[]
  isSameLocation: boolean
  onSubmit: (result: PasteCollectionResult) => void
  onCancel: () => void
}

type PasteMode = 'new' | 'overwrite'

export function PasteCollectionDialog({
  sourceCollection,
  sourceDatabase,
  sourceConnection,
  targetDatabase,
  targetConnection,
  existingCollections,
  isSameLocation,
  onSubmit,
  onCancel
}: PasteCollectionDialogProps) {
  const defaultName = isSameLocation ? `${sourceCollection}_copy` : sourceCollection
  const existsAlready = existingCollections.includes(sourceCollection)
  const [mode, setMode] = useState<PasteMode>(
    existsAlready && !isSameLocation ? 'overwrite' : 'new'
  )
  const [newColName, setNewColName] = useState(defaultName)
  const safeInitialSelected = isSameLocation
    ? existingCollections.find((c) => c !== sourceCollection) ?? ''
    : existsAlready
      ? sourceCollection
      : existingCollections[0] || ''
  const [selectedCol, setSelectedCol] = useState(safeInitialSelected)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode === 'new') nameRef.current?.focus()
  }, [mode])

  const nameConflicts = mode === 'new' && existingCollections.includes(newColName.trim())

  // When same-location, the only candidate for overwrite would be the source collection itself.
  // Overwriting yourself is nonsensical — disable overwrite mode in that case unless there are
  // other collections in the target DB to pick.
  const overwriteDisabled =
    existingCollections.length === 0 ||
    (isSameLocation && existingCollections.length === 1 && existingCollections[0] === sourceCollection)

  const canSubmit =
    mode === 'overwrite'
      ? selectedCol !== '' && !(isSameLocation && selectedCol === sourceCollection)
      : newColName.trim() !== '' && !nameConflicts

  const handleSubmit = () => {
    if (!canSubmit) return
    if (mode === 'overwrite') {
      onSubmit({ targetCollection: selectedCol, dropTarget: true })
    } else {
      onSubmit({ targetCollection: newColName.trim(), dropTarget: false })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[460px] rounded-lg border border-border bg-card p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">Paste Collection</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {sourceDatabase}.{sourceCollection}
          </span>
          {isSameLocation ? (
            <> (same location)</>
          ) : (
            <>
              {' '}
              from <span className="font-medium text-foreground">{sourceConnection}</span> →{' '}
              <span className="font-medium text-foreground">{targetConnection}</span>
            </>
          )}
        </p>

        {/* Target database chip (read-only, determined by right-click target) */}
        <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <Database className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs text-muted-foreground">Target database:</span>
          <span className="font-medium">{targetDatabase}</span>
        </div>

        {/* Mode selection */}
        <div className="space-y-2">
          {/* Create new collection */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
              mode === 'new'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/30'
            }`}
            onClick={() => setMode('new')}
          >
            <input
              type="radio"
              name="pasteColMode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Create new collection</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Creates a fresh collection with all documents and indexes copied over.
              </p>
              {mode === 'new' && (
                <div className="mt-2">
                  <Input
                    ref={nameRef}
                    placeholder="Collection name"
                    value={newColName}
                    onChange={(e) => setNewColName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSubmit()
                      if (e.key === 'Escape') onCancel()
                    }}
                    className="h-8 text-sm"
                  />
                  {nameConflicts && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      A collection with this name already exists in the target database. Choose a
                      different name or use overwrite mode.
                    </p>
                  )}
                </div>
              )}
            </div>
          </label>

          {/* Overwrite existing collection */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
              overwriteDisabled
                ? 'border-border opacity-50 cursor-not-allowed'
                : mode === 'overwrite'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30'
            }`}
            onClick={() => {
              if (!overwriteDisabled) setMode('overwrite')
            }}
          >
            <input
              type="radio"
              name="pasteColMode"
              checked={mode === 'overwrite'}
              onChange={() => setMode('overwrite')}
              disabled={overwriteDisabled}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Overwrite existing collection</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Drops the target collection before copying.
              </p>
              {mode === 'overwrite' && !overwriteDisabled && (
                <div className="mt-2">
                  <select
                    value={selectedCol}
                    onChange={(e) => setSelectedCol(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {existingCollections.map((col) => {
                      const disabled = isSameLocation && col === sourceCollection
                      return (
                        <option key={col} value={col} disabled={disabled}>
                          {col}
                          {disabled ? ' (source — cannot overwrite)' : ''}
                        </option>
                      )
                    })}
                  </select>
                  <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    This will drop and replace the selected collection.
                  </p>
                </div>
              )}
              {overwriteDisabled && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {existingCollections.length === 0
                    ? 'No existing collections in the target database.'
                    : 'No other collections available to overwrite.'}
                </p>
              )}
            </div>
          </label>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Table2 className="h-3 w-3 text-blue-400" />
            {sourceCollection}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              variant={mode === 'overwrite' ? 'destructive' : 'default'}
            >
              {mode === 'overwrite' ? 'Overwrite & Paste' : 'Paste Collection'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
