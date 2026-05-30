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
      // system/init, user (tool results), stream_event -> keep waiting
    }

    abort.abort()
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
