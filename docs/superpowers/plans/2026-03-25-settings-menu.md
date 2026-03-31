# Settings Menu & README Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings popover in the TopBar with theme selector and cat sounds toggle, and update the README to reflect the current app state.

**Architecture:** Replace the existing theme cycle button in TopBar with a gear icon that opens a shadcn/ui Popover. The popover contains a segmented theme toggle (Light/Dark/System) and a Switch for cat sounds. State is managed by expanding the existing Zustand theme store into a general settings store. Cat sounds are gated on the store value throughout.

**Tech Stack:** React 19, TypeScript, Zustand, shadcn/ui (Radix Popover + Switch primitives), Tailwind CSS 4, tRPC

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/renderer/src/store/settingsStore.ts` | Create (rename from `themeStore.ts`) | Theme + catSounds state, persistence via tRPC |
| `src/renderer/src/components/ui/popover.tsx` | Create | shadcn/ui Popover component (Radix primitive wrapper) |
| `src/renderer/src/components/ui/switch.tsx` | Create | shadcn/ui Switch component (Radix primitive wrapper) |
| `src/renderer/src/components/layout/TopBar.tsx` | Modify | Replace theme cycle button with gear icon + settings popover |
| `src/renderer/src/components/fun/CatMode.tsx` | Modify | Gate all sounds on `catSounds` setting |
| `src/renderer/src/components/data/DocumentEditor.tsx` | Modify | Update import path |
| `src/renderer/src/components/data/DocumentTable.tsx` | Modify | Update import path |
| `src/renderer/src/App.tsx` | Modify | Update import, load catSounds on init |
| `src/renderer/src/main.tsx` | Modify | Update import path |
| `src/renderer/src/store/themeStore.ts` | Delete | Replaced by settingsStore.ts |
| `README.md` | Modify | Refresh feature list to reflect current state |

---

### Task 1: Install Radix Popover and Switch primitives

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

Run:
```bash
pnpm add @radix-ui/react-popover @radix-ui/react-switch
```

- [ ] **Step 2: Verify installation**

Run: `pnpm list @radix-ui/react-popover @radix-ui/react-switch`
Expected: Both packages listed with versions

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add radix popover and switch primitives"
```

---

### Task 2: Create shadcn/ui Popover component

**Files:**
- Create: `src/renderer/src/components/ui/popover.tsx`

- [ ] **Step 1: Create the Popover component**

```tsx
import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'

import { cn } from '@renderer/lib/utils'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
```

- [ ] **Step 2: Verify the `cn` utility exists**

Check that `src/renderer/src/lib/utils.ts` exports a `cn` function (used by shadcn components). If it doesn't exist, create it:

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Install deps if needed: `pnpm add clsx tailwind-merge`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ui/popover.tsx
git commit -m "feat: add shadcn/ui Popover component"
```

---

### Task 3: Create shadcn/ui Switch component

**Files:**
- Create: `src/renderer/src/components/ui/switch.tsx`

- [ ] **Step 1: Create the Switch component**

```tsx
import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'

import { cn } from '@renderer/lib/utils'

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0'
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/ui/switch.tsx
git commit -m "feat: add shadcn/ui Switch component"
```

---

### Task 4: Create settingsStore (expand themeStore)

**Files:**
- Create: `src/renderer/src/store/settingsStore.ts`
- Delete: `src/renderer/src/store/themeStore.ts`

- [ ] **Step 1: Create settingsStore.ts**

Create `src/renderer/src/store/settingsStore.ts` with the full contents of the current `themeStore.ts` plus the new `catSounds` state:

```ts
import { create } from 'zustand'
import { trpc } from '@renderer/lib/trpc'

type Theme = 'light' | 'dark' | 'system'

