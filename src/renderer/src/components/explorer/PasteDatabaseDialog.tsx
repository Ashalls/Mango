import { useState, useEffect, useRef } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { AlertTriangle, Table2 } from 'lucide-react'

export interface PasteDatabaseResult {
  targetDatabase: string
  dropTarget: boolean
  collections?: string[]
}

interface PasteDatabaseDialogProps {
  sourceName: string
  sourceConnection: string
  targetConnection: string
  existingDatabases: string[]
  isSameConnection: boolean
  /** Optional list of collections (selectable for import, read-only preview for paste) */
  previewCollections?: string[]
  /** Label variant: 'paste' (default) or 'import' */
  variant?: 'paste' | 'import'
  onSubmit: (result: PasteDatabaseResult) => void
  onCancel: () => void
}

type PasteMode = 'new' | 'overwrite'

export function PasteDatabaseDialog({
  sourceName,
  sourceConnection,
  targetConnection,
  existingDatabases,
  isSameConnection,
  previewCollections,
  variant = 'paste',
  onSubmit,
  onCancel
}: PasteDatabaseDialogProps) {
  const isImport = variant === 'import'
  const defaultName = isSameConnection ? `${sourceName}_copy` : sourceName
  const existsAlready = existingDatabases.includes(sourceName)
  const [mode, setMode] = useState<PasteMode>(existsAlready ? 'overwrite' : 'new')
  const [newDbName, setNewDbName] = useState(defaultName)
  const [selectedDb, setSelectedDb] = useState(existsAlready ? sourceName : (existingDatabases[0] || ''))
  const nameRef = useRef<HTMLInputElement>(null)

  // Collection selection state (only used for import variant)
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set(previewCollections || []))
  const allColsSelected = previewCollections ? selectedCols.size === previewCollections.length : true
  const noColsSelected = previewCollections ? selectedCols.size === 0 : false

  const toggleCol = (name: string) => {
    const next = new Set(selectedCols)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelectedCols(next)
  }

  const toggleAllCols = () => {
    if (allColsSelected) {
      setSelectedCols(new Set())
    } else {
      setSelectedCols(new Set(previewCollections || []))
    }
  }

  useEffect(() => {
    if (mode === 'new') nameRef.current?.focus()
  }, [mode])

  const nameConflicts = mode === 'new' && existingDatabases.includes(newDbName.trim())

  const canSubmit =
    (mode === 'overwrite' ? selectedDb !== '' : newDbName.trim() !== '' && !nameConflicts)
    && (!isImport || !noColsSelected)

  const handleSubmit = () => {
    if (!canSubmit) return
    const cols = isImport && previewCollections && !allColsSelected ? Array.from(selectedCols) : undefined
    if (mode === 'overwrite') {
      onSubmit({ targetDatabase: selectedDb, dropTarget: true, collections: cols })
    } else {
      onSubmit({ targetDatabase: newDbName.trim(), dropTarget: false, collections: cols })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[460px] rounded-lg border border-border bg-card p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">{isImport ? 'Import Database' : 'Paste Database'}</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{sourceName}</span>
          {isSameConnection ? (
            <> (same connection)</>
          ) : (
            <> from <span className="font-medium text-foreground">{sourceConnection}</span> → <span className="font-medium text-foreground">{targetConnection}</span></>
          )}
        </p>

        {/* Collections — selectable for import, read-only chips for paste */}
        {previewCollections && previewCollections.length > 0 && (
          <div className="mb-4 rounded-md border border-border bg-muted/30 p-3">
            {isImport ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={allColsSelected}
                      ref={(el) => { if (el) el.indeterminate = !allColsSelected && !noColsSelected }}
                      onChange={toggleAllCols}
                      className="rounded"
                    />
                    Select all
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {selectedCols.size} of {previewCollections.length} selected
                  </span>
                </div>
                <div className="max-h-40 space-y-0.5 overflow-y-auto">
                  {previewCollections.map((col) => (
                    <label key={col} className="flex cursor-pointer items-center gap-2 rounded px-2 py-0.5 hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={selectedCols.has(col)}
                        onChange={() => toggleCol(col)}
                        className="rounded"
                      />
                      <Table2 className="h-3 w-3 text-blue-400" />
                      <span className="text-xs">{col}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {previewCollections.length} collection{previewCollections.length !== 1 ? 's' : ''}:
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {previewCollections.map((col) => (
                    <span key={col} className="inline-flex items-center gap-1 rounded bg-background px-2 py-0.5 text-xs border border-border">
                      <Table2 className="h-3 w-3 text-blue-400" />
                      {col}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Mode selection */}
        <div className="space-y-2">
          {/* Create new database */}
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
              name="pasteMode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Create new database</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Creates a fresh database with all collections and data copied over.
              </p>
              {mode === 'new' && (
                <div className="mt-2">
                  <Input
                    ref={nameRef}
                    placeholder="Database name"
                    value={newDbName}
                    onChange={(e) => setNewDbName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSubmit()
                      if (e.key === 'Escape') onCancel()
                    }}
                    className="h-8 text-sm"
                  />
                  {nameConflicts && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      A database with this name already exists. Choose a different name or use overwrite mode.
                    </p>
                  )}
                </div>
              )}
            </div>
          </label>

          {/* Overwrite existing database */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
              mode === 'overwrite'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/30'
            }`}
            onClick={() => setMode('overwrite')}
          >
            <input
              type="radio"
              name="pasteMode"
              checked={mode === 'overwrite'}
              onChange={() => setMode('overwrite')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Overwrite existing database</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Drops matching collections in the target database before copying.
              </p>
              {mode === 'overwrite' && (
                <div className="mt-2">
                  {existingDatabases.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No existing databases to overwrite.</p>
                  ) : (
                    <>
                      <select
                        value={selectedDb}
                        onChange={(e) => setSelectedDb(e.target.value)}
                        className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        {existingDatabases.map((db) => (
                          <option key={db} value={db}>
                            {db}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                        <AlertTriangle className="h-3 w-3" />
                        This will drop and replace all collections that exist in the source.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            variant={mode === 'overwrite' ? 'destructive' : 'default'}
          >
            {mode === 'overwrite'
              ? (isImport ? 'Overwrite & Import' : 'Overwrite & Paste')
              : (isImport ? 'Import Database' : 'Paste Database')
            }
          </Button>
        </div>
      </div>
    </div>
  )
}
