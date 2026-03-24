import { router, procedure, z } from '../context'
import * as mutationActions from '../../actions/mutation'
import * as changelog from '../../services/changelog'

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
    }),

  insertMany: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        documents: z.array(z.record(z.unknown()))
      })
    )
    .mutation(async ({ input }) => {
      const result = await mutationActions.insertMany(input.database, input.collection, input.documents)
      changelog.appendChangeLog({
        source: 'user', connectionId: '', connectionName: '',
        database: input.database, collection: input.collection,
        operation: 'insert', count: result.insertedCount
      })
      return result
    }),

  updateMany: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()),
        update: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      const result = await mutationActions.updateMany(
        input.database, input.collection, input.filter, input.update
      )
      changelog.appendChangeLog({
        source: 'user', connectionId: '', connectionName: '',
        database: input.database, collection: input.collection,
        operation: 'update', filter: input.filter, changes: input.update,
        count: result.modifiedCount
      })
      return result
    }),
})
