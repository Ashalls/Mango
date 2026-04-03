# Phase 2 — Connect Anywhere + Profiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock SSH/SSL users, add connection organization, query profiling, and code generation to 6 languages.

**Architecture:** Five independent features that share the connection layer. SSH tunnels and TLS wrap the MongoDB connect flow in `mongodb.ts`. Connection folders add a grouping layer to the sidebar. Query profiler adds a new tab type reading `system.profile`. Code generation is a pure-function template engine with a modal UI.

**Tech Stack:** ssh2 (SSH tunnels), Electron safeStorage (encryption), AG Grid (profiler table), Monaco Editor (code display), ReactFlow (already installed), tRPC + Zustand (existing patterns)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/main/services/sshTunnel.ts` | SSH tunnel lifecycle — create, forward, destroy |
| `src/main/services/queryCodegen.ts` | Template-based code generation for 6 languages |
| `src/main/actions/profiler.ts` | Profiling actions — get/set level, read system.profile |
| `src/main/trpc/routers/profiler.ts` | tRPC routes for profiler |
| `src/renderer/src/components/explorer/SSHForm.tsx` | SSH config form fields |
| `src/renderer/src/components/explorer/TLSForm.tsx` | TLS config form fields |
| `src/renderer/src/components/explorer/ConnectionFolders.tsx` | Folder CRUD UI in sidebar |
| `src/renderer/src/components/profiler/QueryProfiler.tsx` | Profiler tab main component |
| `src/renderer/src/components/codegen/CodeGenModal.tsx` | Code generation modal |

### Modified Files
| File | Changes |
|------|---------|
| `src/shared/types.ts` | Add SSHConfig, TLSConfig, ConnectionFolder, ProfilerEntry types |
| `src/main/services/mongodb.ts` | SSH tunnel + TLS options in connect() |
| `src/main/services/config.ts` | Encrypt SSH passwords/passphrases, load/save folders |
| `src/main/constants.ts` | Add FOLDERS_FILE constant |
| `src/main/actions/connection.ts` | Pass SSH/TLS config through connect flow |
| `src/main/trpc/routers/connection.ts` | Extend save input schema for SSH/TLS fields |
| `src/main/trpc/router.ts` | Add profiler router |
| `src/main/mcp/tools.ts` | Add mongo_query_profiler MCP tool |
| `src/renderer/src/store/connectionStore.ts` | Add folders state + actions |
| `src/renderer/src/components/explorer/ConnectionDialog.tsx` | Add SSH and TLS tabs |
| `src/renderer/src/components/layout/Sidebar.tsx` | Render connection folders |
| `src/renderer/src/components/data/MainPanel.tsx` | Route profiler tab type |
| `src/renderer/src/components/query/QueryBuilder.tsx` | Add Code button |

---

## Task 1: Branch + Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Create feature branch**

```bash
git checkout main
git checkout -b feat/phase2-connect-profiling
```

- [ ] **Step 2: Install ssh2**

```bash
pnpm add ssh2
pnpm add -D @types/ssh2
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: install ssh2 for SSH tunnel support"
```

---

## Task 2: Shared Types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add types to end of file**

Append after the existing `ValueSearchProgress` interface:

```typescript
// --- SSH / TLS connection types ---

export interface SSHConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  authMethod: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

export interface TLSConfig {
  enabled: boolean
  caFile?: string
  certificateKeyFile?: string
  certificateKeyFilePassword?: string
  allowInvalidHostnames: boolean
  allowInvalidCertificates: boolean
  sniHostname?: string
}

// --- Connection Folders ---

export interface ConnectionFolder {
  id: string
  name: string
  order: number
}

// --- Query Profiler ---

export interface ProfilerEntry {
  ts: string
  op: string
  ns: string
  millis: number
  planSummary: string
  docsExamined: number
  keysExamined: number
  nreturned: number
  command: Record<string, unknown>
  rawDoc: Record<string, unknown>
}

// --- Code Generation ---

export type CodegenLanguage = 'javascript' | 'python' | 'java' | 'csharp' | 'php' | 'ruby'

export interface CodegenInput {
  type: 'find' | 'aggregate'
  database: string
  collection: string
  filter?: Record<string, unknown>
  projection?: Record<string, unknown>
  sort?: Record<string, unknown>
  skip?: number
  limit?: number
  pipeline?: Record<string, unknown>[]
  includeBoilerplate: boolean
}
```

- [ ] **Step 2: Extend ConnectionProfile**

Add `sshConfig` and `tlsConfig` optional fields to the existing `ConnectionProfile` interface (after the `databaseCodebasePaths` field):

```typescript
  sshConfig?: SSHConfig
  tlsConfig?: TLSConfig
  folderId?: string
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared types for SSH, TLS, folders, profiler, and codegen"
```

---

## Task 3: SSH Tunnel Service

**Files:**
- Create: `src/main/services/sshTunnel.ts`

- [ ] **Step 1: Create the tunnel service**

```typescript
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
  // Clean up any existing tunnel for this connection
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
      // Create a local TCP server that forwards to the remote MongoDB
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
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/sshTunnel.ts
git commit -m "feat: add SSH tunnel service with create/destroy lifecycle"
```

---

## Task 4: Integrate SSH + TLS into MongoDB Connect

**Files:**
- Modify: `src/main/services/mongodb.ts`
- Modify: `src/main/actions/connection.ts`
- Modify: `src/main/services/config.ts`
- Modify: `src/main/constants.ts`

- [ ] **Step 1: Update mongodb.ts connect to accept SSH/TLS options**

Read `src/main/services/mongodb.ts` first. The current `connect` function (lines 9-17) takes `(id, uri)`. Change it to:

```typescript
import * as sshTunnel from './sshTunnel'
import type { SSHConfig, TLSConfig } from '@shared/types'

