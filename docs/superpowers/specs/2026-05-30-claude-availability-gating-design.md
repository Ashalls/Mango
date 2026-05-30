# Gating the AI DB inspector on Claude availability

**Date:** 2026-05-30
**Status:** Approved (design)
**Author:** Ashley + Claude

## Overview

Mango's AI features (the Claude chat panel, the "Recommend Indexes" button, and the
"AI Explain" button) silently assume Claude is usable. A fresh user who has never
authenticated gets a working-looking panel that fails with a raw `Error: ...` in the
chat on their first message. This work adds a **startup availability probe** that
detects whether Claude can actually run, **gates the three AI entry points** on the
result, and gives users a **setup screen** to fix it — by installing/logging into
Claude Code, or by pasting an Anthropic API key.

### The core reframe

The Claude Code CLI is **bundled** with Mango — `electron-builder.yml` asar-unpacks
`node_modules/@anthropic-ai/claude-agent-sdk/**`, and `claude.ts` points the SDK at
that bundled `cli.js` in packaged builds (`getClaudeExecutablePath`). So we are **not**
detecting a missing binary. The binary always ships. What a fresh user lacks is
**authentication**: `claude.ts` sets no API key and relies entirely on the SDK's
ambient credentials — a logged-in Claude subscription (obtained by installing the
global Claude Code CLI and running `claude` once) or an `ANTHROPIC_API_KEY` in the
environment. With neither, the SDK errors at first use.

Therefore the gate is a **live probe** ("can Claude actually run right now?"), not a
`which claude` check. Installing Claude Code is simply the easiest way for a user to
obtain credentials; an API key is the self-contained alternative.

## Key architectural decisions

- **Detection is a real SDK micro-probe, not a credential heuristic.** We run an actual
  minimal `claudeQuery` through the exact executable/env wiring production uses, wait
  for the first definitive success signal, then abort. This tests the true end-to-end
  path (binary + auth + our env injection) rather than re-implementing the SDK's
  credential resolution, which can drift. Trade-off: a few tokens of cost per probe;
  mitigated by running once at startup + only on explicit user action, and aborting at
  the earliest success signal.
- **The API key is a first-class secret, encrypted at rest, never exposed to the
  renderer.** It is stored via Electron `safeStorage` (the same `encrypted:` scheme the
  connection store already uses), in a **new `claude.json`** file — *not* in the
  plaintext `settings.json` that the renderer can read via `trpc.settings.get`. The
  renderer only ever learns a boolean (`hasApiKey`). The raw key is injected solely into
  the SDK child process's `env`.
- **Availability is global app state pushed from main, not polled.** The main process
  owns the cached `ClaudeAvailability` and emits a `claude:availability` IPC event on
  every change. The renderer reads it once on mount (covering the race where the probe
  finishes before listeners attach) and otherwise lives on the event. All three AI
  entry points read the same store value.
- **Gating is defense-in-depth at both layers.** The renderer disables/replaces the AI
  controls, *and* the tRPC procedures (`sendMessage`, `recommendIndexes`,
  `interpretExplain`) short-circuit with a friendly error when not `ready`, so a stale
  UI can never fire a request into a broken SDK.
- **Claude is not swappable.** Per the product's "AI-native" framing, Claude is a
  fundamental dependency; this work does not abstract over providers.

## The probe (approaches considered)

- **A — SDK micro-probe (chosen).** Start a real `claudeQuery` with a 1-token prompt, no
  MCP servers, `maxTurns: 1`, through the shared executable/env helper (including an
  injected API key if one is set). Iterate the async generator and watch for the first
  definitive **success** signal — an `assistant` text delta or a `result` message —
  then mark `ready` and abort immediately via the probe's own `AbortController`.
  Classify failures that occur *before* any success signal:
  - spawn failure / `ENOENT` / "command not found" → `cli-error`
  - text matching auth/credential/login/401/unauthorized → `unauthenticated`
  - anything else → `error`
  The exact "ready" signal and the auth-error shape are **pinned against the installed
  SDK (0.1.77)** during implementation by reading its `.d.ts` and observing a live run —
  the same discipline the prior modernization spec used. (If reaching the SDK `init`
  system message turns out to reliably imply valid credentials, we may abort there
  instead of waiting for the first token, as a cost optimization; the safe default is to
  wait for a real success signal.)
- **B — credential heuristics (rejected).** Inspect `ANTHROPIC_API_KEY` and
  `~/.claude/.credentials.json` / OS keychain. Zero cost and instant, but cannot
  distinguish a valid login from an expired/garbage one, and duplicates SDK-internal
  credential resolution that can change between versions.
- **C — `claude --version` + heuristics (rejected).** Confirms a binary we already ship
  and still cannot confirm auth validity, which is the actual failure mode.

## Availability state

`ClaudeAvailability` (added to `src/shared/types.ts`):

