import { useEffect } from 'react'
import { AppShell } from '@renderer/components/layout/AppShell'
import { MainPanel } from '@renderer/components/data/MainPanel'
import { ClaudePanel } from '@renderer/components/claude/ClaudePanel'
import { useTabStore } from '@renderer/store/tabStore'
import { useThemeStore } from '@renderer/store/themeStore'

function App(): React.JSX.Element {
  useEffect(() => {
    useTabStore.getState().loadTabs()
    useThemeStore.getState().loadFromSettings()
  }, [])

  return (
    <AppShell
      mainPanel={<MainPanel />}
      claudePanel={<ClaudePanel />}
    />
  )
}

export default App
