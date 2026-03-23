import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useClaudeStore } from '@renderer/store/claudeStore'
import { cn } from '@renderer/lib/utils'

interface AppShellProps {
  mainPanel: React.ReactNode
  claudePanel: React.ReactNode
}

export function AppShell({ mainPanel, claudePanel }: AppShellProps) {
  const isPanelOpen = useClaudeStore((s) => s.isPanelOpen)

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 flex-shrink-0 border-r border-border bg-sidebar-background">
          <Sidebar />
        </div>

        {/* Main Panel */}
        <div className="flex-1 overflow-hidden">
          {mainPanel}
        </div>

        {/* Claude Panel */}
        <div
          className={cn(
            'flex-shrink-0 border-l border-border bg-sidebar-background transition-all duration-200',
            isPanelOpen ? 'w-96' : 'w-0'
          )}
        >
          {isPanelOpen && claudePanel}
        </div>
      </div>
    </div>
  )
}
