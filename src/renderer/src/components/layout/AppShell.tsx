import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { OperationProgressPanel } from '@renderer/components/operations/OperationProgressPanel'
import { useClaudeStore } from '@renderer/store/claudeStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { cn } from '@renderer/lib/utils'

interface AppShellProps {
  mainPanel: React.ReactNode
  claudePanel: React.ReactNode
}

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 600

export function AppShell({ mainPanel, claudePanel }: AppShellProps) {
  const isPanelOpen = useClaudeStore((s) => s.isPanelOpen)
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth)
  const setSidebarWidth = useSettingsStore((s) => s.setSidebarWidth)

  // Drag-to-resize the Explorer sidebar. Mirrors MainPanel's split-drag: live
  // updates during pointermove, persist once on pointerup to avoid a settings
  // write per frame. Read the start width from the store (not the closure) so
  // successive drags compose correctly.
  const startSidebarDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = useSettingsStore.getState().sidebarWidth
    const onMove = (ev: PointerEvent) => {
      const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + (ev.clientX - startX)))
      setSidebarWidth(width)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setSidebarWidth(useSettingsStore.getState().sidebarWidth, true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — width is user-resizable (persisted) */}
        <div
          className="flex-shrink-0 bg-sidebar-background"
          style={{ width: sidebarWidth }}
        >
          <Sidebar />
        </div>

        {/* Resize handle — doubles as the sidebar/main divider (bg-border at rest). */}
        <div
          className="w-1.5 flex-shrink-0 cursor-col-resize bg-border transition-colors hover:bg-emerald-500/50"
          onPointerDown={startSidebarDrag}
          title="Drag to resize sidebar"
        />

        {/* Main Panel.
            min-w-0 + min-h-0 are load-bearing: without them this flex item's
            min-size defaults to its content's intrinsic size (the ag-grid's
            natural table width/height). When the Claude panel animates its
            width (below), the row-flex then re-solves this slot against a
            transient/over-constrained box every frame, and ag-grid — which has
            no fallback height and re-measures only on size-change events — can
            latch on a 0-height measurement and render blank until a forced
            reflow (historically: a right-click). Letting the slot shrink freely
            keeps its resolved size stable through the animation. */}
        <div className="flex-1 overflow-hidden min-w-0 min-h-0">
          {mainPanel}
        </div>

        {/* Claude Panel */}
        <div
          className={cn(
            // transition only width — `transition-all` also animates layout-
            // affecting properties, which amplifies the per-frame re-measure of
            // the main panel (and the ag-grid inside it) during the slide.
            'flex-shrink-0 border-l border-border bg-sidebar-background transition-[width] duration-200',
            isPanelOpen ? 'w-96' : 'w-0'
          )}
        >
          {isPanelOpen && claudePanel}
        </div>
      </div>

      {/* Operation Progress Toasts */}
      <OperationProgressPanel />
    </div>
  )
}
