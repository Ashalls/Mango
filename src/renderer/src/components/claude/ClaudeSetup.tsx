import { useEffect, useState } from 'react'
import { Loader2, ExternalLink, RefreshCw, Copy, Check, KeyRound } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { trpc } from '@renderer/lib/trpc'
import { cn } from '@renderer/lib/utils'
import { useClaudeStore } from '@renderer/store/claudeStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import type { ClaudeAuthMethod } from '@shared/types'

const DOWNLOAD_URL = 'https://claude.com/claude-code'

function installCommand(): string {
  const ua = navigator.userAgent
  if (ua.includes('Windows')) return 'irm https://claude.ai/install.ps1 | iex'
  return 'curl -fsSL https://claude.ai/install.sh | bash'
}

export function ClaudeSetup() {
  const availability = useClaudeStore((s) => s.availability)
  const setAvailability = useClaudeStore((s) => s.setAvailability)
  const authMethod = useSettingsStore((s) => s.claudeAuthMethod)
  const setAuthMethod = useSettingsStore((s) => s.setClaudeAuthMethod)

  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const status = availability.status
  const checking = status === 'checking' || status === 'unknown'

  useEffect(() => {
    trpc.claude.hasApiKey.query().then(setHasKey).catch(() => {})
  }, [status])

  const recheck = async () => {
    setBusy(true)
    try {
      setAvailability(await trpc.claude.recheck.mutate())
    } finally {
      setBusy(false)
    }
  }

  const switchMethod = async (m: ClaudeAuthMethod) => {
    if (m === authMethod) return
    setAuthMethod(m)
    await recheck()
  }

  const saveKey = async () => {
    if (!keyInput.trim()) return
    setBusy(true)
    setSaveError(null)
    try {
      const res = await trpc.claude.setApiKey.mutate({ key: keyInput.trim() })
      if (!res.ok) {
        setSaveError(
          res.reason === 'encryption-unavailable'
            ? 'Secure storage is unavailable here. Use the subscription login instead.'
            : 'Could not save the key.'
        )
        return
      }
      setKeyInput('')
      setHasKey(true)
      setAvailability(res.availability)
    } finally {
      setBusy(false)
    }
  }

  const removeKey = async () => {
    setBusy(true)
    try {
      const res = await trpc.claude.clearApiKey.mutate()
      setHasKey(false)
      setAvailability(res.availability)
    } finally {
      setBusy(false)
    }
  }

  const copyCommand = async () => {
    await navigator.clipboard.writeText(installCommand())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Set up Claude to enable AI features</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose how Mango talks to Claude. The subscription path uses your Claude Code login; the API-key path bills your Anthropic account per token.
        </p>
      </div>

      {/* Auth-method toggle */}
      <div className="flex gap-1 rounded-md bg-muted p-1">
        {([
          { value: 'subscription' as const, label: 'Subscription' },
          { value: 'apiKey' as const, label: 'API key' }
        ]).map(({ value, label }) => (
          <button
            key={value}
            disabled={busy}
            className={cn(
              'flex-1 rounded-sm px-2 py-1 text-xs transition-colors',
              authMethod === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => switchMethod(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {checking ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking Claude…
        </div>
      ) : authMethod === 'subscription' ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="text-xs font-medium text-foreground">Use your Claude Code subscription</div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => window.electron?.ipcRenderer.invoke('shell:openExternal', DOWNLOAD_URL)}
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Get Claude Code
          </Button>
          <div className="flex items-center gap-1">
            <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-[11px]">{installCommand()}</code>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyCommand} title="Copy install command">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Then run <code className="rounded bg-muted px-1">claude</code> in a terminal and complete login. Click Re-check when done.
          </p>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-1 text-xs font-medium text-foreground">
            <KeyRound className="h-3.5 w-3.5" /> Use an Anthropic API key
          </div>
          {hasKey ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-emerald-400">Key set ✓</span>
              <Button variant="ghost" size="sm" onClick={removeKey} disabled={busy}>Remove</Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <input
                type="password"
                className="flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="sk-ant-…"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveKey() }}
              />
              <Button size="sm" onClick={saveKey} disabled={busy || !keyInput.trim()}>Save</Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Billed to your Anthropic account per token. Default model is Haiku to keep costs low — change it in the chat header.
          </p>
          {saveError && <p className="text-[11px] text-destructive">{saveError}</p>}
        </div>
      )}

      {status === 'error' && availability.detail && (
        <p className="text-[11px] text-destructive">{availability.detail}</p>
      )}

      <Button variant="secondary" size="sm" onClick={recheck} disabled={busy}>
        <RefreshCw className={cn('mr-1 h-3.5 w-3.5', busy && 'animate-spin')} />
        Re-check
      </Button>
    </div>
  )
}
