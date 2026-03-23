import { create } from 'zustand'

type Theme = 'light' | 'dark' | 'system'

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
  getEffectiveTheme: () => 'light' | 'dark'
}

const THEME_KEY = 'mongolens:theme'

function applyTheme(theme: Theme): void {
  const effective = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme

  document.documentElement.classList.toggle('dark', effective === 'dark')
  document.documentElement.classList.toggle('light', effective === 'light')
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: (localStorage.getItem(THEME_KEY) as Theme) || 'dark',

  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    applyTheme(theme)
    set({ theme })
  },

  getEffectiveTheme: () => {
    const { theme } = get()
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return theme
  }
}))

// Initialize on load
applyTheme(useThemeStore.getState().theme)

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useThemeStore.getState().theme === 'system') {
    applyTheme('system')
  }
})
