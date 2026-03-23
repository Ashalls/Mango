import { router, procedure, z } from '../context'
import * as mutationActions from '../../actions/mutation'

export const mutationRouter = router({
  insertOne: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        document: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      return mutationActions.insertOne(input.database, input.collection, input.document)
    }),

  updateOne: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()),
        update: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      return mutationActions.updateOne(input.database, input.collection, input.filter, input.update)
    }),

  deleteOne: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      return mutationActions.deleteOne(input.database, input.collection, input.filter)
    }),

  deleteMany: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      return mutationActions.deleteMany(input.database, input.collection, input.filter)
    })
})
