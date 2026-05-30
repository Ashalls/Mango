# Claude Auth-Method Toggle, Availability Gating & Cost Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect whether the user's selected Claude auth method (subscription vs. API key) can actually run, gate the three AI entry points on it with a method-aware onboarding screen, and surface per-message/per-chat cost.

**Architecture:** Main process owns a cached `ClaudeAvailability` produced by a startup SDK micro-probe (keyed on the SDK's typed `assistant.error`/`result.subtype`), pushed to the renderer via a `claude:availability` IPC event and read from `claudeStore`. An explicit `claudeAuthMethod` toggle decides whether an encrypted, `safeStorage`-backed `ANTHROPIC_API_KEY` is injected into the SDK child env; subscription mode strips ambient keys. The result message's `usage`/`total_cost_usd` flow to a per-message footer and a per-chat total. No silent fallback between auth methods.

**Tech Stack:** Electron (main/preload/renderer), electron-vite, tRPC over IPC (electron-trpc), zustand, React 19, Tailwind, `@anthropic-ai/claude-agent-sdk@0.1.77`.

**Verification note:** This repo has **no test runner** (the only `*.test.ts` live in `node_modules`). Gates are `npm run typecheck:node` (main-process types) and `npm run build` (full bundle), plus a manual matrix in the final task. `npm run typecheck` / `typecheck:web` are pre-broken with unrelated errors (project memory) — do **not** treat them as gates. Establish a green baseline first: run `npm run typecheck:node` and `npm run build` before Task 1 and confirm they pass as they do on `main`.

**Spec:** `docs/superpowers/specs/2026-05-30-claude-availability-gating-design.md`

---

### Task 1: Shared types + secret-file constant

**Files:**
- Modify: `src/shared/types.ts` (append)
- Modify: `src/main/constants.ts`

- [ ] **Step 1: Add the Claude types to `src/shared/types.ts`**

Append at the end of the file:

```ts
export type ClaudeAuthMethod = 'subscription' | 'apiKey'

export type ClaudeAvailabilityStatus =
  | 'unknown'
  | 'checking'
  | 'ready'
  | 'unauthenticated'
  | 'cli-error'
  | 'error'

export interface ClaudeAvailability {
  status: ClaudeAvailabilityStatus
  method: ClaudeAuthMethod
  detail?: string
  checkedAt: number
}

export interface ClaudeUsage {
  model: string
  inputTokens: number
  outputTokens: number
  costUsd?: number
}
```

- [ ] **Step 2: Add `usage` to the `ChatMessage` interface in `src/shared/types.ts`**

Find the `ChatMessage` interface and add the optional field (alongside `toolCalls`):

```ts
  usage?: ClaudeUsage
```

- [ ] **Step 3: Add the secret-file constant to `src/main/constants.ts`**

Add after the `SETTINGS_FILE` line:

```ts
export const CLAUDE_SECRET_FILE = join(CONFIG_DIR, 'claude.json')
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:node`
Expected: completes with no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/constants.ts
git commit -m "feat(claude): add availability/usage/auth-method types + secret-file constant" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Encrypted API-key storage in config

**Files:**
- Modify: `src/main/services/config.ts`

- [ ] **Step 1: Extend the fs + constants imports**

Change the top two imports:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { CONFIG_DIR, CONNECTIONS_FILE, FOLDERS_FILE, SETTINGS_FILE, CLAUDE_SECRET_FILE } from '../constants'
```

- [ ] **Step 2: Add the key functions at the end of `config.ts`**

```ts
export function hasClaudeApiKey(): boolean {
  ensureConfigDir()
  return existsSync(CLAUDE_SECRET_FILE)
}

export function loadClaudeApiKey(): string | null {
  ensureConfigDir()
  if (!existsSync(CLAUDE_SECRET_FILE)) return null
  try {
    const data = JSON.parse(readFileSync(CLAUDE_SECRET_FILE, 'utf-8')) as { apiKey?: string }
    if (!data.apiKey) return null
    if (data.apiKey.startsWith('encrypted:')) {
      if (!isEncryptionAvailable()) return null
      return safeStorage.decryptString(Buffer.from(data.apiKey.slice(10), 'base64'))
    }
    return data.apiKey
  } catch (err) {
    console.error('Failed to load Claude API key:', err)
    return null
  }
}

export function saveClaudeApiKey(key: string): { ok: boolean; reason?: string } {
  ensureConfigDir()
  const trimmed = key.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }
  if (!isEncryptionAvailable()) return { ok: false, reason: 'encryption-unavailable' }
  const enc = 'encrypted:' + safeStorage.encryptString(trimmed).toString('base64')
  writeFileSync(CLAUDE_SECRET_FILE, JSON.stringify({ apiKey: enc }, null, 2))
  return { ok: true }
}

