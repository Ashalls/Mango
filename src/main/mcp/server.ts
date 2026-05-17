import express from 'express'
import { randomBytes } from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { DEFAULT_MCP_PORT } from '@shared/constants'
import { registerTools } from './tools'
import type { Server } from 'http'

let httpServer: Server | null = null
let sessionToken: string | null = null

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mango',
    version: '0.1.0'
  })
  registerTools(server)
  return server
}

export function getMcpToken(): string {
  if (!sessionToken) throw new Error('MCP server not started')
  return sessionToken
}

/**
 * Reject browsers and DNS-rebound requests by requiring an Origin/Host header
 * that resolves to a loopback address. Browser fetch always sends Origin;
 * legitimate Claude Agent SDK requests do not, so missing Origin is allowed.
 */
function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false
  const hostname = host.split(':')[0]
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
}

function extractToken(req: express.Request): string | null {
  const auth = req.header('authorization')
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  const q = req.query.token
  if (typeof q === 'string') return q
  return null
}

export async function startMcpServer(port: number = DEFAULT_MCP_PORT): Promise<number> {
  sessionToken = randomBytes(32).toString('hex')

  const app = express()
  app.use(express.json({ limit: '10mb' }))

  // Origin/Host validation — block DNS rebinding + cross-origin browser fetch
  app.use((req, res, next) => {
    const host = req.header('host')
    const origin = req.header('origin')
    if (!isLoopbackHost(host)) {
      res.status(403).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Host header must be loopback' }, id: null })
      return
    }
    if (origin) {
      // Browsers always set Origin; require it to be loopback if present
      try {
        const originHost = new URL(origin).hostname
        if (!isLoopbackHost(originHost)) {
          res.status(403).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Cross-origin requests not allowed' }, id: null })
          return
        }
      } catch {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32602, message: 'Invalid Origin header' }, id: null })
        return
      }
    }
    next()
  })

  // Bearer-token gate
  app.use((req, res, next) => {
    const token = extractToken(req)
    if (!sessionToken || token !== sessionToken) {
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32002, message: 'Unauthorized' }, id: null })
      return
    }
    next()
  })

  app.post('/mcp', async (req, res) => {
    const server = createMcpServer()
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined // stateless
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
      res.on('close', () => {
        transport.close()
        server.close()
      })
    } catch (error) {
      console.error('MCP request error:', error)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        })
      }
    }
  })

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST.' },
      id: null
    })
  })

  return new Promise((resolve, reject) => {
    httpServer = app.listen(port, '127.0.0.1', () => {
      console.log(`MCP server listening on http://127.0.0.1:${port}/mcp (token-gated)`)
      resolve(port)
    })
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        httpServer = app.listen(0, '127.0.0.1', () => {
          const addr = httpServer!.address()
          const actualPort = typeof addr === 'object' && addr ? addr.port : port
          console.log(`MCP server listening on http://127.0.0.1:${actualPort}/mcp (token-gated)`)
          resolve(actualPort)
        })
      } else {
        reject(err)
      }
    })
  })
}

export async function stopMcpServer(): Promise<void> {
  sessionToken = null
  if (httpServer) {
    return new Promise((resolve) => {
      httpServer!.close(() => {
        httpServer = null
        resolve()
      })
    })
  }
}
