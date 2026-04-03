import { Client } from 'ssh2'
import { createServer, type Server, type AddressInfo } from 'net'
import { readFileSync } from 'fs'
import type { SSHConfig } from '@shared/types'

interface TunnelHandle {
  sshClient: Client
  localServer: Server
  localPort: number
}

const tunnels = new Map<string, TunnelHandle>()

export async function createTunnel(
  connectionId: string,
  sshConfig: SSHConfig,
  mongoHost: string,
  mongoPort: number
): Promise<number> {
  await destroyTunnel(connectionId)

  return new Promise((resolve, reject) => {
    const sshClient = new Client()

    const connectConfig: Record<string, unknown> = {
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username
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
      reject(new Error(`SSH tunnel failed: ${err.message}`))
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
