# Claude auth-method toggle, availability gating & cost visibility

**Date:** 2026-05-30
**Status:** Approved (design)
**Author:** Ashley + Claude

## Overview

Mango's AI features (the Claude chat panel, the "Recommend Indexes" button, and the
"AI Explain" button) silently assume Claude is usable. A fresh user who has never
authenticated gets a working-looking panel that fails with a raw `Error: ...` in the
chat on their first message. This work:

1. Adds an explicit **auth-method toggle** — *Use Claude Code subscription* vs *Use an
   Anthropic API key* — so users choose how Claude is powered, with the subscription
   path remaining the default.
2. Adds a **startup availability probe** that detects whether the *selected* method can
   actually run, and **gates the three AI entry points** on the result.
3. Gives users a **method-aware onboarding screen** to fix an unusable state (log into
   Claude Code, or paste an API key).
4. Adds **cost visibility** — per-message token/cost footers, a per-chat total, a
   cost-aware default model, and an optional hard spend cap — because surprise bills are
   the top complaint when bringing your own API key.

### The core reframe

The Claude Code CLI is **bundled** with Mango — `electron-builder.yml` asar-unpacks
`node_modules/@anthropic-ai/claude-agent-sdk/**`, and `claude.ts` points the SDK at that
bundled `cli.js` in packaged builds (`getClaudeExecutablePath`). So we are **not**
detecting a missing binary. What a fresh user lacks is **authentication**: `claude.ts`
sets no credentials and relies entirely on the SDK's ambient resolution — a logged-in
Claude subscription or an `ANTHROPIC_API_KEY` in the environment. With neither, the SDK
errors at first use. The toggle makes that choice explicit; the probe verifies it.

### SDK surface — verified against the installed 0.1.77

These were confirmed by reading the installed SDK's `.d.ts` (not assumed):

- `Options.env?: { [k: string]: string | undefined }` — *"Environment variables to pass
  to the Claude Code process. Defaults to `process.env`."* It **replaces** the env, so we
  spread `...process.env` and add `ANTHROPIC_API_KEY`. (`runtimeTypes.d.ts:296`)
- `Options.executable?: 'bun' | 'deno' | 'node'`, `Options.pathToClaudeCodeExecutable?:
  string` — unchanged from current usage. (`runtimeTypes.d.ts:303,417`)
- `Options.maxBudgetUsd?: number` — *"The query will stop if this budget is exceeded,
  returning an `error_max_budget_usd` result."* A built-in hard spend cap.
  (`runtimeTypes.d.ts:380`)
- `SDKAssistantMessage.error?: 'authentication_failed' | 'billing_error' | 'rate_limit' |
  'invalid_request' | 'server_error' | 'unknown'` — a **typed** failure signal, so the
  probe classifies auth without string-matching. (`coreTypes.d.ts:427`)
- `SDKResultMessage` (success) carries `total_cost_usd: number`, `usage:
  NonNullableUsage` (`input_tokens`/`output_tokens`/cache counts), and `modelUsage`; the
  error variant has `subtype: '… | error_max_budget_usd | …'`. (`coreTypes.d.ts:441`)
- `SDKSystemMessage` (init) exposes `apiKeySource: 'user' | 'project' | 'org' |
  'temporary'` — config *scope*, not logged-in-vs-not, so it can't replace the probe.
  (`coreTypes.d.ts:475,26`)

## Key architectural decisions

- **Auth method is an explicit, persisted toggle — never a silent fallback.**
  `claudeAuthMethod: 'subscription' | 'apiKey'` (default `subscription`). `subscription`
  uses the ambient Claude Code login; `apiKey` injects Mango's stored key. We do **not**
  auto-switch between them: silently falling back from a subscription to a metered API
  key (or vice versa) could produce exactly the surprise charge note 4 warns against.
  When the selected method isn't usable, we show onboarding rather than switching.
- **Subscription mode ignores ambient API keys.** When `subscription` is selected, the
  spawned env has `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` **removed**, so a key that
  happens to sit in the user's shell environment can't quietly bill them; the CLI uses
  the Claude login instead. (Deliberate; see Risks.)
- **Detection is a real SDK micro-probe keyed on typed signals.** We run a minimal
  `claudeQuery` through the exact executable/env wiring production uses and classify from
  the typed `SDKAssistantMessage.error` and `SDKResultMessage.subtype`, falling back to
  string-matching only for thrown spawn errors. Tests the true end-to-end path rather
  than re-implementing SDK credential resolution.