interface SettingsStore {
  theme: Theme
  loaded: boolean
  catSounds: boolean
  setTheme: (theme: Theme) => void
  setCatSounds: (enabled: boolean) => void
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

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  theme: 'dark',
  loaded: false,
  catSounds: true,

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
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
        set({ theme: savedTheme })
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
  }
})
```

- [ ] **Step 2: Delete themeStore.ts**

```bash
rm src/renderer/src/store/themeStore.ts
```

- [ ] **Step 3: Update all imports**

Update every file that imports from `themeStore` to import from `settingsStore` instead. The import name changes from `useThemeStore` to `useSettingsStore`.

Files to update (5 total):
- `src/renderer/src/main.tsx`: Change `import './store/themeStore'` → `import './store/settingsStore'`
- `src/renderer/src/App.tsx`: Change import `useThemeStore` → `useSettingsStore`, update `useThemeStore.getState().loadFromSettings()` → `useSettingsStore.getState().loadFromSettings()`
- `src/renderer/src/components/layout/TopBar.tsx`: Change import and `useThemeStore` → `useSettingsStore`
- `src/renderer/src/components/data/DocumentEditor.tsx`: Change import and `useThemeStore` → `useSettingsStore`
- `src/renderer/src/components/data/DocumentTable.tsx`: Change import and `useThemeStore` → `useSettingsStore`

- [ ] **Step 4: Verify the app compiles**

Run: `pnpm build` (or `pnpm dev` and check for errors)
Expected: No import errors, app starts normally

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/settingsStore.ts src/renderer/src/main.tsx src/renderer/src/App.tsx src/renderer/src/components/layout/TopBar.tsx src/renderer/src/components/data/DocumentEditor.tsx src/renderer/src/components/data/DocumentTable.tsx
git rm src/renderer/src/store/themeStore.ts
git commit -m "refactor: rename themeStore to settingsStore, add catSounds setting"
```

---

### Task 5: Gate cat sounds on settings

**Files:**
- Modify: `src/renderer/src/components/fun/CatMode.tsx`
- Modify: `src/renderer/src/components/claude/ClaudePanel.tsx`

- [ ] **Step 1: Update CatMode.tsx to check catSounds before playing meow**

Replace the `CatMode` component to read from the settings store:

```tsx
import { useEffect } from 'react'
import { useSettingsStore } from '@renderer/store/settingsStore'

import meowSound from '../../../../../resources/sounds/meow.mp3'
import purrSound from '../../../../../resources/sounds/purr.mp3'
import hissSound from '../../../../../resources/sounds/hiss.mp3'

export function playPurr() {
  if (!useSettingsStore.getState().catSounds) return
  try {
    const audio = new Audio(purrSound)
    audio.volume = 0.3
    audio.play().catch(() => {})
  } catch {}
}

export function playHiss() {
  if (!useSettingsStore.getState().catSounds) return
  try {
    const audio = new Audio(hissSound)
    audio.volume = 0.3
    audio.play().catch(() => {})
  } catch {}
}

export function CatMode() {
  useEffect(() => {
    if (!useSettingsStore.getState().catSounds) return
    const timer = setTimeout(() => {
      try {
        const audio = new Audio(meowSound)
        audio.volume = 0.4
        audio.play().catch(() => {})
      } catch {}
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  return null
}
```

All three functions use `getState()` (non-reactive/imperative) to check `catSounds`:
- `playPurr`/`playHiss`: called imperatively from ClaudePanel event handlers
- `CatMode`: checks once on mount with `[]` dependency — meow only plays on fresh app start, never re-triggers on toggle

No changes needed in `ClaudePanel.tsx` — the gate is inside `playPurr`/`playHiss` themselves.

- [ ] **Step 2: Verify ClaudePanel still calls playPurr/playHiss correctly**

Check that `src/renderer/src/components/claude/ClaudePanel.tsx:11` still imports from `@renderer/components/fun/CatMode`. No changes needed in this file.

- [ ] **Step 3: Test manually**

