import { create } from 'zustand'
import type { ChatMessage, ClaudeAvailability } from '@shared/types'

interface ClaudeStore {
  messages: ChatMessage[]
  isStreaming: boolean
  isPanelOpen: boolean
  availability: ClaudeAvailability
  setAvailability: (a: ClaudeAvailability) => void

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
  availability: { status: 'unknown', method: 'subscription', checkedAt: 0 },

  addMessage: (message) => {
    set((state) => ({ messages: [...state.messages, message] }))
  },

  updateMessage: (id, updates) => {
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...updates } : m))
    }))
  },

  setAvailability: (a) => set({ availability: a }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  setPanelOpen: (open) => set({ isPanelOpen: open }),
  clearMessages: () => set({ messages: [] })
}))
