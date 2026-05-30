import { create } from 'zustand'
import { trpc } from '@renderer/lib/trpc'
import type { ClaudeAuthMethod } from '@shared/types'

type Theme = 'light' | 'dark' | 'system'

export type ClaudeModel =
  | 'auto'
  | 'claude-opus-4-8'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5-20251001'

export const CLAUDE_MODELS: { value: ClaudeModel; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' }
]

interface SettingsStore {
  theme: Theme
  effectiveTheme: 'light' | 'dark'
  loaded: boolean
  catSounds: boolean
  documentSplitRatio: number
  claudeModel: ClaudeModel
  claudeAuthMethod: ClaudeAuthMethod
  claudeMaxBudgetUsd: number | null
  setTheme: (theme: Theme) => void
  setCatSounds: (enabled: boolean) => void
  setDocumentSplitRatio: (ratio: number, persist?: boolean) => void
  setClaudeModel: (model: ClaudeModel) => void
  setClaudeAuthMethod: (method: ClaudeAuthMethod) => Promise<void>
  setClaudeMaxBudgetUsd: (usd: number | null) => void
  loadFromSettings: () => Promise<void>
  getEffectiveTheme: () => 'light' | 'dark'
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
}

function applyTheme(theme: Theme): void {
  const effective = resolveTheme(theme)
  document.documentElement.classList.toggle('dark', effective === 'dark')
  document.documentElement.classList.toggle('light', effective === 'light')
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  theme: 'dark',
  effectiveTheme: 'dark',
  loaded: false,
  catSounds: true,
  documentSplitRatio: 0.5,
  claudeModel: 'auto',
  claudeAuthMethod: 'subscription',
  claudeMaxBudgetUsd: null,

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme, effectiveTheme: resolveTheme(theme) })
    trpc.settings.set.mutate({ key: 'theme', value: theme }).catch(() => {})
  },

  setCatSounds: (enabled) => {
    set({ catSounds: enabled })
    trpc.settings.set.mutate({ key: 'catSounds', value: enabled }).catch(() => {})
  },

  setDocumentSplitRatio: (ratio, persist = false) => {
    set({ documentSplitRatio: ratio })
    if (persist) {
      trpc.settings.set.mutate({ key: 'documentSplitRatio', value: ratio }).catch(() => {})
    }
  },

  setClaudeModel: (model) => {
    set({ claudeModel: model })
    trpc.settings.set.mutate({ key: 'claudeModel', value: model }).catch(() => {})
  },

  setClaudeAuthMethod: async (method) => {
    set({ claudeAuthMethod: method })
    // Await persistence so a subsequent re-probe (which reads the method back
    // from disk in the main process) never races a stale value.
    await trpc.settings.set.mutate({ key: 'claudeAuthMethod', value: method }).catch(() => {})
  },

  setClaudeMaxBudgetUsd: (usd) => {
    set({ claudeMaxBudgetUsd: usd })
    trpc.settings.set.mutate({ key: 'claudeMaxBudgetUsd', value: usd }).catch(() => {})
  },

  loadFromSettings: async () => {
    try {
      const [savedTheme, savedCatSounds, savedSplit, savedModel, savedAuthMethod, savedBudget] = await Promise.all([
        trpc.settings.get.query({ key: 'theme' }) as Promise<Theme | null>,
        trpc.settings.get.query({ key: 'catSounds' }) as Promise<boolean | null>,
        trpc.settings.get.query({ key: 'documentSplitRatio' }) as Promise<number | null>,
        trpc.settings.get.query({ key: 'claudeModel' }) as Promise<ClaudeModel | null>,
        trpc.settings.get.query({ key: 'claudeAuthMethod' }) as Promise<ClaudeAuthMethod | null>,
        trpc.settings.get.query({ key: 'claudeMaxBudgetUsd' }) as Promise<number | null>
      ])
      if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
        applyTheme(savedTheme)
        set({ theme: savedTheme, effectiveTheme: resolveTheme(savedTheme) })
      }
      if (savedCatSounds !== null && savedCatSounds !== undefined) {
        set({ catSounds: savedCatSounds })
      }
      if (typeof savedSplit === 'number' && savedSplit > 0 && savedSplit < 1) {
        set({ documentSplitRatio: savedSplit })
      }
      if (savedModel && CLAUDE_MODELS.some((m) => m.value === savedModel)) {
        set({ claudeModel: savedModel })
      }
      if (savedAuthMethod === 'subscription' || savedAuthMethod === 'apiKey') {
        set({ claudeAuthMethod: savedAuthMethod })
      }
      if (typeof savedBudget === 'number' || savedBudget === null) {
        set({ claudeMaxBudgetUsd: savedBudget })
      }
    } catch { /* tRPC not ready yet */ }
    applyTheme(get().theme)
    set({ loaded: true })
  },

  getEffectiveTheme: () => {
    const { theme } = get()
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return theme
  }
}))

// Apply dark immediately to prevent flash, then load saved preference
applyTheme('dark')

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useSettingsStore.getState().theme === 'system') {
    applyTheme('system')
    useSettingsStore.setState({ effectiveTheme: resolveTheme('system') })
  }
})
