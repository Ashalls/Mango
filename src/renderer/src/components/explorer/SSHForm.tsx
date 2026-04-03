import { useState } from 'react'
import { Eye, EyeOff, FolderOpen, Server, ArrowRight, Monitor } from 'lucide-react'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { trpc } from '@renderer/lib/trpc'
import type { SSHConfig } from '@shared/types'

export const defaultSSH: SSHConfig = {
  enabled: false,
  host: '',
  port: 22,
  username: '',
  authMethod: 'password'
}

interface SSHFormProps {
  config: SSHConfig
  onChange: (config: SSHConfig) => void
}

export function SSHForm({ config, onChange }: SSHFormProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [showPassphrase, setShowPassphrase] = useState(false)

  const update = (partial: Partial<SSHConfig>) => onChange({ ...config, ...partial })

  const browsePKFile = async () => {
    const result = await trpc.settings.pickFile.mutate({
      title: 'Select Private Key File',
      filters: [
        { name: 'Private Key Files', extensions: ['pem', 'key', 'ppk', 'id_rsa', 'id_ed25519'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!result.canceled && result.path) {
      update({ privateKeyPath: result.path })
    }
  }

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div
        className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 ${
          config.enabled ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-border'
        }`}
        onClick={() => update({ enabled: !config.enabled })}
      >
        <Server
          className={`h-5 w-5 ${config.enabled ? 'text-emerald-400' : 'text-muted-foreground'}`}
        />
        <div className="flex-1">
          <p className={`text-sm font-medium ${config.enabled ? 'text-emerald-400' : ''}`}>
            Connect via SSH Tunnel
          </p>
          <p className="text-xs text-muted-foreground">
            Route your MongoDB connection through an SSH server
          </p>
        </div>
        <div
          className={`h-5 w-9 rounded-full transition-colors ${
            config.enabled ? 'bg-emerald-500' : 'bg-secondary'
          }`}
        >
          <div
            className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
              config.enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </div>
      </div>

      {config.enabled && (
        <>
          {/* Visual flow indicator */}
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Monitor className="h-3.5 w-3.5 shrink-0" />
            <span>Your machine</span>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <Server className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span className="text-emerald-400">SSH server</span>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <span>MongoDB</span>
          </div>

          {/* SSH Host + Port */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-sm text-muted-foreground">SSH Host</label>
              <Input
                placeholder="ssh.example.com"
                value={config.host}
                onChange={(e) => update({ host: e.target.value })}
              />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-sm text-muted-foreground">Port</label>
              <Input
                placeholder="22"
                type="number"
                min={1}
                max={65535}
                value={config.port}
                onChange={(e) => update({ port: parseInt(e.target.value, 10) || 22 })}
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">Username</label>
            <Input
              placeholder="ubuntu"
              value={config.username}
              onChange={(e) => update({ username: e.target.value })}
            />
          </div>

          {/* Auth method radio */}
          <div>
            <label className="mb-1.5 block text-sm text-muted-foreground">Authentication</label>
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 rounded-md border px-3 py-2 text-xs ${
                  config.authMethod === 'password'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                    : 'border-border text-muted-foreground hover:bg-accent'
                }`}
                onClick={() => update({ authMethod: 'password' })}
              >
                Password
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md border px-3 py-2 text-xs ${
                  config.authMethod === 'privateKey'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                    : 'border-border text-muted-foreground hover:bg-accent'
                }`}
                onClick={() => update({ authMethod: 'privateKey' })}
              >
                Private Key
              </button>
            </div>
          </div>

          {/* Password field */}
          {config.authMethod === 'password' && (
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Password</label>
              <div className="relative">
                <Input
                  placeholder="SSH password"
                  type={showPassword ? 'text' : 'password'}
                  value={config.password ?? ''}
                  onChange={(e) => update({ password: e.target.value })}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Private key fields */}
          {config.authMethod === 'privateKey' && (
            <>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Private Key Path</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="~/.ssh/id_rsa"
                    value={config.privateKeyPath ?? ''}
                    onChange={(e) => update({ privateKeyPath: e.target.value })}
                  />
                  <Button type="button" variant="outline" size="icon" onClick={browsePKFile}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">
                  Passphrase{' '}
                  <span className="text-xs opacity-60">(optional)</span>
                </label>
                <div className="relative">
                  <Input
                    placeholder="Key passphrase"
                    type={showPassphrase ? 'text' : 'password'}
                    value={config.passphrase ?? ''}
                    onChange={(e) => update({ passphrase: e.target.value })}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                  >
                    {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
