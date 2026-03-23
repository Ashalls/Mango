import { ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@renderer/lib/utils'
import type { ToolCallInfo } from '@shared/types'

interface ToolCallCardProps {
  toolCall: ToolCallInfo
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = {
    pending: <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />,
    running: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />,
    success: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    error: <XCircle className="h-3.5 w-3.5 text-red-400" />
  }

  return (
    <div className="my-1 ml-2 rounded-md border border-border bg-card text-xs">
      <button
        className="flex w-full items-center gap-2 px-2 py-1.5"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')}
        />
        {statusIcon[toolCall.status]}
        <span className="font-mono">{toolCall.name}</span>
      </button>
      {expanded && (
        <div className="border-t border-border px-2 py-1.5">
          <pre className="overflow-auto whitespace-pre-wrap text-muted-foreground">
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>
          {toolCall.result && (
            <pre className="mt-1 overflow-auto whitespace-pre-wrap border-t border-border pt-1">
              {toolCall.result}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
