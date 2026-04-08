import { useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw, Plug, PlugZap, ShieldAlert, ClipboardPaste, Pencil, Trash2, Database, Bot, MessageSquare, Upload, FolderClosed, FolderOpen, FolderPlus } from 'lucide-react'
import { PasteDatabaseDialog, type PasteDatabaseResult } from '@renderer/components/explorer/PasteDatabaseDialog'
import { PasteCollectionDialog, type PasteCollectionResult } from '@renderer/components/explorer/PasteCollectionDialog'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { DatabaseTree } from '@renderer/components/explorer/DatabaseTree'
import { ConnectionDialog } from '@renderer/components/explorer/ConnectionDialog'
import { InputDialog } from '@renderer/components/ui/input-dialog'
import { useConnectionStore } from '@renderer/store/connectionStore'
import { useExplorerStore } from '@renderer/store/explorerStore'
import { useTabStore } from '@renderer/store/tabStore'
import { trpc } from '@renderer/lib/trpc'
import type { ConnectionProfile } from '@shared/types'

export function Sidebar() {
  const [version, setVersion] = useState('')
  const [showConnectionDialog, setShowConnectionDialog] = useState(false)
  const [editProfile, setEditProfile] = useState<ConnectionProfile | null>(null)
  const [showCreateDb, setShowCreateDb] = useState<string | null>(null) // connection ID
  const [search, setSearch] = useState('')
  const [clipboard, setClipboard] = useState<
    | { type: 'database'; connectionId: string; database: string }
    | { type: 'collection'; connectionId: string; database: string; collection: string }
    | null
  >(null)
  const [pasteTarget, setPasteTarget] = useState<string | null>(null) // target connection ID
  const [pasteCollectionTarget, setPasteCollectionTarget] = useState<{
    connectionId: string
    database: string
  } | null>(null)
  const [importDump, setImportDump] = useState<{
    connectionId: string
    importDir: string
    detectedName: string
    collections: string[]
  } | null>(null)

  // Folder state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [newFolderName, setNewFolderName] = useState<string | null>(null)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renamingFolderName, setRenamingFolderName] = useState('')
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  const renameFolderInputRef = useRef<HTMLInputElement>(null)

  const { profiles, activeConnection, connectedIds, loadProfiles, connect, disconnect, setActive, folders, saveFolder, deleteFolder } =
    useConnectionStore()
  const { databases, loadDatabases, clear } = useExplorerStore()
  const isConnected = activeConnection?.status === 'connected'

  useEffect(() => {
    loadProfiles()
  }, [])

  useEffect(() => {
    window.electron?.ipcRenderer.invoke('app:getVersion').then((v: string) => setVersion(v))
  }, [])

  useEffect(() => {
    if (isConnected) {
      loadDatabases()
    } else {
      clear()
    }
  }, [isConnected, activeConnection?.profileId])

  // Auto-focus new folder input when shown
  useEffect(() => {
    if (newFolderName !== null) {
      setTimeout(() => newFolderInputRef.current?.focus(), 0)
    }
  }, [newFolderName])

  useEffect(() => {
    if (renamingFolderId !== null) {
      setTimeout(() => renameFolderInputRef.current?.focus(), 0)
    }
  }, [renamingFolderId])

  // Group profiles by folder
  const sortedFolders = [...folders].sort((a, b) => a.order - b.order)
  const folderedProfiles = sortedFolders.reduce<Record<string, ConnectionProfile[]>>((acc, folder) => {
    acc[folder.id] = profiles.filter((p) => p.folderId === folder.id)
    return acc
  }, {})
  const unfolderedProfiles = profiles.filter((p) => !p.folderId)

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreateFolder = async () => {
    const name = newFolderName?.trim()
    if (!name) {
      setNewFolderName(null)
      return
    }
    const order = folders.length
    await saveFolder(name, order)
    setNewFolderName(null)
  }

  const handleRenameFolder = async (id: string) => {
    const name = renamingFolderName.trim()
    if (name) {
      const folder = folders.find((f) => f.id === id)
      await saveFolder(name, folder?.order ?? 0, id)
    }
    setRenamingFolderId(null)
    setRenamingFolderName('')
  }

  const handleMoveToFolder = async (profile: ConnectionProfile, folderId: string | undefined) => {
    await useConnectionStore.getState().saveProfile({ ...profile, folderId })
  }

  const handleCopyDatabase = (connectionId: string, database: string) => {
    setClipboard({ type: 'database', connectionId, database })
  }

  const handleCopyCollection = (connectionId: string, database: string, collection: string) => {
    setClipboard({ type: 'collection', connectionId, database, collection })
  }

  const handlePasteCollection = async (targetConnectionId: string, targetDatabase: string) => {
    if (!clipboard || clipboard.type !== 'collection') return
    const targetProfile = profiles.find((p) => p.id === targetConnectionId)
    if (targetProfile?.isProduction) {
      alert('Cannot paste into a production connection. Production connections are protected from mass write operations.')
      return
    }
    if (targetProfile?.isReadOnly) {
      alert('Cannot paste into a read-only connection. Disable Read Only in connection settings to allow writes.')
      return
    }
    // Ensure we have the target database's collection list cached (for the overwrite dropdown)
    const colKey = `${targetConnectionId}:${targetDatabase}`
    const { collections, loadCollections } = useExplorerStore.getState()
    if (!collections[colKey]) {
      try {
        await loadCollections(targetDatabase, targetConnectionId)
      } catch (err) {
        alert(`Failed to load collections for ${targetDatabase}: ${err instanceof Error ? err.message : err}`)
        return
      }
    }
    setPasteCollectionTarget({ connectionId: targetConnectionId, database: targetDatabase })
  }

  const handlePasteDatabase = (targetConnectionId: string) => {
    if (!clipboard || clipboard.type !== 'database') return
    const targetProfile = profiles.find((p) => p.id === targetConnectionId)
    if (targetProfile?.isProduction) {
      alert('Cannot paste into a production connection. Production connections are protected from mass write operations.')
      return
    }
    if (targetProfile?.isReadOnly) {
      alert('Cannot paste into a read-only connection. Disable Read Only in connection settings to allow writes.')
      return
    }
    setPasteTarget(targetConnectionId)
  }

  const handlePasteSubmit = async (result: PasteDatabaseResult) => {
    if (!clipboard || clipboard.type !== 'database' || !pasteTarget) return
    try {
      await trpc.migration.copyDatabase.mutate({
        sourceConnectionId: clipboard.connectionId,
        sourceDatabase: clipboard.database,
        targetConnectionId: pasteTarget,
        targetDatabase: result.targetDatabase,
        dropTarget: result.dropTarget
      })
      loadDatabases()
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setPasteTarget(null)
    }
  }

  const handlePasteCollectionSubmit = async (result: PasteCollectionResult) => {
    if (!clipboard || clipboard.type !== 'collection' || !pasteCollectionTarget) return
    try {
      await trpc.migration.copyCollection.mutate({
        sourceConnectionId: clipboard.connectionId,
        sourceDatabase: clipboard.database,
        sourceCollection: clipboard.collection,
        targetConnectionId: pasteCollectionTarget.connectionId,
        targetDatabase: pasteCollectionTarget.database,
        targetCollection: result.targetCollection,
        dropTarget: result.dropTarget
      })
      // Refresh the target database's collection list
      await useExplorerStore
        .getState()
        .loadCollections(pasteCollectionTarget.database, pasteCollectionTarget.connectionId)
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setPasteCollectionTarget(null)
    }
  }

  const renderConnection = (profile: ConnectionProfile) => {
    const isThisConnected = connectedIds.includes(profile.id)
    const isThisActive = activeConnection?.profileId === profile.id

    return (
      <ContextMenu.Root key={profile.id}>
        <ContextMenu.Trigger asChild>
          <div>
            {/* Connection button */}
            <button
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent ${
                isThisActive ? 'bg-sidebar-accent' : ''
              }`}
              onClick={() => {
                if (isThisConnected) {
                  setActive(profile.id)
                } else {
                  connect(profile.id)
                }
              }}
            >
              {isThisConnected ? (
                <PlugZap className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Plug className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: profile.color || '#6b7280' }}
              />
              <span className="flex-1 truncate">{profile.name}</span>
              {(profile.claudeAccess === 'readwrite' || (!profile.claudeAccess && !profile.isProduction)) && isThisConnected && (
                <Bot className="h-3 w-3 text-red-400" title="Claude: readwrite" />
              )}
              {profile.isProduction && (
                <ShieldAlert className="h-3.5 w-3.5 text-red-400" title="Production" />
              )}
            </button>

            {/* Show database tree if this is the active connection */}
            {isThisActive && isConnected && (
              <div className="ml-2">
                <DatabaseTree
                  databases={databases}
                  searchFilter={search}
                  connectionId={profile.id}
                  onCopyDatabase={(db) => handleCopyDatabase(profile.id, db)}
                  canPaste={clipboard?.type === 'database'}
                  onPasteDatabase={() => handlePasteDatabase(profile.id)}
                  onCopyCollection={(db, col) => handleCopyCollection(profile.id, db, col)}
                  canPasteCollection={clipboard?.type === 'collection'}
                  onPasteCollection={(db) => handlePasteCollection(profile.id, db)}
                  isProduction={profile.isProduction}
                  isReadOnly={profile.isReadOnly}
                  connectionName={profile.name}
                  claudeAccess={profile.claudeAccess}
                  claudeDbOverrides={profile.claudeDbOverrides}
                  databaseCodebasePaths={profile.databaseCodebasePaths}
                  onSetDbCodebasePath={async (dbName) => {
                    const current = profile.databaseCodebasePaths?.[dbName] || ''
                    const result = await trpc.settings.pickFolder.mutate({
                      title: `Select codebase folder for "${dbName}"`,
                      defaultPath: current || undefined
                    })
                    if (result.canceled) return
                    const paths = { ...(profile.databaseCodebasePaths || {}) }
                    if (result.path) {
                      paths[dbName] = result.path
                    } else {
                      delete paths[dbName]
                    }
                    await useConnectionStore.getState().saveProfile({
                      ...profile,
                      databaseCodebasePaths: paths
                    })
                  }}
                  onClearDbCodebasePath={async (dbName) => {
                    const paths = { ...(profile.databaseCodebasePaths || {}) }
                    delete paths[dbName]
                    await useConnectionStore.getState().saveProfile({
                      ...profile,
                      databaseCodebasePaths: paths
                    })
                  }}
                  onToggleDbClaude={async (dbName) => {
                    const defaultAccess = profile.claudeAccess || (profile.isProduction ? 'readonly' : 'readwrite')
                    const overrides = { ...(profile.claudeDbOverrides || {}) }
                    const current = overrides[dbName] || defaultAccess
                    const next = current === 'readonly' ? 'readwrite' : 'readonly'
                    if (next === defaultAccess) {
                      delete overrides[dbName]
                    } else {
                      overrides[dbName] = next
                    }
                    await useConnectionStore.getState().saveProfile({
                      ...profile,
                      claudeDbOverrides: overrides
                    })
                  }}
                />
              </div>
            )}
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="min-w-[180px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
            {isThisConnected ? (
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                onSelect={() => disconnect(profile.id)}
              >
                <Plug className="h-3.5 w-3.5" />
                Disconnect
              </ContextMenu.Item>
            ) : (
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                onSelect={() => connect(profile.id)}
              >
                <PlugZap className="h-3.5 w-3.5" />
                Connect
              </ContextMenu.Item>
            )}
            {isThisConnected && !profile.isProduction && !profile.isReadOnly && (
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                onSelect={() => setShowCreateDb(profile.id)}
              >
                <Database className="h-3.5 w-3.5" />
                Create Database
              </ContextMenu.Item>
            )}
            {isThisConnected && !profile.isProduction && !profile.isReadOnly && (
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                onSelect={async () => {
                  try {
                    const result = await trpc.exportImport.pickDumpFolder.mutate()
                    if (result) {
                      setImportDump({
                        connectionId: profile.id,
                        importDir: result.importDir,
                        detectedName: result.detectedName,
                        collections: result.collections
                      })
                    }
                  } catch (err) {
                    alert(`Failed: ${err instanceof Error ? err.message : err}`)
                  }
                }}
              >
                <Upload className="h-3.5 w-3.5" />
                Import Database from Dump
              </ContextMenu.Item>
            )}
            {isThisConnected && (
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                onSelect={() => useTabStore.getState().openConnectionTab(profile.id, profile.name)}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Chat with Claude...
              </ContextMenu.Item>
            )}
            {isThisConnected && (
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                onSelect={async () => {
                  const current = profile.claudeAccess || (profile.isProduction ? 'readonly' : 'readwrite')
                  const next = current === 'readonly' ? 'readwrite' : 'readonly'
                  await useConnectionStore.getState().saveProfile({ ...profile, claudeAccess: next })
                  alert(`Claude access for "${profile.name}" set to ${next}`)
                }}
              >
                <Bot className="h-3.5 w-3.5" />
                Claude: {(profile.claudeAccess || (profile.isProduction ? 'readonly' : 'readwrite')) === 'readonly' ? 'Enable Write' : 'Set Read-Only'}
              </ContextMenu.Item>
            )}
            <ContextMenu.Separator className="my-1 h-px bg-border" />
            <ContextMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
              onSelect={() => setEditProfile(profile)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Connection
            </ContextMenu.Item>
            <ContextMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-destructive outline-none hover:bg-destructive/10"
              onSelect={async () => {
                if (!confirm(`Delete connection "${profile.name}"?`)) return
                if (isThisConnected) await disconnect(profile.id)
                await useConnectionStore.getState().deleteProfile(profile.id)
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Connection
            </ContextMenu.Item>
            {/* Move to Folder submenu */}
            {folders.length > 0 && (
              <>
                <ContextMenu.Separator className="my-1 h-px bg-border" />
                <ContextMenu.Sub>
                  <ContextMenu.SubTrigger className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent">
                    <FolderClosed className="h-3.5 w-3.5" />
                    Move to Folder
                  </ContextMenu.SubTrigger>
                  <ContextMenu.Portal>
                    <ContextMenu.SubContent className="min-w-[140px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
                      <ContextMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                        onSelect={() => handleMoveToFolder(profile, undefined)}
                      >
                        None
                      </ContextMenu.Item>
                      <ContextMenu.Separator className="my-1 h-px bg-border" />
                      {sortedFolders.map((folder) => (
                        <ContextMenu.Item
                          key={folder.id}
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                          onSelect={() => handleMoveToFolder(profile, folder.id)}
                        >
                          <FolderClosed className="h-3.5 w-3.5 text-amber-400" />
                          {folder.name}
                        </ContextMenu.Item>
                      ))}
                    </ContextMenu.SubContent>
                  </ContextMenu.Portal>
                </ContextMenu.Sub>
              </>
            )}
            {clipboard?.type === 'database' && isThisConnected && (
              <>
                <ContextMenu.Separator className="my-1 h-px bg-border" />
                <ContextMenu.Item
                  className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent ${
                    profile.isProduction || profile.isReadOnly ? 'text-muted-foreground' : ''
                  }`}
                  onSelect={() => handlePasteDatabase(profile.id)}
                  disabled={profile.isProduction || profile.isReadOnly}
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  Paste "{clipboard.database}"
                  {profile.isProduction && ' (blocked)'}
                  {!profile.isProduction && profile.isReadOnly && ' (read-only)'}
                </ContextMenu.Item>
              </>
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sidebar-border p-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Explorer
        </span>
        <div className="flex gap-1">
          {isConnected && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={loadDatabases}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="New Folder"
            onClick={() => setNewFolderName('')}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="New Connection"
            onClick={() => setShowConnectionDialog(true)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="p-2">
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs"
        />
      </div>

      {/* Connection list + trees */}
      <ScrollArea className="flex-1 px-2">
        {profiles.length === 0 && folders.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No connections yet.
            <br />
            Click + to add one.
          </p>
        ) : (
          <div className="space-y-1">
            {/* New folder inline input */}
            {newFolderName !== null && (
              <div className="flex items-center gap-1 px-1 py-0.5">
                <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={newFolderInputRef}
                  className="h-6 flex-1 rounded border border-border bg-background px-1 text-xs outline-none focus:border-primary"
                  placeholder="Folder name..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateFolder()
                    if (e.key === 'Escape') setNewFolderName(null)
                  }}
                  onBlur={handleCreateFolder}
                />
              </div>
            )}

            {/* Folders with their connections */}
            {sortedFolders.map((folder) => {
              const isExpanded = expandedFolders.has(folder.id)
              const folderConns = folderedProfiles[folder.id] ?? []

              return (
                <div key={folder.id}>
                  {/* Folder header */}
                  <ContextMenu.Root>
                    <ContextMenu.Trigger asChild>
                      <button
                        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                        onClick={() => toggleFolder(folder.id)}
                      >
                        {isExpanded ? (
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        ) : (
                          <FolderClosed className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        )}
                        {renamingFolderId === folder.id ? (
                          <input
                            ref={renameFolderInputRef}
                            className="h-5 flex-1 rounded border border-border bg-background px-1 text-xs outline-none focus:border-primary"
                            value={renamingFolderName}
                            onChange={(e) => setRenamingFolderName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (e.key === 'Enter') handleRenameFolder(folder.id)
                              if (e.key === 'Escape') {
                                setRenamingFolderId(null)
                                setRenamingFolderName('')
                              }
                            }}
                            onBlur={() => handleRenameFolder(folder.id)}
                          />
                        ) : (
                          <span className="flex-1 truncate">{folder.name}</span>
                        )}
                        <span className="rounded px-1 text-[10px] text-muted-foreground">
                          {folderConns.length}
                        </span>
                      </button>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content className="min-w-[160px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
                        <ContextMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                          onSelect={() => {
                            setRenamingFolderId(folder.id)
                            setRenamingFolderName(folder.name)
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Rename Folder
                        </ContextMenu.Item>
                        <ContextMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-destructive outline-none hover:bg-destructive/10"
                          onSelect={async () => {
                            if (!confirm(`Delete folder "${folder.name}"? Connections will be moved to root.`)) return
                            await deleteFolder(folder.id)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete Folder
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>

                  {/* Folder's connections (when expanded) */}
                  {isExpanded && (
                    <div className="pl-3 space-y-0.5">
                      {folderConns.map((profile) => renderConnection(profile))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Ungrouped connections */}
            {unfolderedProfiles.map((profile) => renderConnection(profile))}
          </div>
        )}

        {clipboard && (
          <div className="mt-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-2 py-1.5 text-[10px] text-primary">
            Copied:{' '}
            {clipboard.type === 'database'
              ? clipboard.database
              : `${clipboard.database}.${clipboard.collection}`}
          </div>
        )}
      </ScrollArea>

      {(showConnectionDialog || editProfile) && (
        <ConnectionDialog
          onClose={() => {
            setShowConnectionDialog(false)
            setEditProfile(null)
          }}
          editProfile={editProfile || undefined}
        />
      )}

      {showCreateDb && (
        <InputDialog
          title="Create Database"
          fields={[
            { key: 'database', label: 'Database Name', placeholder: 'my_database' },
            { key: 'collection', label: 'Initial Collection', placeholder: 'default', defaultValue: 'default' }
          ]}
          submitLabel="Create"
          onCancel={() => setShowCreateDb(null)}
          onSubmit={async (values) => {
            try {
              await trpc.admin.createCollection.mutate({
                database: values.database,
                collection: values.collection
              })
              setShowCreateDb(null)
              loadDatabases()
            } catch (err) {
              alert(`Failed: ${err instanceof Error ? err.message : err}`)
            }
          }}
        />
      )}

      {pasteTarget && clipboard?.type === 'database' && (() => {
        const targetProfile = profiles.find((p) => p.id === pasteTarget)
        const sourceProfile = profiles.find((p) => p.id === clipboard.connectionId)
        const isSameConnection = clipboard.connectionId === pasteTarget
        const existingDbNames = databases.map((d) => d.name)
        return (
          <PasteDatabaseDialog
            sourceName={clipboard.database}
            sourceConnection={sourceProfile?.name || 'Unknown'}
            targetConnection={targetProfile?.name || 'Unknown'}
            existingDatabases={existingDbNames}
            isSameConnection={isSameConnection}
            onSubmit={handlePasteSubmit}
            onCancel={() => setPasteTarget(null)}
          />
        )
      })()}

      {pasteCollectionTarget && clipboard?.type === 'collection' && (() => {
        const targetProfile = profiles.find((p) => p.id === pasteCollectionTarget.connectionId)
        const sourceProfile = profiles.find((p) => p.id === clipboard.connectionId)
        const isSameLocation =
          clipboard.connectionId === pasteCollectionTarget.connectionId &&
          clipboard.database === pasteCollectionTarget.database
        const colKey = `${pasteCollectionTarget.connectionId}:${pasteCollectionTarget.database}`
        // Non-reactive read: handlePasteCollection preloads collections into the store
        // before setting pasteCollectionTarget, so the snapshot is always populated by
        // the time this block renders. The dialog captures the list on mount.
        const existingCols =
          useExplorerStore.getState().collections[colKey]?.map((c) => c.name) ?? []
        return (
          <PasteCollectionDialog
            sourceCollection={clipboard.collection}
            sourceDatabase={clipboard.database}
            sourceConnection={sourceProfile?.name || 'Unknown'}
            targetDatabase={pasteCollectionTarget.database}
            targetConnection={targetProfile?.name || 'Unknown'}
            existingCollections={existingCols}
            isSameLocation={isSameLocation}
            onSubmit={handlePasteCollectionSubmit}
            onCancel={() => setPasteCollectionTarget(null)}
          />
        )
      })()}

      {importDump && (() => {
        const targetProfile = profiles.find((p) => p.id === importDump.connectionId)
        const existingDbNames = databases.map((d) => d.name)
        return (
          <PasteDatabaseDialog
            sourceName={importDump.detectedName}
            sourceConnection="Dump file"
            targetConnection={targetProfile?.name || 'Unknown'}
            existingDatabases={existingDbNames}
            isSameConnection={false}
            previewCollections={importDump.collections}
            variant="import"
            onSubmit={async (result) => {
              setImportDump(null)
              try {
                await trpc.exportImport.importDatabaseFromDump.mutate({
                  connectionId: importDump.connectionId,
                  importDir: importDump.importDir,
                  targetDatabase: result.targetDatabase,
                  dropTarget: result.dropTarget,
                  collections: result.collections
                })
                loadDatabases()
              } catch (err) {
                alert(`Import failed: ${err instanceof Error ? err.message : err}`)
              }
            }}
            onCancel={() => setImportDump(null)}
          />
        )
      })()}

      <div className="mt-auto border-t border-border px-3 py-2">
        <span className="text-[10px] text-muted-foreground">Mango {version ? `v${version}` : ''}</span>
      </div>
    </div>
  )
}