export function clearClaudeApiKey(): void {
  if (existsSync(CLAUDE_SECRET_FILE)) rmSync(CLAUDE_SECRET_FILE)
}
```

(`safeStorage` and `isEncryptionAvailable` already exist in this file.)

- [ ] **Step 2b: Reason through the round-trip (no runner to assert it)**

Confirm by reading: `saveClaudeApiKey('sk-ant-x')` writes `{ "apiKey": "encrypted:…" }`; `loadClaudeApiKey()` returns `'sk-ant-x'`; `hasClaudeApiKey()` is `true`; after `clearClaudeApiKey()` the file is gone and `hasClaudeApiKey()` is `false`. With `safeStorage` unavailable, `saveClaudeApiKey` returns `{ ok: false, reason: 'encryption-unavailable' }` and writes nothing.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:node`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/config.ts
git commit -m "feat(claude): encrypted safeStorage helpers for the Anthropic API key" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `claude.ts` — method-aware spawn options, model resolution, cost emit

**Files:**
- Modify: `src/main/services/claude.ts`

- [ ] **Step 1: Import the auth-method type**

Add to the imports near the top:

```ts
import type { ClaudeAuthMethod } from '@shared/types'
```

- [ ] **Step 2: Replace `getClaudeExecutablePath` + `getSpawnOverrides` with `buildSdkSpawnOptions` + `resolveModel`**

Delete both existing functions (`getClaudeExecutablePath` at lines ~15-25 and `getSpawnOverrides` at ~34-43) and add:

```ts
/**
 * Executable + env wiring shared by sendMessage and the availability probe.
 * - Packaged builds run the asar-unpacked cli.js via Electron-as-node.
 * - On the apiKey method we inject the stored ANTHROPIC_API_KEY.
 * - On the subscription method we STRIP ambient ANTHROPIC_API_KEY/AUTH_TOKEN so a
 *   key in the user's shell can't silently cause metered billing.
 */
export function buildSdkSpawnOptions(): {
  pathToClaudeCodeExecutable?: string
  executable?: 'node' | 'bun' | 'deno'
  env?: NodeJS.ProcessEnv
} {
  const method: ClaudeAuthMethod =
    configService.loadSettings().claudeAuthMethod === 'apiKey' ? 'apiKey' : 'subscription'
  const env: NodeJS.ProcessEnv = { ...process.env }

  if (method === 'apiKey') {
    const key = configService.loadClaudeApiKey()
    if (key) env.ANTHROPIC_API_KEY = key
  } else {
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
  }

  const opts: { pathToClaudeCodeExecutable?: string; executable?: 'node' | 'bun' | 'deno'; env: NodeJS.ProcessEnv } = { env }
  if (app.isPackaged) {
    opts.pathToClaudeCodeExecutable = join(
      process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'
    )
    opts.executable = process.execPath as 'node'
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  return opts
}

/** 'auto' → Haiku on the apiKey path (cheap), Sonnet on subscription. */
export function resolveModel(requested: string | undefined, method: ClaudeAuthMethod): string {
  if (requested && requested !== 'auto') return requested
  return method === 'apiKey' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6'
}
```

- [ ] **Step 3: Compute method/model/budget at the top of `sendMessage`**

In `sendMessage`, immediately after `activeAbortController = new AbortController()`:

```ts
  const settings = configService.loadSettings()
  const method: ClaudeAuthMethod = settings.claudeAuthMethod === 'apiKey' ? 'apiKey' : 'subscription'
  const model = resolveModel(opts.model, method)
  const maxBudgetUsd =
    method === 'apiKey' && typeof settings.claudeMaxBudgetUsd === 'number' && settings.claudeMaxBudgetUsd > 0
      ? settings.claudeMaxBudgetUsd
      : null
```

- [ ] **Step 4: Use the helpers in the `claudeQuery` options**

Replace these lines in the `options` object:

```ts
        pathToClaudeCodeExecutable: getClaudeExecutablePath(),
        ...getSpawnOverrides(),
        systemPrompt: buildSystemPrompt(context),
        model: opts.model || 'claude-sonnet-4-6',
```

with:

```ts
        ...buildSdkSpawnOptions(),
        systemPrompt: buildSystemPrompt(context),
        model,
        ...(maxBudgetUsd != null ? { maxBudgetUsd } : {}),
```

- [ ] **Step 5: Emit `usage` at the result message**

In the `else if (msg.type === 'result')` branch, replace the existing `emitToRenderer('claude:stream-end', { … })` call with:

```ts
        const u = (msg as { usage?: { input_tokens?: number; output_tokens?: number } }).usage
        emitToRenderer('claude:stream-end', {
          messageId,
          text: finalText,
          lastTurnText,
          cost: 'total_cost_usd' in msg ? msg.total_cost_usd : undefined,
          usage: u
            ? {
                model,
                inputTokens: u.input_tokens ?? 0,
                outputTokens: u.output_tokens ?? 0,
                costUsd: 'total_cost_usd' in msg ? (msg as { total_cost_usd?: number }).total_cost_usd : undefined
              }
            : undefined
        })
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck:node`
Expected: no new errors (note `buildSdkSpawnOptions`/`resolveModel` are now exported for Task 4).

