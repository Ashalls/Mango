import { useState } from 'react'
import { Play, Copy, Check, Code } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { trpc } from '@renderer/lib/trpc'
import { StageList } from './StageList'
import { StageEditor } from './StageEditor'
import { StagePreview } from './StagePreview'
import { CodeGenModal } from '@renderer/components/codegen/CodeGenModal'
import type { AggregationStage } from '@shared/types'

function buildPipeline(stages: AggregationStage[]): Record<string, unknown>[] {
  return stages
    .filter((s) => s.enabled)
    .map((s) => ({ [s.type]: JSON.parse(s.content) }))
}

export function AggregationEditor() {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const updateTab = useTabStore((s) => s.updateTab)

  const [stages, setStages] = useState<AggregationStage[]>([])
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultCount, setResultCount] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [codegenOpen, setCodegenOpen] = useState(false)

  if (!tab || tab.scope !== 'collection') return null

  const selectedStage = stages.find((s) => s.id === selectedStageId) ?? null

  const handleStageContentChange = (content: string) => {
    if (!selectedStageId) return
    setStages((prev) =>
      prev.map((s) => (s.id === selectedStageId ? { ...s, content } : s))
    )
  }

  const handleRun = async () => {
    setRunning(true)
    setError(null)
    setResultCount(null)
    try {
      const pipeline = buildPipeline(stages)
      const documents = await trpc.query.aggregate.query({
        database: tab.database,
        collection: tab.collection,
        pipeline
      })
      updateTab(tab.id, {
        results: { documents, totalCount: documents.length }
      })
      setResultCount(documents.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline execution failed')
    } finally {
      setRunning(false)
    }
  }

  const handleCopy = async () => {
    try {
      const pipeline = buildPipeline(stages)
      await navigator.clipboard.writeText(JSON.stringify(pipeline, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard not available */
    }
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex flex-1 min-h-0">
        <StageList
          stages={stages}
          selectedStageId={selectedStageId}
          onSelectStage={setSelectedStageId}
          onUpdateStages={setStages}
        />

        <StageEditor stage={selectedStage} onChange={handleStageContentChange} />

        <StagePreview
          database={tab.database}
          collection={tab.collection}
          stages={stages}
          selectedStageId={selectedStageId}
        />
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Button
          size="sm"
          className="h-7 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
          onClick={handleRun}
          disabled={running || stages.filter((s) => s.enabled).length === 0}
        >
          <Play className="mr-1 h-3 w-3" />
          {running ? 'Running...' : 'Run Pipeline'}
        </Button>

        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCopy}>
          {copied ? (
            <Check className="mr-1 h-3 w-3 text-emerald-400" />
          ) : (
            <Copy className="mr-1 h-3 w-3" />
          )}
          {copied ? 'Copied' : 'Copy JSON'}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setCodegenOpen(true)}
          title="Generate code for this pipeline"
        >
          <Code className="mr-1 h-3 w-3" />
          Code
        </Button>

        {resultCount !== null && !error && (
          <span className="text-xs text-muted-foreground">{resultCount} documents</span>
        )}

        {error && (
          <span className="flex-1 truncate text-xs text-destructive">{error}</span>
        )}
      </div>

      <CodeGenModal
        open={codegenOpen}
        onClose={() => setCodegenOpen(false)}
        type="aggregate"
        pipeline={buildPipeline(stages)}
      />
    </div>
  )
}
