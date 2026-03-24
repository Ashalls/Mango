import { Play, Clock, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'

interface QueryFooterProps {
  onRun: () => void
  onToggleHistory: () => void
  loading: boolean
}

export function QueryFooter({ onRun, onToggleHistory, loading }: QueryFooterProps) {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const setPageSize = useTabStore((s) => s.setPageSize)

  const limit = activeTab?.pageSize ?? 50
  const skip = (activeTab?.page ?? 0) * limit

  return (
    <div className="flex items-center border-t border-border px-4 py-1.5">
      {/* Left side: Skip and Limit */}
      <div className="flex items-center gap-3">
        <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Skip: {skip}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Limit:
          <input
            type="number"
            className="h-6 w-16 rounded border border-input bg-transparent px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            min={1}
            max={1000}
            value={limit}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!isNaN(val) && val >= 1 && val <= 1000) {
                setPageSize(val)
              }
            }}
          />
        </label>
      </div>

      {/* Right side: History and Run */}
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onToggleHistory}
        >
          <Clock className="mr-1 h-3.5 w-3.5" />
          History
        </Button>
        <Button
          size="sm"
          className="h-7 bg-green-600 text-xs text-white hover:bg-green-700"
          onClick={onRun}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="mr-1 h-3.5 w-3.5" />
          )}
          Run
        </Button>
      </div>
    </div>
  )
}