- **The API key is a first-class secret, encrypted at rest, never exposed to the
  renderer.** Stored via Electron `safeStorage` (the connection store's `encrypted:`
  scheme) in a **new `claude.json`** — not the plaintext `settings.json`. The renderer
  only learns a boolean (`hasApiKey`); the raw key is injected solely into the SDK child
  env.
- **Cost is surfaced by default, capped by choice.** The default model is cost-aware
  (`auto` → Haiku on `apiKey`, Sonnet on `subscription`); every assistant turn shows
  tokens + USD; an optional `claudeMaxBudgetUsd` (blank by default) wires the SDK's hard
  cap so the cautious can bound spend without truncating everyone's tasks.
- **Availability is global app state pushed from main, not polled.** Main owns the cached
  `ClaudeAvailability` and emits `claude:availability` on change; the renderer reads it
  once on mount and lives on the event. All three AI entry points read one store value.
- **Gating is defense-in-depth at both layers.** The renderer disables/replaces AI
  controls, *and* the tRPC procedures short-circuit when not `ready`.
- **Claude is not swappable.** Per the product's "AI-native" framing, Claude is a
  fundamental dependency; this work does not abstract over providers.

## The probe

Run `claudeQuery` with a 1-token prompt, no MCP, `maxTurns: 1`, `maxBudgetUsd: 0.05` (a
belt-and-braces cap on the probe itself), through the shared executable/env helper, with
the probe's own `AbortController`. Iterate the async generator and classify:

- `assistant` with `error === 'authentication_failed'` → `unauthenticated` (abort).
- `assistant` with `error === 'billing_error'` → `error`, detail "Billing error — check
  your Anthropic plan/credits" (abort).
- `assistant` with no `error`, or `result` with `subtype === 'success'` → `ready`
  (abort). This is a definitive signal that the CLI spawned, authenticated, and completed
  an API round-trip.
- `result` with an error subtype → inspect `errors[]`: auth-ish → `unauthenticated`, else
  `error`.
- Generator throws before any signal → `classifyProbeError(err)`: `ENOENT`/spawn →
  `cli-error`; auth-ish text → `unauthenticated`; else `error`. (Our own post-success
  `AbortError` is treated as `ready`.)

Short-circuit: if `claudeAuthMethod === 'apiKey'` and no key is stored, return
`{ status: 'unauthenticated', detail: 'No API key set' }` **without spawning**.

Runs once at startup, and on explicit user action (Re-check, auth-method change, API-key
save/clear). Never on every panel open. `classifyProbeError` is a **pure function** kept
independently checkable. The exact `authentication_failed`/error-text behavior is pinned
during implementation by observing a live logged-out run.

## Availability & shared types

Added to `src/shared/types.ts`:

```ts
export type ClaudeAuthMethod = 'subscription' | 'apiKey'

export type ClaudeAvailabilityStatus =
  | 'unknown'        // before the first probe completes
  | 'checking'       // a probe is in flight
  | 'ready'          // a probe succeeded — AI features enabled
  | 'unauthenticated'// selected method has no/invalid credentials
  | 'cli-error'      // the CLI could not be spawned (ENOENT / spawn failure)
  | 'error'          // any other failure (carries `detail`)

export interface ClaudeAvailability {
  status: ClaudeAvailabilityStatus
  method: ClaudeAuthMethod  // which method was probed
  detail?: string           // short message for 'error'/'cli-error'
  checkedAt: number         // epoch ms of the last probe
}

export interface ClaudeUsage {  // surfaced per assistant message
  model: string
  inputTokens: number
  outputTokens: number
  costUsd?: number
}
```

`ChatMessage` gains an optional `usage?: ClaudeUsage` (persisted by `chatHistory.ts`).

## Settings

Plaintext `settings.json` (via the existing generic `settings` router, like `theme`):
- `claudeAuthMethod: 'subscription' | 'apiKey'` — default `'subscription'`.
- `claudeModel: 'auto' | 'claude-opus-4-8' | 'claude-sonnet-4-6' |
  'claude-haiku-4-5-20251001'` — default `'auto'`. `auto` resolves to Haiku on `apiKey`,
  Sonnet on `subscription`.
