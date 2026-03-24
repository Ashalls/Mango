import { create } from 'zustand'
import { trpc } from '@renderer/lib/trpc'

type Theme = 'light' | 'dark' | 'system'

interface ThemeStore {
  theme: Theme
  loaded: boolean
  setTheme: (theme: Theme) => void
  loadFromSettings: () => Promise<void>
  getEffectiveTheme: () => 'light' | 'dark'
}

function applyTheme(theme: Theme): void {
  const effective = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme

  document.documentElement.classList.toggle('dark', effective === 'dark')
  document.documentElement.classList.toggle('light', effective === 'light')
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: 'dark',
  loaded: false,

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    // Persist to settings file via main process
    trpc.settings.set.mutate({ key: 'theme', value: theme }).catch(() => {})
  },

  loadFromSettings: async () => {
    try {
      const saved = await trpc.settings.get.query({ key: 'theme' }) as Theme | null
      if (saved && ['light', 'dark', 'system'].includes(saved)) {
        applyTheme(saved)
        set({ theme: saved, loaded: true })
        return
      }
    } catch { /* tRPC not ready yet */ }
    applyTheme('dark')
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
  if (useThemeStore.getState().theme === 'system') {
    applyTheme('system')
  }
})
