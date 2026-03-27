import { create } from 'zustand'
import { trpc } from '@renderer/lib/trpc'

type Theme = 'light' | 'dark' | 'system'

interface SettingsStore {
  theme: Theme
  effectiveTheme: 'light' | 'dark'
  loaded: boolean
  catSounds: boolean
  setTheme: (theme: Theme) => void
  setCatSounds: (enabled: boolean) => void
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

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme, effectiveTheme: resolveTheme(theme) })
    trpc.settings.set.mutate({ key: 'theme', value: theme }).catch(() => {})
  },

  setCatSounds: (enabled) => {
    set({ catSounds: enabled })
    trpc.settings.set.mutate({ key: 'catSounds', value: enabled }).catch(() => {})
  },

  loadFromSettings: async () => {
    try {
      const [savedTheme, savedCatSounds] = await Promise.all([
        trpc.settings.get.query({ key: 'theme' }) as Promise<Theme | null>,
        trpc.settings.get.query({ key: 'catSounds' }) as Promise<boolean | null>
      ])
      if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
        applyTheme(savedTheme)
        set({ theme: savedTheme, effectiveTheme: resolveTheme(savedTheme) })
      }
      if (savedCatSounds !== null && savedCatSounds !== undefined) {
        set({ catSounds: savedCatSounds })
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
