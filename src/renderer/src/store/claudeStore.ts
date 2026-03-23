import { create } from 'zustand'
import type { ChatMessage } from '@shared/types'

interface ClaudeStore {
  messages: ChatMessage[]
  isStreaming: boolean
  isPanelOpen: boolean

  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  setStreaming: (streaming: boolean) => void
  togglePanel: () => void
  setPanelOpen: (open: boolean) => void
  clearMessages: () => void
}

export const useClaudeStore = create<ClaudeStore>((set) => ({
  messages: [],
  isStreaming: false,
  isPanelOpen: true,

  addMessage: (message) => {
    set((state) => ({ messages: [...state.messages, message] }))
  },

  updateMessage: (id, updates) => {
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...updates } : m))
    }))
  },

  setStreaming: (streaming) => set({ isStreaming: streaming }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  setPanelOpen: (open) => set({ isPanelOpen: open }),
  clearMessages: () => set({ messages: [] })
}))
