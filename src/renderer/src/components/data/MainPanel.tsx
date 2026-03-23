import { useTabStore } from '@renderer/store/tabStore'
import { TabBar } from '@renderer/components/layout/TabBar'
import { QueryBuilder } from '@renderer/components/query/QueryBuilder'
import { DocumentTable } from './DocumentTable'
import { DocumentEditor } from './DocumentEditor'

export function MainPanel() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      {activeTab ? (
        <>
          <QueryBuilder />
          <div className={activeTab.selectedDocument ? 'h-1/2 min-h-0' : 'flex-1 min-h-0'}>
            <DocumentTable />
          </div>
          {activeTab.selectedDocument && (
            <div className="h-1/2 min-h-0">
              <DocumentEditor />
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Select a collection to view documents
        </div>
      )}
    </div>
  )
}
