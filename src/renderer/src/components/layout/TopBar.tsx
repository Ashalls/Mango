import { Database, MessageSquare, Plug, PlugZap, Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useConnectionStore } from '@renderer/store/connectionStore'
import { useTabStore } from '@renderer/store/tabStore'
import { useClaudeStore } from '@renderer/store/claudeStore'
import { useThemeStore } from '@renderer/store/themeStore'

export function TopBar() {
  const activeConnection = useConnectionStore((s) => s.activeConnection)
  const profiles = useConnectionStore((s) => s.profiles)
  const connectedIds = useConnectionStore((s) => s.connectedIds)
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const togglePanel = useClaudeStore((s) => s.togglePanel)
  const isPanelOpen = useClaudeStore((s) => s.isPanelOpen)
  const { theme, setTheme } = useThemeStore()

  const activeProfile = profiles.find((p) => p.id === activeConnection?.profileId)
  const isConnected = activeConnection?.status === 'connected'

  const cycleTheme = () => {
    const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark'
    setTheme(next)
  }

  const themeIcon = theme === 'dark'
    ? <Moon className="h-4 w-4" />
    : theme === 'light'
      ? <Sun className="h-4 w-4" />
      : <Monitor className="h-4 w-4" />

  return (
    <div className="flex h-12 items-center justify-between border-b border-border bg-background px-4">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold tracking-tight">MongoLens</h1>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-2 text-sm">
          {isConnected ? (
            <PlugZap className="h-4 w-4 text-emerald-400" />
          ) : (
            <Plug className="h-4 w-4 text-muted-foreground" />
          )}
          <span className={isConnected ? 'text-foreground' : 'text-muted-foreground'}>
            {activeProfile?.name || 'Not connected'}
          </span>
          {connectedIds.length > 1 && (
            <span className="text-xs text-muted-foreground">
              (+{connectedIds.length - 1} more)
            </span>
          )}
        </div>

        {tab && (
          <>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Database className="h-3.5 w-3.5" />
              <span>{tab.database}</span>
              <span className="text-border">/</span>
              <span className="text-foreground">{tab.collection}</span>
              {tab.isView && (
                <span className="rounded bg-purple-500/20 px-1 py-0.5 text-[10px] text-purple-400">view</span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={cycleTheme}
          title={`Theme: ${theme}`}
        >
          {themeIcon}
        </Button>
        <Button
          variant={isPanelOpen ? 'secondary' : 'ghost'}
          size="sm"
          onClick={togglePanel}
        >
          <MessageSquare className="h-4 w-4" />
          Claude
        </Button>
      </div>
    </div>
  )
}
