import { Client } from 'ssh2'
import { createServer, type Server, type AddressInfo } from 'net'
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { CONFIG_DIR } from '../constants'
import type { SSHConfig } from '@shared/types'

interface TunnelHandle {
  sshClient: Client
  localServer: Server
  localPort: number
}

const tunnels = new Map<string, TunnelHandle>()

// --- SSH host-key pinning (trust-on-first-use) -----------------------------
// Without this the ssh2 client accepts ANY presented host key, so a network
// attacker between the app and the bastion can transparently MITM the tunnel
// carrying MongoDB credentials. We pin the fingerprint on first connect and
// reject on mismatch thereafter.

const KNOWN_HOSTS_FILE = join(CONFIG_DIR, 'ssh-known-hosts.json')

/**
 * Load the pinned host keys. Fails CLOSED: a missing file is fine (no pins yet,
 * first use), but a corrupt or unreadable store THROWS rather than returning an
 * empty set — otherwise a corrupted store would silently re-trust the next key.
 */
function loadKnownHosts(): Record<string, string> {
  let raw: string
  try {
    raw = readFileSync(KNOWN_HOSTS_FILE, 'utf-8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`Cannot read SSH known-hosts store (${KNOWN_HOSTS_FILE}): ${(e as Error).message}`)
  }
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`SSH known-hosts store is corrupt (${KNOWN_HOSTS_FILE})`)
  }
  return parsed as Record<string, string>
}

/** Persist atomically (temp + rename) so an interrupted write can't corrupt the
 * store, and re-assert restrictive modes even on pre-existing paths. */
function saveKnownHosts(hosts: Record<string, string>): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  try { chmodSync(CONFIG_DIR, 0o700) } catch { /* best-effort */ }
  const tmp = `${KNOWN_HOSTS_FILE}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(hosts, null, 2), { mode: 0o600 })
  renameSync(tmp, KNOWN_HOSTS_FILE)
  try { chmodSync(KNOWN_HOSTS_FILE, 0o600) } catch { /* best-effort */ }
}

function fingerprint(hostKey: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')
}

export async function createTunnel(
  connectionId: string,
  sshConfig: SSHConfig,
  mongoHost: string,
  mongoPort: number
): Promise<number> {
  await destroyTunnel(connectionId)

  return new Promise((resolve, reject) => {
    const sshClient = new Client()

    // Set by the host-key verifier so the connection error carries a clear
    // MITM message instead of ssh2's generic handshake failure.
    let hostKeyError: string | null = null
    const hostId = `${sshConfig.host}:${sshConfig.port}`

    const connectConfig: Record<string, unknown> = {
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      hostVerifier: (hostKey: Buffer): boolean => {
        try {
          const fp = fingerprint(hostKey)
          const known = loadKnownHosts()
          const stored = known[hostId]
          if (!stored) {
            // Trust on first use — pin this fingerprint for future connections.
            known[hostId] = fp
            saveKnownHosts(known)
            return true
          }
          if (stored === fp) return true
          hostKeyError =
            `SSH host key for ${hostId} has CHANGED (pinned ${stored}, server offered ${fp}). ` +
            `This may be a man-in-the-middle attack. If the host legitimately rotated its key, ` +
            `remove its entry from ${KNOWN_HOSTS_FILE} and reconnect.`
          return false
        } catch (err) {
          // Fail CLOSED: if the pin store can't be read or persisted, reject the
          // connection instead of trusting an unverified key (and never let the
          // error escape the verifier as an uncaught main-process exception).
          hostKeyError = `SSH host-key verification failed for ${hostId}: ${(err as Error).message}`
          return false
        }
      }
    }

    if (sshConfig.authMethod === 'password') {
      connectConfig.password = sshConfig.password
    } else {
      try {
        connectConfig.privateKey = readFileSync(sshConfig.privateKeyPath!)
        if (sshConfig.passphrase) {
          connectConfig.passphrase = sshConfig.passphrase
        }
      } catch (err) {
        reject(new Error(`Failed to read SSH private key: ${(err as Error).message}`))
        return
      }
    }

    sshClient.on('ready', () => {
      const localServer = createServer((localSocket) => {
        sshClient.forwardOut(
          '127.0.0.1',
          0,
          mongoHost,
          mongoPort,
          (err, stream) => {
            if (err) {
              localSocket.destroy()
              return
            }
            localSocket.pipe(stream).pipe(localSocket)
          }
        )
      })

      localServer.listen(0, '127.0.0.1', () => {
        const localPort = (localServer.address() as AddressInfo).port
        tunnels.set(connectionId, { sshClient, localServer, localPort })
        resolve(localPort)
      })

      localServer.on('error', (err) => {
        sshClient.end()
        reject(new Error(`SSH local server error: ${err.message}`))
      })
    })

    sshClient.on('error', (err) => {
      reject(new Error(hostKeyError ?? `SSH tunnel failed: ${err.message}`))
    })

    sshClient.connect(connectConfig as Parameters<Client['connect']>[0])
  })
}

export async function destroyTunnel(connectionId: string): Promise<void> {
  const tunnel = tunnels.get(connectionId)
  if (!tunnel) return
  tunnel.localServer.close()
  tunnel.sshClient.end()
  tunnels.delete(connectionId)
}

export async function destroyAllTunnels(): Promise<void> {
  for (const id of tunnels.keys()) {
    await destroyTunnel(id)
  }
}

export function hasTunnel(connectionId: string): boolean {
  return tunnels.has(connectionId)
}
