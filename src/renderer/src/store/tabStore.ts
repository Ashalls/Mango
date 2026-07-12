import { create } from 'zustand'
import type { QueryResult, ChatMessage } from '@shared/types'
import type { FilterBuilderState } from '@renderer/components/query/filterTypes'
import { DEFAULT_PAGE_SIZE } from '@shared/constants'
import { trpc } from '@renderer/lib/trpc'

export interface Tab {
  id: string
  connectionId: string
  database: string
  collection: string
  label: string
  isView: boolean
  scope: 'collection' | 'database' | 'connection'

  // Query state
  filter: Record<string, unknown>
  // Snapshot of the QueryBuilder UI for this tab, so its visual filter rows are
  // restored on revisit (null until the builder first persists one).
  filterBuilder: FilterBuilderState | null
  projection: Record<string, number> | null
  sort: Record<string, number> | null
  page: number
  pageSize: number
  results: QueryResult | null
  loading: boolean
  error: string | null

  // Document state
  selectedDocument: Record<string, unknown> | null
  editorContent: string
  isDirty: boolean
  selectedDocIds: unknown[]

  // Claude state
  messages: ChatMessage[]
  isStreaming: boolean
  chatSessionId: string
  sdkSessionId?: string
}

function createTab(connectionId: string, database: string, collection: string, isView: boolean = false): Tab {
  return {
    id: `${connectionId}:${database}:${collection}`,
    connectionId,
    database,
    collection,
    label: collection,
    isView,
    scope: 'collection',
    filter: {},
    filterBuilder: null,
    projection: null,
    sort: null,
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    results: null,
    loading: false,
    error: null,
    selectedDocument: null,
    editorContent: '',
    isDirty: false,
    selectedDocIds: [],
    messages: [],
    isStreaming: false,
    chatSessionId: crypto.randomUUID(),
    sdkSessionId: undefined
  }
}

interface TabStore {
  tabs: Tab[]
  activeTabId: string | null

