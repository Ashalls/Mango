import { router, procedure, z } from '../context'
import * as adminActions from '../../actions/admin'

export const adminRouter = router({
  dropDatabase: procedure
    .input(z.object({ database: z.string() }))
    .mutation(async ({ input }) => {
      await adminActions.dropDatabase(input.database)
      return { dropped: true }
    }),

  dropCollection: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .mutation(async ({ input }) => {
      await adminActions.dropCollection(input.database, input.collection)
      return { dropped: true }
    }),

  createCollection: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .mutation(async ({ input }) => {
      await adminActions.createCollection(input.database, input.collection)
      return { created: true }
    }),

  listIndexes: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .query(async ({ input }) => {
      return adminActions.listIndexes(input.database, input.collection)
    })
})