- [ ] **Step 7: Commit**

```bash
git add src/main/services/claude.ts
git commit -m "feat(claude): method-aware spawn env + auto model resolution + usage emit" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `claudeHealth.ts` — the availability probe

**Files:**
- Create: `src/main/services/claudeHealth.ts`

- [ ] **Step 1: Write the service**

```ts
import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk'
import { buildSdkSpawnOptions } from './claude'
import * as configService from './config'
import type { ClaudeAuthMethod, ClaudeAvailability, ClaudeAvailabilityStatus } from '@shared/types'

function currentMethod(): ClaudeAuthMethod {
  return configService.loadSettings().claudeAuthMethod === 'apiKey' ? 'apiKey' : 'subscription'
}

let current: ClaudeAvailability = { status: 'unknown', method: 'subscription', checkedAt: 0 }
let inFlight: Promise<ClaudeAvailability> | null = null
const listeners = new Set<(a: ClaudeAvailability) => void>()

export function getAvailability(): ClaudeAvailability {
  return current
}

export function onAvailabilityChange(cb: (a: ClaudeAvailability) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function publish(a: ClaudeAvailability): ClaudeAvailability {
  current = a
  for (const cb of listeners) {
    try {
      cb(a)
    } catch (e) {
      console.error('availability listener failed:', e)
    }
  }
  return a
}

const AUTH_HINTS = [
  'authentication', 'unauthorized', 'not logged in', 'log in', 'login', 'credential',
  'api key', 'api_key', '401', '403', 'oauth', 'invalid x-api-key', 'expired', 'please run'
]

/** Pure: map a thrown error / result-error string to a status. */
export function classifyProbeError(err: unknown): { status: ClaudeAvailabilityStatus; detail?: string } {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (
    lower.includes('enoent') || lower.includes('spawn') ||
    lower.includes('command not found') || lower.includes('cannot find') || lower.includes('no such file')
  ) {
    return { status: 'cli-error', detail: message }
  }
  if (AUTH_HINTS.some((h) => lower.includes(h))) return { status: 'unauthenticated', detail: message }
  return { status: 'error', detail: message }
}

export function probe(): Promise<ClaudeAvailability> {
  if (inFlight) return inFlight
  publish({ ...current, status: 'checking' })
  inFlight = runProbe().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runProbe(): Promise<ClaudeAvailability> {
  const method = currentMethod()

  // apiKey method with no stored key: don't spawn — there's nothing to test.
  if (method === 'apiKey' && !configService.hasClaudeApiKey()) {
    return publish({ status: 'unauthenticated', method, detail: 'No API key set', checkedAt: Date.now() })
  }

  const abort = new AbortController()
  let done: ClaudeAvailability | null = null
  try {
    const q = claudeQuery({
      prompt: 'ping',
      options: {
        ...buildSdkSpawnOptions(),
        model: method === 'apiKey' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6',
        maxTurns: 1,
        maxBudgetUsd: 0.05,
        abortController: abort,
        mcpServers: {},
        allowedTools: [],
        permissionMode: 'default'
      }
    })

    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const err = (msg as { error?: string }).error
        if (err === 'authentication_failed') {
          done = { status: 'unauthenticated', method, detail: 'Authentication failed', checkedAt: Date.now() }
        } else if (err === 'billing_error') {
          done = { status: 'error', method, detail: 'Billing error — check your Anthropic plan or credits', checkedAt: Date.now() }
        } else if (!err || err === 'rate_limit') {
          // No error, or merely throttled — credentials are valid.
          done = { status: 'ready', method, checkedAt: Date.now() }
        } else {
          done = { status: 'error', method, detail: err, checkedAt: Date.now() }
        }
        break
      }
      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          done = { status: 'ready', method, checkedAt: Date.now() }
        } else {
          const errs = (msg as { errors?: string[] }).errors?.join(' ') ?? msg.subtype
          done = { ...classifyProbeError(errs), method, checkedAt: Date.now() }
        }
        break
      }
      // system/init, user (tool results), stream_event → keep waiting
    }

    abort.abort() // stop the in-flight turn once we have a verdict
    if (!done) done = { status: 'error', method, detail: 'No response from Claude', checkedAt: Date.now() }
    return publish(done)
  } catch (err) {
    if (done) return publish(done)
    if (err instanceof Error && err.name === 'AbortError') {
      return publish({ status: 'error', method, detail: 'Probe aborted before a verdict', checkedAt: Date.now() })
    }
    return publish({ ...classifyProbeError(err), method, checkedAt: Date.now() })
  }
}
```

- [ ] **Step 2: Reason through `classifyProbeError` (pure; no runner)**

Confirm by reading: `Error('spawn node ENOENT')` → `cli-error`; `Error('Invalid API key · 401')` → `unauthenticated`; `Error('Please run `claude login`')` → `unauthenticated`; `Error('socket hang up')` → `error`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:node`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/claudeHealth.ts
git commit -m "feat(claude): startup availability probe keyed on typed SDK error signals" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: tRPC `claudeRouter` — availability, re-check, key management, ready-guards

