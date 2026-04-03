import { useState, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeMouseHandler
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import Editor from '@monaco-editor/react'
import { useSettingsStore } from '@renderer/store/settingsStore'
import type { ExplainPlan, ExplainStageNode } from '@shared/types'

const efficiencyColors = {
  good: { bg: '#065f46', border: '#10b981', text: '#6ee7b7' },
  moderate: { bg: '#78350f', border: '#f59e0b', text: '#fcd34d' },
  poor: { bg: '#7f1d1d', border: '#ef4444', text: '#fca5a5' }
} as const

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function buildNodesAndEdges(stages: ExplainStageNode[]) {
  const nodes: Node[] = []
  const edges: Edge[] = []

  stages.forEach((stage, index) => {
    const colors = efficiencyColors[stage.efficiency]
    nodes.push({
      id: stage.id,
      position: { x: index * 220, y: 100 },
      data: { label: stage },
      style: {
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 12,
        color: colors.text,
        fontSize: 12,
        minWidth: 160
      }
    })

    if (index > 0) {
      edges.push({
        id: `e-${stages[index - 1].id}-${stage.id}`,
        source: stages[index - 1].id,
        target: stage.id,
        label: `${stage.docsExamined.toLocaleString()} examined`,
        style: { stroke: '#525252' },
        labelStyle: { fill: '#a1a1aa', fontSize: 10 }
      })
    }
  })

  return { nodes, edges }
}

function StageNodeLabel({ stage }: { stage: ExplainStageNode }) {
  const colors = efficiencyColors[stage.efficiency]
  return (
    <div style={{ color: colors.text }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{stage.type}</div>
      <div style={{ fontSize: 11, opacity: 0.85 }}>{stage.executionTimeMs}ms</div>
      <div style={{ fontSize: 11, opacity: 0.85 }}>{stage.docsReturned.toLocaleString()} returned</div>
      {stage.indexName && (
        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{stage.indexName}</div>
      )}
    </div>
  )
}

export function VisualExplain({ plan }: { plan: ExplainPlan }) {
  const [showRawJson, setShowRawJson] = useState(false)
  const [selectedStage, setSelectedStage] = useState<ExplainStageNode | null>(null)
  const effectiveTheme = useSettingsStore((s) => s.effectiveTheme)

  const hasCollscan = useMemo(
    () => plan.stages.some((s) => s.type === 'COLLSCAN'),
    [plan.stages]
  )

  const { nodes, edges } = useMemo(() => {
    const result = buildNodesAndEdges(plan.stages)
    // Replace label data with rendered component
    result.nodes = result.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        label: <StageNodeLabel stage={node.data.label as ExplainStageNode} />
      }
    }))
    return result
  }, [plan.stages])

  // Keep raw stage data for click lookups
  const stageMap = useMemo(() => {
    const map = new Map<string, ExplainStageNode>()
    plan.stages.forEach((s) => map.set(s.id, s))
    return map
  }, [plan.stages])

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const stage = stageMap.get(node.id)
      if (stage) setSelectedStage(stage)
    },
    [stageMap]
  )

  return (
    <div className="flex h-full flex-col">
      {/* Summary bar */}
      <div className="flex items-center gap-4 border-b border-border bg-card px-4 py-2 text-xs">
        <span className="text-muted-foreground">
          Total: <span className="font-medium text-foreground">{plan.totalExecutionTimeMs}ms</span>
        </span>
        <span className="text-muted-foreground">
          Plan: <span className="font-medium text-foreground">{plan.winningPlan}</span>
        </span>
        <span className="text-muted-foreground">
          Rejected: <span className="font-medium text-foreground">{plan.rejectedPlansCount}</span>
        </span>
        {plan.indexSuggestion && (
          <span className={hasCollscan ? 'text-amber-400' : 'text-muted-foreground'}>
            {plan.indexSuggestion}
          </span>
        )}
        <div className="ml-auto">
          <button
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              showRawJson
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setShowRawJson(!showRawJson)}
          >
            {showRawJson ? 'Show Diagram' : 'Show Raw JSON'}
          </button>
        </div>
      </div>

      {/* Main content */}
      {showRawJson ? (
        <div className="flex-1">
          <Editor
            height="100%"
            defaultLanguage="json"
            value={JSON.stringify(plan.raw, null, 2)}
            theme={effectiveTheme === 'dark' ? 'vs-dark' : 'light'}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              readOnly: true,
              automaticLayout: true,
              tabSize: 2
            }}
          />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Flow diagram */}
          <div className="flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodeClick={onNodeClick}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>

          {/* Stage detail panel */}
          {selectedStage && (
            <div className="w-66 shrink-0 overflow-auto border-l border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{selectedStage.type}</h3>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedStage(null)}
                >
                  Close
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <DetailRow label="Execution Time" value={`${selectedStage.executionTimeMs}ms`} />
                <DetailRow
                  label="Docs Examined"
                  value={selectedStage.docsExamined.toLocaleString()}
                />
                <DetailRow
                  label="Docs Returned"
                  value={selectedStage.docsReturned.toLocaleString()}
                />
                <DetailRow
                  label="Keys Examined"
                  value={selectedStage.keysExamined.toLocaleString()}
                />

                {selectedStage.indexName && (
                  <DetailRow label="Index Name" value={selectedStage.indexName} />
                )}

                {selectedStage.indexKeyPattern && (
                  <div>
                    <span className="text-muted-foreground">Key Pattern</span>
                    <pre className="mt-1 rounded bg-secondary p-2 font-mono text-xs text-foreground">
                      {JSON.stringify(selectedStage.indexKeyPattern, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedStage.filter && (
                  <div>
                    <span className="text-muted-foreground">Filter</span>
                    <pre className="mt-1 rounded bg-secondary p-2 font-mono text-xs text-foreground">
                      {JSON.stringify(selectedStage.filter, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedStage.memoryUsageBytes !== undefined && (
                  <DetailRow
                    label="Memory Usage"
                    value={formatBytes(selectedStage.memoryUsageBytes)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}
