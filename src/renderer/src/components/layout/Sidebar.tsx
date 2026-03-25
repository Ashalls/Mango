import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Plug, PlugZap, ShieldAlert, Copy, ClipboardPaste, Pencil, Trash2, Database, Bot, MessageSquare, Upload } from 'lucide-react'
import { PasteDatabaseDialog, type PasteDatabaseResult } from '@renderer/components/explorer/PasteDatabaseDialog'
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
  const [clipboard, setClipboard] = useState<{
    connectionId: string
    database: string
  } | null>(null)
  const [pasteTarget, setPasteTarget] = useState<string | null>(null) // target connection ID
  const [importDump, setImportDump] = useState<{
    connectionId: string
    importDir: string
    detectedName: string
    collections: string[]
  } | null>(null)

  const { profiles, activeConnection, connectedIds, loadProfiles, connect, disconnect, setActive } =
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

  const activeProfile = profiles.find((p) => p.id === activeConnection?.profileId)

  const handleCopyDatabase = (connectionId: string, database: string) => {
    setClipboard({ connectionId, database })
  }

  const handlePasteDatabase = (targetConnectionId: string) => {
    if (!clipboard) return
    const targetProfile = profiles.find((p) => p.id === targetConnectionId)
    if (targetProfile?.isProduction) {
      alert('Cannot paste into a production connection. Production connections are protected from mass write operations.')
      return
    }
    setPasteTarget(targetConnectionId)
  }

  const handlePasteSubmit = async (result: PasteDatabaseResult) => {
    if (!clipboard || !pasteTarget) return
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
        {profiles.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No connections yet.
            <br />
            Click + to add one.
          </p>
        ) : (
          <div className="space-y-1">
            {profiles.map((profile) => {
              const isThisConnected = connectedIds.includes(profile.id)
              const isThisActive = activeConnection?.profileId === profile.id

              return (
                <ContextMenu.Root key={profile.id}>
                  <ContextMenu.Trigger asChild>
                    <div>
                      {/* Connection header */}
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
                            canPaste={clipboard !== null}
                            onPasteDatabase={() => handlePasteDatabase(profile.id)}
                            isProduction={profile.isProduction}
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
                                delete overrides[dbName] // Remove override, inherit from connection
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
                      {isThisConnected && !profile.isProduction && (
                        <ContextMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
                          onSelect={() => setShowCreateDb(profile.id)}
                        >
                          <Database className="h-3.5 w-3.5" />
                          Create Database
                        </ContextMenu.Item>
                      )}
                      {isThisConnected && !profile.isProduction && (
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
                      {clipboard && isThisConnected && (
                        <>
                          <ContextMenu.Separator className="my-1 h-px bg-border" />
                          <ContextMenu.Item
                            className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent ${
                              profile.isProduction ? 'text-muted-foreground' : ''
                            }`}
                            onSelect={() => handlePasteDatabase(profile.id)}
                            disabled={profile.isProduction}
                          >
                            <ClipboardPaste className="h-3.5 w-3.5" />
                            Paste "{clipboard.database}"
                            {profile.isProduction && ' (blocked)'}
                          </ContextMenu.Item>
                        </>
                      )}
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              )
            })}
          </div>
        )}

        {clipboard && (
          <div className="mt-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-2 py-1.5 text-[10px] text-primary">
            Copied: {clipboard.database}
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

      {pasteTarget && clipboard && (() => {
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
                  dropTarget: result.dropTarget
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
