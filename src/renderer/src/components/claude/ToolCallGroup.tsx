import { useState } from 'react'
import { ChevronRight, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { ToolCallInfo } from '@shared/types'
import { ToolCallCard } from './ToolCallCard'

interface ToolCallGroupProps {
  toolCalls: ToolCallInfo[]
}

export function ToolCallGroup({ toolCalls }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false)

  const completed = toolCalls.filter((tc) => tc.status === 'success').length
  const running = toolCalls.filter(
    (tc) => tc.status === 'running' || tc.status === 'pending'
  ).length
  const errors = toolCalls.filter((tc) => tc.status === 'error').length

  return (
    <div className="my-1 ml-2">
      <button
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')}
        />
        <span>
          {toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}
        </span>
        {completed > 0 && (
          <span className="flex items-center gap-0.5 text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            <span>{completed}</span>
          </span>
        )}
        {running > 0 && (
          <span className="flex items-center gap-0.5 text-blue-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{running}</span>
          </span>
        )}
        {errors > 0 && (
          <span className="flex items-center gap-0.5 text-red-400">
            <XCircle className="h-3 w-3" />
            <span>{errors}</span>
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1">
          {toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  )
}
