import type { ExplainStageNode, ExplainPlan } from '@shared/types'

function classifyEfficiency(node: {
  type: string
  docsExamined: number
  docsReturned: number
}): 'good' | 'moderate' | 'poor' {
  if (node.type === 'COLLSCAN') return 'poor'
  if (node.docsReturned === 0) return 'good'
  const ratio = node.docsExamined / Math.max(node.docsReturned, 1)
  if (ratio <= 2) return 'good'
  if (ratio <= 10) return 'moderate'
  return 'poor'
}

let nodeCounter = 0

function parseExecutionStage(stage: Record<string, unknown>): ExplainStageNode {
  const id = `node-${nodeCounter++}`
  const type = (stage.stage as string) ?? (stage.inputStage ? 'UNKNOWN' : 'ROOT')

  const docsExamined = (stage.docsExamined as number) ?? (stage.totalDocsExamined as number) ?? 0
  const docsReturned = (stage.nReturned as number) ?? 0
  const keysExamined = (stage.totalKeysExamined as number) ?? (stage.keysExamined as number) ?? 0
  const executionTimeMs = (stage.executionTimeMillisEstimate as number) ?? 0
  const memoryUsageBytes = (stage.memUsage as number) ?? undefined

  const indexName = (stage.indexName as string) ?? undefined
  const indexKeyPattern = (stage.keyPattern as Record<string, 1 | -1>) ?? undefined
  const filter = (stage.filter as Record<string, unknown>) ?? undefined

  const children: ExplainStageNode[] = []
  if (stage.inputStage) {
    children.push(parseExecutionStage(stage.inputStage as Record<string, unknown>))
  }
  if (stage.inputStages) {
    for (const child of stage.inputStages as Record<string, unknown>[]) {
      children.push(parseExecutionStage(child))
    }
  }

  const node: ExplainStageNode = {
    id,
    type,
    executionTimeMs,
    docsExamined,
    docsReturned,
    keysExamined,
    indexName,
    indexKeyPattern,
    filter,
    memoryUsageBytes,
    children,
    efficiency: 'good'
  }
  node.efficiency = classifyEfficiency(node)
  return node
}

function flattenNodes(node: ExplainStageNode): ExplainStageNode[] {
  const result: ExplainStageNode[] = []
  for (const child of node.children) {
    result.push(...flattenNodes(child))
  }
  result.push(node)
  return result
}

function suggestIndex(root: ExplainStageNode): string | undefined {
  const allNodes = flattenNodes(root)
  const collScan = allNodes.find((n) => n.type === 'COLLSCAN')
  if (!collScan || !collScan.filter) return undefined

  const fields = Object.keys(collScan.filter).filter((k) => !k.startsWith('$'))
  if (fields.length === 0) return undefined
  return `Consider creating an index on { ${fields.map((f) => `"${f}": 1`).join(', ')} }`
}

export function parseExplainResult(raw: Record<string, unknown>): ExplainPlan {
  nodeCounter = 0

  const executionStats = raw.executionStats as Record<string, unknown> | undefined
  const queryPlanner = raw.queryPlanner as Record<string, unknown> | undefined

  let root: ExplainStageNode
  let totalExecutionTimeMs = 0
  let winningPlan = ''
  let rejectedPlansCount = 0

  if (executionStats?.executionStages) {
    root = parseExecutionStage(executionStats.executionStages as Record<string, unknown>)
    totalExecutionTimeMs = (executionStats.executionTimeMillis as number) ?? 0
  } else if (raw.stages) {
    const aggStages = raw.stages as Record<string, unknown>[]
    const firstStage = aggStages[0]
    if (firstStage?.$cursor) {
      const cursor = firstStage.$cursor as Record<string, unknown>
      const cursorExecStats = cursor.executionStats as Record<string, unknown> | undefined
      if (cursorExecStats?.executionStages) {
        root = parseExecutionStage(cursorExecStats.executionStages as Record<string, unknown>)
        totalExecutionTimeMs = (cursorExecStats.executionTimeMillis as number) ?? 0
      } else {
        root = { id: 'root', type: 'PIPELINE', executionTimeMs: 0, docsExamined: 0, docsReturned: 0, keysExamined: 0, children: [], efficiency: 'good' }
      }
    } else {
      root = { id: 'root', type: 'PIPELINE', executionTimeMs: 0, docsExamined: 0, docsReturned: 0, keysExamined: 0, children: [], efficiency: 'good' }
    }
  } else {
    root = { id: 'root', type: 'UNKNOWN', executionTimeMs: 0, docsExamined: 0, docsReturned: 0, keysExamined: 0, children: [], efficiency: 'good' }
  }

  if (queryPlanner) {
    const wp = queryPlanner.winningPlan as Record<string, unknown> | undefined
    winningPlan = wp?.stage ? String(wp.stage) : 'unknown'
    const rejected = queryPlanner.rejectedPlans as unknown[]
    rejectedPlansCount = Array.isArray(rejected) ? rejected.length : 0
  }

  const stages = flattenNodes(root)

  return {
    stages,
    totalExecutionTimeMs,
    winningPlan,
    rejectedPlansCount,
    indexSuggestion: suggestIndex(root),
    raw
  }
}
