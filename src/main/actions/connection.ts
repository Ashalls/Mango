import { randomUUID } from 'crypto'
import * as mongoService from '../services/mongodb'
import * as configService from '../services/config'
import type { ConnectionProfile, ConnectionState } from '@shared/types'

export function listConnections(): ConnectionProfile[] {
  return configService.loadConnections()
}

export function saveConnection(input: {
  id?: string
  name: string
  uri: string
  color?: string
  isProduction?: boolean
  claudeAccess?: 'readonly' | 'readwrite'
}): ConnectionProfile {
  const connections = configService.loadConnections()
  const profile: ConnectionProfile = {
    id: input.id || randomUUID(),
    name: input.name,
    uri: input.uri,
    color: input.color,
    isProduction: input.isProduction,
    claudeAccess: input.claudeAccess ?? (input.isProduction ? 'readonly' : 'readwrite')
  }

  const index = connections.findIndex((c) => c.id === profile.id)
  if (index >= 0) {
    connections[index] = profile
  } else {
    connections.push(profile)
  }

  configService.saveConnections(connections)
  return profile
}

export function deleteConnection(id: string): void {
  const connections = configService.loadConnections()
  configService.saveConnections(connections.filter((c) => c.id !== id))
}

export async function connect(id: string): Promise<ConnectionState> {
  const connections = configService.loadConnections()
  const profile = connections.find((c) => c.id === id)
  if (!profile) {
    throw new Error(`Connection profile "${id}" not found`)
  }

  try {
    await mongoService.connect(id, profile.uri)
    mongoService.setActiveConnectionId(id)
    return { profileId: id, status: 'connected' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { profileId: id, status: 'error', error: message }
  }
}

export async function disconnect(id?: string): Promise<void> {
  if (id) {
    await mongoService.disconnect(id)
  } else {
    const activeId = mongoService.getActiveConnectionId()
    if (activeId) await mongoService.disconnect(activeId)
  }
}

export function setActive(id: string): void {
  mongoService.setActiveConnectionId(id)
}

export function getStatus(): ConnectionState & { connectedIds: string[] } {
  const activeId = mongoService.getActiveConnectionId()
  const connectedIds = mongoService.getConnectedIds()
  if (!activeId || !mongoService.isConnected(activeId)) {
    return { profileId: '', status: 'disconnected', connectedIds }
  }
  return { profileId: activeId, status: 'connected', connectedIds }
}
