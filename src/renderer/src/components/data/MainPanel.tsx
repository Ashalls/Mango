import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useTabStore } from '@renderer/store/tabStore'
import { TabBar } from '@renderer/components/layout/TabBar'
import { QueryBuilder } from '@renderer/components/query/QueryBuilder'
import { DocumentTable } from './DocumentTable'
import { BulkToolbar } from './BulkToolbar'
import { DocumentEditor } from './DocumentEditor'
import { IndexPanel } from '@renderer/components/indexes/IndexPanel'
import { ValidationPanel } from '@renderer/components/validation/ValidationPanel'
import { AggregationEditor } from '@renderer/components/aggregation/AggregationEditor'
import { VisualExplain } from '@renderer/components/explain/VisualExplain'
import { QueryProfiler } from '@renderer/components/profiler/QueryProfiler'
import { trpc } from '@renderer/lib/trpc'
import { MessageSquare } from 'lucide-react'
import type { ExplainPlan } from '@shared/types'

export function MainPanel() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [subTab, setSubTab] = useState<'documents' | 'aggregation' | 'explain' | 'indexes' | 'validation'>('documents')
  const [viewMode, setViewMode] = useState<'table' | 'tree' | 'json'>('table')
  const [explainPlan, setExplainPlan] = useState<ExplainPlan | null>(null)
  // The document-editor pop-out state lives here (not inside DocumentEditor) so
  // that closing the pop-out re-renders DocumentTable too — ag-grid leaves its
  // rows stuck at 0px height after the pop-out overlay reflows, and only a
  // re-render of the table forces it to re-lay-out the rows.
  const [editorExpanded, setEditorExpanded] = useState(false)

  const splitRef = useRef<HTMLDivElement>(null)
  const documentSplitRatio = useSettingsStore((s) => s.documentSplitRatio)
  const setDocumentSplitRatio = useSettingsStore((s) => s.setDocumentSplitRatio)

  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const onMove = (ev: PointerEvent) => {
      const el = splitRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      let ratio = (ev.clientY - rect.top) / rect.height
      ratio = Math.min(0.85, Math.max(0.15, ratio))
      setDocumentSplitRatio(ratio)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDocumentSplitRatio(useSettingsStore.getState().documentSplitRatio, true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const runExplain = async () => {
    if (!activeTab) return
    try {
      const result = await trpc.query.parsedExplain.query({
        connectionId: activeTab.connectionId,
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

  // Collapse the popped-out editor when the document is closed, so re-opening a
  // document later doesn't immediately re-enter the pop-out.
  useEffect(() => {
    if (!activeTab?.selectedDocument) setEditorExpanded(false)
  }, [activeTab?.selectedDocument])

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      {activeTab ? (
        <>
          {activeTab.collection === '__profiler__' ? (
            <QueryProfiler key={activeTab.id} database={activeTab.database} />
          ) : activeTab.scope !== 'collection' ? (
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
                <button
                  className={`relative px-3 py-1 text-xs font-medium transition-colors ${
                    subTab === 'validation'
                      ? 'text-emerald-400'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setSubTab('validation')}
                >
                  Validation
                  {subTab === 'validation' && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400" />
                  )}
                </button>

              </div>

              {subTab === 'documents' ? (
                <>
                  {/* key per tab: QueryBuilder keeps its filter-builder rows in
                      local state, so without a per-tab key the previous tab's
                      filter visually leaks onto the next collection. Remounting
                      per tab isolates each tab's filter UI. */}
                  <QueryBuilder key={activeTab.id} />
                  <BulkToolbar />
                  {viewMode === 'table' && activeTab.selectedDocument ? (
                    <div ref={splitRef} className="flex flex-1 min-h-0 flex-col">
                      {/* The table pane uses a DEFINITE percentage height rather than
                          flexBasis:0 + flexGrow. ag-grid resolves its own height:100%
                          against this pane, and Chromium fails to re-resolve a %-height
                          child of a flex-basis:0 grown item after a reflow (it collapses
                          to 0 and sticks) — which the document-editor pop-out's
                          position:fixed overlay triggers. A definite % height is immune. */}
                      <div className="min-h-0" style={{ height: `${documentSplitRatio * 100}%`, flexShrink: 0 }}>
                        <DocumentTable viewMode={viewMode} onViewModeChange={setViewMode} popoutExpanded={editorExpanded} />
                      </div>
                      <div
                        className="h-1.5 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-emerald-500/50"
                        onPointerDown={startSplitDrag}
                        title="Drag to resize"
                      />
                      {/* Editor pane takes the remaining height; Monaco self-sizes via
                          automaticLayout, so flex-grow here is safe. */}
                      <div className="min-h-0 flex-1">
                        <DocumentEditor expanded={editorExpanded} onExpandedChange={setEditorExpanded} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0">
                      <DocumentTable viewMode={viewMode} onViewModeChange={setViewMode} />
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
              ) : subTab === 'indexes' ? (
                <div className="flex-1 overflow-auto">
                  <IndexPanel />
                </div>
              ) : (
                <div className="flex-1 min-h-0">
                  <ValidationPanel />
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
