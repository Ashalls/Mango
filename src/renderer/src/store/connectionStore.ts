import { create } from 'zustand'
import type { ConnectionProfile, ConnectionState, ConnectionFolder } from '@shared/types'
import { trpc } from '@renderer/lib/trpc'

interface ConnectionStore {
  profiles: ConnectionProfile[]
  activeConnection: ConnectionState | null
  connectedIds: string[] // All currently connected profile IDs
  loading: boolean
  folders: ConnectionFolder[]

  loadProfiles: () => Promise<void>
  saveProfile: (profile: Omit<ConnectionProfile, 'id'> & { id?: string }) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  connect: (id: string) => Promise<void>
  disconnect: (id?: string) => Promise<void>
  setActive: (id: string) => Promise<void>
  refreshStatus: () => Promise<void>
  loadFolders: () => Promise<void>
  saveFolder: (name: string, order: number, id?: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  profiles: [],
  activeConnection: null,
  connectedIds: [],
  loading: false,
  folders: [],

  loadProfiles: async () => {
    const profiles = await trpc.connection.list.query()
    set({ profiles })
    await get().loadFolders()
  },

  saveProfile: async (profile) => {
    await trpc.connection.save.mutate(profile)
    await get().loadProfiles()
  },

  deleteProfile: async (id) => {
    await trpc.connection.delete.mutate({ id })
    await get().loadProfiles()
  },

  connect: async (id) => {
    set({ loading: true })
    try {
      const state = await trpc.connection.connect.mutate({ id })
      const status = await trpc.connection.status.query()
      set({
        activeConnection: state,
        connectedIds: status.connectedIds,
        loading: false
      })
    } catch (err) {
      set({
        activeConnection: {
          profileId: id,
          status: 'error',
          error: err instanceof Error ? err.message : 'Connection failed'
        },
        loading: false
      })
    }
  },

  disconnect: async (id) => {
    await trpc.connection.disconnect.mutate({ id })
    const status = await trpc.connection.status.query()
    set({
      activeConnection: status.status === 'connected' ? status : null,
      connectedIds: status.connectedIds
    })
  },

  setActive: async (id) => {
    await trpc.connection.setActive.mutate({ id })
    set({
      activeConnection: { profileId: id, status: 'connected' }
    })
  },

  refreshStatus: async () => {
    const status = await trpc.connection.status.query()
    set({
      activeConnection: status.status === 'connected' ? status : null,
      connectedIds: status.connectedIds
    })
  },

  loadFolders: async () => {
    const folders = await trpc.connection.listFolders.query()
    set({ folders })
  },

  saveFolder: async (name, order, id) => {
    const folders = await trpc.connection.saveFolder.mutate({ id, name, order })
    set({ folders })
  },

  deleteFolder: async (id) => {
    const folders = await trpc.connection.deleteFolder.mutate({ id })
    set({ folders })
    await get().loadProfiles()
  }
}))
