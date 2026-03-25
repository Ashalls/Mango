import { useEffect, useState, useRef } from 'react'
import { X, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Loader2, Copy, Download, Upload, Clock, Ban } from 'lucide-react'
import type { OperationProgress } from '@shared/types'
import { trpc } from '@renderer/lib/trpc'

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem}s`
}

function OperationIcon({ type }: { type: OperationProgress['type'] }) {
  switch (type) {
    case 'copy': return <Copy className="h-3.5 w-3.5" />
    case 'export': return <Download className="h-3.5 w-3.5" />
    case 'import': return <Upload className="h-3.5 w-3.5" />
  }
}

function StatusIcon({ status }: { status: 'running' | 'done' | 'error' | 'pending' }) {
  switch (status) {
    case 'running': return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
    case 'done': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
    case 'error': return <AlertCircle className="h-3.5 w-3.5 text-red-400" />
    case 'pending': return <Clock className="h-3.5 w-3.5 text-muted-foreground" />
  }
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-blue-500 transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function OperationCard({ op, onDismiss }: { op: OperationProgress; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(op.status === 'running')
  const prevStatus = useRef(op.status)
  const elapsed = Date.now() - op.startedAt
  const overallPct = op.total > 0 ? Math.round((op.processed / op.total) * 100) : 0

  // Auto-collapse when operation finishes
  useEffect(() => {
    if (prevStatus.current === 'running' && op.status !== 'running') {
      setExpanded(false)
    }
    prevStatus.current = op.status
  }, [op.status])

  const isDone = op.status !== 'running'

  return (
    <div className="rounded-md border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <OperationIcon type={op.type} />
        <StatusIcon status={op.status} />
        <span className="flex-1 truncate text-xs font-medium" title={op.label}>{op.label}</span>
        <span className="text-[10px] text-muted-foreground">{formatDuration(elapsed)}</span>
        {op.status === 'running' && (
          <button
            onClick={async () => {
              try { await trpc.exportImport.cancelOperation.mutate({ operationId: op.id }) } catch { /* ignore */ }
            }}
            className="rounded p-0.5 hover:bg-red-500/20"
            title="Cancel operation"
          >
            <Ban className="h-3 w-3 text-red-400" />
          </button>
        )}
        {isDone && (
          <button onClick={onDismiss} className="rounded p-0.5 hover:bg-accent" title="Dismiss">
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
        {op.collections.length > 0 && (
          <button onClick={() => setExpanded(!expanded)} className="rounded p-0.5 hover:bg-accent">
            {expanded
              ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
              : <ChevronDown className="h-3 w-3 text-muted-foreground" />
            }
          </button>
        )}
      </div>

      {/* Running: progress bar + current step */}
      {op.status === 'running' && (
        <div className="px-3 pb-1.5">
          <ProgressBar value={op.processed} max={op.total} />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground truncate">{op.currentStep}</span>
            <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
              {op.total > 0 ? `${overallPct}%` : ''}
            </span>
          </div>
        </div>
      )}

      {/* Done: single line */}
      {op.status === 'done' && !expanded && (
        <div className="px-3 pb-1.5 text-[10px] text-emerald-400">Complete</div>
      )}

      {/* Error: single line with hover for full text */}
      {op.status === 'error' && !expanded && (
        <div
          className="px-3 pb-1.5 text-[10px] text-red-400 truncate cursor-help"
          title={op.error || op.currentStep}
        >
          {op.error || op.currentStep}
        </div>
      )}

      {/* Expanded collection details */}
      {expanded && op.collections.length > 0 && (
        <div className="border-t border-border px-3 py-2 space-y-1 max-h-48 overflow-y-auto">
          {op.collections.map((col) => (
            <div key={col.name} className="flex items-center gap-2">
              <StatusIcon status={col.status} />
              <span className="flex-1 truncate text-[11px]" title={col.name}>{col.name}</span>
              {col.total > 0 && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {col.copied.toLocaleString()}/{col.total.toLocaleString()}
                </span>
              )}
              {col.error && (
                <span
                  className="text-[10px] text-red-400 truncate max-w-[120px] cursor-help"
                  title={col.error}
                >
                  {col.error.length > 30 ? col.error.slice(0, 27) + '...' : col.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function OperationProgressPanel() {
  const [operations, setOperations] = useState<Map<string, OperationProgress>>(new Map())

  useEffect(() => {
    const electron = window.electron
    if (!electron) return

    const handleProgress = (_event: unknown, data: OperationProgress) => {
      setOperations((prev) => {
        const next = new Map(prev)
        next.set(data.id, { ...data })
        return next
      })
    }

    electron.ipcRenderer.on('operation:progress', handleProgress)
    return () => {
      electron.ipcRenderer.removeAllListeners('operation:progress')
    }
  }, [])

  const dismiss = (id: string) => {
    setOperations((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  if (operations.size === 0) return null

  const ops = Array.from(operations.values()).sort((a, b) => b.startedAt - a.startedAt)

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2">
      {ops.map((op) => (
        <OperationCard key={op.id} op={op} onDismiss={() => dismiss(op.id)} />
      ))}
    </div>
  )
}
