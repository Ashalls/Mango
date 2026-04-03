import { MongoClient, type Db } from 'mongodb'
import * as sshTunnel from './sshTunnel'
import type { SSHConfig, TLSConfig } from '@shared/types'

/** Map of connection profile ID → MongoClient */
const clients = new Map<string, MongoClient>()

/** The currently "active" connection ID (shown in main UI) */
let activeConnectionId: string | null = null

export async function connect(
  id: string,
  uri: string,
  sshConfig?: SSHConfig,
  tlsConfig?: TLSConfig
): Promise<void> {
  if (clients.has(id)) {
    await disconnect(id)
  }

  let connectUri = uri

  if (sshConfig?.enabled) {
    const url = new URL(uri)
    const mongoHost = url.hostname
    const mongoPort = parseInt(url.port) || 27017
    const localPort = await sshTunnel.createTunnel(id, sshConfig, mongoHost, mongoPort)
    url.hostname = '127.0.0.1'
    url.port = String(localPort)
    connectUri = url.toString()
  }

  const options: Record<string, unknown> = {}
  if (tlsConfig?.enabled) {
    options.tls = true
    if (tlsConfig.caFile) options.tlsCAFile = tlsConfig.caFile
    if (tlsConfig.certificateKeyFile) options.tlsCertificateKeyFile = tlsConfig.certificateKeyFile
    if (tlsConfig.certificateKeyFilePassword) options.tlsCertificateKeyFilePassword = tlsConfig.certificateKeyFilePassword
    if (tlsConfig.allowInvalidHostnames) options.tlsAllowInvalidHostnames = true
    if (tlsConfig.allowInvalidCertificates) options.tlsAllowInvalidCertificates = true
  }

  const client = new MongoClient(connectUri, options)
  await client.connect()
  clients.set(id, client)
}

export async function disconnect(id: string): Promise<void> {
  const client = clients.get(id)
  if (client) {
    await client.close()
    clients.delete(id)
    if (activeConnectionId === id) {
      activeConnectionId = null
    }
    await sshTunnel.destroyTunnel(id)
  }
}

export async function disconnectAll(): Promise<void> {
  for (const [id, client] of clients) {
    await client.close()
  }
  clients.clear()
  activeConnectionId = null
  await sshTunnel.destroyAllTunnels()
}

export function getClient(id?: string): MongoClient {
  const connId = id || activeConnectionId
  if (!connId) throw new Error('No active connection')
  const client = clients.get(connId)
  if (!client) throw new Error(`Connection "${connId}" not found`)
  return client
}

export function getDb(name: string, connectionId?: string): Db {
  return getClient(connectionId).db(name)
}

export function isConnected(id?: string): boolean {
  if (id) return clients.has(id)
  return activeConnectionId !== null && clients.has(activeConnectionId)
}

export function getActiveConnectionId(): string | null {
  return activeConnectionId
}

export function setActiveConnectionId(id: string | null): void {
  if (id && !clients.has(id)) {
    throw new Error(`Connection "${id}" not found`)
  }
  activeConnectionId = id
}

export function getConnectedIds(): string[] {
  return Array.from(clients.keys())
}