**Files:**
- Modify: `src/main/trpc/routers/claude.ts`

- [ ] **Step 1: Add imports**

Below the existing imports:

```ts
import * as claudeHealth from '../../services/claudeHealth'
import * as configService from '../../services/config'
```

- [ ] **Step 2: Add the new procedures to `claudeRouter`**

Add these inside the `router({ … })` object (e.g. after `abort`):

```ts
  availability: procedure.query(() => claudeHealth.getAvailability()),

  recheck: procedure.mutation(async () => claudeHealth.probe()),

  hasApiKey: procedure.query(() => configService.hasClaudeApiKey()),

  setApiKey: procedure
    .input(z.object({ key: z.string() }))
    .mutation(async ({ input }) => {
      const res = configService.saveClaudeApiKey(input.key)
      if (!res.ok) return { ok: false, reason: res.reason, availability: claudeHealth.getAvailability() }
      const availability = await claudeHealth.probe()
      return { ok: true, availability }
    }),

  clearApiKey: procedure.mutation(async () => {
    configService.clearClaudeApiKey()
    const availability = await claudeHealth.probe()
    return { ok: true, availability }
  }),
```

- [ ] **Step 3: Add ready-guards to the three SDK-invoking procedures**

At the very start of the `sendMessage` mutation body (before `claudeService.sendMessage(...)`):

```ts
      if (claudeHealth.getAvailability().status !== 'ready') {
        return { started: false, reason: 'claude-unavailable' }
      }
```

Add the same guard at the start of the `recommendIndexes` mutation body and the `interpretExplain` mutation body (after their existing `database + collection` checks).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:node`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/trpc/routers/claude.ts
git commit -m "feat(claude): availability/recheck/api-key procedures + not-ready guards" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `index.ts` — run the probe at startup, emit availability, openExternal handler

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Import the health service**

Add near the other service imports (after `import * as claudeService from './services/claude'`):

```ts
import * as claudeHealth from './services/claudeHealth'
```

- [ ] **Step 2: Wire the bridge + first probe**

Immediately after the existing `claudeService.setMainWindow(mainWindow)` line (~272), add:

```ts
  claudeHealth.onAvailabilityChange((a) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('claude:availability', a)
  })
  void claudeHealth.probe()
```

- [ ] **Step 3: Add the `shell:openExternal` IPC handler**

After the existing `ipcMain.handle('app:getVersion', …)` line:

```ts
ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || u.protocol === 'http:') await shell.openExternal(url)
  } catch {
    /* ignore malformed/blocked urls */
  }
})
```

(`shell` is already imported on line 1.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:node`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(claude): probe availability at startup, push to renderer, add openExternal IPC" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `settingsStore` — auth method, `auto` model, budget

**Files:**
- Modify: `src/renderer/src/store/settingsStore.ts`

- [ ] **Step 1: Import the auth-method type and widen the model union**

At the top, add the import and update `ClaudeModel` + `CLAUDE_MODELS`:

```ts
import type { ClaudeAuthMethod } from '@shared/types'

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
```

- [ ] **Step 2: Extend the store interface**

Inside `interface SettingsStore`, add:

```ts
  claudeAuthMethod: ClaudeAuthMethod
  claudeMaxBudgetUsd: number | null
  setClaudeAuthMethod: (method: ClaudeAuthMethod) => void
  setClaudeMaxBudgetUsd: (usd: number | null) => void
```

- [ ] **Step 3: Add defaults + setters in the store body**

Add to the initial state (near `claudeModel: 'claude-sonnet-4-6'` — also change that default):

```ts
  claudeModel: 'auto',
  claudeAuthMethod: 'subscription',
  claudeMaxBudgetUsd: null,
```

Add the setters (near `setClaudeModel`):

```ts
  setClaudeAuthMethod: (method) => {
    set({ claudeAuthMethod: method })
    trpc.settings.set.mutate({ key: 'claudeAuthMethod', value: method }).catch(() => {})
  },

  setClaudeMaxBudgetUsd: (usd) => {
    set({ claudeMaxBudgetUsd: usd })
    trpc.settings.set.mutate({ key: 'claudeMaxBudgetUsd', value: usd }).catch(() => {})
  },
```

- [ ] **Step 4: Load the new keys in `loadFromSettings`**

Extend the `Promise.all` and apply the results:

