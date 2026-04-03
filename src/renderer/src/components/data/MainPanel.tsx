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
import { MessageSquare, Table2, GitBranch } from 'lucide-react'
import type { ExplainPlan } from '@shared/types'

export function MainPanel() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [subTab, setSubTab] = useState<'documents' | 'aggregation' | 'explain' | 'indexes'>('documents')
  const [viewMode, setViewMode] = useState<'table' | 'tree'>('table')
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
              </div>

              {subTab === 'documents' ? (
                <>
                  <QueryBuilder />
                  <BulkToolbar />
                  {/* View mode toggle */}
                  <div className="flex items-center gap-1.5 border-b border-border px-4 py-1">
                    <span className="text-[11px] text-muted-foreground mr-1">View:</span>
                    <button
                      className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        viewMode === 'table'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setViewMode('table')}
                    >
                      <Table2 className="h-3 w-3" />
                      Table
                    </button>
                    <button
                      className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        viewMode === 'tree'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setViewMode('tree')}
                    >
                      <GitBranch className="h-3 w-3" />
                      Tree
                    </button>
                  </div>
                  <div className={viewMode === 'table' && activeTab.selectedDocument ? 'h-1/2 min-h-0' : 'flex-1 min-h-0'}>
                    {viewMode === 'table' ? <DocumentTable /> : <TreeView />}
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
