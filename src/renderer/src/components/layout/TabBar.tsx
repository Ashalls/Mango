import { X, Table2, Eye } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useTabStore } from '@renderer/store/tabStore'

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabStore()

  if (tabs.length === 0) return null

  return (
    <div className="flex h-9 items-center border-b border-border bg-card overflow-x-auto">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            'group flex h-full cursor-pointer items-center gap-1.5 border-r border-border px-3 text-xs',
            activeTabId === tab.id
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          onClick={() => setActiveTab(tab.id)}
        >
          {tab.isView
            ? <Eye className="h-3 w-3 shrink-0 text-purple-400" />
            : <Table2 className="h-3 w-3 shrink-0 text-blue-400" />
          }
          <span className="truncate max-w-[120px]" title={`${tab.database}.${tab.collection}`}>
            {tab.label}
          </span>
          <span className="text-[10px] text-muted-foreground">{tab.database}</span>
          <button
            className="ml-1 rounded p-0.5 opacity-0 hover:bg-secondary group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(tab.id)
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
