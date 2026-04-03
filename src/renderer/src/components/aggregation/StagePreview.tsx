import { useState, useEffect, useRef } from 'react'
import { trpc } from '@renderer/lib/trpc'
import type { AggregationStage } from '@shared/types'

interface StagePreviewProps {
  database: string
  collection: string
  stages: AggregationStage[]
  selectedStageId: string | null
}

type PreviewMode = 'input' | 'output'

function buildPipeline(stages: AggregationStage[]): Record<string, unknown>[] {
  return stages
    .filter((s) => s.enabled)
    .map((s) => ({ [s.type]: JSON.parse(s.content) }))
}

export function StagePreview({
  database,
  collection,
  stages,
  selectedStageId
}: StagePreviewProps) {
  const [mode, setMode] = useState<PreviewMode>('output')
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchPreview()
    }, 500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [stages, selectedStageId, mode])

  const fetchPreview = async () => {
    if (!selectedStageId) {
      setDocuments([])
      setCount(0)
      return
    }

    const enabledStages = stages.filter((s) => s.enabled)
    const selectedIndex = enabledStages.findIndex((s) => s.id === selectedStageId)

    // If selected stage is disabled, show nothing
    if (selectedIndex < 0) {
      setDocuments([])
      setCount(0)
      return
    }

    setLoading(true)
    setError(null)

    try {
      let pipeline: Record<string, unknown>[]

      if (mode === 'input') {
        // Input: documents before the selected stage
        if (selectedIndex === 0) {
          // First stage input = raw collection docs
          const result = await trpc.query.find.query({
            database,
            collection,
            filter: {},
            limit: 20
          })
          setDocuments(result.documents)
          setCount(result.totalCount)
          setLoading(false)
          return
        }
        // Run pipeline up to but NOT including selected stage
        pipeline = buildPipeline(enabledStages.slice(0, selectedIndex))
      } else {
        // Output: documents after the selected stage
        pipeline = buildPipeline(enabledStages.slice(0, selectedIndex + 1))
      }

      const result = await trpc.query.aggregateWithStagePreview.query({
        database,
        collection,
        pipeline,
        stageIndex: pipeline.length - 1,
        sampleSize: 20
      })
      setDocuments(result.documents)
      setCount(result.count)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
      setDocuments([])
      setCount(0)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex w-80 flex-col border-l border-border">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <button
          className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
            mode === 'input'
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setMode('input')}
        >
          Input
        </button>
        <button
          className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
            mode === 'output'
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setMode('output')}
        >
          Output
        </button>
        {!loading && count > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">{count} docs</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            Loading preview...
          </div>
        )}

        {error && (
          <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !selectedStageId && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            Select a stage to preview
          </div>
        )}

        {!loading && !error && selectedStageId && documents.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            No documents
          </div>
        )}

        {!loading &&
          !error &&
          documents.map((doc, i) => (
            <pre
              key={i}
              className="mb-1 rounded border border-border bg-muted/30 p-2 text-[10px] leading-relaxed text-foreground overflow-x-auto"
            >
              {JSON.stringify(doc, null, 2)}
            </pre>
          ))}
      </div>
    </div>
  )
}