```ts
      const [savedTheme, savedCatSounds, savedSplit, savedModel, savedAuthMethod, savedBudget] = await Promise.all([
        trpc.settings.get.query({ key: 'theme' }) as Promise<Theme | null>,
        trpc.settings.get.query({ key: 'catSounds' }) as Promise<boolean | null>,
        trpc.settings.get.query({ key: 'documentSplitRatio' }) as Promise<number | null>,
        trpc.settings.get.query({ key: 'claudeModel' }) as Promise<ClaudeModel | null>,
        trpc.settings.get.query({ key: 'claudeAuthMethod' }) as Promise<ClaudeAuthMethod | null>,
        trpc.settings.get.query({ key: 'claudeMaxBudgetUsd' }) as Promise<number | null>
      ])
```

After the existing `if (savedModel …)` block, add:

```ts
      if (savedAuthMethod === 'subscription' || savedAuthMethod === 'apiKey') {
        set({ claudeAuthMethod: savedAuthMethod })
      }
      if (typeof savedBudget === 'number' || savedBudget === null) {
        set({ claudeMaxBudgetUsd: savedBudget })
      }
```

- [ ] **Step 5: Build (renderer)**

Run: `npm run build`
Expected: build completes (bundles the renderer).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/settingsStore.ts
git commit -m "feat(claude): settings for auth method, auto model default, and budget cap" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `claudeStore` — availability state

**Files:**
- Modify: `src/renderer/src/store/claudeStore.ts`

- [ ] **Step 1: Add availability to the store**

Add the import, interface fields, default, and setter:

```ts
import type { ChatMessage, ClaudeAvailability } from '@shared/types'
```

In `interface ClaudeStore` add:

```ts
  availability: ClaudeAvailability
  setAvailability: (a: ClaudeAvailability) => void
```

In the `create(...)` initial state add:

```ts
  availability: { status: 'unknown', method: 'subscription', checkedAt: 0 },
```

And the setter:

```ts
  setAvailability: (a) => set({ availability: a }),
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/store/claudeStore.ts
git commit -m "feat(claude): hold global availability state in claudeStore" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `App.tsx` — fetch availability on mount + subscribe

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add imports**

```ts
import { trpc } from '@renderer/lib/trpc'
import { useClaudeStore } from '@renderer/store/claudeStore'
import type { ClaudeAvailability } from '@shared/types'
```

- [ ] **Step 2: Add a second effect inside `App`**

After the existing `useEffect(() => { … }, [])`:

```ts
  useEffect(() => {
    const setAvailability = useClaudeStore.getState().setAvailability
    trpc.claude.availability.query().then(setAvailability).catch(() => {})

    const handler = (_: unknown, a: ClaudeAvailability) => setAvailability(a)
    window.electron?.ipcRenderer.on('claude:availability', handler)
    return () => {
      window.electron?.ipcRenderer.removeListener('claude:availability', handler)
    }
  }, [])
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(claude): load availability on mount and live-update from main" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `ClaudeSetup.tsx` — method-aware onboarding + toggle

