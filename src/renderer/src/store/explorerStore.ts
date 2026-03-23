import { create } from 'zustand'
import type { DatabaseInfo, CollectionInfo } from '@shared/types'
import { trpc } from '@renderer/lib/trpc'

interface ExplorerStore {
  databases: DatabaseInfo[]
  collections: Record<string, CollectionInfo[]> // keyed by database name
  selectedDatabase: string | null
  selectedCollection: string | null
  loading: boolean

  loadDatabases: () => Promise<void>
  loadCollections: (database: string) => Promise<void>
  selectDatabase: (database: string) => void
  selectCollection: (database: string, collection: string) => void
  clear: () => void
}

export const useExplorerStore = create<ExplorerStore>((set, get) => ({
  databases: [],
  collections: {},
  selectedDatabase: null,
  selectedCollection: null,
  loading: false,

  loadDatabases: async () => {
    set({ loading: true })
    try {
      const databases = await trpc.explorer.listDatabases.query()
      set({ databases, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  loadCollections: async (database) => {
    const collections = await trpc.explorer.listCollections.query({ database })
    set((state) => ({
      collections: { ...state.collections, [database]: collections }
    }))
  },

  selectDatabase: (database) => {
    set({ selectedDatabase: database, selectedCollection: null })
    // Auto-load collections
    if (!get().collections[database]) {
      get().loadCollections(database)
    }
  },

  selectCollection: (database, collection) => {
    set({ selectedDatabase: database, selectedCollection: collection })
  },

  clear: () => {
    set({
      databases: [],
      collections: {},
      selectedDatabase: null,
      selectedCollection: null
    })
  }
}))
