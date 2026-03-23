import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { DEFAULT_MCP_PORT } from '@shared/constants'
import { registerTools } from './tools'
import type { Server } from 'http'

let httpServer: Server | null = null

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mongolens',
    version: '0.1.0'
  })
  registerTools(server)
  return server
}

export async function startMcpServer(port: number = DEFAULT_MCP_PORT): Promise<number> {
  const app = express()
  app.use(express.json())

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

  // Reject GET requests per Streamable HTTP spec
  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST.' },
      id: null
    })
  })

  return new Promise((resolve, reject) => {
    httpServer = app.listen(port, '127.0.0.1', () => {
      console.log(`MCP server listening on http://127.0.0.1:${port}/mcp`)
      resolve(port)
    })
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Try next port
        httpServer = app.listen(0, '127.0.0.1', () => {
          const addr = httpServer!.address()
          const actualPort = typeof addr === 'object' && addr ? addr.port : port
          console.log(`MCP server listening on http://127.0.0.1:${actualPort}/mcp`)
          resolve(actualPort)
        })
      } else {
        reject(err)
      }
    })
  })
}

export async function stopMcpServer(): Promise<void> {
  if (httpServer) {
    return new Promise((resolve) => {
      httpServer!.close(() => {
        httpServer = null
        resolve()
      })
    })
  }
}
