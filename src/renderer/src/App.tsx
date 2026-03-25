import { useEffect } from 'react'
import { AppShell } from '@renderer/components/layout/AppShell'
import { MainPanel } from '@renderer/components/data/MainPanel'
import { ClaudePanel } from '@renderer/components/claude/ClaudePanel'
import { useTabStore } from '@renderer/store/tabStore'
import { useConnectionStore } from '@renderer/store/connectionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { CatMode } from '@renderer/components/fun/CatMode'

function App(): React.JSX.Element {
  useEffect(() => {
    useTabStore.getState().loadTabs()
    useSettingsStore.getState().loadFromSettings()

    // Auto-reconnect for restored tabs and execute their queries
    autoReconnectTabs()
  }, [])

  return (
    <>
      <AppShell
        mainPanel={<MainPanel />}
        claudePanel={<ClaudePanel />}
      />
      <CatMode />
    </>
  )
}

async function autoReconnectTabs() {
  const tabs = useTabStore.getState().tabs
  if (tabs.length === 0) return

  // Collect unique connectionIds needed by restored tabs
  const connectionIds = [...new Set(tabs.map((t) => t.connectionId))]

  const connStore = useConnectionStore.getState()
  await connStore.loadProfiles()

  // Try to connect each needed connection
  for (const connId of connectionIds) {
    try {
      await connStore.connect(connId)
    } catch {
      // Connection may no longer exist or be unreachable
    }
  }

  // Now execute queries for all restored collection tabs
  const tabStore = useTabStore.getState()
  const currentActiveId = tabStore.activeTabId

  for (const tab of tabStore.tabs) {
    if (tab.scope !== 'collection') continue
    // Temporarily make this tab active so executeQuery targets it
    tabStore.setActiveTab(tab.id)
    try {
      await tabStore.executeQuery()
    } catch {
      // Query may fail if connection didn't reconnect
    }
  }

  // Restore the original active tab
  if (currentActiveId) {
    tabStore.setActiveTab(currentActiveId)
  }
}

export default App
