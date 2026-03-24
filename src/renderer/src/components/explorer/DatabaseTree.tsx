import { useState } from 'react'
import { ChevronRight, Database, Table2, Plus, Trash2, Loader2, Copy, ClipboardPaste, Eye, Download, Upload, Bot, FileUp, FolderOpen, X, MessageSquare } from 'lucide-react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { cn } from '@renderer/lib/utils'
import { useExplorerStore } from '@renderer/store/explorerStore'
import { useTabStore } from '@renderer/store/tabStore'
import { trpc } from '@renderer/lib/trpc'
import type { DatabaseInfo } from '@shared/types'
import { InsertDocumentsDialog } from '@renderer/components/data/InsertDocumentsDialog'

interface DatabaseTreeProps {
  databases: DatabaseInfo[]
  searchFilter: string
  connectionId: string
  onCopyDatabase?: (dbName: string) => void
  canPaste?: boolean
  onPasteDatabase?: () => void
  isProduction?: boolean
  claudeAccess?: 'readonly' | 'readwrite'
  claudeDbOverrides?: Record<string, 'readonly' | 'readwrite'>
  onToggleDbClaude?: (dbName: string) => void
  databaseCodebasePaths?: Record<string, string>
  onSetDbCodebasePath?: (dbName: string) => void
  onClearDbCodebasePath?: (dbName: string) => void
}

