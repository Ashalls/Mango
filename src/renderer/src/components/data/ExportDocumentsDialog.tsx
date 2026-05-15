import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Download, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { trpc } from '@renderer/lib/trpc'

interface ExportDocumentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  database: string
  collection: string
  currentFilter: Record<string, unknown>
  currentProjection: Record<string, number> | null
  currentSort: Record<string, number> | null
}

type FilterSource = 'current' | 'all' | 'custom'
type Format = 'json' | 'ndjson' | 'csv'

export function ExportDocumentsDialog({
  open,
  onOpenChange,
  database,
  collection,
  currentFilter,
  currentProjection,
  currentSort
}: ExportDocumentsDialogProps) {
  const [format, setFormat] = useState<Format>('json')
  const [source, setSource] = useState<FilterSource>('current')
  const [customFilter, setCustomFilter] = useState('{}')
  const [applyProjection, setApplyProjection] = useState(true)
  const [applySort, setApplySort] = useState(true)
  const [useLimit, setUseLimit] = useState(false)
  const [limit, setLimit] = useState('1000')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matchCount, setMatchCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [done, setDone] = useState<{ path: string; count: number } | null>(null)

  const hasCurrentFilter = Object.keys(currentFilter).length > 0

  useEffect(() => {
    if (open) {
      setSource(hasCurrentFilter ? 'current' : 'all')
      setCustomFilter(hasCurrentFilter ? JSON.stringify(currentFilter, null, 2) : '{}')
      setError(null)
      setDone(null)
    }
  }, [open, hasCurrentFilter, currentFilter])

  const resolvedFilter = useMemo<Record<string, unknown> | { _err: string }>(() => {
    if (source === 'all') return {}
    if (source === 'current') return currentFilter
    try {
      const parsed = JSON.parse(customFilter)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return { _err: 'Filter must be a JSON object' }
    } catch {
      return { _err: 'Invalid JSON in custom filter' }
    }
  }, [source, currentFilter, customFilter])

  const filterError = '_err' in resolvedFilter ? (resolvedFilter as { _err: string })._err : null
  const cleanFilter = filterError ? {} : (resolvedFilter as Record<string, unknown>)

  // Count matching docs whenever filter changes
  useEffect(() => {
    if (!open || filterError) {
      setMatchCount(null)
      return
    }
    setCounting(true)
    let cancelled = false
    trpc.query.count
      .query({ database, collection, filter: cleanFilter })
      .then((n: number) => {
        if (!cancelled) setMatchCount(n)
      })
      .catch(() => {
        if (!cancelled) setMatchCount(null)
      })
      .finally(() => {
        if (!cancelled) setCounting(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, database, collection, JSON.stringify(cleanFilter), filterError])

  const exportCount =
    useLimit && limit && matchCount !== null
      ? Math.min(matchCount, parseInt(limit, 10) || 0)
      : matchCount

  const handleExport = async () => {
    if (filterError) {
      setError(filterError)
      return
    }
    setError(null)
    setExporting(true)
    try {
      const result = await trpc.exportImport.exportCollection.mutate({
        database,
        collection,
        format,
        filter: cleanFilter,
        projection: applyProjection ? currentProjection : null,
        sort: applySort ? currentSort : null,
        limit: useLimit ? Math.max(1, parseInt(limit, 10) || 0) : undefined
      })
      if (result) {
        setDone(result)
      } else {
        // User cancelled the save dialog
        setExporting(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setExporting(false)
    } finally {
      setExporting(false)
    }
  }

  const filterSummary = filterError
    ? filterError
    : Object.keys(cleanFilter).length === 0
      ? '(no filter — entire collection)'
      : JSON.stringify(cleanFilter)

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!exporting) onOpenChange(o)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">Export Documents</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={exporting}>
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <Dialog.Description className="mb-4 text-sm text-muted-foreground">
            Export from{' '}
            <span className="font-mono text-foreground">
              {database}.{collection}
            </span>
          </Dialog.Description>

          {done ? (
            <div className="space-y-3">
              <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-400">
                Exported {done.count.toLocaleString()} document(s).
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs break-all">
                {done.path}
              </div>
              <div className="flex justify-end">
                <Button onClick={() => onOpenChange(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              {/* Format */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Format
                </label>
                <div className="flex gap-2">
                  {(['json', 'ndjson', 'csv'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`flex-1 rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
                        format === f
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-input text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {f === 'json' ? 'JSON (array)' : f === 'ndjson' ? 'NDJSON (lines)' : 'CSV'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filter source */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Filter
                </label>
                <div className="space-y-1.5 text-sm">
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      checked={source === 'current'}
                      onChange={() => setSource('current')}
                      disabled={!hasCurrentFilter}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className={!hasCurrentFilter ? 'text-muted-foreground' : ''}>
                        Use current query filter
                      </div>
                      {hasCurrentFilter && (
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground line-clamp-2">
                          {JSON.stringify(currentFilter)}
                        </div>
                      )}
                      {!hasCurrentFilter && (
                        <div className="text-[10px] text-muted-foreground">(no filter set on this tab)</div>
                      )}
                    </div>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={source === 'all'}
                      onChange={() => setSource('all')}
                    />
                    Entire collection
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={source === 'custom'}
                      onChange={() => setSource('custom')}
                    />
                    Custom filter (JSON)
                  </label>
                  {source === 'custom' && (
                    <textarea
                      className="mt-1 h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder='{ "status": "active" }'
                      value={customFilter}
                      onChange={(e) => setCustomFilter(e.target.value)}
                      spellCheck={false}
                    />
                  )}
                </div>
              </div>

              {/* Apply current sort/projection */}
              {(currentSort || currentProjection) && (
                <div className="mb-4 space-y-1.5 text-sm">
                  {currentSort && (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={applySort}
                        onChange={(e) => setApplySort(e.target.checked)}
                      />
                      Apply current sort
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {JSON.stringify(currentSort)}
                      </span>
                    </label>
                  )}
                  {currentProjection && (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={applyProjection}
                        onChange={(e) => setApplyProjection(e.target.checked)}
                      />
                      Apply current projection
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {Object.keys(currentProjection).length} fields
                      </span>
                    </label>
                  )}
                </div>
              )}

              {/* Limit */}
              <div className="mb-4 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  id="export-use-limit"
                  checked={useLimit}
                  onChange={(e) => setUseLimit(e.target.checked)}
                />
                <label htmlFor="export-use-limit">Limit to</label>
                <input
                  type="number"
                  min={1}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  disabled={!useLimit}
                  className="h-7 w-24 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                />
                <span className="text-muted-foreground">documents</span>
              </div>

              {/* Match count summary */}
              <div className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Filter:</span>
                  <span className="ml-2 font-mono truncate max-w-[360px]" title={filterSummary}>
                    {filterSummary}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Will export:</span>
                  <span className="font-medium">
                    {counting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : exportCount !== null ? (
                      `${exportCount.toLocaleString()} document(s)`
                    ) : (
                      '—'
                    )}
                  </span>
                </div>
              </div>

              {error && (
                <div className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button variant="outline" disabled={exporting}>
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button onClick={handleExport} disabled={exporting || !!filterError}>
                  {exporting ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Export
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
