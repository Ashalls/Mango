import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { trpc } from '@renderer/lib/trpc'

interface SampleResult {
  sampled: number
  failed: number
  failures: Record<string, unknown>[]
}

const EXAMPLE_SCHEMA = `{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["_id"],
    "properties": {
      "_id": { "bsonType": "objectId" }
    }
  }
}`

export function ValidationPanel() {
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const effectiveTheme = useSettingsStore((s) => s.effectiveTheme)

  const [text, setText] = useState<string>(EXAMPLE_SCHEMA)
  const [level, setLevel] = useState<'off' | 'strict' | 'moderate'>('strict')
  const [action, setAction] = useState<'error' | 'warn'>('error')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<'sample' | 'apply' | 'remove' | null>(null)
  const [sample, setSample] = useState<SampleResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const database = activeTab?.database ?? ''
  const collection = activeTab?.collection ?? ''

  const load = useCallback(async () => {
    if (!database || !collection) return
    setLoading(true)
    setError(null)
    try {
      const v = await trpc.admin.getValidator.query({ connectionId: activeTab?.connectionId, database, collection })
      if (v.validator && Object.keys(v.validator).length > 0) {
        setText(JSON.stringify(v.validator, null, 2))
      } else {
        setText(EXAMPLE_SCHEMA)
      }
      setLevel(v.validationLevel)
      setAction(v.validationAction)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [database, collection, activeTab?.connectionId])

  useEffect(() => {
    load()
    setSample(null)
    setSuccess(null)
  }, [load])

  const parseSchema = (): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Validator must be a JSON object')
      }
      return parsed
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }

  const handleSample = async () => {
    setError(null)
    setSuccess(null)
    const validator = parseSchema()
    if (!validator) return
    setBusy('sample')
    try {
      const result = await trpc.admin.validateSample.mutate({
        connectionId: activeTab?.connectionId, database, collection, validator, sampleSize: 500
      })
      setSample(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleApply = async () => {
    setError(null)
    setSuccess(null)
    const validator = parseSchema()
    if (!validator) return
    if (!window.confirm(
      `Apply this validator to ${database}.${collection}?\n\nFuture writes that don't match will be ${action === 'error' ? 'rejected' : 'warned'}.\nExisting documents are NOT modified — use Validate Sample first to see how many would fail.`
    )) return
    setBusy('apply')
    try {
      await trpc.admin.setValidator.mutate({
        connectionId: activeTab?.connectionId, database, collection, validator,
        validationLevel: level, validationAction: action
      })
      setSuccess('Validator applied')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleRemove = async () => {
    if (!window.confirm(`Remove the validator from ${database}.${collection}?`)) return
    setError(null)
    setSuccess(null)
    setBusy('remove')
    try {
      await trpc.admin.setValidator.mutate({
        connectionId: activeTab?.connectionId, database, collection, validator: null,
        validationLevel: 'off', validationAction: 'error'
      })
      setSuccess('Validator removed')
      setText(EXAMPLE_SCHEMA)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (!activeTab) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Select a collection to edit validation
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium text-foreground">
          Validation
          <span className="ml-2 text-xs text-muted-foreground">
            {database}.{collection}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as 'off' | 'strict' | 'moderate')}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="strict">strict (apply to all writes)</option>
            <option value="moderate">moderate (only valid existing docs)</option>
            <option value="off">off (validator stored but not enforced)</option>
          </select>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as 'error' | 'warn')}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="error">error (reject invalid writes)</option>
            <option value="warn">warn (log to mongod, accept write)</option>
          </select>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="json"
          value={text}
          onChange={(v) => setText(v ?? '')}
          theme={effectiveTheme === 'dark' ? 'vs-dark' : 'light'}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            tabSize: 2
          }}
        />
      </div>

      {/* Status panel */}
      {(error || success || sample) && (
        <div className="border-t border-border bg-card/50 px-4 py-2 text-xs">
          {error && (
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {success}
            </div>
          )}
          {sample && (
            <div>
              <div className={sample.failed === 0 ? 'text-emerald-400' : 'text-amber-400'}>
                {sample.failed === 0
                  ? `All ${sample.sampled} sampled documents pass validation.`
                  : `${sample.failed} of ${sample.sampled} sampled documents FAIL validation.`}
              </div>
              {sample.failures.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-muted-foreground">
                    Show {sample.failures.length} failing example{sample.failures.length === 1 ? '' : 's'}
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-[10px]">
                    {JSON.stringify(sample.failures, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRemove}
          disabled={!!busy || loading}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Remove validator
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSample}
          disabled={!!busy || loading}
        >
          {busy === 'sample' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Validate sample
        </Button>
        <Button
          size="sm"
          onClick={handleApply}
          disabled={!!busy || loading}
        >
          {busy === 'apply' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Apply validator
        </Button>
      </div>
    </div>
  )
}
