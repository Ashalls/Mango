import { useEffect } from 'react'
import { AppShell } from '@renderer/components/layout/AppShell'
import { MainPanel } from '@renderer/components/data/MainPanel'
import { ClaudePanel } from '@renderer/components/claude/ClaudePanel'
import { useTabStore } from '@renderer/store/tabStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { CatMode } from '@renderer/components/fun/CatMode'

function App(): React.JSX.Element {
  useEffect(() => {
    useTabStore.getState().loadTabs()
    useSettingsStore.getState().loadFromSettings()
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

export default App
