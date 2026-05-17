import { useEffect, useRef } from 'react'
import { X, Table2, Eye, Database, MessageSquare } from 'lucide-react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type Modifier
} from '@dnd-kit/core'

// Lock drag motion to the X axis — the tab strip is a single horizontal row,
// vertical motion would visually detach the tab from the bar.
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0
})
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@renderer/lib/utils'
import { useTabStore } from '@renderer/store/tabStore'
import { useConnectionStore } from '@renderer/store/connectionStore'
import type { ConnectionProfile } from '@shared/types'

type TabModel = ReturnType<typeof useTabStore.getState>['tabs'][number]

interface SortableTabProps {
  tab: TabModel
  index: number
  tabsLength: number
  isActive: boolean
  profile: ConnectionProfile | undefined
  onActivate: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseRight: () => void
  onCloseLeft: () => void
  onCloseAll: () => void
}

function SortableTab({
  tab,
  index,
  tabsLength,
  isActive,
  profile,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseLeft,
  onCloseAll
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id
  })

  const connName = profile?.name ?? ''
  const titleText =
    tab.scope === 'connection'
      ? tab.label
      : tab.scope === 'database'
        ? `${tab.database} (${connName})`
        : `${tab.database}.${tab.collection} (${connName})`

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          ref={setNodeRef}
          style={{
            transform: CSS.Transform.toString(transform),
            transition,
            opacity: isDragging ? 0.5 : 1,
            zIndex: isDragging ? 10 : undefined
          }}
          className={cn(
            'group flex h-full shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 text-xs',
            'min-w-[160px] max-w-[260px]',
            isActive
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          onClick={onActivate}
          {...attributes}
          {...listeners}
        >
          {profile?.color ? (
            <div
              className="h-full w-0.5 shrink-0 rounded-full"
              style={{ backgroundColor: profile.color }}
            />
          ) : null}
          {tab.scope === 'connection' ? (
            <MessageSquare className="h-3 w-3 shrink-0 text-emerald-400" />
          ) : tab.scope === 'database' ? (
            <Database className="h-3 w-3 shrink-0 text-amber-400" />
          ) : tab.isView ? (
            <Eye className="h-3 w-3 shrink-0 text-purple-400" />
          ) : (
            <Table2 className="h-3 w-3 shrink-0 text-blue-400" />
          )}
          <span className="min-w-0 flex-1 truncate" title={titleText}>
            {tab.label}
          </span>
          {tab.scope === 'collection' && (
            <span className="shrink-0 truncate text-[10px] text-muted-foreground" title={tab.database}>
              {tab.database}
            </span>
          )}
          <button
            className="ml-1 shrink-0 rounded p-0.5 opacity-0 hover:bg-secondary group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            // Stop drag from claiming the close click
            onPointerDown={(e) => e.stopPropagation()}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-[180px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
          <ContextMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
            onSelect={onClose}
          >
            Close
          </ContextMenu.Item>
          <ContextMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
            onSelect={onCloseOthers}
            disabled={tabsLength <= 1}
          >
            Close Others
          </ContextMenu.Item>
          <ContextMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
            onSelect={onCloseRight}
            disabled={index >= tabsLength - 1}
          >
            Close to the Right
          </ContextMenu.Item>
          <ContextMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
            onSelect={onCloseLeft}
            disabled={index <= 0}
          >
            Close to the Left
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ContextMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
            onSelect={onCloseAll}
          >
            Close All
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, reorderTabs } = useTabStore()
  const profiles = useConnectionStore((s) => s.profiles)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevTabCount = useRef(tabs.length)

  // 4px activation distance — clicks still register cleanly, drag kicks in on
  // intentional motion.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    if (tabs.length > prevTabCount.current && containerRef.current) {
      containerRef.current.scrollLeft = containerRef.current.scrollWidth
    }
    prevTabCount.current = tabs.length
  }, [tabs.length])

  if (tabs.length === 0) return null

  const closeOtherTabs = (tabId: string) => {
    tabs.filter((t) => t.id !== tabId).forEach((t) => closeTab(t.id))
  }
  const closeTabsToTheRight = (tabId: string) => {
    const idx = tabs.findIndex((t) => t.id === tabId)
    tabs.slice(idx + 1).forEach((t) => closeTab(t.id))
  }
  const closeTabsToTheLeft = (tabId: string) => {
    const idx = tabs.findIndex((t) => t.id === tabId)
    tabs.slice(0, idx).forEach((t) => closeTab(t.id))
  }
  const closeAllTabs = () => {
    tabs.forEach((t) => closeTab(t.id))
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    reorderTabs(String(active.id), String(over.id))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToHorizontalAxis]}
    >
      <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        <div
          ref={containerRef}
          className="flex h-9 items-center border-b border-border bg-card overflow-x-auto"
        >
          {tabs.map((tab, index) => {
            const profile = profiles.find((p) => p.id === tab.connectionId)
            return (
              <SortableTab
                key={tab.id}
                tab={tab}
                index={index}
                tabsLength={tabs.length}
                isActive={activeTabId === tab.id}
                profile={profile}
                onActivate={() => setActiveTab(tab.id)}
                onClose={() => closeTab(tab.id)}
                onCloseOthers={() => closeOtherTabs(tab.id)}
                onCloseRight={() => closeTabsToTheRight(tab.id)}
                onCloseLeft={() => closeTabsToTheLeft(tab.id)}
                onCloseAll={closeAllTabs}
              />
            )
          })}
        </div>
      </SortableContext>
    </DndContext>
  )
}