```ts
type ClaudeAvailabilityStatus =
  | 'unknown'        // before the first probe completes
  | 'checking'       // a probe is in flight
  | 'ready'          // a probe succeeded — AI features enabled
  | 'unauthenticated'// CLI ran but has no/invalid credentials
  | 'cli-error'      // the CLI could not be spawned (ENOENT / spawn failure)
  | 'error'          // any other failure (carries `detail`)

interface ClaudeAvailability {
  status: ClaudeAvailabilityStatus
  method?: 'subscription' | 'apiKey' // how it became ready (informational)
  detail?: string                     // short error text for 'error'/'cli-error'
  checkedAt: number                   // epoch ms of the last probe
}
```

## Component changes

### Main process

**New — `src/main/services/claudeHealth.ts`**
- Owns the cached `ClaudeAvailability` (starts `{ status: 'unknown', checkedAt: 0 }`).
- `probe(): Promise<ClaudeAvailability>` — sets `checking`, runs the micro-probe (above),
  classifies the outcome, updates the cache, and notifies listeners. Concurrent calls
  collapse onto the in-flight probe.
- `getAvailability(): ClaudeAvailability` — returns the cache.
- `classifyProbeError(err): ClaudeAvailabilityStatus` — a **pure function** mapping an
  error/string to a status. Kept pure so it is independently checkable without the SDK.
- A change emitter (`onChange(cb)`) so `index.ts` can forward changes to the renderer.

**Refactor — `src/main/services/claude.ts`**
- Extract the executable/env wiring (currently split across `getClaudeExecutablePath`
  and `getSpawnOverrides`, where `env` is only set when packaged) into a single shared
  helper, e.g. `buildSdkSpawnOptions(): { pathToClaudeCodeExecutable?, executable?, env? }`.
  This helper **always** merges a stored API key into `env` (`ANTHROPIC_API_KEY`) in both
  dev and packaged builds, and adds the `ELECTRON_RUN_AS_NODE` / asar-unpacked path logic
  only when packaged. Export it so `claudeHealth.ts` uses the identical wiring.
- `sendMessage` uses the shared helper instead of `getClaudeExecutablePath()` +
  `getSpawnOverrides()` inline.

**`src/main/constants.ts`**
- Add `CLAUDE_SECRET_FILE = join(CONFIG_DIR, 'claude.json')`.

**`src/main/services/config.ts`**
- Add `saveClaudeApiKey(key: string)`, `loadClaudeApiKey(): string | null`,
  `clearClaudeApiKey()`, `hasClaudeApiKey(): boolean`. Encrypt with `safeStorage` using
  the existing `encrypted:` + base64 scheme; persist to `CLAUDE_SECRET_FILE`. Never
  return the key to any renderer-facing path except the SDK env injection.

**`src/main/trpc/routers/claude.ts`**
- `availability: query()` → `claudeHealth.getAvailability()`.
- `recheck: mutation()` → `await claudeHealth.probe()`; returns the new availability.
- `hasApiKey: query()` → `configService.hasClaudeApiKey()` (boolean only).
- `setApiKey: mutation({ key })` → `saveClaudeApiKey(key)` then re-probe; returns availability.
- `clearApiKey: mutation()` → `clearClaudeApiKey()` then re-probe; returns availability.
- Guard `sendMessage` / `recommendIndexes` / `interpretExplain`: if
  `getAvailability().status !== 'ready'`, return `{ started: false, reason }` (mirrors the
  existing `{ started: true }` shape) instead of invoking the SDK. This path is purely
  defensive — the renderer already prevents sending when not `ready`.

**`src/main/index.ts`**
- After the window and services are ready, call `claudeHealth.probe()` (fire-and-forget).
- Subscribe to `claudeHealth.onChange` and forward each change to the renderer as
  `claude:availability`. Reuse the existing `mainWindow.webContents.send` path that
  `claude.ts` already uses for streaming events.

### Renderer

**`src/renderer/src/store/claudeStore.ts`**
- Add `availability: ClaudeAvailability` (default `{ status: 'unknown', checkedAt: 0 }`)
  and `setAvailability(a)`. This store already holds global Claude panel state
  (`isPanelOpen`), so it is the natural home; no new store.

**`src/renderer/src/App.tsx`**
- On mount: `trpc.claude.availability.query()` → `setAvailability`, and subscribe to the
  `claude:availability` IPC event → `setAvailability`. Clean up the listener on unmount.

**New — `src/renderer/src/components/claude/ClaudeSetup.tsx`**
- Rendered by `ClaudePanel` when `status !== 'ready'`. Content adapts to status:
  - `checking` / `unknown` → a small "Checking Claude…" line with a spinner.
  - `unauthenticated` → "Claude Code is installed but not signed in. Run `claude` in a
    terminal and complete login, then Re-check."
  - `cli-error` → "Couldn't start Claude Code." + install guidance.
  - `error` → the `detail` text + install guidance.