// ... existing code ...

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

  // SSH tunnel: rewrite URI to go through local port forward
  if (sshConfig?.enabled) {
    const url = new URL(uri)
    const mongoHost = url.hostname
    const mongoPort = parseInt(url.port) || 27017
    const localPort = await sshTunnel.createTunnel(id, sshConfig, mongoHost, mongoPort)
    url.hostname = '127.0.0.1'
    url.port = String(localPort)
    connectUri = url.toString()
  }

  // TLS options
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
```

Also update `disconnect` (lines 19-28) to destroy the SSH tunnel:

```typescript
export async function disconnect(id: string): Promise<void> {
  const client = clients.get(id)
  if (client) {
    await client.close()
    clients.delete(id)
  }
  await sshTunnel.destroyTunnel(id)
  if (activeConnectionId === id) {
    activeConnectionId = null
  }
}
```

And update `disconnectAll` (lines 30-36) to also call `sshTunnel.destroyAllTunnels()`.

- [ ] **Step 2: Update connection.ts connect action**

Read `src/main/actions/connection.ts` first. The `connect` function (lines 52-67) currently calls `mongoService.connect(id, profile.uri)`. Update it to pass SSH/TLS config:

```typescript
export async function connect(id: string): Promise<ConnectionState> {
  const connections = configService.loadConnections()
  const profile = connections.find((c) => c.id === id)
  if (!profile) throw new Error('Connection not found')

  try {
    await mongoService.connect(id, profile.uri, profile.sshConfig, profile.tlsConfig)
    mongoService.setActiveConnectionId(id)
    return {
      profileId: id,
      status: 'connected'
    }
  } catch (err) {
    return {
      profileId: id,
      status: 'error',
      error: (err as Error).message
    }
  }
}
```

- [ ] **Step 3: Update config.ts to encrypt SSH passwords and passphrases**

Read `src/main/services/config.ts` first. In `loadConnections()` (lines 20-41), after decrypting the URI, also decrypt SSH fields:

```typescript
// After existing URI decryption block, add:
if (conn.sshConfig?.password && conn.sshConfig.password.startsWith('encrypted:')) {
  const buf = Buffer.from(conn.sshConfig.password.slice(10), 'base64')
  conn.sshConfig.password = safeStorage.decryptString(buf)
}
if (conn.sshConfig?.passphrase && conn.sshConfig.passphrase.startsWith('encrypted:')) {
  const buf = Buffer.from(conn.sshConfig.passphrase.slice(10), 'base64')
  conn.sshConfig.passphrase = safeStorage.decryptString(buf)
}
if (conn.tlsConfig?.certificateKeyFilePassword && conn.tlsConfig.certificateKeyFilePassword.startsWith('encrypted:')) {
  const buf = Buffer.from(conn.tlsConfig.certificateKeyFilePassword.slice(10), 'base64')
  conn.tlsConfig.certificateKeyFilePassword = safeStorage.decryptString(buf)
}
```

In `saveConnections()` (lines 43-52), before saving, also encrypt SSH fields:

```typescript
// After existing URI encryption block, add:
if (conn.sshConfig?.password && !conn.sshConfig.password.startsWith('encrypted:')) {
  conn.sshConfig.password = 'encrypted:' + safeStorage.encryptString(conn.sshConfig.password).toString('base64')
}
if (conn.sshConfig?.passphrase && !conn.sshConfig.passphrase.startsWith('encrypted:')) {
  conn.sshConfig.passphrase = 'encrypted:' + safeStorage.encryptString(conn.sshConfig.passphrase).toString('base64')
}
if (conn.tlsConfig?.certificateKeyFilePassword && !conn.tlsConfig.certificateKeyFilePassword.startsWith('encrypted:')) {
  conn.tlsConfig.certificateKeyFilePassword = 'encrypted:' + safeStorage.encryptString(conn.tlsConfig.certificateKeyFilePassword).toString('base64')
}
```

- [ ] **Step 4: Add FOLDERS_FILE constant**

Append to `src/main/constants.ts`:

```typescript
export const FOLDERS_FILE = join(CONFIG_DIR, 'folders.json')
```

- [ ] **Step 5: Add folder persistence to config.ts**

Append to `src/main/services/config.ts`:

```typescript
import { FOLDERS_FILE } from '../constants'
import type { ConnectionFolder } from '@shared/types'

