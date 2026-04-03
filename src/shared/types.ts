export interface ConnectionProfile {
  id: string
  name: string
  uri: string
  color?: string
  isProduction?: boolean
  /** When true, blocks all manual write operations on this connection */
  isReadOnly?: boolean
  /** Default Claude access for all databases on this connection */
  claudeAccess?: 'readonly' | 'readwrite'
  /** Per-database Claude access overrides (key = database name) */
  claudeDbOverrides?: Record<string, 'readonly' | 'readwrite'>
  /** Per-database codebase paths for Claude context (key = database name) */
  databaseCodebasePaths?: Record<string, string>
}

export interface ConnectionState {
  profileId: string
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  error?: string
}

export interface DatabaseInfo {
  name: string
  sizeOnDisk: number
  empty: boolean
}

export interface CollectionInfo {
  name: string
  type: 'collection' | 'view' | string
  documentCount?: number
  /** For views: the source collection */
  viewOn?: string
  /** For views: the aggregation pipeline */
  pipeline?: Record<string, unknown>[]
}

export interface QueryOptions {
  database: string
  collection: string
  filter?: Record<string, unknown>
  projection?: Record<string, number>
  sort?: Record<string, number>
  skip?: number
  limit?: number
}

export interface QueryResult {
  documents: Record<string, unknown>[]
  totalCount: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallInfo[]
  timestamp: number
}

export interface ToolCallInfo {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  status: 'pending' | 'running' | 'success' | 'error'
}

export interface CopyDatabaseOptions {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  collections?: string[] // if empty, copy all
  dropTarget?: boolean
}

export interface CopyProgress {
  collection: string
  copied: number
  total: number
  status: 'pending' | 'copying' | 'done' | 'error'
  error?: string
}

/** Unified progress tracking for long-running database operations */
export interface OperationProgress {
  /** Unique ID for this operation */
  id: string
  type: 'copy' | 'export' | 'import'
  /** Human-readable label, e.g. "Copy mydb → mydb_copy" */
  label: string
  status: 'running' | 'done' | 'error'
  /** Current step description, e.g. "Copying users (500/2000)" */
  currentStep: string
  /** Overall items processed */
  processed: number
  /** Overall total items (0 if unknown) */
  total: number
  /** Per-collection progress */
  collections: CollectionProgress[]
  error?: string
  startedAt: number
}

export interface CollectionProgress {
  name: string
  status: 'pending' | 'running' | 'done' | 'error'
  copied: number
  total: number
  error?: string
}

// --- Aggregation Editor types ---

export interface AggregationStage {
  id: string
  type: string        // e.g., "$match", "$group", "$project"
  content: string     // JSON string of stage body
  enabled: boolean
  order: number
}

export interface StagePreviewResult {
  documents: Record<string, unknown>[]
  count: number
}

// --- Visual Explain types ---

export interface ExplainStageNode {
  id: string
  type: string              // IXSCAN, FETCH, SORT, COLLSCAN, etc.
  executionTimeMs: number
  docsExamined: number
  docsReturned: number
  keysExamined: number
  indexName?: string
  indexKeyPattern?: Record<string, 1 | -1>
  filter?: Record<string, unknown>
  memoryUsageBytes?: number
  children: ExplainStageNode[]
  efficiency: 'good' | 'moderate' | 'poor'
}

export interface ExplainPlan {
  stages: ExplainStageNode[]
  totalExecutionTimeMs: number
  winningPlan: string
  rejectedPlansCount: number
  indexSuggestion?: string
  raw: Record<string, unknown>
}

// --- Value Search types ---

export interface ValueSearchResult {
  database: string
  collection: string
  documentId: string
  fieldPath: string
  matchedValue: string
}

export interface ValueSearchProgress {
  collectionsScanned: number
  collectionsTotal: number
  resultsFound: number
  currentCollection: string
  done: boolean
}
