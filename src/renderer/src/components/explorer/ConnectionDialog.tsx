import { useState } from 'react'
import { X, Eye, EyeOff, ShieldAlert, Lock } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { useConnectionStore } from '@renderer/store/connectionStore'
import { SSHForm, defaultSSH } from './SSHForm'
import { TLSForm, defaultTLS } from './TLSForm'
import type { SSHConfig, TLSConfig } from '@shared/types'

interface ConnectionDialogProps {
  onClose: () => void
  editProfile?: {
    id: string
    name: string
    uri: string
    color?: string
    isProduction?: boolean
    isReadOnly?: boolean
    claudeAccess?: 'readonly' | 'readwrite'
    sshConfig?: SSHConfig
    tlsConfig?: TLSConfig
  }
}

export function ConnectionDialog({ onClose, editProfile }: ConnectionDialogProps) {
  const [dialogTab, setDialogTab] = useState<'general' | 'ssh' | 'tls'>('general')
  const [name, setName] = useState(editProfile?.name || '')
  const [uri, setUri] = useState(editProfile?.uri || '')
  const [color, setColor] = useState(editProfile?.color || '#10b981')
  const [isProduction, setIsProduction] = useState(editProfile?.isProduction || false)
  const [isReadOnly, setIsReadOnly] = useState(editProfile?.isReadOnly || false)
  const [claudeAccess, setClaudeAccess] = useState<'readonly' | 'readwrite'>(
    editProfile?.claudeAccess || (editProfile?.isProduction ? 'readonly' : 'readwrite')
  )
  const [showUri, setShowUri] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sshConfig, setSSHConfig] = useState<SSHConfig>(editProfile?.sshConfig ?? defaultSSH)
  const [tlsConfig, setTLSConfig] = useState<TLSConfig>(editProfile?.tlsConfig ?? defaultTLS)
  const { saveProfile, connect } = useConnectionStore()

  const handleSave = async () => {
    if (!name.trim() || !uri.trim()) return
    setSaving(true)
    setError(null)
    try {
      await saveProfile({
        id: editProfile?.id,
        name: name.trim(),
        uri: uri.trim(),
        color,
        isProduction,
        isReadOnly,
        claudeAccess,
        sshConfig,
        tlsConfig
      })
      const profiles = useConnectionStore.getState().profiles
      const saved = profiles.find((p) => p.name === name.trim())
      if (saved) {
        await connect(saved.id)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save connection')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[480px] rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {editProfile ? 'Edit Connection' : 'New Connection'}
          </h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tab bar */}
        <div className="mb-4 flex border-b border-border">
          {(['general', 'ssh', 'tls'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                dialogTab === tab
                  ? 'border-b-2 border-emerald-500 text-emerald-400'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setDialogTab(tab)}
            >
              {tab === 'general' ? 'General' : tab === 'ssh' ? 'SSH' : 'TLS/SSL'}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {dialogTab === 'general' && (
            <>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Name</label>
                <Input
                  placeholder="e.g. Production, Local"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Connection URI</label>
                <div className="relative">
                  <Input
                    placeholder="mongodb://localhost:27017 or mongodb+srv://..."
                    value={uri}
                    onChange={(e) => setUri(e.target.value)}
                    type={showUri ? 'text' : 'password'}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowUri(!showUri)}
                  >
                    {showUri ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">Color</label>
                  <div className="flex gap-2">
                    {['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'].map(
                      (c) => (
                        <button
                          key={c}
                          className={`h-8 w-8 rounded-full border-2 ${
                            color === c ? 'border-white' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                          onClick={() => setColor(c)}
                        />
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* Production toggle */}
              <div
                className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 ${
                  isProduction ? 'border-red-500/50 bg-red-500/10' : 'border-border'
                }`}
                onClick={() => {
                  const next = !isProduction
                  setIsProduction(next)
                  if (next) setClaudeAccess('readonly')
                }}
              >
                <ShieldAlert
                  className={`h-5 w-5 ${isProduction ? 'text-red-400' : 'text-muted-foreground'}`}
                />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${isProduction ? 'text-red-400' : ''}`}>
                    Production
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Protected from database copy/paste, bulk imports, and mass deletes
                  </p>
                </div>
                <div
                  className={`h-5 w-9 rounded-full transition-colors ${
                    isProduction ? 'bg-red-500' : 'bg-secondary'
                  }`}
                >
                  <div
                    className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      isProduction ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>

              {/* Read Only toggle */}
              <div
                className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 ${
                  isReadOnly ? 'border-blue-500/50 bg-blue-500/10' : 'border-border'
                }`}
                onClick={() => {
                  const next = !isReadOnly
                  setIsReadOnly(next)
                  if (next) setClaudeAccess('readonly')
                }}
              >
                <Lock
                  className={`h-5 w-5 ${isReadOnly ? 'text-blue-400' : 'text-muted-foreground'}`}
                />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${isReadOnly ? 'text-blue-400' : ''}`}>
                    Read Only
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Prevent all manual write operations on this connection
                  </p>
                </div>
                <div
                  className={`h-5 w-9 rounded-full transition-colors ${
                    isReadOnly ? 'bg-blue-500' : 'bg-secondary'
                  }`}
                >
                  <div
                    className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      isReadOnly ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>

              {/* Claude access control */}
              <div className="rounded-md border border-border px-3 py-2.5">
                <label className="mb-1.5 block text-sm font-medium">Claude AI Access</label>
                <div className="flex gap-2">
                  <button
                    className={`flex-1 rounded-md border px-3 py-2 text-xs ${
                      claudeAccess === 'readonly'
                        ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                        : 'border-border text-muted-foreground hover:bg-accent'
                    }`}
                    onClick={() => setClaudeAccess('readonly')}
                  >
                    <div className="font-medium">Read Only</div>
                    <div className="mt-0.5 text-[10px] opacity-75">
                      Claude can query but not modify data
                    </div>
                  </button>
                  <button
                    className={`flex-1 rounded-md border px-3 py-2 text-xs ${
                      claudeAccess === 'readwrite'
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                        : 'border-border text-muted-foreground hover:bg-accent'
                    } ${isReadOnly ? 'cursor-not-allowed opacity-50' : ''}`}
                    onClick={() => {
                      if (!isReadOnly) setClaudeAccess('readwrite')
                    }}
                  >
                    <div className="font-medium">Read &amp; Write</div>
                    <div className="mt-0.5 text-[10px] opacity-75">
                      Claude can query and modify data
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}

          {dialogTab === 'ssh' && (
            <SSHForm config={sshConfig} onChange={setSSHConfig} />
          )}

          {dialogTab === 'tls' && (
            <TLSForm config={tlsConfig} onChange={setTLSConfig} />
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || !uri.trim() || saving}>
            {saving ? 'Saving...' : 'Save & Connect'}
          </Button>
        </div>
      </div>
    </div>
  )
}
