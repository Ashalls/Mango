import { router, procedure, z } from '../context'
import * as connectionActions from '../../actions/connection'

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
        claudeAccess: z.enum(['readonly', 'readwrite']).optional()
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

  status: procedure.query(async () => {
    return connectionActions.getStatus()
  })
})
