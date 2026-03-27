import { X, Table2, Eye, Database, MessageSquare } from 'lucide-react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { cn } from '@renderer/lib/utils'
import { useTabStore } from '@renderer/store/tabStore'
import { useConnectionStore } from '@renderer/store/connectionStore'

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabStore()
  const profiles = useConnectionStore((s) => s.profiles)

  if (tabs.length === 0) return null

  const closeOtherTabs = (tabId: string) => {
    const idsToClose = tabs.filter((t) => t.id !== tabId).map((t) => t.id)
    idsToClose.forEach((id) => closeTab(id))
  }

  const closeTabsToTheRight = (tabId: string) => {
    const idx = tabs.findIndex((t) => t.id === tabId)
    const idsToClose = tabs.slice(idx + 1).map((t) => t.id)
    idsToClose.forEach((id) => closeTab(id))
  }

  const closeTabsToTheLeft = (tabId: string) => {
    const idx = tabs.findIndex((t) => t.id === tabId)
    const idsToClose = tabs.slice(0, idx).map((t) => t.id)
    idsToClose.forEach((id) => closeTab(id))
  }

  const closeAllTabs = () => {
    const idsToClose = tabs.map((t) => t.id)
    idsToClose.forEach((id) => closeTab(id))
  }

  return (
    <div className="flex h-9 items-center border-b border-border bg-card overflow-x-auto">
      {tabs.map((tab, index) => (
        <ContextMenu.Root key={tab.id}>
          <ContextMenu.Trigger asChild>
            <div
              className={cn(
                'group flex h-full cursor-pointer items-center gap-1.5 border-r border-border px-3 text-xs',
                activeTabId === tab.id
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {(() => {
                const profile = profiles.find((p) => p.id === tab.connectionId)
                const connColor = profile?.color
                return connColor ? (
                  <div className="h-full w-0.5 shrink-0 rounded-full" style={{ backgroundColor: connColor }} />
                ) : null
              })()}
              {tab.scope === 'connection'
                ? <MessageSquare className="h-3 w-3 shrink-0 text-emerald-400" />
                : tab.scope === 'database'
                  ? <Database className="h-3 w-3 shrink-0 text-amber-400" />
                  : tab.isView
                    ? <Eye className="h-3 w-3 shrink-0 text-purple-400" />
                    : <Table2 className="h-3 w-3 shrink-0 text-blue-400" />
              }
              <span className="truncate max-w-[120px]" title={(() => {
                const profile = profiles.find((p) => p.id === tab.connectionId)
                const connName = profile?.name || ''
                if (tab.scope === 'connection') return tab.label
                if (tab.scope === 'database') return `${tab.database} (${connName})`
                return `${tab.database}.${tab.collection} (${connName})`
              })()}>
                {tab.label}
              </span>
              {tab.scope === 'collection' && (
                <span className="text-[10px] text-muted-foreground">{tab.database}</span>
              )}
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
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content className="min-w-[180px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                onSelect={() => closeTab(tab.id)}
              >
                Close
              </ContextMenu.Item>
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                onSelect={() => closeOtherTabs(tab.id)}
                disabled={tabs.length <= 1}
              >
                Close Others
              </ContextMenu.Item>
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                onSelect={() => closeTabsToTheRight(tab.id)}
                disabled={index >= tabs.length - 1}
              >
                Close to the Right
              </ContextMenu.Item>
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                onSelect={() => closeTabsToTheLeft(tab.id)}
                disabled={index <= 0}
              >
                Close to the Left
              </ContextMenu.Item>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                onSelect={closeAllTabs}
              >
                Close All
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      ))}
    </div>
  )
}
