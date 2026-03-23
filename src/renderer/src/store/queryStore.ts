import { create } from 'zustand'
import type { QueryResult } from '@shared/types'
import { trpc } from '@renderer/lib/trpc'
import { DEFAULT_PAGE_SIZE } from '@shared/constants'

interface QueryStore {
  filter: Record<string, unknown>
  projection: Record<string, number> | null
  sort: Record<string, number> | null
  page: number
  pageSize: number
  results: QueryResult | null
  loading: boolean
  error: string | null

  setFilter: (filter: Record<string, unknown>) => void
  setProjection: (projection: Record<string, number> | null) => void
  setSort: (sort: Record<string, number> | null) => void
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  executeQuery: (database: string, collection: string) => Promise<void>
  clear: () => void
}

export const useQueryStore = create<QueryStore>((set, get) => ({
  filter: {},
  projection: null,
  sort: null,
  page: 0,
  pageSize: DEFAULT_PAGE_SIZE,
  results: null,
  loading: false,
  error: null,

  setFilter: (filter) => set({ filter }),
  setProjection: (projection) => set({ projection }),
  setSort: (sort) => set({ sort }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 0 }),

  executeQuery: async (database, collection) => {
    const { filter, projection, sort, page, pageSize } = get()
    set({ loading: true, error: null })
    try {
      const results = await trpc.query.find.query({
        database,
        collection,
        filter,
        projection: projection ?? undefined,
        sort: sort ?? undefined,
        skip: page * pageSize,
        limit: pageSize
      })
      set({ results, loading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Query failed',
        loading: false
      })
    }
  },

  clear: () => {
    set({
      filter: {},
      projection: null,
      sort: null,
      page: 0,
      results: null,
      error: null
    })
  }
}))