1. Launch app — should hear meow
2. Open settings, toggle cat sounds OFF
3. Trigger a Claude query — should NOT hear purr/hiss
4. Restart app — should NOT hear meow (setting persisted)
5. Toggle cat sounds ON, trigger Claude — should hear purr/hiss again

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/fun/CatMode.tsx
git commit -m "feat: gate cat sounds on catSounds setting"
```

---

### Task 6: Build the Settings Popover in TopBar

**Files:**
- Modify: `src/renderer/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Replace the theme cycle button with settings popover**

Update `TopBar.tsx` to:
1. Remove the `cycleTheme` function and `themeIcon` variable
2. Import `Settings`, `Sun`, `Moon`, `Monitor` from lucide-react
3. Import `Popover`, `PopoverTrigger`, `PopoverContent` from the new popover component
4. Import `Switch` from the new switch component
5. Import `useSettingsStore` instead of `useThemeStore`
6. Add the popover UI replacing the old theme button (lines 94-102)

The new TopBar should replace the theme `<Button>` block (lines 94-102) with:

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      title="Settings"
    >
      <Settings className="h-4 w-4" />
    </Button>
  </PopoverTrigger>
  <PopoverContent align="end" className="w-64">
    <div className="space-y-4">
      <h4 className="text-sm font-medium">Settings</h4>

      {/* Theme selector */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Theme</label>
        <div className="flex gap-1 rounded-md bg-muted p-1">
          {([
            { value: 'light' as const, icon: Sun, label: 'Light' },
            { value: 'dark' as const, icon: Moon, label: 'Dark' },
            { value: 'system' as const, icon: Monitor, label: 'System' }
          ]).map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-xs transition-colors',
                theme === value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setTheme(value)}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Cat sounds toggle */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <label className="text-sm">Cat Sounds</label>
          <p className="text-xs text-muted-foreground">Meow, purr & hiss effects</p>
        </div>
        <Switch
          checked={catSounds}
          onCheckedChange={setCatSounds}
        />
      </div>
    </div>
  </PopoverContent>
</Popover>
```

Destructure from the store at the top of the component:
```tsx
const { theme, setTheme, catSounds, setCatSounds } = useSettingsStore()
```

Import `cn` from `@renderer/lib/utils`.

- [ ] **Step 2: Verify the popover works**

Run the app, click the gear icon in the top-right. The popover should open showing:
- Segmented theme toggle with Light/Dark/System
- Cat Sounds switch (ON by default)
- Theme changes apply immediately
- Cat sounds toggle persists across app restarts

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/layout/TopBar.tsx
git commit -m "feat: add settings popover with theme and cat sounds controls"
```

---

### Task 7: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

Key changes to make:
1. **Features list** — add these items:
   - `Cat sounds` — audio feedback (meow on launch, purr on success, hiss on failure) with toggle in settings
   - `Persistent chat history` — Claude conversations are saved and can be resumed
   - `Drag-and-drop query building` — drag fields onto filter rows to build queries
   - `Settings menu` — configurable theme and sound preferences
   - Update "Dark/light theme" to mention "with system preference support"
2. **Project structure** — add `resources/sounds/` to the tree
3. Keep everything else as-is, no mention of mongosh

- [ ] **Step 2: Review the README reads well**

Read through the updated README to ensure accuracy and flow.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README to reflect current feature set"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run the app end-to-end**

Run: `pnpm dev`

Verify:
1. App starts, meow plays (cat sounds default ON)
2. Gear icon visible in TopBar top-right
3. Click gear → popover opens with theme toggle and cat sounds switch
4. Theme toggle works: Light/Dark/System all apply correctly
5. Toggle cat sounds OFF → no more sounds on Claude operations
6. Restart app → cat sounds still OFF (persisted), no meow on launch
7. Toggle cat sounds ON → meow does NOT replay (only on fresh app start), but purr/hiss resume on Claude operations
8. Claude panel toggle button still works

- [ ] **Step 2: Build check**

Run: `pnpm build`
Expected: Clean build, no errors

- [ ] **Step 3: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: settings menu polish"
```
