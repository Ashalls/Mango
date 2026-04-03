import { randomUUID } from 'crypto'
import { router, procedure, z } from '../context'
import * as connectionActions from '../../actions/connection'
import * as configService from '../../services/config'
import type { ConnectionFolder } from '@shared/types'

export const connectionRouter = router({
  list: procedure.query(async () => {
    return connectionActions.listConnections()
  }),

  save: procedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        uri: z.string().min(1),
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

  delete: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return connectionActions.deleteConnection(input.id)
    }),

  connect: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return connectionActions.connect(input.id)
    }),

  disconnect: procedure
    .input(z.object({ id: z.string().optional() }))
    .mutation(async ({ input }) => {
      return connectionActions.disconnect(input.id)
    }),

  setActive: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      connectionActions.setActive(input.id)
      return { active: true }
    }),

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
          id: randomUUID(),
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
      const connections = configService.loadConnections()
      for (const conn of connections) {
        if (conn.folderId === input.id) conn.folderId = undefined
      }
      configService.saveConnections(connections)
      return folders
    }),

  status: procedure.query(async () => {
    return connectionActions.getStatus()
  })
})
