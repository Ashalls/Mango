import { AlertTriangle, FolderOpen, ShieldCheck, X } from 'lucide-react'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { trpc } from '@renderer/lib/trpc'
import type { TLSConfig } from '@shared/types'

export const defaultTLS: TLSConfig = {
  enabled: false,
  allowInvalidHostnames: false,
  allowInvalidCertificates: false
}

interface TLSFormProps {
  config: TLSConfig
  onChange: (config: TLSConfig) => void
}

interface FilePickerProps {
  label: string
  value: string | undefined
  onPick: () => void
  onClear: () => void
  placeholder?: string
}

function FilePicker({ label, value, onPick, onClear, placeholder }: FilePickerProps) {
  return (
    <div>
      <label className="mb-1 block text-sm text-muted-foreground">{label}</label>
      <div className="flex gap-2">
        <Input
          readOnly
          placeholder={placeholder ?? 'No file selected'}
          value={value ?? ''}
          className="flex-1 cursor-default text-xs"
          title={value}
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClear}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title="Clear"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        <Button type="button" variant="outline" size="icon" onClick={onPick} className="shrink-0">
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export function TLSForm({ config, onChange }: TLSFormProps) {
  const update = (partial: Partial<TLSConfig>) => onChange({ ...config, ...partial })

  const pickFile = async (
    field: 'caFile' | 'certificateKeyFile',
    title: string,
    filters?: { name: string; extensions: string[] }[]
  ) => {
    const result = await trpc.settings.pickFile.mutate({
      title,
      filters: filters ?? [{ name: 'All Files', extensions: ['*'] }]
    })
    if (!result.canceled && result.path) {
      update({ [field]: result.path })
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
        <ShieldCheck
          className={`h-5 w-5 ${config.enabled ? 'text-emerald-400' : 'text-muted-foreground'}`}
        />
        <div className="flex-1">
          <p className={`text-sm font-medium ${config.enabled ? 'text-emerald-400' : ''}`}>
            Use TLS/SSL
          </p>
          <p className="text-xs text-muted-foreground">
            Encrypt your MongoDB connection with TLS/SSL
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
          {/* CA Certificate */}
          <FilePicker
            label="CA Certificate"
            value={config.caFile}
            placeholder="Path to CA certificate (.pem, .crt)"
            onPick={() =>
              pickFile('caFile', 'Select CA Certificate', [
                { name: 'Certificate Files', extensions: ['pem', 'crt', 'cer'] },
                { name: 'All Files', extensions: ['*'] }
              ])
            }
            onClear={() => update({ caFile: undefined })}
          />

          {/* Client Certificate */}
          <FilePicker
            label="Client Certificate"
            value={config.certificateKeyFile}
            placeholder="Path to client certificate (.pem, .crt)"
            onPick={() =>
              pickFile('certificateKeyFile', 'Select Client Certificate', [
                { name: 'Certificate Files', extensions: ['pem', 'crt', 'cer', 'key'] },
                { name: 'All Files', extensions: ['*'] }
              ])
            }
            onClear={() => update({ certificateKeyFile: undefined })}
          />

          {/* Private Key Passphrase */}
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">
              Private Key Passphrase{' '}
              <span className="text-xs opacity-60">(optional)</span>
            </label>
            <Input
              type="password"
              placeholder="Passphrase for client certificate key"
              value={config.certificateKeyFilePassword ?? ''}
              onChange={(e) =>
                update({ certificateKeyFilePassword: e.target.value || undefined })
              }
            />
          </div>

          {/* SNI Hostname */}
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">
              SNI Hostname{' '}
              <span className="text-xs opacity-60">(optional)</span>
            </label>
            <Input
              placeholder="Override the server name for SNI"
              value={config.sniHostname ?? ''}
              onChange={(e) => update({ sniHostname: e.target.value || undefined })}
            />
          </div>

          {/* Allow invalid hostnames */}
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={config.allowInvalidHostnames}
              onChange={(e) => update({ allowInvalidHostnames: e.target.checked })}
              className="h-4 w-4 rounded accent-emerald-500"
            />
            <span className="text-sm">Allow invalid hostnames</span>
          </label>

          {/* Allow invalid certificates */}
          <div>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={config.allowInvalidCertificates}
                onChange={(e) => update({ allowInvalidCertificates: e.target.checked })}
                className="h-4 w-4 rounded accent-emerald-500"
              />
              <span className="text-sm">Allow invalid certificates</span>
            </label>
            {config.allowInvalidCertificates && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p className="text-xs text-amber-300">
                  Accepting invalid certificates is insecure and should only be used for
                  self-signed certificates in development environments.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
