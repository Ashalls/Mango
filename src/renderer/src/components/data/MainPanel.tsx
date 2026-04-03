import { useState, useEffect } from 'react'
import { useTabStore } from '@renderer/store/tabStore'
import { TabBar } from '@renderer/components/layout/TabBar'
import { QueryBuilder } from '@renderer/components/query/QueryBuilder'
import { DocumentTable } from './DocumentTable'
import { TreeView } from './TreeView'
import { BulkToolbar } from './BulkToolbar'
import { DocumentEditor } from './DocumentEditor'
import { IndexPanel } from '@renderer/components/indexes/IndexPanel'
import { AggregationEditor } from '@renderer/components/aggregation/AggregationEditor'
import { VisualExplain } from '@renderer/components/explain/VisualExplain'
import { trpc } from '@renderer/lib/trpc'
import { MessageSquare, Table2, GitBranch, Braces } from 'lucide-react'
import type { ExplainPlan } from '@shared/types'

export function MainPanel() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [subTab, setSubTab] = useState<'documents' | 'aggregation' | 'explain' | 'indexes'>('documents')
  const [viewMode, setViewMode] = useState<'table' | 'tree' | 'json'>('table')
  const [explainPlan, setExplainPlan] = useState<ExplainPlan | null>(null)

  const runExplain = async () => {
    if (!activeTab) return
    try {
      const result = await trpc.query.parsedExplain.query({
        database: activeTab.database,
        collection: activeTab.collection,
        filter: activeTab.filter
      })
      setExplainPlan(result)
      setSubTab('explain')
    } catch (err) {
      console.error('Failed to run explain:', err)
    }
  }

  // Reset to documents tab when the active tab changes
  useEffect(() => {
    setSubTab('documents')
  }, [activeTab?.id])

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      {activeTab ? (
        <>
          {activeTab.scope !== 'collection' ? (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-3">
              <MessageSquare className="h-10 w-10 opacity-30" />
              <p className="text-sm">Chat with Claude in the side panel &rarr;</p>
            </div>
          ) : (
            <>
              {/* Sub-tab bar */}
              <div className="flex h-8 items-center gap-0 border-b border-border bg-card px-2">
                <button
                  className={`relative px-3 py-1 text-xs font-medium transition-colors ${
                    subTab === 'documents'
                      ? 'text-emerald-400'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setSubTab('documents')}
                >
                  Documents
                  {subTab === 'documents' && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400" />
                  )}
                </button>
                <button
                  className={`relative px-3 py-1 text-xs font-medium transition-colors ${
                    subTab === 'aggregation'
                      ? 'text-emerald-400'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setSubTab('aggregation')}
                >
                  Aggregation
                  {subTab === 'aggregation' && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400" />
                  )}
                </button>
                <button
                  className={`relative px-3 py-1 text-xs font-medium transition-colors ${
                    subTab === 'explain'
                      ? 'text-emerald-400'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={runExplain}
                >
                  Explain
                  {subTab === 'explain' && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400" />
                  )}
                </button>
                <button
                  className={`relative px-3 py-1 text-xs font-medium transition-colors ${
                    subTab === 'indexes'
                      ? 'text-emerald-400'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setSubTab('indexes')}
                >
                  Indexes
                  {subTab === 'indexes' && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400" />
                  )}
                </button>

                {/* View mode toggle — only for documents sub-tab */}
                {subTab === 'documents' && (
                  <div className="ml-auto flex items-center gap-0.5 rounded border border-border mr-1">
                    {([
                      { key: 'table' as const, icon: Table2, label: 'Table' },
                      { key: 'tree' as const, icon: GitBranch, label: 'Tree' },
                      { key: 'json' as const, icon: Braces, label: 'JSON' }
                    ]).map(({ key, icon: Icon, label }) => (
                      <button
                        key={key}
                        className={`flex items-center gap-1 px-2 py-0.5 text-[11px] ${
                          viewMode === key
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setViewMode(key)}
                      >
                        <Icon className="h-3 w-3" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {subTab === 'documents' ? (
                <>
                  <QueryBuilder />
                  <BulkToolbar />
                  <div className={viewMode === 'table' && activeTab.selectedDocument ? 'h-1/2 min-h-0' : 'flex-1 min-h-0'}>
                    {viewMode === 'table' || viewMode === 'json' ? (
                      <DocumentTable viewMode={viewMode === 'json' ? 'json' : 'table'} />
                    ) : (
                      <TreeView />
                    )}
                  </div>
                  {viewMode === 'table' && activeTab.selectedDocument && (
                    <div className="h-1/2 min-h-0">
                      <DocumentEditor />
                    </div>
                  )}
                </>
              ) : subTab === 'aggregation' ? (
                <>
                  <div className={activeTab.results ? 'flex-1 min-h-0' : 'flex-1 min-h-0'}>
                    <AggregationEditor />
                  </div>
                  {activeTab.results && (
                    <div className="h-2/5 min-h-0 border-t border-border">
                      <DocumentTable />
                    </div>
                  )}
                </>
              ) : subTab === 'explain' ? (
                <div className="flex-1 min-h-0">
                  {explainPlan ? (
                    <VisualExplain plan={explainPlan} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Run a query first, then click Explain
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 overflow-auto">
                  <IndexPanel />
                </div>
              )}
            </>
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
