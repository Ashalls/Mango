import { useEffect, useState } from 'react'
import { Star, Play, X, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { trpc } from '@renderer/lib/trpc'

interface HistoryEntry {
  id: string
  connectionId: string
  database: string
  collection: string
  filter: Record<string, unknown>
  sort: Record<string, number> | null
  projection: Record<string, number> | null
  limit: number
  resultCount: number
  timestamp: number
  pinned: boolean
}

interface QueryHistoryPanelProps {
  onClose: () => void
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function filterSummary(filter: Record<string, unknown>): string {
  const json = JSON.stringify(filter)
  if (json === '{}') return '{}'
  if (json.length <= 60) return json
  return json.slice(0, 57) + '...'
}

export function QueryHistoryPanel({ onClose }: QueryHistoryPanelProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [showAll, setShowAll] = useState(false)

  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { setFilter, setSort, setProjection, updateTab, executeQuery } = useTabStore()

  useEffect(() => {
    trpc.query.getHistory.query().then((data) => {
      setEntries(data as HistoryEntry[])
    })
  }, [])

  const connectionId = activeTab?.connectionId
  const filtered = showAll ? entries : entries.filter((e) => e.connectionId === connectionId)
  const pinned = filtered.filter((e) => e.pinned)
  const recent = filtered.filter((e) => !e.pinned)

  const replay = (entry: HistoryEntry) => {
    setFilter(entry.filter)
    setSort(entry.sort)
    setProjection(entry.projection)
    // Use updateTab directly to avoid double-query (setPageSize calls executeQuery internally)
    if (activeTab) updateTab(activeTab.id, { pageSize: entry.limit, page: 0 })
    executeQuery()
    onClose()
  }

  const togglePin = async (id: string) => {
    await trpc.query.togglePinHistory.mutate({ id })
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e))
    )
  }

  const deleteEntry = async (id: string) => {
    await trpc.query.deleteHistory.mutate({ id })
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  const clearAll = async () => {
    await trpc.query.clearHistory.mutate()
    setEntries((prev) => prev.filter((e) => e.pinned))
  }

  const renderEntry = (entry: HistoryEntry) => (
    <div
      key={entry.id}
      className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50"
    >
      <button
        className="shrink-0"
        onClick={() => togglePin(entry.id)}
        title={entry.pinned ? 'Unpin' : 'Pin'}
      >
        <Star
          className={`h-3.5 w-3.5 ${entry.pinned ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`}
        />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-xs">
            {entry.collection} → {filterSummary(entry.filter)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{relativeTime(entry.timestamp)}</span>
          <span>{entry.resultCount} results</span>
          {entry.sort && Object.keys(entry.sort).length > 0 && <span>sorted</span>}
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-green-500 hover:text-green-400"
        onClick={() => replay(entry)}
        title="Run"
      >
        <Play className="h-3 w-3" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={() => deleteEntry(entry.id)}
        title="Delete"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  )

  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-[420px] max-h-[400px] overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium">Query History</span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] text-destructive hover:text-destructive"
            onClick={clearAll}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Clear
          </Button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="p-2">
        {pinned.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 px-2 text-[10px] font-medium text-yellow-400">Pinned</div>
            {pinned.map(renderEntry)}
          </div>
        )}

        {recent.length > 0 && (
          <div>
            <div className="mb-1 px-2 text-[10px] font-medium text-muted-foreground">Recent</div>
            {recent.map(renderEntry)}
          </div>
        )}

        {pinned.length === 0 && recent.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            No history yet. Run a query to get started.
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="rounded"
          />
          Show all connections
        </label>
      </div>
    </div>
  )
}