**Files:**
- Create: `src/renderer/src/components/claude/ClaudeSetup.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from 'react'
import { Loader2, ExternalLink, RefreshCw, Copy, Check, KeyRound, Plug } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { trpc } from '@renderer/lib/trpc'
import { cn } from '@renderer/lib/utils'
import { useClaudeStore } from '@renderer/store/claudeStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import type { ClaudeAuthMethod } from '@shared/types'

const DOWNLOAD_URL = 'https://claude.com/claude-code'

function installCommand(): string {
  const ua = navigator.userAgent
  if (ua.includes('Windows')) return 'irm https://claude.ai/install.ps1 | iex'
  return 'curl -fsSL https://claude.ai/install.sh | bash'
}

export function ClaudeSetup() {
  const availability = useClaudeStore((s) => s.availability)
  const setAvailability = useClaudeStore((s) => s.setAvailability)
  const authMethod = useSettingsStore((s) => s.claudeAuthMethod)
  const setAuthMethod = useSettingsStore((s) => s.setClaudeAuthMethod)

  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const status = availability.status
  const checking = status === 'checking' || status === 'unknown'

  useEffect(() => {
    trpc.claude.hasApiKey.query().then(setHasKey).catch(() => {})
  }, [status])

  const recheck = async () => {
    setBusy(true)
    try {
      setAvailability(await trpc.claude.recheck.mutate())
    } finally {
      setBusy(false)
    }
  }

  const switchMethod = async (m: ClaudeAuthMethod) => {
    if (m === authMethod) return
    setAuthMethod(m)
    await recheck()
  }

  const saveKey = async () => {
    if (!keyInput.trim()) return
    setBusy(true)
    setSaveError(null)
    try {
      const res = await trpc.claude.setApiKey.mutate({ key: keyInput.trim() })
      if (!res.ok) {
        setSaveError(
          res.reason === 'encryption-unavailable'
            ? 'Secure storage is unavailable here. Use the subscription login instead.'
            : 'Could not save the key.'
        )
        return
      }
      setKeyInput('')
      setHasKey(true)
      setAvailability(res.availability)
    } finally {
      setBusy(false)
    }
  }

  const removeKey = async () => {
    setBusy(true)
    try {
      const res = await trpc.claude.clearApiKey.mutate()
      setHasKey(false)
      setAvailability(res.availability)
    } finally {
      setBusy(false)
    }
  }

  const copyCommand = async () => {
    await navigator.clipboard.writeText(installCommand())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Set up Claude to enable AI features</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose how Mango talks to Claude. The subscription path uses your Claude Code login; the API-key path bills your Anthropic account per token.
        </p>
      </div>

      {/* Auth-method toggle */}
      <div className="flex gap-1 rounded-md bg-muted p-1">
        {([
          { value: 'subscription' as const, label: 'Subscription' },
          { value: 'apiKey' as const, label: 'API key' }
        ]).map(({ value, label }) => (
          <button
            key={value}
            disabled={busy}
            className={cn(
              'flex-1 rounded-sm px-2 py-1 text-xs transition-colors',
              authMethod === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => switchMethod(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {checking ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking Claude…
        </div>
      ) : authMethod === 'subscription' ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="text-xs font-medium text-foreground">Use your Claude Code subscription</div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => window.electron?.ipcRenderer.invoke('shell:openExternal', DOWNLOAD_URL)}
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Get Claude Code
          </Button>
          <div className="flex items-center gap-1">
            <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-[11px]">{installCommand()}</code>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyCommand} title="Copy install command">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Then run <code className="rounded bg-muted px-1">claude</code> in a terminal and complete login. Click Re-check when done.
          </p>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-1 text-xs font-medium text-foreground">
            <KeyRound className="h-3.5 w-3.5" /> Use an Anthropic API key
          </div>
          {hasKey ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-emerald-400">Key set ✓</span>
              <Button variant="ghost" size="sm" onClick={removeKey} disabled={busy}>Remove</Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <input
                type="password"
                className="flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="sk-ant-…"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveKey() }}
              />
              <Button size="sm" onClick={saveKey} disabled={busy || !keyInput.trim()}>Save</Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Billed to your Anthropic account per token. Default model is Haiku to keep costs low — change it in the chat header.
          </p>
          {saveError && <p className="text-[11px] text-destructive">{saveError}</p>}
        </div>
      )}

      {status === 'error' && availability.detail && (
        <p className="text-[11px] text-destructive">{availability.detail}</p>
      )}

      <Button variant="secondary" size="sm" onClick={recheck} disabled={busy}>
        <RefreshCw className={cn('mr-1 h-3.5 w-3.5', busy && 'animate-spin')} />
        Re-check
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/claude/ClaudeSetup.tsx
git commit -m "feat(claude): method-aware setup screen with subscription/API-key toggle" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `ClaudePanel` — gate to setup, thread usage, per-chat total

**Files:**
- Modify: `src/renderer/src/components/claude/ClaudePanel.tsx`

- [ ] **Step 1: Add imports**

```ts
import { useClaudeStore } from '@renderer/store/claudeStore'
import { ClaudeSetup } from './ClaudeSetup'
```

- [ ] **Step 2: Read availability (with the other store hooks, before any early return)**

Near the top of the component, alongside the existing store reads:

```ts
  const claudeStatus = useClaudeStore((s) => s.availability.status)
