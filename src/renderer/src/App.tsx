import { useEffect } from 'react'
import { AppShell } from '@renderer/components/layout/AppShell'
import { MainPanel } from '@renderer/components/data/MainPanel'
import { ClaudePanel } from '@renderer/components/claude/ClaudePanel'
import { useTabStore } from '@renderer/store/tabStore'

function App(): React.JSX.Element {
  useEffect(() => {
    useTabStore.getState().loadTabs()
  }, [])

  return (
    <AppShell
      mainPanel={<MainPanel />}
      claudePanel={<ClaudePanel />}
    />
  )
}

export default App