export function DatabaseTree({ databases, searchFilter, connectionId, onCopyDatabase, canPaste, onPasteDatabase, isProduction, claudeAccess, claudeDbOverrides, onToggleDbClaude, databaseCodebasePaths, onSetDbCodebasePath, onClearDbCodebasePath }: DatabaseTreeProps) {
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set())
  const [loadingDbs, setLoadingDbs] = useState<Set<string>>(new Set())
  const [newCollName, setNewCollName] = useState<{ db: string } | null>(null)
  const [newCollInput, setNewCollInput] = useState('')
  const [insertTarget, setInsertTarget] = useState<{ db: string; col: string } | null>(null)
  const {
    collections,
    selectedDatabase,
    selectedCollection,
    loadCollections,
    loadDatabases
  } = useExplorerStore()
  const openTab = useTabStore((s) => s.openTab)
  const openDatabaseTab = useTabStore((s) => s.openDatabaseTab)
  const activeTabId = useTabStore((s) => s.activeTabId)

  const filteredDatabases = searchFilter
    ? databases.filter(
        (db) =>
          db.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
          collections[db.name]?.some((c) =>
            c.name.toLowerCase().includes(searchFilter.toLowerCase())
          )
      )
    : databases

  const toggleDb = async (dbName: string) => {
    const next = new Set(expandedDbs)
    if (next.has(dbName)) {
      next.delete(dbName)
    } else {
      next.add(dbName)
      if (!collections[dbName]) {
        setLoadingDbs((prev) => new Set(prev).add(dbName))
        try {
          await loadCollections(dbName)
        } catch (err) {
          console.error(`Failed to load collections for ${dbName}:`, err)
        } finally {
          setLoadingDbs((prev) => {
            const s = new Set(prev)
            s.delete(dbName)
            return s
          })
        }
      }
    }
    setExpandedDbs(next)
  }

  const handleCollectionClick = (dbName: string, colName: string, isView: boolean = false) => {
    openTab(connectionId, dbName, colName, isView)
  }

  const handleDropDatabase = async (dbName: string) => {
    if (!confirm(`Drop database "${dbName}"? This cannot be undone.`)) return
    try {
      await trpc.admin.dropDatabase.mutate({ database: dbName })
      await loadDatabases()
    } catch (err) {
      alert(`Failed to drop database: ${err instanceof Error ? err.message : err}`)
    }
  }

  const handleDropCollection = async (dbName: string, colName: string) => {
    if (!confirm(`Drop collection "${dbName}.${colName}"? This cannot be undone.`)) return
    try {
      await trpc.admin.dropCollection.mutate({ database: dbName, collection: colName })
      await loadCollections(dbName)
    } catch (err) {
      alert(`Failed to drop collection: ${err instanceof Error ? err.message : err}`)
    }
  }

  const handleCreateCollection = async (dbName: string) => {
    if (!newCollInput.trim()) return
    try {
      await trpc.admin.createCollection.mutate({
        database: dbName,
        collection: newCollInput.trim()
      })
      setNewCollName(null)
      setNewCollInput('')
      await loadCollections(dbName)
    } catch (err) {
      alert(`Failed to create collection: ${err instanceof Error ? err.message : err}`)
    }
  }

  return (
    <div className="space-y-0.5">
      {filteredDatabases.map((db) => (
        <div key={db.name}>
          {/* Database node with context menu */}
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <button
                className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-sm hover:bg-sidebar-accent"
                onClick={() => toggleDb(db.name)}
              >
                {loadingDbs.has(db.name) ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 transition-transform text-muted-foreground',
                      expandedDbs.has(db.name) && 'rotate-90'
                    )}
                  />
                )}
                <Database className="h-3.5 w-3.5 text-amber-400" />
                <span className="truncate">{db.name}</span>
                {databaseCodebasePaths?.[db.name] && (
                  <FolderOpen className="h-3 w-3 text-green-400 shrink-0" title={`Linked: ${databaseCodebasePaths[db.name]}`} />
                )}
                {(() => {
                  const dbOverride = claudeDbOverrides?.[db.name]
                  if (!dbOverride) return null
                  const defaultAccess = claudeAccess || (isProduction ? 'readonly' : 'readwrite')
                  if (dbOverride === defaultAccess) return null
                  return (
                    <Bot
                      className={`ml-auto h-3 w-3 shrink-0 ${dbOverride === 'readwrite' ? 'text-red-400' : 'text-amber-400'}`}
                      title={`Claude: ${dbOverride} (override)`}
                    />
                  )
                })()}
              </button>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="min-w-[160px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
                <ContextMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                  onSelect={() => {
                    setNewCollName({ db: db.name })
                    if (!expandedDbs.has(db.name)) toggleDb(db.name)
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Collection
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                  onSelect={() => openDatabaseTab(connectionId, db.name)}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Chat with Claude...
                </ContextMenu.Item>
                {onCopyDatabase && (
                  <ContextMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                    onSelect={() => onCopyDatabase(db.name)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy Database
                  </ContextMenu.Item>
                )}
                {canPaste && onPasteDatabase && !isProduction && (
                  <ContextMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                    onSelect={onPasteDatabase}
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    Paste Database Here
                  </ContextMenu.Item>
                )}
                {onToggleDbClaude && (
                  <>
                    <ContextMenu.Separator className="my-1 h-px bg-border" />
                    {(() => {
                      const defaultAccess = claudeAccess || (isProduction ? 'readonly' : 'readwrite')
                      const dbAccess = claudeDbOverrides?.[db.name] || defaultAccess
                      const isReadOnly = dbAccess === 'readonly'
                      return (
                        <ContextMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                          onSelect={() => onToggleDbClaude(db.name)}
                        >
                          <Bot className={`h-3.5 w-3.5 ${isReadOnly ? 'text-blue-400' : 'text-amber-400'}`} />
                          Claude: {isReadOnly ? 'Enable Write' : 'Set Read-Only'}
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {dbAccess === (claudeAccess || (isProduction ? 'readonly' : 'readwrite')) ? '(inherited)' : '(override)'}
                          </span>
                        </ContextMenu.Item>
                      )
                    })()}
                  </>
                )}
                {onSetDbCodebasePath && (
                  <>
                    <ContextMenu.Separator className="my-1 h-px bg-border" />
                    {databaseCodebasePaths?.[db.name] ? (
                      <>
                        {/* Show linked path */}
                        <div className="px-2 py-1.5 text-[10px] text-muted-foreground flex items-center gap-1.5">
                          <FolderOpen className="h-3 w-3 text-green-400 shrink-0" />
                          <span className="truncate" title={databaseCodebasePaths[db.name]}>
                            Linked: {databaseCodebasePaths[db.name]}
                          </span>
                        </div>
                        <ContextMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                          onSelect={() => onSetDbCodebasePath(db.name)}
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                          Relink Codebase...
                        </ContextMenu.Item>
                        {onClearDbCodebasePath && (
                          <ContextMenu.Item
                            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent text-red-400"
                            onSelect={() => onClearDbCodebasePath(db.name)}
                          >
                            <X className="h-3.5 w-3.5" />
                            Unlink Codebase
                          </ContextMenu.Item>
                        )}
                      </>
                    ) : (
                      <ContextMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                        onSelect={() => onSetDbCodebasePath(db.name)}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        Link Codebase...
                      </ContextMenu.Item>
                    )}
                  </>
                )}
                <ContextMenu.Separator className="my-1 h-px bg-border" />
                <ContextMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                  onSelect={async () => {
                    const result = await trpc.exportImport.exportDatabaseDump.mutate({
                      connectionId, database: db.name
                    })
                    if (result) alert(`Database exported to ${result.path}`)
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Database (dump)
                </ContextMenu.Item>
                {!isProduction && (
                  <ContextMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                    onSelect={async () => {
                      const drop = confirm('Drop existing collections before import?')
                      try {
                        const result = await trpc.exportImport.importDatabaseDump.mutate({
                          connectionId, database: db.name, dropExisting: drop
                        })
                        if (result) alert(`Imported ${result.collections} collections, ${result.documents} documents`)
                        loadCollections(db.name)
                      } catch (err) {
                        alert(`Import failed: ${err instanceof Error ? err.message : err}`)
                      }
                    }}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Import Database (from dump)
                  </ContextMenu.Item>
                )}
                <ContextMenu.Separator className="my-1 h-px bg-border" />
                <ContextMenu.Item
                  className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none ${
                    isProduction
                      ? 'text-muted-foreground'
                      : 'text-destructive hover:bg-destructive/10'
                  }`}
                  onSelect={() => {
                    if (isProduction) {
                      alert('Cannot drop a database on a production connection.')
                      return
                    }
                    handleDropDatabase(db.name)
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Drop Database {isProduction && '(blocked)'}
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>

          {/* Collections */}
          {expandedDbs.has(db.name) && (() => {
            const allItems = collections[db.name]
              ?.filter((c) => !searchFilter || c.name.toLowerCase().includes(searchFilter.toLowerCase()))
              .sort((a, b) => a.name.localeCompare(b.name)) ?? []
            const regularCollections = allItems.filter((c) => c.type !== 'view')
            const views = allItems.filter((c) => c.type === 'view')

            return (
            <div className="ml-4 space-y-0.5">
              {/* Collections */}
              {regularCollections.map((col) => (
                <ContextMenu.Root key={col.name}>
                  <ContextMenu.Trigger asChild>
                    <button
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-sidebar-accent',
                        activeTabId === `${connectionId}:${db.name}:${col.name}` &&
                          'bg-sidebar-accent text-sidebar-accent-foreground'
                      )}
                      onClick={() => handleCollectionClick(db.name, col.name)}
                    >
                      <Table2 className="h-3.5 w-3.5 text-blue-400" />
                      <span className="truncate">{col.name}</span>
                      {col.documentCount !== undefined && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {col.documentCount.toLocaleString()}
                        </span>
                      )}
                    </button>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="min-w-[160px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
                      <ContextMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                        onSelect={async () => {
                          const result = await trpc.exportImport.exportCollection.mutate({
                            database: db.name, collection: col.name, format: 'json'
                          })
                          if (result) alert(`Exported ${result.count} documents to ${result.path}`)
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export as JSON
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                        onSelect={async () => {
                          const result = await trpc.exportImport.exportCollection.mutate({
                            database: db.name, collection: col.name, format: 'csv'
                          })
                          if (result) alert(`Exported ${result.count} documents to ${result.path}`)
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export as CSV
                      </ContextMenu.Item>
                      {!isProduction && (
                        <ContextMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                          onSelect={async () => {
                            try {
                              const result = await trpc.exportImport.importCollection.mutate({
                                database: db.name, collection: col.name
                              })
                              if (result) alert(`Imported ${result.count} documents`)
                            } catch (err) {
                              alert(`Import failed: ${err instanceof Error ? err.message : err}`)
                            }
                          }}
                        >
                          <Upload className="h-3.5 w-3.5" />
                          Import JSON
                        </ContextMenu.Item>
                      )}
                      <ContextMenu.Separator className="my-1 h-px bg-border" />
                      <ContextMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                        onSelect={() => setInsertTarget({ db: db.name, col: col.name })}
                      >
                        <FileUp className="h-3.5 w-3.5" />
                        Insert Documents...
                      </ContextMenu.Item>
                      <ContextMenu.Separator className="my-1 h-px bg-border" />
                      <ContextMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-destructive outline-none hover:bg-destructive/10"
                        onSelect={() => handleDropCollection(db.name, col.name)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Drop Collection
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              ))}

              {/* Views section */}
              {views.length > 0 && (
                <>
                  <div className="mt-2 mb-0.5 flex items-center gap-1 px-1">
                    <Eye className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Views ({views.length})
                    </span>
                  </div>
                  {views.map((view) => (
                    <ContextMenu.Root key={view.name}>
                      <ContextMenu.Trigger asChild>
                        <button
                          className={cn(
                            'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-sidebar-accent',
                            activeTabId === `${connectionId}:${db.name}:${view.name}` &&
                              'bg-sidebar-accent text-sidebar-accent-foreground'
                          )}
                          onClick={() => handleCollectionClick(db.name, view.name, true)}
                        >
                          <Eye className="h-3.5 w-3.5 text-purple-400" />
                          <span className="truncate">{view.name}</span>
                          {view.viewOn && (
                            <span className="ml-auto truncate text-[10px] text-muted-foreground" title={`on ${view.viewOn}`}>
                              → {view.viewOn}
                            </span>
                          )}
                        </button>
                      </ContextMenu.Trigger>
                      <ContextMenu.Portal>
                        <ContextMenu.Content className="min-w-[160px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
                          {view.viewOn && (
                            <ContextMenu.Item
                              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                              onSelect={() => handleCollectionClick(db.name, view.viewOn!)}
                            >
                              <Table2 className="h-3.5 w-3.5" />
                              Open Source: {view.viewOn}
                            </ContextMenu.Item>
                          )}
                          <ContextMenu.Separator className="my-1 h-px bg-border" />
                          <ContextMenu.Item
                            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-destructive outline-none hover:bg-destructive/10"
                            onSelect={() => handleDropCollection(db.name, view.name)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Drop View
                          </ContextMenu.Item>
                        </ContextMenu.Content>
                      </ContextMenu.Portal>
                    </ContextMenu.Root>
                  ))}
                </>
              )}

              {/* New collection input */}
              {newCollName?.db === db.name && (
                <div className="ml-2 flex items-center gap-1">
                  <input
                    className="h-6 flex-1 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="collection name"
                    value={newCollInput}
                    onChange={(e) => setNewCollInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateCollection(db.name)
                      if (e.key === 'Escape') {
                        setNewCollName(null)
                        setNewCollInput('')
                      }
                    }}
                    autoFocus
                  />
                </div>
              )}

              {!collections[db.name]?.length && !loadingDbs.has(db.name) && (
                <p className="px-2 py-1 text-xs text-muted-foreground">No collections</p>
              )}
            </div>
            )
          })()}
        </div>
      ))}
      {insertTarget && (
        <InsertDocumentsDialog
          open={true}
          onOpenChange={(o) => { if (!o) setInsertTarget(null) }}
          database={insertTarget.db}
          collection={insertTarget.col}
          onInserted={() => {
            loadCollections(insertTarget.db)
          }}
        />
      )}
    </div>
  )
}