```

- [ ] **Step 3: Thread `usage` onto the message in `handleStreamEnd`**

Update the `handleStreamEnd` signature and the content update. Change:

```ts
    const handleStreamEnd = (_: unknown, data: { messageId: string; text: string; lastTurnText?: string }) => {
```

to:

```ts
    const handleStreamEnd = (
      _: unknown,
      data: { messageId: string; text: string; lastTurnText?: string; usage?: import('@shared/types').ClaudeUsage }
    ) => {
```

And change the existing content update:

```ts
      if (data.text) {
        store.updateMessage(data.messageId, { content: data.text })
      }
```

to:

```ts
      if (data.text) {
        store.updateMessage(data.messageId, { content: data.text, usage: data.usage })
      } else if (data.usage) {
        store.updateMessage(data.messageId, { usage: data.usage })
      }
```

- [ ] **Step 4: Render the setup screen when not ready (after all hooks, before the normal `return`)**

Immediately before the component's main `return (`:

```tsx
  if (claudeStatus !== 'ready') {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-sidebar-border p-3">
          <span className="text-sm font-medium">Claude</span>
        </div>
        <ClaudeSetup />
      </div>
    )
  }
```

- [ ] **Step 5: Show a per-chat cost total in the header**

After `const messages = tab?.messages ?? []`, add:

```ts
  const chatCost = messages.reduce((sum, m) => sum + (m.usage?.costUsd ?? 0), 0)
```

In the header, inside the right-hand controls `div` (just before the model `<select>`), add:

```tsx
          {chatCost > 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground" title="Total cost of this chat">
              ${chatCost.toFixed(4)}
            </span>
          )}
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/claude/ClaudePanel.tsx
git commit -m "feat(claude): show setup screen when unavailable; surface per-chat cost" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `MessageBubble` — per-message cost footer

**Files:**
- Modify: `src/renderer/src/components/claude/MessageBubble.tsx`

- [ ] **Step 1: Add a short model-label helper above the component**

```tsx
function modelLabel(model: string): string {
  if (model.includes('opus')) return 'Opus'
  if (model.includes('sonnet')) return 'Sonnet'
  if (model.includes('haiku')) return 'Haiku'
  return model
}
```

- [ ] **Step 2: Render the footer inside the assistant bubble**

Inside the bubble `div`, immediately after the `{isUser ? (…) : (<Markdown …/>)}` block (still inside the inner `div` that has the `max-w-[85%]` classes), add:

```tsx
        {!isUser && message.usage && (
          <div className="mt-1.5 border-t border-border/40 pt-1 text-[10px] text-muted-foreground">
            {modelLabel(message.usage.model)} · {message.usage.inputTokens.toLocaleString()} in /{' '}
            {message.usage.outputTokens.toLocaleString()} out
            {message.usage.costUsd ? ` · $${message.usage.costUsd.toFixed(4)}` : ''}
          </div>
        )}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/claude/MessageBubble.tsx
git commit -m "feat(claude): per-message token/cost footer on assistant turns" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Gate the "Recommend Indexes" and "AI Explain" buttons

**Files:**
- Modify: `src/renderer/src/components/indexes/IndexPanel.tsx`
- Modify: `src/renderer/src/components/explain/VisualExplain.tsx`

- [ ] **Step 1: IndexPanel — read availability**

Add the import and hook:

```ts
import { useClaudeStore } from '@renderer/store/claudeStore'
```

Inside the component (near the other store reads):

```ts
  const claudeReady = useClaudeStore((s) => s.availability.status === 'ready')
```

- [ ] **Step 2: IndexPanel — wrap the "Recommend with Claude" button**

Replace the existing `<Button … >Recommend with Claude</Button>` (the `variant="outline"` one) with:

```tsx
          <span title={claudeReady ? undefined : 'Set up Claude to enable AI features'}>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecommendIndexes}
              disabled={!claudeReady}
              title={
                claudeReady
                  ? 'Ask Claude to analyse the collection and recommend indexes based on profiler data, schema sampling, and the linked codebase (if any).'
                  : undefined
              }
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              Recommend with Claude
            </Button>
          </span>
```

- [ ] **Step 3: VisualExplain — read availability**

Add the import and hook:

```ts
import { useClaudeStore } from '@renderer/store/claudeStore'
```

Inside the component (near the other store reads):

```ts
  const claudeReady = useClaudeStore((s) => s.availability.status === 'ready')
```

- [ ] **Step 4: VisualExplain — wrap the "Explain with Claude" button**

Replace the existing `<button … >…Explain with Claude</button>` block with:

```tsx
          <span title={claudeReady ? undefined : 'Set up Claude to enable AI features'}>
            <button
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              onClick={handleInterpretExplain}
              title={claudeReady ? "Ask Claude to read this plan and explain what's slow" : undefined}
              disabled={!claudeReady || !activeTab?.database || !activeTab?.collection}
            >
              <Sparkles className="h-3 w-3" />
              Explain with Claude
            </button>
          </span>
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/indexes/IndexPanel.tsx src/renderer/src/components/explain/VisualExplain.tsx
git commit -m "feat(claude): disable Recommend Indexes / AI Explain until Claude is ready" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Settings popover — "Claude AI" section

**Files:**
- Modify: `src/renderer/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Add imports + state**

Add to the lucide import: `Sparkles`. Add:

```ts
import { trpc } from '@renderer/lib/trpc'
import { useClaudeStore } from '@renderer/store/claudeStore'
```

In the component, extend the settings store read and add availability + key state:

```ts
  const { theme, setTheme, catSounds, setCatSounds, claudeAuthMethod, setClaudeAuthMethod, claudeMaxBudgetUsd, setClaudeMaxBudgetUsd } = useSettingsStore()
  const availability = useClaudeStore((s) => s.availability)
  const setAvailability = useClaudeStore((s) => s.setAvailability)
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')

  useEffect(() => {
    trpc.claude.hasApiKey.query().then(setHasKey).catch(() => {})
  }, [availability.status])
