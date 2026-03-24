import { Trash2, Download } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { trpc } from '@renderer/lib/trpc'

export function BulkToolbar() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { setSelectedDocIds, executeQuery } = useTabStore()

  const ids = activeTab?.selectedDocIds ?? []
  if (ids.length === 0) return null

  async function deleteSelected() {
    if (!activeTab) return
    if (!window.confirm(`Delete ${ids.length} document(s)? This cannot be undone.`)) return
    await trpc.mutation.deleteMany.mutate({
      database: activeTab.database,
      collection: activeTab.collection,
      filter: { _id: { $in: ids } }
    })
    setSelectedDocIds([])
    executeQuery()
  }

  function exportSelected() {
    if (!activeTab?.results) return
    const idSet = new Set(ids.map(String))
    const docs = activeTab.results.documents.filter((d) => idSet.has(String(d._id)))
    const blob = new Blob([JSON.stringify(docs, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeTab.collection}-${ids.length}docs.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
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
  )
}
