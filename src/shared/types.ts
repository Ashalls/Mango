export interface ConnectionProfile {
  id: string
  name: string
  uri: string
  color?: string
  isProduction?: boolean
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