```

- [ ] **Step 2: Add the "Claude AI" block inside the Settings `PopoverContent`**

After the Cat-sounds block (still inside the `space-y-4` div):

```tsx
              {/* Claude AI */}
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm">Claude AI</label>
                  <span
                    className={cn(
                      'text-[10px]',
                      availability.status === 'ready' ? 'text-emerald-400' : 'text-muted-foreground'
                    )}
                  >
                    {availability.status === 'ready'
                      ? 'Ready'
                      : availability.status === 'checking'
                        ? 'Checking…'
                        : availability.status === 'unauthenticated'
                          ? 'Not signed in'
                          : availability.status === 'cli-error'
                            ? 'CLI error'
                            : availability.status === 'error'
                              ? 'Unavailable'
                              : '—'}
                  </span>
                </div>

                <div className="flex gap-1 rounded-md bg-muted p-1">
                  {([
                    { value: 'subscription' as const, label: 'Subscription' },
                    { value: 'apiKey' as const, label: 'API key' }
                  ]).map(({ value, label }) => (
                    <button
                      key={value}
                      className={cn(
                        'flex-1 rounded-sm px-2 py-1 text-xs transition-colors',
                        claudeAuthMethod === value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={async () => {
                        if (claudeAuthMethod !== value) {
                          setClaudeAuthMethod(value)
                          setAvailability(await trpc.claude.recheck.mutate())
                        }
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {claudeAuthMethod === 'apiKey' &&
                  (hasKey ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-emerald-400">Key set ✓</span>
                      <button
                        className="text-xs text-muted-foreground hover:text-destructive"
                        onClick={async () => {
                          const res = await trpc.claude.clearApiKey.mutate()
                          setHasKey(false)
                          setAvailability(res.availability)
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type="password"
                        className="flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        placeholder="sk-ant-…"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                      />
                      <button
                        className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                        disabled={!keyInput.trim()}
                        onClick={async () => {
                          const res = await trpc.claude.setApiKey.mutate({ key: keyInput.trim() })
                          if (res.ok) {
                            setKeyInput('')
                            setHasKey(true)
                          }
                          setAvailability(res.availability)
                        }}
                      >
                        Save
                      </button>
                    </div>
                  ))}

                {claudeAuthMethod === 'apiKey' && (
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-muted-foreground">Max $ / message</label>
                    <input
                      type="number"
                      min="0"
                      step="0.05"
                      placeholder="none"
                      className="w-20 rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={claudeMaxBudgetUsd ?? ''}
                      onChange={(e) => setClaudeMaxBudgetUsd(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </div>
                )}

                <button
                  className="flex w-full items-center justify-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={async () => setAvailability(await trpc.claude.recheck.mutate())}
                >
                  Re-check
                </button>
              </div>
```

(`useState`/`useEffect` are already imported in `TopBar.tsx`.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/TopBar.tsx
git commit -m "feat(claude): Claude AI settings — method toggle, status, key, re-check" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Full build + manual verification matrix

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the main process + full build**

Run: `npm run typecheck:node`
Expected: passes.

Run: `npm run build`
Expected: passes (main + preload + renderer bundles emitted).

- [ ] **Step 2: Run the app and walk the matrix**

Run: `npm run dev`

Confirm:
- [ ] Subscription + logged in → panel chats; "Recommend with Claude" and "Explain with Claude" enabled; Settings shows "Ready".
- [ ] Subscription + logged out (`claude logout` in a terminal, then Re-check) → panel shows the setup screen; both buttons disabled and show the "Set up Claude…" tooltip; Settings shows "Not signed in".
- [ ] Switch toggle to "API key" with no key → setup screen asks for a key (no spawn/flicker); status "Not signed in".
- [ ] Paste a valid key → flips to Ready without restart; chat works; model header shows "Auto" and replies come from Haiku.
- [ ] Paste an obviously bad key (`sk-ant-bad`) → stays not-ready (`unauthenticated`, or `error` with a billing message).
- [ ] After a successful turn, the assistant bubble shows a `Haiku · N in / N out · $…` footer and the header shows the per-chat `$` total (API-key path).
- [ ] Switch back to Subscription (logged in) → Ready again; no key is required.

- [ ] **Step 3: Packaged smoke build (optional but recommended)**

Run: `npm run build`
Expected: passes. (No SDK version change, so the asar-unpacked CLI path is untouched.)

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(claude): verification fixes for availability gating + cost" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (already reconciled against the spec)

- **Spec coverage:** auth-method toggle (T7,10,14) · encrypted key (T2) · env injection + subscription strip (T3) · probe with typed signals (T4) · availability procedures + guards (T5) · startup probe + openExternal (T6) · availability store + mount wiring (T8,9) · setup screen (T10) · panel gating + per-chat total (T11) · per-message footer (T12) · button gating (T13) · cost-aware `auto` model (T3,7) · optional budget cap (T3,7,settings) · `usage` persisted via `ChatMessage` (T1). All present.
- **Type consistency:** `ClaudeAvailability`/`ClaudeAuthMethod`/`ClaudeUsage` defined in T1 and used unchanged in T3–T14; `buildSdkSpawnOptions`/`resolveModel` exported in T3 and consumed in T4; `claude:availability` event name identical in T6 (emit) and T9 (listen); `claudeMaxBudgetUsd`/`claudeAuthMethod`/`claudeModel` setting keys identical across T3, T7, T14.
- **Budget-cap UI:** covered end-to-end — persisted in `settingsStore` (T7), applied in `claude.ts`'s `sendMessage` on the apiKey path (T3), and editable via the "Max $ / message" field in the Settings "Claude AI" section (T14).