export function loadFolders(): ConnectionFolder[] {
  ensureConfigDir()
  try {
    const data = readFileSync(FOLDERS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

export function saveFolders(folders: ConnectionFolder[]): void {
  ensureConfigDir()
  writeFileSync(FOLDERS_FILE, JSON.stringify(folders, null, 2))
}
```

Note: `FOLDERS_FILE` import must be added to the existing imports from `'../constants'`.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/mongodb.ts src/main/actions/connection.ts src/main/services/config.ts src/main/constants.ts
git commit -m "feat: integrate SSH tunnels and TLS into MongoDB connect flow with encrypted config"
```

---

## Task 5: Update tRPC Connection Router for SSH/TLS/Folder Fields

**Files:**
- Modify: `src/main/trpc/routers/connection.ts`

- [ ] **Step 1: Extend the save mutation input schema**

Read the file first. The `save` mutation (lines 9-25) has an input schema for `name`, `uri`, `color`, etc. Add `sshConfig`, `tlsConfig`, and `folderId` to the input `z.object`:

```typescript
  save: procedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        uri: z.string(),
        color: z.string().optional(),
        isProduction: z.boolean().optional(),
        isReadOnly: z.boolean().optional(),
        claudeAccess: z.enum(['readonly', 'readwrite']).optional(),
        claudeDbOverrides: z.record(z.enum(['readonly', 'readwrite'])).optional(),
        databaseCodebasePaths: z.record(z.string()).optional(),
        sshConfig: z.object({
          enabled: z.boolean(),
          host: z.string(),
          port: z.number(),
          username: z.string(),
          authMethod: z.enum(['password', 'privateKey']),
          password: z.string().optional(),
          privateKeyPath: z.string().optional(),
          passphrase: z.string().optional()
        }).optional(),
        tlsConfig: z.object({
          enabled: z.boolean(),
          caFile: z.string().optional(),
          certificateKeyFile: z.string().optional(),
          certificateKeyFilePassword: z.string().optional(),
          allowInvalidHostnames: z.boolean(),
          allowInvalidCertificates: z.boolean(),
          sniHostname: z.string().optional()
        }).optional(),
        folderId: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      return connectionActions.saveConnection(input)
    }),
```

- [ ] **Step 2: Add folder CRUD routes**

Add these routes to the same connection router (or create a dedicated `folder` section — simplest is to add to the existing router):

```typescript
  listFolders: procedure.query(() => {
    return configService.loadFolders()
  }),

  saveFolder: procedure
    .input(z.object({
      id: z.string().optional(),
      name: z.string(),
      order: z.number()
    }))
    .mutation(({ input }) => {
      const folders = configService.loadFolders()
      if (input.id) {
        const idx = folders.findIndex((f) => f.id === input.id)
        if (idx >= 0) folders[idx] = { ...folders[idx], ...input } as ConnectionFolder
      } else {
        const folder: ConnectionFolder = {
          id: crypto.randomUUID(),
          name: input.name,
          order: input.order
        }
        folders.push(folder)
      }
      configService.saveFolders(folders)
      return folders
    }),

  deleteFolder: procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const folders = configService.loadFolders().filter((f) => f.id !== input.id)
      configService.saveFolders(folders)
      // Move connections in this folder to root
      const connections = configService.loadConnections()
      for (const conn of connections) {
        if (conn.folderId === input.id) conn.folderId = undefined
      }
      configService.saveConnections(connections)
      return folders
    }),
```

Add the necessary imports at the top: `import type { ConnectionFolder } from '@shared/types'` and `import * as configService from '../../services/config'`.

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/connection.ts
git commit -m "feat: extend connection router with SSH/TLS fields and folder CRUD"
```

---

## Task 6: SSH and TLS Form Components

**Files:**
- Create: `src/renderer/src/components/explorer/SSHForm.tsx`
- Create: `src/renderer/src/components/explorer/TLSForm.tsx`

- [ ] **Step 1: Create SSHForm**

```typescript
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Eye, EyeOff, FileKey } from 'lucide-react'
import { useState } from 'react'
import type { SSHConfig } from '@shared/types'

interface SSHFormProps {
  config: SSHConfig
  onChange: (config: SSHConfig) => void
}

const defaultSSH: SSHConfig = {
  enabled: false,
  host: '',
  port: 22,
  username: '',
  authMethod: 'password'
}

export { defaultSSH }

export function SSHForm({ config, onChange }: SSHFormProps) {
  const [showPassword, setShowPassword] = useState(false)

  const update = (partial: Partial<SSHConfig>) => onChange({ ...config, ...partial })

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="rounded"
        />
        Connect via SSH Tunnel
      </label>

      {config.enabled && (
        <>
          {/* Visual flow */}
          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
            <span>[Your Machine]</span>
            <span>&rarr; SSH &rarr;</span>
            <span>[{config.host || '...'}]</span>
            <span>&rarr;</span>
            <span>[MongoDB Host]</span>
          </div>

          <div className="grid grid-cols-[1fr_80px] gap-2">
            <div>
              <Label className="text-xs">SSH Host</Label>
              <Input
                value={config.host}
                onChange={(e) => update({ host: e.target.value })}
                placeholder="ssh.example.com"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Port</Label>
              <Input
                type="number"
                value={config.port}
                onChange={(e) => update({ port: parseInt(e.target.value) || 22 })}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Username</Label>
            <Input
              value={config.username}
              onChange={(e) => update({ username: e.target.value })}
              placeholder="ubuntu"
              className="h-8 text-sm"
            />
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name="ssh-auth"
                checked={config.authMethod === 'password'}
                onChange={() => update({ authMethod: 'password' })}
              />
              Password
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name="ssh-auth"
                checked={config.authMethod === 'privateKey'}
                onChange={() => update({ authMethod: 'privateKey' })}
              />
              Private Key
            </label>
          </div>

          {config.authMethod === 'password' ? (
            <div className="relative">
              <Label className="text-xs">Password</Label>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={config.password ?? ''}
                onChange={(e) => update({ password: e.target.value })}
                className="h-8 pr-8 text-sm"
              />
              <button
                type="button"
                className="absolute right-2 top-6 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs">Private Key File</Label>
                <div className="flex gap-2">
                  <Input
                    value={config.privateKeyPath ?? ''}
                    onChange={(e) => update({ privateKeyPath: e.target.value })}
                    placeholder="/path/to/key.pem"
                    className="h-8 text-sm"
                  />
                  <button
                    type="button"
                    className="flex h-8 items-center gap-1 rounded border border-input px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={async () => {
                      const { dialog } = window.require('@electron/remote') ?? {}
                      if (!dialog) return
                      const result = await dialog.showOpenDialog({
                        properties: ['openFile'],
                        filters: [{ name: 'Key Files', extensions: ['pem', 'ppk', 'key'] }]
                      })
                      if (!result.canceled && result.filePaths[0]) {
                        update({ privateKeyPath: result.filePaths[0] })
                      }
                    }}
                  >
                    <FileKey className="h-3.5 w-3.5" />
                    Browse
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Passphrase (optional)</Label>
                <Input
                  type="password"
                  value={config.passphrase ?? ''}
                  onChange={(e) => update({ passphrase: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create TLSForm**

```typescript
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { AlertTriangle, FileKey } from 'lucide-react'
import type { TLSConfig } from '@shared/types'

interface TLSFormProps {
  config: TLSConfig
  onChange: (config: TLSConfig) => void
}

const defaultTLS: TLSConfig = {
  enabled: false,
  allowInvalidHostnames: false,
  allowInvalidCertificates: false
}

export { defaultTLS }

function FilePicker({ label, value, onChange, extensions }: {
  label: string
  value?: string
  onChange: (path: string | undefined) => void
  extensions: string[]
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder={`Select ${label.toLowerCase()}...`}
          className="h-8 text-sm"
        />
        <button
          type="button"
          className="flex h-8 items-center gap-1 rounded border border-input px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={async () => {
            const { dialog } = window.require('@electron/remote') ?? {}
            if (!dialog) return
            const result = await dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [{ name: 'Certificates', extensions }]
            })
            if (!result.canceled && result.filePaths[0]) {
              onChange(result.filePaths[0])
            }
          }}
        >
          <FileKey className="h-3.5 w-3.5" />
        </button>
        {value && (
          <button
            type="button"
            className="h-8 rounded border border-input px-2 text-xs text-destructive hover:bg-destructive/10"
            onClick={() => onChange(undefined)}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

export function TLSForm({ config, onChange }: TLSFormProps) {
  const update = (partial: Partial<TLSConfig>) => onChange({ ...config, ...partial })

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="rounded"
        />
        Use TLS/SSL
      </label>

      {config.enabled && (
        <>
          <FilePicker
            label="CA Certificate"
            value={config.caFile}
            onChange={(path) => update({ caFile: path })}
            extensions={['pem', 'crt', 'cer']}
          />

          <FilePicker
            label="Client Certificate"
            value={config.certificateKeyFile}
            onChange={(path) => update({ certificateKeyFile: path })}
            extensions={['pem', 'crt', 'cer']}
          />

          <div>
            <Label className="text-xs">Private Key Passphrase</Label>
            <Input
              type="password"
              value={config.certificateKeyFilePassword ?? ''}
              onChange={(e) => update({ certificateKeyFilePassword: e.target.value || undefined })}
              className="h-8 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={config.allowInvalidHostnames}
              onChange={(e) => update({ allowInvalidHostnames: e.target.checked })}
              className="rounded"
            />
            Allow invalid hostnames
          </label>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={config.allowInvalidCertificates}
              onChange={(e) => update({ allowInvalidCertificates: e.target.checked })}
              className="rounded"
            />
            <span className="flex items-center gap-1">
              Allow invalid certificates
              <AlertTriangle className="h-3 w-3 text-amber-400" />
            </span>
          </label>
          {config.allowInvalidCertificates && (
            <p className="text-[10px] text-amber-400">Only for self-signed certs in development</p>
          )}

          <div>
            <Label className="text-xs">SNI Hostname (optional)</Label>
            <Input
              value={config.sniHostname ?? ''}
              onChange={(e) => update({ sniHostname: e.target.value || undefined })}
              placeholder="server.example.com"
              className="h-8 text-sm"
            />
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/explorer/SSHForm.tsx src/renderer/src/components/explorer/TLSForm.tsx
git commit -m "feat: add SSHForm and TLSForm components for connection dialog"
```

---

## Task 7: Integrate SSH/TLS Tabs into ConnectionDialog

**Files:**
- Modify: `src/renderer/src/components/explorer/ConnectionDialog.tsx`

- [ ] **Step 1: Read and modify ConnectionDialog**

Read the file first. It currently has state for `name`, `uri`, `color`, `isProduction`, `isReadOnly`, `claudeAccess`. Add:

1. Import `SSHForm`, `defaultSSH`, `TLSForm`, `defaultTLS` from the new components
2. Add state:
   ```typescript
   const [dialogTab, setDialogTab] = useState<'general' | 'ssh' | 'tls'>('general')
   const [sshConfig, setSSHConfig] = useState<SSHConfig>(editProfile?.sshConfig ?? defaultSSH)
   const [tlsConfig, setTLSConfig] = useState<TLSConfig>(editProfile?.tlsConfig ?? defaultTLS)
   ```
3. Add a tab bar at the top of the form body: `General | SSH | TLS`
4. Wrap existing form fields in a `{dialogTab === 'general' && (...)}` block
5. Add `{dialogTab === 'ssh' && <SSHForm config={sshConfig} onChange={setSSHConfig} />}`
6. Add `{dialogTab === 'tls' && <TLSForm config={tlsConfig} onChange={setTLSConfig} />}`
7. Pass `sshConfig` and `tlsConfig` through to `saveProfile()` call (add them to the `trpc.connection.save.mutate()` input)

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/explorer/ConnectionDialog.tsx
git commit -m "feat: add SSH and TLS tabs to ConnectionDialog"
```

---

## Task 8: Connection Folders — Store + Sidebar

**Files:**
- Modify: `src/renderer/src/store/connectionStore.ts`
- Modify: `src/renderer/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Extend connectionStore with folders**

Read `connectionStore.ts` first. Add to the interface:

```typescript
  folders: ConnectionFolder[]
  loadFolders: () => Promise<void>
  saveFolder: (name: string, order: number, id?: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
```

Add to the store implementation:

```typescript
  folders: [],
  loadFolders: async () => {
    const folders = await trpc.connection.listFolders.query()
    set({ folders })
  },
  saveFolder: async (name, order, id) => {
    const folders = await trpc.connection.saveFolder.mutate({ id, name, order })
    set({ folders })
  },
  deleteFolder: async (id) => {
    const folders = await trpc.connection.deleteFolder.mutate({ id })
    set({ folders })
    await get().loadProfiles()
  },
```

Add `ConnectionFolder` import from `@shared/types`. Call `loadFolders()` inside the existing `loadProfiles` function so folders load at startup.

- [ ] **Step 2: Update Sidebar to render folders**

Read `src/renderer/src/components/layout/Sidebar.tsx` first. In the connection list area (around line 138), render folders before ungrouped connections:

1. Import `useConnectionStore` folders and folder actions
2. Add state for `newFolderName` and `renamingFolder`
3. Group profiles: `folderedProfiles = profiles.filter(p => p.folderId)`, `unfolderedProfiles = profiles.filter(p => !p.folderId)`
4. Render folders as collapsible sections with:
   - Folder icon + name + connection count badge
   - Click to expand/collapse
   - Context menu: Rename, Delete
   - Connections within the folder listed underneath
5. Render ungrouped connections after folders
6. Add "New Folder" option to the sidebar context menu (right-click on empty space)
7. Add ability to drag connections into folders via a simple dropdown in the connection context menu: "Move to Folder >" submenu

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/store/connectionStore.ts src/renderer/src/components/layout/Sidebar.tsx
git commit -m "feat: add connection folders with sidebar grouping and folder CRUD"
```

---

## Task 9: Profiler Backend

**Files:**
- Create: `src/main/actions/profiler.ts`
- Create: `src/main/trpc/routers/profiler.ts`
- Modify: `src/main/trpc/router.ts`
- Modify: `src/main/mcp/tools.ts`

- [ ] **Step 1: Create profiler actions**

```typescript
import * as mongoService from '../services/mongodb'

export async function getProfilingStatus(database: string): Promise<{ was: number; slowms: number }> {
  const db = mongoService.getDb(database)
  const result = await db.command({ profile: -1 })
  return { was: result.was, slowms: result.slowms }
}

export async function setProfilingLevel(
  database: string,
  level: 0 | 1 | 2,
  slowms?: number
): Promise<void> {
  const db = mongoService.getDb(database)
  const cmd: Record<string, unknown> = { profile: level }
  if (slowms !== undefined) cmd.slowms = slowms
  await db.command(cmd)
}

export async function getProfilingData(
  database: string,
  limit: number = 100,
  namespace?: string
): Promise<Record<string, unknown>[]> {
  const db = mongoService.getDb(database)
  const filter: Record<string, unknown> = {}
  if (namespace) filter.ns = namespace

  const docs = await db
    .collection('system.profile')
    .find(filter)
    .sort({ millis: -1 })
    .limit(limit)
    .toArray()

  return docs.map((doc) => ({
    ts: doc.ts ? new Date(doc.ts as Date).toISOString() : '',
    op: String(doc.op ?? ''),
    ns: String(doc.ns ?? ''),
    millis: Number(doc.millis ?? 0),
    planSummary: String(doc.planSummary ?? ''),
    docsExamined: Number(doc.docsExamined ?? 0),
    keysExamined: Number(doc.keysExamined ?? 0),
    nreturned: Number(doc.nreturned ?? 0),
    command: (doc.command as Record<string, unknown>) ?? {},
    rawDoc: doc as Record<string, unknown>
  }))
}

export async function clearProfilingData(database: string): Promise<void> {
  const db = mongoService.getDb(database)
  await db.collection('system.profile').drop().catch(() => {
    // Collection may not exist — that's fine
  })
}
```

- [ ] **Step 2: Create profiler router**

```typescript
import { router, procedure } from '../context'
import { z } from 'zod'
import * as profilerActions from '../../actions/profiler'

export const profilerRouter = router({
  getStatus: procedure
    .input(z.object({ database: z.string() }))
    .query(({ input }) => profilerActions.getProfilingStatus(input.database)),

  setLevel: procedure
    .input(z.object({
      database: z.string(),
      level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      slowms: z.number().optional()
    }))
    .mutation(({ input }) => profilerActions.setProfilingLevel(input.database, input.level, input.slowms)),

  getData: procedure
    .input(z.object({
      database: z.string(),
      limit: z.number().optional().default(100),
      namespace: z.string().optional()
    }))
    .query(({ input }) => profilerActions.getProfilingData(input.database, input.limit, input.namespace)),

  clear: procedure
    .input(z.object({ database: z.string() }))
    .mutation(({ input }) => profilerActions.clearProfilingData(input.database))
})
```

- [ ] **Step 3: Add profiler router to root**

Read `src/main/trpc/router.ts`. Add import and merge:

```typescript
import { profilerRouter } from './routers/profiler'

// In the router({ ... }) object:
  profiler: profilerRouter,
```

- [ ] **Step 4: Add MCP tool**

Read `src/main/mcp/tools.ts`. After the `mongo_value_search` registration, add:

```typescript
  server.registerTool('mongo_query_profiler', {
    description: 'Read slow query profiling data from a MongoDB database. Returns recent profiled operations sorted by duration.',
    inputSchema: {
      database: z.string().describe('Database name'),
      limit: z.number().default(20).describe('Max results'),
      namespace: z.string().optional().describe('Filter by namespace (e.g., "mydb.users")')
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ database, limit, namespace }) => {
    const data = await profilerActions.getProfilingData(database, limit, namespace)
    const summary = data.map((d) =>
      `${d.op} ${d.ns} — ${d.millis}ms | ${d.planSummary} | docs:${d.docsExamined} keys:${d.keysExamined}`
    ).join('\n')
    return {
      content: [{ type: 'text', text: `Profiling data (${data.length} entries):\n${summary}` }]
    }
  })
```

Add `import * as profilerActions from '../actions/profiler'` at the top.

- [ ] **Step 5: Commit**

```bash
git add src/main/actions/profiler.ts src/main/trpc/routers/profiler.ts src/main/trpc/router.ts src/main/mcp/tools.ts
git commit -m "feat: add query profiler backend with tRPC routes and MCP tool"
```

---

## Task 10: Query Profiler Frontend

**Files:**
- Create: `src/renderer/src/components/profiler/QueryProfiler.tsx`
- Modify: `src/renderer/src/components/data/MainPanel.tsx`

- [ ] **Step 1: Create QueryProfiler component**

A full-page profiler tab with controls bar, AG Grid results table, and row expansion.

```typescript
import { useState, useEffect, useRef, useCallback } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { themeAlpine } from 'ag-grid-community'
import { trpc } from '@renderer/lib/trpc'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useTabStore } from '@renderer/store/tabStore'
import { Button } from '@renderer/components/ui/button'
import {
  RefreshCw,
  Trash2,
  Play,
  Pause,
  Search,
  Copy,
  ExternalLink
} from 'lucide-react'
import type { ProfilerEntry } from '@shared/types'

export function QueryProfiler({ database }: { database: string }) {
  const effectiveTheme = useSettingsStore((s) => s.effectiveTheme)
  const { openTab } = useTabStore()

  const [level, setLevel] = useState(0)
  const [slowms, setSlowms] = useState(100)
  const [data, setData] = useState<ProfilerEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState<number | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<ProfilerEntry | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const status = await trpc.profiler.getStatus.query({ database })
      setLevel(status.was)
      setSlowms(status.slowms)
    } catch { /* ignore */ }
  }, [database])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await trpc.profiler.getData.query({ database, limit: 200 })
      setData(result as ProfilerEntry[])
    } catch { /* ignore */ }
    setLoading(false)
  }, [database])

  useEffect(() => {
    fetchStatus()
    fetchData()
  }, [fetchStatus, fetchData])

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchData, autoRefresh * 1000)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, fetchData])

  const applyLevel = async () => {
    await trpc.profiler.setLevel.mutate({ database, level: level as 0 | 1 | 2, slowms })
    fetchStatus()
  }

  const clearData = async () => {
    await trpc.profiler.clear.mutate({ database })
    setData([])
  }

  const gridTheme = effectiveTheme === 'dark'
    ? themeAlpine.withParams({ backgroundColor: '#1a1a2e', foregroundColor: '#e4e4e7', headerBackgroundColor: '#16162a', borderColor: '#27272a' })
    : themeAlpine

  const columnDefs = [
    { field: 'ts', headerName: 'Timestamp', width: 180, valueFormatter: (p: { value: string }) => new Date(p.value).toLocaleTimeString() },
    { field: 'op', headerName: 'Op', width: 80 },
    { field: 'ns', headerName: 'Namespace', width: 200 },
    {
      field: 'millis', headerName: 'Duration (ms)', width: 120, sort: 'desc' as const,
      cellStyle: (p: { value: number }) => ({
        color: p.value > (slowms || 100) ? '#ef4444' : p.value > 50 ? '#f59e0b' : '#22c55e',
        fontWeight: 600
      })
    },
    {
      field: 'planSummary', headerName: 'Plan', width: 150,
      cellStyle: (p: { value: string }) => ({
        color: p.value?.includes('COLLSCAN') ? '#ef4444' : '#22c55e'
      })
    },
    { field: 'docsExamined', headerName: 'Docs Examined', width: 120 },
    { field: 'keysExamined', headerName: 'Keys Examined', width: 120 },
    { field: 'nreturned', headerName: 'Returned', width: 100 }
  ]

  const statusLabel = level === 0 ? 'OFF' : level === 1 ? `SLOW > ${slowms}ms` : 'ALL'

  return (
    <div className="flex h-full flex-col">
      {/* Controls bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <select
          className="h-7 rounded border border-input bg-transparent px-2 text-xs"
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
        >
          <option value={0}>Off (0)</option>
          <option value={1}>Slow Operations (1)</option>
          <option value={2}>All Operations (2)</option>
        </select>
        {level === 1 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Threshold:</span>
            <input
              type="number"
              className="h-7 w-16 rounded border border-input bg-transparent px-1 text-xs"
              value={slowms}
              onChange={(e) => setSlowms(Number(e.target.value))}
            />
            <span className="text-xs text-muted-foreground">ms</span>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={applyLevel}>Apply</Button>

        <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${
          level === 0 ? 'bg-gray-500/20 text-gray-400'
            : level === 1 ? 'bg-amber-500/20 text-amber-400'
            : 'bg-red-500/20 text-red-400'
        }`}>
          Profiling: {statusLabel}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <select
            className="h-7 rounded border border-input bg-transparent px-1 text-xs"
            value={autoRefresh ?? 0}
            onChange={(e) => setAutoRefresh(Number(e.target.value) || null)}
          >
            <option value={0}>Auto-refresh: Off</option>
            <option value={5}>5s</option>
            <option value={10}>10s</option>
            <option value={30}>30s</option>
          </select>
          <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={clearData}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0">
        <AgGridReact
          theme={gridTheme}
          rowData={data}
          columnDefs={columnDefs}
          onRowClicked={(e) => setSelectedEntry(e.data)}
          getRowId={(p) => `${p.data.ts}-${p.data.ns}-${p.data.millis}`}
          enableCellTextSelection
        />
      </div>

      {/* Detail panel */}
      {selectedEntry && (
        <div className="h-1/3 border-t border-border overflow-auto p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">{selectedEntry.op} on {selectedEntry.ns} — {selectedEntry.millis}ms</h3>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => {
                const parts = selectedEntry.ns.split('.')
                const db = parts[0]
                const col = parts.slice(1).join('.')
                if (db && col) openTab(db, col)
              }}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Open Collection
              </Button>
              <Button variant="ghost" size="sm" onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(selectedEntry.command, null, 2))
              }}>
                <Copy className="h-3.5 w-3.5 mr-1" />
                Copy Query
              </Button>
            </div>
          </div>
          <pre className="rounded bg-muted/50 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">
            {JSON.stringify(selectedEntry.rawDoc, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add profiler tab routing to MainPanel**

Read `src/renderer/src/components/data/MainPanel.tsx`. The tab store has a `scope` field on tabs. For profiler tabs, use `scope: 'database'`. Add:

1. Import `QueryProfiler`
2. In the `activeTab.scope !== 'collection'` branch (currently shows "Chat with Claude" placeholder), add a check: if `activeTab.scope === 'database'`, render `<QueryProfiler database={activeTab.database} />`

The profiler tab will be opened from the database context menu in the sidebar (Task 8 already adds database-level context menu items — the profiler opens as a database-scoped tab).

- [ ] **Step 3: Add "Query Profiler" to database context menu**

Read `src/renderer/src/components/explorer/DatabaseTree.tsx`. In the database context menu (around lines 199-382), add a new item:

```typescript
<ContextMenu.Item
  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none hover:bg-accent"
  onSelect={() => {
    // Open a database-scoped tab for the profiler
    useTabStore.getState().openTab(dbName, '__profiler__')
  }}
>
  <Search className="h-3.5 w-3.5" />
  Query Profiler
</ContextMenu.Item>
```

Note: The exact tab opening mechanism depends on how `openTab` works. If it requires a real collection name, we may need a new `openProfilerTab` action in tabStore. Read the tabStore to determine the right approach.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/profiler/QueryProfiler.tsx src/renderer/src/components/data/MainPanel.tsx src/renderer/src/components/explorer/DatabaseTree.tsx
git commit -m "feat: add Query Profiler UI with AG Grid, auto-refresh, and detail panel"
```

---

## Task 11: Code Generation Backend

**Files:**
- Create: `src/main/services/queryCodegen.ts`

- [ ] **Step 1: Create the codegen module**

This is a pure-function template engine — no external dependencies. Each language has `generateFind` and `generateAggregate` helpers.

```typescript
import type { CodegenInput, CodegenLanguage } from '@shared/types'

function jsonStr(obj: unknown, indent = 2): string {
  return JSON.stringify(obj, null, indent)
}

function pyDict(obj: unknown): string {
  // Convert JSON to Python dict-like syntax
  return JSON.stringify(obj, null, 4)
    .replace(/"(\w+)":/g, '"$1":')
    .replace(/: true/g, ': True')
    .replace(/: false/g, ': False')
    .replace(/: null/g, ': None')
}

function csharpBsonDoc(obj: unknown): string {
  return `BsonDocument.Parse(@"${JSON.stringify(obj).replace(/"/g, '""')}")`
}

const generators: Record<CodegenLanguage, (input: CodegenInput) => string> = {
  javascript: (input) => {
    const lines: string[] = []
    if (input.includeBoilerplate) {
      lines.push(`const { MongoClient } = require('mongodb');`)
      lines.push(``)
      lines.push(`const client = new MongoClient('mongodb://localhost:27017');`)
      lines.push(``)
      lines.push(`async function main() {`)
      lines.push(`  await client.connect();`)
      lines.push(`  const db = client.db('${input.database}');`)
      lines.push(`  const collection = db.collection('${input.collection}');`)
      lines.push(``)
    } else {
      lines.push(`// Assumes 'collection' is already defined`)
    }
    const pad = input.includeBoilerplate ? '  ' : ''

    if (input.type === 'find') {
      lines.push(`${pad}const cursor = collection.find(${jsonStr(input.filter ?? {})})`)
      if (input.projection && Object.keys(input.projection).length > 0)
        lines.push(`${pad}  .project(${jsonStr(input.projection)})`)
      if (input.sort && Object.keys(input.sort).length > 0)
        lines.push(`${pad}  .sort(${jsonStr(input.sort)})`)
      if (input.skip) lines.push(`${pad}  .skip(${input.skip})`)
      if (input.limit) lines.push(`${pad}  .limit(${input.limit})`)
      lines.push(`${pad}const results = await cursor.toArray();`)
      lines.push(`${pad}console.log(results);`)
    } else {
      lines.push(`${pad}const pipeline = ${jsonStr(input.pipeline ?? [], 2).split('\n').join('\n' + pad)};`)
      lines.push(`${pad}const results = await collection.aggregate(pipeline).toArray();`)
      lines.push(`${pad}console.log(results);`)
    }

    if (input.includeBoilerplate) {
      lines.push(``)
      lines.push(`  await client.close();`)
      lines.push(`}`)
      lines.push(``)
      lines.push(`main().catch(console.error);`)
    }
    return lines.join('\n')
  },

  python: (input) => {
    const lines: string[] = []
    if (input.includeBoilerplate) {
      lines.push(`from pymongo import MongoClient`)
      lines.push(``)
      lines.push(`client = MongoClient("mongodb://localhost:27017")`)
      lines.push(`db = client["${input.database}"]`)
      lines.push(`collection = db["${input.collection}"]`)
      lines.push(``)
    } else {
      lines.push(`# Assumes 'collection' is already defined`)
    }

    if (input.type === 'find') {
      const args = [`${pyDict(input.filter ?? {})}`]
      if (input.projection && Object.keys(input.projection).length > 0)
        args.push(pyDict(input.projection))
      lines.push(`cursor = collection.find(${args.join(', ')})`)
      if (input.sort && Object.keys(input.sort).length > 0)
        lines.push(`cursor = cursor.sort(${pyDict(Object.entries(input.sort).map(([k, v]) => [k, v]))})`)
      if (input.skip) lines.push(`cursor = cursor.skip(${input.skip})`)
      if (input.limit) lines.push(`cursor = cursor.limit(${input.limit})`)
      lines.push(`results = list(cursor)`)
      lines.push(`print(results)`)
    } else {
      lines.push(`pipeline = ${pyDict(input.pipeline ?? [])}`)
      lines.push(`results = list(collection.aggregate(pipeline))`)
      lines.push(`print(results)`)
    }
    return lines.join('\n')
  },

  java: (input) => {
    const lines: string[] = []
    if (input.includeBoilerplate) {
      lines.push(`import com.mongodb.client.*;`)
      lines.push(`import org.bson.Document;`)
      lines.push(`import java.util.Arrays;`)
      lines.push(``)
      lines.push(`public class Query {`)
      lines.push(`    public static void main(String[] args) {`)
      lines.push(`        MongoClient client = MongoClients.create("mongodb://localhost:27017");`)
      lines.push(`        MongoDatabase db = client.getDatabase("${input.database}");`)
      lines.push(`        MongoCollection<Document> collection = db.getCollection("${input.collection}");`)
      lines.push(``)
    }
    const pad = input.includeBoilerplate ? '        ' : ''

    if (input.type === 'find') {
      lines.push(`${pad}FindIterable<Document> cursor = collection.find(Document.parse("${JSON.stringify(input.filter ?? {}).replace(/"/g, '\\"')}"))`)
      if (input.sort && Object.keys(input.sort).length > 0)
        lines.push(`${pad}    .sort(Document.parse("${JSON.stringify(input.sort).replace(/"/g, '\\"')}"))`)
      if (input.skip) lines.push(`${pad}    .skip(${input.skip})`)
      if (input.limit) lines.push(`${pad}    .limit(${input.limit})`)
      lines.push(`${pad};`)
      lines.push(`${pad}for (Document doc : cursor) {`)
      lines.push(`${pad}    System.out.println(doc.toJson());`)
      lines.push(`${pad}}`)
    } else {
      const stages = (input.pipeline ?? []).map((s) => `Document.parse("${JSON.stringify(s).replace(/"/g, '\\"')}")`)
      lines.push(`${pad}AggregateIterable<Document> result = collection.aggregate(Arrays.asList(`)
      lines.push(stages.map((s) => `${pad}    ${s}`).join(',\n'))
      lines.push(`${pad}));`)
      lines.push(`${pad}for (Document doc : result) {`)
      lines.push(`${pad}    System.out.println(doc.toJson());`)
      lines.push(`${pad}}`)
    }

    if (input.includeBoilerplate) {
      lines.push(``)
      lines.push(`        client.close();`)
      lines.push(`    }`)
      lines.push(`}`)
    }
    return lines.join('\n')
  },

  csharp: (input) => {
    const lines: string[] = []
    if (input.includeBoilerplate) {
      lines.push(`using MongoDB.Bson;`)
      lines.push(`using MongoDB.Driver;`)
      lines.push(``)
      lines.push(`var client = new MongoClient("mongodb://localhost:27017");`)
      lines.push(`var db = client.GetDatabase("${input.database}");`)
      lines.push(`var collection = db.GetCollection<BsonDocument>("${input.collection}");`)
      lines.push(``)
    }

    if (input.type === 'find') {
      lines.push(`var filter = ${csharpBsonDoc(input.filter ?? {})};`)
      lines.push(`var results = await collection.Find(filter)`)
      if (input.sort && Object.keys(input.sort).length > 0)
        lines.push(`    .Sort(${csharpBsonDoc(input.sort)})`)
      if (input.skip) lines.push(`    .Skip(${input.skip})`)
      if (input.limit) lines.push(`    .Limit(${input.limit})`)
      lines.push(`    .ToListAsync();`)
      lines.push(`foreach (var doc in results) Console.WriteLine(doc);`)
    } else {
      const stages = (input.pipeline ?? []).map((s) => `    ${csharpBsonDoc(s)}`)
      lines.push(`var pipeline = new[] {`)
      lines.push(stages.join(',\n'))
      lines.push(`};`)
      lines.push(`var results = await collection.Aggregate<BsonDocument>(pipeline).ToListAsync();`)
      lines.push(`foreach (var doc in results) Console.WriteLine(doc);`)
    }
    return lines.join('\n')
  },

  php: (input) => {
    const lines: string[] = []
    if (input.includeBoilerplate) {
      lines.push(`<?php`)
      lines.push(`require 'vendor/autoload.php';`)
      lines.push(``)
      lines.push(`$client = new MongoDB\\Client('mongodb://localhost:27017');`)
      lines.push(`$collection = $client->${input.database}->${input.collection};`)
      lines.push(``)
    }

    if (input.type === 'find') {
      const opts: string[] = []
      if (input.projection && Object.keys(input.projection).length > 0)
        opts.push(`'projection' => ${jsonStr(input.projection)}`)
      if (input.sort && Object.keys(input.sort).length > 0)
        opts.push(`'sort' => ${jsonStr(input.sort)}`)
      if (input.skip) opts.push(`'skip' => ${input.skip}`)
      if (input.limit) opts.push(`'limit' => ${input.limit}`)
      lines.push(`$cursor = $collection->find(`)
      lines.push(`    json_decode('${JSON.stringify(input.filter ?? {})}', true)` + (opts.length ? ',' : ''))
      if (opts.length) lines.push(`    [${opts.join(', ')}]`)
      lines.push(`);`)
      lines.push(`foreach ($cursor as $doc) { print_r($doc); }`)
    } else {
      lines.push(`$pipeline = json_decode('${JSON.stringify(input.pipeline ?? [])}', true);`)
      lines.push(`$cursor = $collection->aggregate($pipeline);`)
      lines.push(`foreach ($cursor as $doc) { print_r($doc); }`)
    }
    return lines.join('\n')
  },

  ruby: (input) => {
    const lines: string[] = []
    if (input.includeBoilerplate) {
      lines.push(`require 'mongo'`)
      lines.push(``)
      lines.push(`client = Mongo::Client.new('mongodb://localhost:27017/${input.database}')`)
      lines.push(`collection = client[:${input.collection}]`)
      lines.push(``)
    }

    if (input.type === 'find') {
      const chain: string[] = [`collection.find(${jsonStr(input.filter ?? {})})`]
      if (input.projection && Object.keys(input.projection).length > 0)
        chain.push(`.projection(${jsonStr(input.projection)})`)
      if (input.sort && Object.keys(input.sort).length > 0)
        chain.push(`.sort(${jsonStr(input.sort)})`)
      if (input.skip) chain.push(`.skip(${input.skip})`)
      if (input.limit) chain.push(`.limit(${input.limit})`)
      lines.push(`results = ${chain.join('')}`)
      lines.push(`results.each { |doc| puts doc }`)
    } else {
      lines.push(`pipeline = ${jsonStr(input.pipeline ?? [])}`)
      lines.push(`results = collection.aggregate(pipeline)`)
      lines.push(`results.each { |doc| puts doc }`)
    }
    return lines.join('\n')
  }
}

export function generateCode(input: CodegenInput, language: CodegenLanguage): string {
  return generators[language](input)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/queryCodegen.ts
git commit -m "feat: add query code generation for 6 languages"
```

---

## Task 12: Code Generation tRPC Route

**Files:**
- Modify: `src/main/trpc/routers/query.ts`

- [ ] **Step 1: Add codegen route**

Read the file first. Add import at top:

```typescript
import { generateCode } from '../../services/queryCodegen'
```

Add route before `getHistory`:

```typescript
  generateCode: procedure
    .input(z.object({
      type: z.enum(['find', 'aggregate']),
      database: z.string(),
      collection: z.string(),
      filter: z.record(z.unknown()).optional(),
      projection: z.record(z.unknown()).optional(),
      sort: z.record(z.unknown()).optional(),
      skip: z.number().optional(),
      limit: z.number().optional(),
      pipeline: z.array(z.record(z.unknown())).optional(),
      includeBoilerplate: z.boolean(),
      language: z.enum(['javascript', 'python', 'java', 'csharp', 'php', 'ruby'])
    }))
    .query(({ input }) => {
      const { language, ...codegenInput } = input
      return { code: generateCode(codegenInput, language) }
    }),
```

- [ ] **Step 2: Commit**

```bash
git add src/main/trpc/routers/query.ts
git commit -m "feat: add generateCode tRPC route"
```

---

## Task 13: Code Generation Modal Frontend

**Files:**
- Create: `src/renderer/src/components/codegen/CodeGenModal.tsx`
- Modify: `src/renderer/src/components/query/QueryBuilder.tsx`
- Modify: `src/renderer/src/components/aggregation/AggregationEditor.tsx`

- [ ] **Step 1: Create CodeGenModal**

```typescript
import { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useTabStore } from '@renderer/store/tabStore'
import { trpc } from '@renderer/lib/trpc'
import { Button } from '@renderer/components/ui/button'
import { Copy, Download, X } from 'lucide-react'
import type { CodegenLanguage } from '@shared/types'

interface CodeGenModalProps {
  open: boolean
  onClose: () => void
  type: 'find' | 'aggregate'
  filter?: Record<string, unknown>
  projection?: Record<string, unknown>
  sort?: Record<string, unknown>
  skip?: number
  limit?: number
  pipeline?: Record<string, unknown>[]
}

const LANGUAGES: { key: CodegenLanguage; label: string; monaco: string; ext: string }[] = [
  { key: 'javascript', label: 'JavaScript', monaco: 'javascript', ext: 'js' },
  { key: 'python', label: 'Python', monaco: 'python', ext: 'py' },
  { key: 'java', label: 'Java', monaco: 'java', ext: 'java' },
  { key: 'csharp', label: 'C#', monaco: 'csharp', ext: 'cs' },
  { key: 'php', label: 'PHP', monaco: 'php', ext: 'php' },
  { key: 'ruby', label: 'Ruby', monaco: 'ruby', ext: 'rb' }
]

export function CodeGenModal({ open, onClose, type, filter, projection, sort, skip, limit, pipeline }: CodeGenModalProps) {
  const effectiveTheme = useSettingsStore((s) => s.effectiveTheme)
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [language, setLanguage] = useState<CodegenLanguage>('javascript')
  const [includeBoilerplate, setIncludeBoilerplate] = useState(true)
  const [code, setCode] = useState('')

  useEffect(() => {
    if (!open || !tab) return
    trpc.query.generateCode.query({
      type,
      database: tab.database,
      collection: tab.collection,
      filter,
      projection,
      sort,
      skip,
      limit,
      pipeline,
      includeBoilerplate,
      language
    }).then((result) => setCode(result.code))
      .catch(() => setCode('// Error generating code'))
  }, [open, language, includeBoilerplate, tab, type, filter, projection, sort, skip, limit, pipeline])

  if (!open) return null

  const langConfig = LANGUAGES.find((l) => l.key === language)!

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `query.${langConfig.ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="flex h-[70vh] w-[700px] flex-col rounded-lg border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Generated Code</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Language tabs */}
        <div className="flex items-center gap-0 border-b border-border px-2">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.key}
              className={`relative px-3 py-2 text-xs font-medium transition-colors ${
                language === lang.key ? 'text-emerald-400' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setLanguage(lang.key)}
            >
              {lang.label}
              {language === lang.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400" />}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2 pr-2">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={includeBoilerplate}
                onChange={(e) => setIncludeBoilerplate(e.target.checked)}
                className="rounded"
              />
              Include connection boilerplate
            </label>
          </div>
        </div>

        {/* Code editor */}
        <div className="flex-1 min-h-0">
          <Editor
            value={code}
            language={langConfig.monaco}
            theme={effectiveTheme === 'dark' ? 'vs-dark' : 'light'}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true
            }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(code)}>
            <Copy className="h-3.5 w-3.5 mr-1" />
            Copy to Clipboard
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5 mr-1" />
            Download as {langConfig.ext}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add Code button to QueryBuilder**

Read `src/renderer/src/components/query/QueryBuilder.tsx`. Find the `QueryFooter` component or the area near the Run button (around line 611). Add a `</>  Code` button that opens the CodeGenModal, passing the current filter, projection, sort, skip, limit. Add state for `codegenOpen`.

- [ ] **Step 3: Add Generate Code button to AggregationEditor**

Read `src/renderer/src/components/aggregation/AggregationEditor.tsx`. Add a "Code" button to the bottom toolbar (next to "Copy JSON"). When clicked, open `CodeGenModal` with `type='aggregate'` and the current pipeline.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/codegen/CodeGenModal.tsx src/renderer/src/components/query/QueryBuilder.tsx src/renderer/src/components/aggregation/AggregationEditor.tsx
git commit -m "feat: add Code Generation modal with 6 languages, accessible from query builder and aggregation editor"
```

---

## Task 14: Build Verification

- [ ] **Step 1: Build the app**

```bash
npx electron-vite build
```

Expected: Clean build with no errors.

- [ ] **Step 2: Verify no TypeScript errors**

Check all new files compile correctly.

- [ ] **Step 3: Commit any fixes**

If build reveals issues, fix and commit.

---

## Execution Order

```
Task 1  →  Task 2  →  Task 3  →  Task 4  →  Task 5  (SSH/TLS/folders backend)
                                                ↓
Task 6  →  Task 7  (SSH/TLS frontend forms → dialog integration)
                ↓
Task 8  (Connection folders in sidebar)
                ↓
Task 9  →  Task 10  (Profiler backend → frontend)
                ↓
Task 11  →  Task 12  →  Task 13  (Codegen backend → route → modal)
                                       ↓
                                   Task 14  (Build verification)
```

**Parallel execution opportunities:** Tasks 3+6 (SSH service + SSH form) are independent. Tasks 9+11 (profiler backend + codegen backend) are independent. Tasks 8 (folders) is independent of Tasks 9-13 (profiler + codegen).

---

## Spec Coverage Notes

Items from the design spec addressed with simplified scope or deferred during implementation:

1. **SSH "Test SSH" button**: The spec calls for a button that validates the SSH connection independently. During Task 6/7 implementation, add a "Test SSH" button in SSHForm that calls `sshTunnel.createTunnel()` with a test connection ID, then immediately destroys it. Surface success/failure to the user. Requires a new tRPC route `connection.testSSH`.

2. **TLS "Verify Certificates" button**: The spec calls for a button that validates cert files are readable and valid. During Task 6/7 implementation, add a "Verify" button in TLSForm that calls a new tRPC route checking `fs.readFileSync()` on each cert path. Report readable/invalid to the user.

3. **TLS — Client Private Key as separate field**: The spec lists Client Certificate and Client Private Key as separate file pickers. The TLSConfig type uses `certificateKeyFile` (MongoDB driver convention: combined cert+key file). If separate files are needed, add `clientKeyFile?: string` to TLSConfig.

4. **Profiler — "Explain This Query" button**: The profiler detail panel should include an "Explain" button that reconstructs the query from the profile entry's `command` field and calls `parsedExplain`. Wire this to open the Explain sub-tab on the relevant collection.

5. **Connection Folders — drag-and-drop**: The plan uses a "Move to Folder" context menu submenu instead of full drag-and-drop between folders. This is simpler to implement and avoids complex DnD between the sidebar and folder groups. Can be upgraded to DnD later.
