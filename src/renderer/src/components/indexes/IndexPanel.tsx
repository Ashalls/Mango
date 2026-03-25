import { useState, useEffect, useCallback } from 'react'
import { Plus, RefreshCw, Trash2, Loader2, Pencil } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { trpc } from '@renderer/lib/trpc'
import { CreateIndexDialog, type EditIndexInfo } from './CreateIndexDialog'

interface IndexInfo {
  name: string
  key: Record<string, number | string>
  unique?: boolean
  sparse?: boolean
  expireAfterSeconds?: number
  [k: string]: unknown
}

type IndexType = 'Default' | 'Unique' | 'Compound' | 'Text' | '2dsphere' | 'TTL'

const typeBadgeColors: Record<IndexType, string> = {
  Default: 'bg-zinc-700 text-zinc-200',
  Unique: 'bg-orange-900/60 text-orange-300',
  Compound: 'bg-blue-900/60 text-blue-300',
  Text: 'bg-green-900/60 text-green-300',
  '2dsphere': 'bg-purple-900/60 text-purple-300',
  TTL: 'bg-yellow-900/60 text-yellow-300'
}

function detectType(idx: IndexInfo): IndexType {
  if (idx.expireAfterSeconds !== undefined) return 'TTL'
  if (idx.unique) return 'Unique'
  const values = Object.values(idx.key)
  if (values.some((v) => v === 'text')) return 'Text'
  if (values.some((v) => v === '2dsphere')) return '2dsphere'
  if (values.length > 1) return 'Compound'
  return 'Default'
}

function formatDirection(v: number | string): string {
  if (v === 1) return '1'
  if (v === -1) return '-1'
  return String(v)
}

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function IndexPanel() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [indexes, setIndexes] = useState<IndexInfo[]>([])
  const [stats, setStats] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<EditIndexInfo | undefined>(undefined)

  const database = activeTab?.database ?? ''
  const collection = activeTab?.collection ?? ''

  const fetchIndexes = useCallback(async () => {
    if (!database || !collection) return
    setLoading(true)
    try {
      const result = await trpc.admin.listIndexes.query({ database, collection })
      setIndexes(result as IndexInfo[])

      // Stats may not be available on all servers
      try {
        const statsResult = await trpc.admin.indexStats.query({ database, collection })
        const map = new Map<string, number>()
        for (const s of statsResult) {
          const name = s.name as string
          const accesses = s.accesses as { ops?: number } | undefined
          if (name && accesses?.ops !== undefined) {
            map.set(name, accesses.ops)
          }
        }
        setStats(map)
      } catch {
        setStats(new Map())
      }
    } catch (err) {
      console.error('Failed to fetch indexes:', err)
      setIndexes([])
    } finally {
      setLoading(false)
    }
  }, [database, collection])

  useEffect(() => {
    fetchIndexes()
  }, [fetchIndexes])

  const handleDrop = async (indexName: string) => {
    if (!window.confirm(`Drop index "${indexName}"? This action cannot be undone.`)) return
    try {
      await trpc.admin.dropIndex.mutate({ database, collection, indexName })
      await fetchIndexes()
    } catch (err) {
      console.error('Failed to drop index:', err)
    }
  }

  if (!activeTab) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Select a collection to view indexes
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium text-foreground">
          Indexes
          {!loading && (
            <span className="ml-2 text-xs text-muted-foreground">({indexes.length})</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={fetchIndexes} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Create Index
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : indexes.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            No indexes found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Fields</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2 font-medium">Usage</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((idx) => {
                const idxType = detectType(idx)
                const size = (idx as Record<string, unknown>).size as number | undefined
                const usage = stats.get(idx.name)
                return (
                  <tr
                    key={idx.name}
                    className="border-b border-border/50 hover:bg-accent/30"
                  >
                    <td className="px-4 py-2 font-mono text-xs">{idx.name}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(idx.key).map(([field, dir]) => (
                          <span
                            key={field}
                            className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 font-mono text-xs"
                          >
                            {field}: {formatDirection(dir)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${typeBadgeColors[idxType]}`}
                      >
                        {idxType}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatSize(size)}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {usage !== undefined ? usage.toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
                          onClick={() => {
                            setEditingIndex({
                              name: idx.name,
                              key: idx.key,
                              unique: idx.unique,
                              sparse: idx.sparse,
                              expireAfterSeconds: idx.expireAfterSeconds
                            })
                            setCreateDialogOpen(true)
                          }}
                          disabled={idx.name === '_id_'}
                          title={idx.name === '_id_' ? 'Cannot edit the _id index' : `Edit ${idx.name}`}
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleDrop(idx.name)}
                          disabled={idx.name === '_id_'}
                          title={idx.name === '_id_' ? 'Cannot drop the _id index' : `Drop ${idx.name}`}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          Drop
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create dialog */}
      <CreateIndexDialog
        open={createDialogOpen}
        onOpenChange={(o) => {
          setCreateDialogOpen(o)
          if (!o) setEditingIndex(undefined)
        }}
        database={database}
        collection={collection}
        onCreated={fetchIndexes}
        editIndex={editingIndex}
      />
    </div>
  )
}
