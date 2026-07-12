import { useState } from 'react'
import { Trash2, Download, Plus, Pencil, Terminal } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { trpc } from '@renderer/lib/trpc'
import { InsertDocumentsDialog } from './InsertDocumentsDialog'
import { UpdateManyDialog } from './UpdateManyDialog'
import { ExportDocumentsDialog } from './ExportDocumentsDialog'

export function BulkToolbar() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { setSelectedDocIds, executeQuery } = useTabStore()

  const [insertOpen, setInsertOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const ids = activeTab?.selectedDocIds ?? []
  const hasSelection = ids.length > 0

  async function deleteSelected() {
    if (!activeTab) return
    if (!window.confirm(`Delete ${ids.length} document(s)? This cannot be undone.`)) return
    await trpc.mutation.deleteMany.mutate({
      connectionId: activeTab.connectionId,
      database: activeTab.database,
      collection: activeTab.collection,
      filter: { _id: { $in: ids } }
    })
    setSelectedDocIds([])
    executeQuery()
  }

  async function exportSelected() {
    if (!activeTab || ids.length === 0) return
    // Route through the lossless exporter (serializeToEJSON + native save
    // dialog) instead of JSON.stringify-ing the store's already-lossy display
    // docs — the old path wrote ObjectIds/Dates as bare strings that couldn't
    // round-trip back on import.
    try {
      await trpc.exportImport.exportCollection.mutate({
        connectionId: activeTab.connectionId,
        database: activeTab.database,
        collection: activeTab.collection,
        format: 'json',
        filter: { _id: { $in: ids } }
      })
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  if (!activeTab) return null

  return (
    <>
      {hasSelection && (
        <div className="flex items-center gap-2 border-b border-green-500/30 bg-green-500/10 px-3 py-1.5">
          <span className="text-xs font-semibold text-green-400">{ids.length} selected</span>
          <span className="text-border">|</span>
          <Button variant="ghost" size="sm" className="h-6 text-xs text-red-400 hover:text-red-300" onClick={deleteSelected}>
            <Trash2 className="mr-1 h-3 w-3" /> Delete
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs text-purple-400 hover:text-purple-300" onClick={exportSelected}>
            <Download className="mr-1 h-3 w-3" /> Export
          </Button>
          <div className="ml-auto">
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedDocIds([])}>
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-border px-3 py-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-emerald-400 hover:text-emerald-300"
          onClick={() => setInsertOpen(true)}
        >
          <Plus className="mr-1 h-3 w-3" /> Insert Documents
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-blue-400 hover:text-blue-300"
          onClick={() => setUpdateOpen(true)}
        >
          <Pencil className="mr-1 h-3 w-3" /> Update Many
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-purple-400 hover:text-purple-300"
          onClick={() => setExportOpen(true)}
          title="Export documents to JSON / NDJSON / CSV"
        >
          <Download className="mr-1 h-3 w-3" /> Export
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-amber-400 hover:text-amber-300 ml-auto"
          onClick={async () => {
            if (!activeTab) return
            try {
              await trpc.mongosh.open.mutate({
                connectionId: activeTab.connectionId,
                database: activeTab.database,
                collection: activeTab.collection
              })
            } catch (err) {
              alert(`Failed to open mongosh: ${err instanceof Error ? err.message : err}`)
            }
          }}
        >
          <Terminal className="mr-1 h-3 w-3" /> mongosh
        </Button>
      </div>

      <InsertDocumentsDialog
        open={insertOpen}
        onOpenChange={setInsertOpen}
        connectionId={activeTab.connectionId}
        database={activeTab.database}
        collection={activeTab.collection}
        onInserted={() => executeQuery()}
      />

      <UpdateManyDialog
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        connectionId={activeTab.connectionId}
        database={activeTab.database}
        collection={activeTab.collection}
        currentFilter={activeTab.filter}
        onUpdated={() => executeQuery()}
      />

      <ExportDocumentsDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        connectionId={activeTab.connectionId}
        database={activeTab.database}
        collection={activeTab.collection}
        currentFilter={activeTab.filter}
        currentProjection={activeTab.projection}
        currentSort={activeTab.sort}
      />
    </>
  )
}