  // Tab management
  openTab: (connectionId: string, database: string, collection: string, isView?: boolean) => void
  openNewTab: (connectionId: string, database: string, collection: string, isView?: boolean) => void
  openDatabaseTab: (connectionId: string, database: string) => void
  openConnectionTab: (connectionId: string, connectionName: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  getActiveTab: () => Tab | null
  reorderTabs: (fromId: string, toId: string) => void

  // Query actions (operate on active tab)
  setFilter: (filter: Record<string, unknown>) => void
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  setSort: (sort: Record<string, number> | null) => void
  setProjection: (projection: Record<string, number> | null) => void
  executeQuery: () => Promise<void>

  // Document actions
  selectDocument: (doc: Record<string, unknown> | null) => void
  setEditorContent: (content: string) => void
  setEditorContentPristine: (content: string) => void
  clearDocument: () => void

  // Selection actions
  setSelectedDocIds: (ids: unknown[]) => void

  // Claude actions
  addMessage: (message: ChatMessage) => void
  updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void
  setStreaming: (streaming: boolean) => void
  clearMessages: () => void
  startNewChat: () => void
  setSdkSessionId: (sessionId: string) => void

  // Internal
  updateTab: (tabId: string, updates: Partial<Tab>) => void

  // Persistence
  saveTabs: () => void
  loadTabs: () => void
}

const TABS_STORAGE_KEY = 'mango:openTabs'

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (connectionId, database, collection, isView = false) => {
    const baseId = `${connectionId}:${database}:${collection}`
    const existing = get().tabs.find((t) => t.id === baseId)
    if (existing) {
      set({ activeTabId: baseId })
      return
    }
    const tab = createTab(connectionId, database, collection, isView)
    if (collection === '__profiler__') {
      tab.label = `${database} (Profiler)`
    }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id
    }))
    // Auto-execute query for new tab
    get().executeQuery()
    get().saveTabs()
  },

  openNewTab: (connectionId, database, collection, isView = false) => {
    const baseId = `${connectionId}:${database}:${collection}`
    const existingCount = get().tabs.filter((t) => t.id === baseId || t.id.startsWith(baseId + '::')).length
    const tab = createTab(connectionId, database, collection, isView)
    if (existingCount > 0) {
      tab.id = `${baseId}::${existingCount + 1}`
      tab.label = `${collection} (${existingCount + 1})`
    }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id
    }))
    get().executeQuery()
    get().saveTabs()
  },

  openDatabaseTab: (connectionId, database) => {
    const id = `${connectionId}:${database}:__db__`
    const existing = get().tabs.find((t) => t.id === id)
    if (existing) {
      set({ activeTabId: id })
      return
    }
    const tab: Tab = {
      id,
      connectionId,
      database,
      collection: '',
      label: `${database} (Chat)`,
      isView: false,
      scope: 'database',
      filter: {},
      projection: null,
      sort: null,
      page: 0,
      pageSize: 50,
      results: null,
      loading: false,
      error: null,
      selectedDocument: null,
      editorContent: '',
      isDirty: false,
      selectedDocIds: [],
      messages: [],
      isStreaming: false,
      chatSessionId: crypto.randomUUID(),
      sdkSessionId: undefined
    }
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
    get().saveTabs()
  },

  openConnectionTab: (connectionId, connectionName) => {
    const id = `${connectionId}:__conn__`
    const existing = get().tabs.find((t) => t.id === id)
    if (existing) {
      set({ activeTabId: id })
      return
    }
    const tab: Tab = {
      id,
      connectionId,
      database: '',
      collection: '',
      label: `${connectionName} (Chat)`,
      isView: false,
      scope: 'connection',
      filter: {},
      projection: null,
      sort: null,
      page: 0,
      pageSize: 50,
      results: null,
      loading: false,
      error: null,
      selectedDocument: null,
      editorContent: '',
      isDirty: false,
      selectedDocIds: [],
      messages: [],
      isStreaming: false,
      chatSessionId: crypto.randomUUID(),
      sdkSessionId: undefined
    }
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
    get().saveTabs()
  },

  closeTab: (tabId) => {
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId)
      const newTabs = state.tabs.filter((t) => t.id !== tabId)
      let newActive = state.activeTabId
      if (state.activeTabId === tabId) {
        if (newTabs.length === 0) {
          newActive = null
        } else if (idx >= newTabs.length) {
          newActive = newTabs[newTabs.length - 1].id
        } else {
          newActive = newTabs[idx].id
        }
      }
      return { tabs: newTabs, activeTabId: newActive }
    })
    get().saveTabs()
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId })
  },

  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId) || null
  },

  reorderTabs: (fromId, toId) => {
    if (fromId === toId) return
    set((state) => {
      const fromIdx = state.tabs.findIndex((t) => t.id === fromId)
      const toIdx = state.tabs.findIndex((t) => t.id === toId)
      if (fromIdx < 0 || toIdx < 0) return state
      const next = state.tabs.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return { tabs: next }
    })
    get().saveTabs()
  },

  updateTab: (tabId, updates) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t))
    }))
  },

  // Query actions
  setFilter: (filter) => {
    const tab = get().getActiveTab()
    if (tab) get().updateTab(tab.id, { filter })
  },

  setPage: (page) => {
    const tab = get().getActiveTab()
    if (!tab) return
    get().updateTab(tab.id, { page })
    get().executeQuery()
  },

  setPageSize: (pageSize) => {
    const tab = get().getActiveTab()
    if (!tab) return
    get().updateTab(tab.id, { pageSize, page: 0 })
    get().executeQuery()
  },

  setSort: (sort) => {
    const tab = get().getActiveTab()
    if (!tab) return
    get().updateTab(tab.id, { sort, page: 0 })
  },

  setProjection: (projection) => {
    const tab = get().getActiveTab()
    if (!tab) return
    get().updateTab(tab.id, { projection, page: 0 })
  },

  executeQuery: async () => {
    const tab = get().getActiveTab()
    if (!tab) return
    if (tab.scope !== 'collection') return
    if (tab.collection === '__profiler__') return

    get().updateTab(tab.id, { loading: true, error: null })
    try {
      const results = await trpc.query.find.query({
        connectionId: tab.connectionId,
        database: tab.database,
        collection: tab.collection,
        filter: tab.filter,
        projection: tab.projection ?? undefined,
        sort: tab.sort ?? undefined,
        skip: tab.page * tab.pageSize,
        limit: tab.pageSize
      })
      get().updateTab(tab.id, { results, loading: false })

      // Auto-save to query history
      try {
        trpc.query.saveHistory.mutate({
          connectionId: tab.connectionId,
          database: tab.database,
          collection: tab.collection,
          filter: tab.filter,
          sort: tab.sort,
          projection: tab.projection,
          limit: tab.pageSize,
          resultCount: results.totalCount
        })
      } catch { /* history save is best-effort */ }
    } catch (err) {
      get().updateTab(tab.id, {
        error: err instanceof Error ? err.message : 'Query failed',
        loading: false
      })
    }
  },

  // Document actions
  selectDocument: (doc) => {
    const tab = get().getActiveTab()
    if (!tab) return
    get().updateTab(tab.id, {
      selectedDocument: doc,
      editorContent: doc ? JSON.stringify(doc, null, 2) : '',
      isDirty: false
    })
  },

  setEditorContent: (content) => {
    const tab = get().getActiveTab()
    if (tab) get().updateTab(tab.id, { editorContent: content, isDirty: true })
  },

  // Replace editor content without marking the tab dirty — used when the editor
  // upgrades its plain-JSON view to server-rendered shell source (ObjectId(...),
  // ISODate(...)) after a document is selected.
  setEditorContentPristine: (content) => {
    const tab = get().getActiveTab()
    if (tab) get().updateTab(tab.id, { editorContent: content, isDirty: false })
  },

  clearDocument: () => {
    const tab = get().getActiveTab()
    if (tab) get().updateTab(tab.id, { selectedDocument: null, editorContent: '', isDirty: false })
  },

  // Selection actions
  setSelectedDocIds: (ids) => {
    const tab = get().getActiveTab()
    if (tab) get().updateTab(tab.id, { selectedDocIds: ids })
  },

  // Claude actions
  addMessage: (message) => {
    const tab = get().getActiveTab()
    if (!tab) return
    get().updateTab(tab.id, { messages: [...tab.messages, message] })
  },

  updateMessage: (messageId, updates) => {
    const tab = get().getActiveTab()
    if (!tab) return
    const messages = tab.messages.map((m) =>
      m.id === messageId ? { ...m, ...updates } : m
    )
    get().updateTab(tab.id, { messages })
  },

  setStreaming: (streaming) => {
    const tab = get().getActiveTab()
    if (tab) get().updateTab(tab.id, { isStreaming: streaming })
  },

  clearMessages: () => {
    const tab = get().getActiveTab()
    if (tab) get().updateTab(tab.id, { messages: [], isStreaming: false, sdkSessionId: undefined })
  },

  startNewChat: () => {
    const tab = get().getActiveTab()
    if (!tab) return
    // Save current session first if it has messages
    if (tab.messages.length > 0) {
      trpc.chatHistory.save
        .mutate({
          tabId: tab.id,
          sessionId: tab.chatSessionId,
          messages: tab.messages,
          sdkSessionId: tab.sdkSessionId
        })
        .catch(() => {})
    }
    get().updateTab(tab.id, {
      messages: [],
      isStreaming: false,
      chatSessionId: crypto.randomUUID(),
      sdkSessionId: undefined
    })
  },

  setSdkSessionId: (sessionId) => {
    const tab = get().getActiveTab()
    if (tab) get().updateTab(tab.id, { sdkSessionId: sessionId })
  },

  // Persistence
  saveTabs: () => {
    const { tabs, activeTabId } = get()
    const data = tabs.map((t) => ({
      id: t.id,
      connectionId: t.connectionId,
      database: t.database,
      collection: t.collection,
      scope: t.scope,
      label: t.label
    }))
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ tabs: data, activeTabId }))
    } catch { /* ignore */ }
  },

  loadTabs: () => {
    try {
      const raw = localStorage.getItem(TABS_STORAGE_KEY)
      if (!raw) return
      const { tabs: savedTabs, activeTabId } = JSON.parse(raw)
      if (!Array.isArray(savedTabs)) return
      const seen = new Set<string>()
      const tabs = savedTabs
        .map((t: { id?: string; connectionId: string; database: string; collection: string; scope?: string; label?: string }) => {
          const tab = createTab(t.connectionId, t.database, t.collection)
          tab.scope = (t.scope as Tab['scope']) || 'collection'
          if (t.label) tab.label = t.label
          // Preserve saved id (handles duplicate tabs with ::N suffix)
          if (t.id) tab.id = t.id
          else if (tab.scope === 'database') tab.id = `${t.connectionId}:${t.database}:__db__`
          else if (tab.scope === 'connection') tab.id = `${t.connectionId}:__conn__`
          return tab
        })
        .filter((tab: Tab) => {
          if (seen.has(tab.id)) return false
          seen.add(tab.id)
          return true
        })
      set({ tabs, activeTabId: activeTabId || (tabs.length > 0 ? tabs[0].id : null) })
    } catch { /* ignore */ }
  }
}))
