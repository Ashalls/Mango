import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X } from 'lucide-react'
import { trpc } from '@renderer/lib/trpc'
import { useExplorerStore } from '@renderer/store/explorerStore'
import { useTabStore } from '@renderer/store/tabStore'
import { useConnectionStore } from '@renderer/store/connectionStore'
import type { ValueSearchResult } from '@shared/types'

interface ValueSearchDialogProps {
  open: boolean
  onClose: () => void
}

export function ValueSearchDialog({ open, onClose }: ValueSearchDialogProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [scopeType, setScopeType] = useState<'server' | 'database' | 'collection'>('server')
  const [selectedDb, setSelectedDb] = useState<string>('')
  const [selectedCol, setSelectedCol] = useState<string>('')
  const [caseInsensitive, setCaseInsensitive] = useState(true)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState<ValueSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const databases = useExplorerStore((s) => s.databases)
  const collections = useExplorerStore((s) => s.collections)
  const loadCollections = useExplorerStore((s) => s.loadCollections)
  const openTab = useTabStore((s) => s.openTab)
  const activeConnection = useConnectionStore((s) => s.activeConnection)

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Load collections when database changes
  useEffect(() => {
    if (selectedDb && !collections[selectedDb]) {
      loadCollections(selectedDb)
    }
  }, [selectedDb, collections, loadCollections])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleSearch = useCallback(async () => {
    if (!searchTerm.trim()) return

    setLoading(true)
    setError(null)
    setSearched(true)

    try {
      const scope: { type: 'server' | 'database' | 'collection'; database?: string; collection?: string } = {
        type: scopeType
      }
      if (scopeType === 'database' || scopeType === 'collection') {
        scope.database = selectedDb
      }
      if (scopeType === 'collection') {
        scope.collection = selectedCol
      }

      const data = await trpc.query.valueSearch.query({
        searchTerm: searchTerm.trim(),
        scope,
        regex,
        caseInsensitive,
        maxResults: 200
      })
      setResults(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [searchTerm, scopeType, selectedDb, selectedCol, regex, caseInsensitive])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const handleResultDoubleClick = (result: ValueSearchResult) => {
    if (activeConnection?.profileId) {
      openTab(activeConnection.profileId, result.database, result.collection)
    }
  }

  if (!open) return null

  // Group results by database.collection
  const grouped = results.reduce<Record<string, ValueSearchResult[]>>((acc, r) => {
    const key = `${r.database}.${r.collection}`
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

  const dbCollections = selectedDb ? collections[selectedDb] || [] : []

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[10vh]">
      <div className="flex max-h-[75vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-background shadow-2xl">
        {/* Search bar */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search for a value across collections..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Options bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs">
          <select
            className="rounded border border-border bg-background px-2 py-1 text-xs"
            value={scopeType}
            onChange={(e) => {
              setScopeType(e.target.value as 'server' | 'database' | 'collection')
              if (e.target.value === 'server') {
                setSelectedDb('')
                setSelectedCol('')
              }
            }}
          >
            <option value="server">All databases</option>
            <option value="database">Database</option>
            <option value="collection">Collection</option>
          </select>

          {(scopeType === 'database' || scopeType === 'collection') && (
            <select
              className="rounded border border-border bg-background px-2 py-1 text-xs"
              value={selectedDb}
              onChange={(e) => {
                setSelectedDb(e.target.value)
                setSelectedCol('')
              }}
            >
              <option value="">Select database...</option>
              {databases.map((db) => (
                <option key={db.name} value={db.name}>
                  {db.name}
                </option>
              ))}
            </select>
          )}

          {scopeType === 'collection' && selectedDb && (
            <select
              className="rounded border border-border bg-background px-2 py-1 text-xs"
              value={selectedCol}
              onChange={(e) => setSelectedCol(e.target.value)}
            >
              <option value="">Select collection...</option>
              {dbCollections.map((col) => (
                <option key={col.name} value={col.name}>
                  {col.name}
                </option>
              ))}
            </select>
          )}

          <label className="flex items-center gap-1 text-muted-foreground">
            <input
              type="checkbox"
              checked={caseInsensitive}
              onChange={(e) => setCaseInsensitive(e.target.checked)}
              className="rounded"
            />
            Case insensitive
          </label>

          <label className="flex items-center gap-1 text-muted-foreground">
            <input
              type="checkbox"
              checked={regex}
              onChange={(e) => setRegex(e.target.checked)}
              className="rounded"
            />
            Regex
          </label>

          <button
            onClick={handleSearch}
            disabled={loading || !searchTerm.trim()}
            className="ml-auto rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Results area */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>
          )}

          {!searched && !loading && (
            <p className="text-center text-sm text-muted-foreground">
              Enter a search term and press Enter or click Search.
            </p>
          )}

          {searched && !loading && results.length === 0 && !error && (
            <p className="text-center text-sm text-muted-foreground">No results found.</p>
          )}

          {Object.entries(grouped).map(([key, items]) => (
            <div key={key} className="mb-4">
              <div className="mb-2 flex items-center gap-2 rounded bg-emerald-500/10 px-3 py-1.5">
                <span className="text-xs font-semibold text-emerald-400">{key}</span>
                <span className="text-[10px] text-muted-foreground">
                  {items.length} match{items.length !== 1 ? 'es' : ''}
                </span>
              </div>
              <div className="space-y-1">
                {items.map((r, idx) => (
                  <div
                    key={`${r.documentId}-${r.fieldPath}-${idx}`}
                    className="flex items-baseline gap-3 rounded px-3 py-1.5 text-xs hover:bg-muted cursor-pointer"
                    onDoubleClick={() => handleResultDoubleClick(r)}
                    title="Double-click to open collection"
                  >
                    <span className="shrink-0 truncate font-mono text-muted-foreground" style={{ maxWidth: '120px' }}>
                      {r.documentId}
                    </span>
                    <span className="shrink-0 text-blue-400">{r.fieldPath}</span>
                    <span className="truncate text-foreground">{r.matchedValue}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