- Always offers both remediation paths:
  - **Install / log in:** a "Get Claude Code" button (opens `https://claude.com/claude-code`
    via `shell.openExternal` from main), a copy-able, **platform-aware** install command
    (`irm https://claude.ai/install.ps1 | iex` on Windows; `curl -fsSL https://claude.ai/install.sh | bash`
    on macOS/Linux; `npm install -g @anthropic-ai/claude-code` as the cross-platform
    fallback — selected from the platform the electron-toolkit preload already exposes
    at `window.electron.process.platform`), and the `claude` login note.
  - **API key:** a masked input + Save (`trpc.claude.setApiKey`). If a key is already set
    (`hasApiKey`), show "Key set ✓" with a Remove action; never render the key itself.
  - A **Re-check** button (`trpc.claude.recheck`).
- The external link opens via `shell.openExternal` behind a small main IPC handler
  (e.g. `ipcMain.handle('shell:openExternal', ...)`, mirroring the existing
  `update:install` invoke pattern used in `TopBar.tsx`), never by navigating the renderer.

**`src/renderer/src/components/claude/ClaudePanel.tsx`**
- If `availability.status !== 'ready'`, render `<ClaudeSetup />` in place of the chat
  thread + input. Otherwise unchanged.

**`src/renderer/src/components/indexes/IndexPanel.tsx` (`IndexPanel.tsx:102` area)**
- The "Recommend Indexes" button gets `disabled={status !== 'ready'}` and a tooltip
  "Set up Claude to enable AI features" when disabled.

**`src/renderer/src/components/explain/VisualExplain.tsx` (`VisualExplain.tsx:92` area)**
- The "AI Explain" button gets the same `disabled` + tooltip treatment.

**`src/renderer/src/components/layout/TopBar.tsx`**
- Add a "Claude AI" subsection to the Settings popover (below Cat Sounds): a status badge
  (Ready / Not signed in / etc.), the API-key set/remove control, and a Re-check button —
  so the key and status are reachable without opening the panel.
- Optional polish: a small colored status dot on the existing "Claude" toggle button.

**`src/shared/types.ts`**
- Add the `ClaudeAvailability` / `ClaudeAvailabilityStatus` types above.

## Data flow

1. **Startup (main):** window + services ready → `claudeHealth.probe()` → cache set →
   `claude:availability` emitted.
2. **Renderer mount:** `App` queries `trpc.claude.availability` (handles the
   probe-finished-before-listener race) and subscribes to `claude:availability`.
3. **Gating:** `ClaudePanel`, `IndexPanel`, `VisualExplain` all read
   `claudeStore.availability.status === 'ready'`.
4. **User remediation:** Save/Remove API key or click Re-check → main re-probes → emits →
   every consumer updates reactively.

## Security

- API key encrypted at rest via `safeStorage`; stored in `claude.json`, never in
  plaintext `settings.json`; never returned to the renderer (only a boolean); injected
  only into the SDK child `env`.
- If `safeStorage.isEncryptionAvailable()` is false (mirrors the connection store's
  existing guard), we do **not** silently store the key in plaintext — saving is refused
  with a message telling the user to use the Claude Code login path instead.
- External links open via `shell.openExternal`, never renderer navigation.

## Risks & verification

- **Probe semantics drift.** The success signal and auth-error shape must be pinned
  against the *installed* SDK (0.1.77) by reading its types and observing a live probe —
  not assumed from docs. Keep `classifyProbeError` pure and small so the mapping is
  obvious and adjustable.
- **Probe cost / latency.** A startup SDK call adds a brief delay and a few tokens.
  Mitigated by `maxTurns: 1`, a 1-token prompt, aborting at the first success signal, and
  running only at startup + explicit user action (no per-panel-open probing). The probe
  must never block the UI — the panel shows `checking` until it resolves.
- **No test runner in the repo.** Verification is `npm run build` + manual
  (`npm run typecheck` is pre-broken; use `typecheck:node`). `classifyProbeError` is the
  one piece kept independently checkable. Manual matrix:
  - logged-in subscription → `ready`, panel + both buttons work;
  - logged out (`claude logout`) → `unauthenticated`, setup screen shown, buttons
    disabled with tooltip;
  - valid API key entered → flips to `ready` without restart;
  - bad API key entered → stays `unauthenticated`;
  - Re-check after fixing auth flips to `ready`;
  - packaged `npm run build` smoke-check (no SDK version change, asar path untouched).

## Out of scope

- Swapping Claude for another AI provider (Claude is a fundamental dependency).
- An embedded OAuth login flow inside Mango (we direct users to the CLI's `claude`
  login).
- Auto-installing Claude Code on the user's behalf.
- Re-probing on every panel open (startup + explicit Re-check / key change only).
- Per-feature availability (all three entry points share one global status).
