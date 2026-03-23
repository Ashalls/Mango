import { MongoClient, type Db } from 'mongodb'

/** Map of connection profile ID → MongoClient */
const clients = new Map<string, MongoClient>()

/** The currently "active" connection ID (shown in main UI) */
let activeConnectionId: string | null = null

export async function connect(id: string, uri: string): Promise<void> {
  // If already connected with this id, close first
  if (clients.has(id)) {
    await clients.get(id)!.close()
  }
  const client = new MongoClient(uri)
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
  }
}

export async function disconnectAll(): Promise<void> {
  for (const [id, client] of clients) {
    await client.close()
  }
  clients.clear()
  activeConnectionId = null
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