- `claudeMaxBudgetUsd: number | null` — default `null` (no cap). Applied only on the
  `apiKey` path.

Encrypted `claude.json` (via dedicated secret procedures): the API key.

## Component changes

### Main process

**New — `src/main/services/claudeHealth.ts`**
- Cached `ClaudeAvailability` (`{ status: 'unknown', method: 'subscription', checkedAt: 0 }`).
- `probe(): Promise<ClaudeAvailability>` — the probe above; collapses concurrent calls.
- `getAvailability()`, `onAvailabilityChange(cb)`, and the pure
  `classifyProbeError(err): { status; detail? }`.

**Refactor — `src/main/services/claude.ts`**
- `buildSdkSpawnOptions()` (replaces `getClaudeExecutablePath` + `getSpawnOverrides`):
  reads `claudeAuthMethod`; builds `env = { ...process.env }`; on `apiKey` adds
  `ANTHROPIC_API_KEY` from the stored key; on `subscription` **deletes**
  `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`; adds the packaged
  `pathToClaudeCodeExecutable`/`executable`/`ELECTRON_RUN_AS_NODE`. Exported for the probe.
- `resolveModel(requested, method)`: `requested && requested !== 'auto'` → as-is; else
  `method === 'apiKey' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6'`.
- `sendMessage` uses both helpers, passes `maxBudgetUsd` when set on the `apiKey` path,
  and at `result` emits `usage` alongside the existing `cost` in `claude:stream-end`:
  `{ model: resolved, inputTokens: msg.usage.input_tokens, outputTokens:
  msg.usage.output_tokens, costUsd: msg.total_cost_usd }`.

**`src/main/constants.ts`** — add `CLAUDE_SECRET_FILE = join(CONFIG_DIR, 'claude.json')`.

**`src/main/services/config.ts`** — `saveClaudeApiKey(key): { ok; reason? }` (refuses if
`safeStorage` unavailable rather than storing plaintext), `loadClaudeApiKey(): string |
null`, `clearClaudeApiKey()`, `hasClaudeApiKey(): boolean`; `encrypted:`+base64 scheme;
persisted to `CLAUDE_SECRET_FILE`.

**`src/main/trpc/routers/claude.ts`**
- `availability` (query), `recheck` (mutation → `probe()`), `hasApiKey` (query→boolean),
  `setApiKey({ key })` / `clearApiKey()` (mutations; each re-probes and returns the new
  availability).
- Guard `sendMessage` / `recommendIndexes` / `interpretExplain`: if
  `getAvailability().status !== 'ready'`, return `{ started: false, reason }` instead of
  invoking the SDK (defensive — the renderer already blocks sending when not `ready`).
- `claudeAuthMethod`, `claudeModel`, `claudeMaxBudgetUsd` need no new procedures — they
  ride the existing `settings.get`/`set`.

**`src/main/index.ts`** — after the window is ready, wire
`claudeHealth.onAvailabilityChange((a) => mainWindow.webContents.send('claude:availability', a))`
and fire `claudeHealth.probe()`. Add `ipcMain.handle('shell:openExternal', (_e, url) =>
…)` (https/http only), mirroring the existing `update:install` handler.

### Renderer

**`src/renderer/src/store/claudeStore.ts`** — add `availability: ClaudeAvailability` +
`setAvailability(a)` (this store already holds global Claude panel state).

**`src/renderer/src/store/settingsStore.ts`** — add `claudeAuthMethod`, widen
`claudeModel` to include `'auto'` (default `'auto'`), add `claudeMaxBudgetUsd`; load/save
via `trpc.settings` exactly like `theme`. `CLAUDE_MODELS` gains a leading
`{ value: 'auto', label: 'Auto' }`.

**`src/renderer/src/App.tsx`** — on mount: `trpc.claude.availability.query()` →
`setAvailability`, subscribe to `claude:availability`, clean up on unmount.

**New — `src/renderer/src/components/claude/ClaudeSetup.tsx`** — rendered by `ClaudePanel`
when `status !== 'ready'`. Top: the **auth-method toggle** (Subscription | API key). Then,
method-aware:
- `checking`/`unknown` → "Checking Claude…" spinner.
- `subscription` + not ready → "Get Claude Code" button (opens `https://claude.com/claude-code`
  via `shell:openExternal`), a copy-able **platform-aware** install command (from
  `navigator.userAgent`: `irm https://claude.ai/install.ps1 | iex` on Windows; else
  `curl -fsSL https://claude.ai/install.sh | bash`; npm fallback noted), and "run `claude`
  to log in, then Re-check".
