import { router, procedure, z } from '../context'
import * as explorerActions from '../../actions/explorer'

export const explorerRouter = router({
  listDatabases: procedure.query(async () => {
    return explorerActions.listDatabases()
  }),

  listCollections: procedure
    .input(z.object({ database: z.string() }))
    .query(async ({ input }) => {
      return explorerActions.listCollections(input.database)
    }),

  collectionSchema: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        sampleSize: z.number().default(100)
      })
    )
    .query(async ({ input }) => {
      return explorerActions.collectionSchema(input.database, input.collection, input.sampleSize)
    }),

  collectionStats: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .query(async ({ input }) => {
      return explorerActions.collectionStats(input.database, input.collection)
    })
})
