import { useEffect, useState } from 'react'
import { Database, MessageSquare, Plug, PlugZap, Sun, Moon, Monitor, Settings, Search } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@renderer/components/ui/popover'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import { useConnectionStore } from '@renderer/store/connectionStore'
import { useTabStore } from '@renderer/store/tabStore'
import { useClaudeStore } from '@renderer/store/claudeStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { ValueSearchDialog } from '@renderer/components/search/ValueSearchDialog'

export function TopBar() {
  const activeConnection = useConnectionStore((s) => s.activeConnection)
  const profiles = useConnectionStore((s) => s.profiles)
  const connectedIds = useConnectionStore((s) => s.connectedIds)
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const togglePanel = useClaudeStore((s) => s.togglePanel)
  const isPanelOpen = useClaudeStore((s) => s.isPanelOpen)
  const { theme, setTheme, catSounds, setCatSounds } = useSettingsStore()
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [valueSearchOpen, setValueSearchOpen] = useState(false)

  useEffect(() => {
    const handler = (_event: unknown, data: { version: string }) => {
      setUpdateVersion(data.version)
    }
    window.electron?.ipcRenderer.on('update:downloaded', handler)
    return () => {
      window.electron?.ipcRenderer.removeListener('update:downloaded', handler)
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setValueSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const activeProfile = profiles.find((p) => p.id === activeConnection?.profileId)
  const isConnected = activeConnection?.status === 'connected'

  return (
    <div className="flex h-12 items-center justify-between border-b border-border bg-background px-4">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold tracking-tight">Mango</h1>

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
        {updateVersion && (
          <div className="flex items-center gap-2 rounded-md bg-green-500/15 px-3 py-1 text-xs text-green-400">
            <span>v{updateVersion} ready</span>
            <button
              className="rounded bg-green-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-green-500"
              onClick={() => window.electron?.ipcRenderer.invoke('update:install')}
            >
              Restart
            </button>
          </div>
        )}
        <button
          onClick={() => setValueSearchOpen(true)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Search Values (Ctrl+Shift+F)"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search Values</span>
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Settings</h4>

              {/* Theme selector */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Theme</label>
                <div className="flex gap-1 rounded-md bg-muted p-1">
                  {([
                    { value: 'light' as const, icon: Sun, label: 'Light' },
                    { value: 'dark' as const, icon: Moon, label: 'Dark' },
                    { value: 'system' as const, icon: Monitor, label: 'System' }
                  ]).map(({ value, icon: Icon, label }) => (
                    <button
                      key={value}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-xs transition-colors',
                        theme === value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => setTheme(value)}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cat sounds toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-sm">Cat Sounds</label>
                  <p className="text-xs text-muted-foreground">Meow, purr & hiss effects</p>
                </div>
                <Switch
                  checked={catSounds}
                  onCheckedChange={setCatSounds}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Button
          variant={isPanelOpen ? 'secondary' : 'ghost'}
          size="sm"
          onClick={togglePanel}
        >
          <MessageSquare className="h-4 w-4" />
          Claude
        </Button>
      </div>
      <ValueSearchDialog open={valueSearchOpen} onClose={() => setValueSearchOpen(false)} />
    </div>
  )
}