- `apiKey` → masked key input + Save (`setApiKey`), or "Key set ✓ / Remove" when present;
  a one-line note that API usage is billed per token and the default model is Haiku.
- Always: a **Re-check** button.

**`src/renderer/src/components/claude/ClaudePanel.tsx`** — after all hooks, if
`availability.status !== 'ready'` render a minimal header + `<ClaudeSetup />` instead of
the chat. Model selector now includes "Auto".

**`src/renderer/src/components/claude/MessageBubble.tsx`** — when `message.usage` is
present, a small muted footer: `Haiku · 1,234 in / 567 out · $0.0021` (USD omitted when
0/undefined). `ClaudePanel` shows a per-chat running total of `costUsd`/tokens in the
header when any message has usage.

**`IndexPanel.tsx` / `VisualExplain.tsx`** — the AI buttons get `disabled={status !==
'ready'}` and, wrapped in a `<span title="Set up Claude to enable AI features">` (so the
tooltip shows even though disabled buttons swallow hover), the hint when disabled.

**`src/renderer/src/components/layout/TopBar.tsx`** — Settings popover gains a "Claude AI"
section: the auth-method toggle, a status badge, the API-key set/remove control (shown for
`apiKey`), an optional max-budget field, and a Re-check button.

## Data flow

1. **Startup (main):** window ready → `probe()` → cache set → `claude:availability` emitted.
2. **Renderer mount:** `App` queries availability (handles the probe-before-listener race)
   and subscribes to the event.
3. **Gating:** `ClaudePanel`, `IndexPanel`, `VisualExplain` read
   `claudeStore.availability.status === 'ready'`.
4. **Remediation / method change:** toggling method, saving/removing a key, or Re-check →
   main re-probes → emits → every consumer updates reactively.
5. **Cost:** each turn's `result` → `usage` in `claude:stream-end` → stored on the message
   → rendered as a footer + summed per chat.

## Security

- API key encrypted via `safeStorage` in `claude.json`; never in plaintext `settings.json`;
  never returned to the renderer (only a boolean); injected only into the SDK child env.
- If `safeStorage.isEncryptionAvailable()` is false, saving is refused with a message to
  use the subscription login instead — never silent plaintext.
- Subscription mode strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from the spawned env.
- External links open via `shell.openExternal` behind an https/http-only IPC handler.

## Risks & verification

- **Probe semantics.** Keyed on the SDK's typed `error`/`subtype`; `classifyProbeError`
  (the thrown-error fallback) is pure and small. Pin the `authentication_failed` path by
  observing a live `claude logout` run.
- **Subscription env-stripping is a behavior change** for the niche user who today relies
  on an ambient `ANTHROPIC_API_KEY` with no login: after upgrade (default
  `subscription`), they'll see onboarding until they log in or switch to `apiKey` + paste
  the key. Deliberate, to prevent unexpected metered billing; called out for review.
- **Probe cost/latency.** `maxTurns: 1` + tiny prompt + `maxBudgetUsd: 0.05` + abort at
  first signal; startup + explicit only. Panel shows `checking` until it resolves; never
  blocks the UI.
- **No test runner in the repo.** Verification is `npm run typecheck:node` + `npm run
  build` + manual (`npm run typecheck` is pre-broken). Manual matrix:
  - subscription, logged in → `ready`; both buttons + panel work.
  - subscription, logged out → `unauthenticated`; onboarding; buttons disabled w/ tooltip.
  - switch to apiKey, no key → onboarding asks for key (no spawn).
  - paste valid key → `ready` without restart; model selector defaults Haiku via `auto`.
  - paste bad key → `unauthenticated`/billing `error`.
  - a chat turn shows a token/$ footer and updates the per-chat total.
  - packaged `npm run build` smoke-check (asar path untouched).

## Out of scope

- Swapping Claude for another AI provider (Claude is fundamental).
- An embedded OAuth login flow inside Mango (we direct to the CLI's `claude` login).
- Auto-installing Claude Code.
- Re-probing on every panel open (startup + explicit only).
- Per-feature availability (all three entry points share one global status).
- Historical/aggregate cost analytics beyond the current chat's running total.
