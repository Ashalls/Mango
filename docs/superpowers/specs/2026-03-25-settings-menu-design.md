# Settings Menu & README Update — Design Spec

## Overview

Add a settings popover to the TopBar that consolidates app preferences (theme selection and cat sounds toggle), replacing the current standalone theme cycle button. Update the README to reflect the current state of the application.

## Settings Popover

### Location & Trigger

- Replace the existing theme cycle button (Moon/Sun/Monitor icons) in `TopBar.tsx` with a Lucide `Settings` (gear) icon
- Clicking the gear icon opens a shadcn/ui `Popover` anchored to the icon

### Popover Contents

**Theme Selector** — 3-segment toggle using existing Moon/Sun/Monitor Lucide icons:
- Light (Sun icon)
- Dark (Moon icon)
- System (Monitor icon)
- Visually highlights the active selection
- Behavior identical to current cycle button, just presented as a grouped toggle

**Cat Sounds Toggle** — labeled switch:
- Label: "Cat Sounds"
- Subtitle: "Meow, purr & hiss effects"
- shadcn/ui `Switch` component
- Default: ON (enabled)

### State Management

Expand `themeStore.ts` into a general `settingsStore.ts`:
- Retains all existing theme state and logic (`theme`, `setTheme`, `initTheme`)
- Adds `catSounds: boolean` (default: `true`)
- Adds `setCatSounds(enabled: boolean)` action
- Adds `initCatSounds()` that loads from `trpc.settings.get({ key: 'catSounds' })`
- Persists changes via `trpc.settings.set({ key: 'catSounds', value: boolean })`

### Cat Sounds Gating

All three sound effects check the `catSounds` setting before playing:

1. **Launch meow** (`CatMode.tsx`): Check `useSettingsStore.getState().catSounds` before playing `meow.mp3`
2. **Success purr** (`ClaudePanel.tsx`): Check store before calling `playPurr()`
3. **Failure hiss** (`ClaudePanel.tsx`): Check store before calling `playHiss()`

When `catSounds` is toggled off, all sounds are suppressed immediately — no restart required.

## README Update

Update `README.md` to accurately reflect the current application state:
- Add cat sounds to feature list
- Add persistent chat history
- Add drag-field-onto-filter functionality
- Add settings menu description
- Refresh any outdated descriptions
- Do not mention mongosh (work in progress)

## Files to Modify

| File | Change |
|------|--------|
| `src/renderer/src/components/layout/TopBar.tsx` | Replace theme cycle button with gear icon + Popover containing settings UI |
| `src/renderer/src/store/themeStore.ts` | Rename to `settingsStore.ts`, add `catSounds` state + persistence |
| `src/renderer/src/components/fun/CatMode.tsx` | Gate meow playback on `catSounds` setting |
| `src/renderer/src/components/claude/ClaudePanel.tsx` | Gate purr/hiss playback on `catSounds` setting |
| `src/renderer/src/App.tsx` | Update import if store name changes |
| `README.md` | Refresh to reflect current feature set |

No new files are created beyond the store rename.

## Design Decisions

- **Popover over modal/page**: Only 2 settings right now — a full page would be overkill. Popover is proportional and fast to access.
- **Segmented toggle over dropdown for theme**: More visual, shows all 3 options at a glance, consistent with the icon-based approach already in use.
- **Cat sounds default ON**: They're a signature part of the app's personality. Users who prefer silence can toggle off easily.
- **Store rename over new store**: Theme and cat sounds are both app-level preferences — one store keeps it simple.
