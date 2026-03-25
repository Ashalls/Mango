import { router, procedure, z } from '../context'
import * as mongoshActions from '../../actions/mongosh'

export const mongoshRouter = router({
  open: procedure
    .input(
      z.object({
        connectionId: z.string(),
        database: z.string(),
        collection: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      await mongoshActions.openMongosh(input.connectionId, input.database, input.collection)
      return { opened: true }
    })
})
