import { router, procedure, z } from '../context'
import * as mutationActions from '../../actions/mutation'
import * as changelog from '../../services/changelog'
import * as connectionActions from '../../actions/connection'

export const mutationRouter = router({
  insertOne: procedure
    .input(
      z.object({
        connectionId: z.string().optional(),
        database: z.string(),
        collection: z.string(),
        document: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      return mutationActions.insertOne(input.database, input.collection, input.document, input.connectionId)
    }),

  updateOne: procedure
    .input(
      z.object({
        connectionId: z.string().optional(),
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()),
        update: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      return mutationActions.updateOne(input.database, input.collection, input.filter, input.update, input.connectionId)
    }),

  deleteOne: procedure
    .input(
      z.object({
        connectionId: z.string().optional(),
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      return mutationActions.deleteOne(input.database, input.collection, input.filter, input.connectionId)
    }),

  deleteMany: procedure
    .input(
      z.object({
        connectionId: z.string().optional(),
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      return mutationActions.deleteMany(input.database, input.collection, input.filter, input.connectionId)
    }),

  insertMany: procedure
    .input(
      z.object({
        connectionId: z.string().optional(),
        database: z.string(),
        collection: z.string(),
        documents: z.array(z.record(z.unknown()))
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      const result = await mutationActions.insertMany(input.database, input.collection, input.documents, input.connectionId)
      changelog.appendChangeLog({
        source: 'user', connectionId: input.connectionId ?? '', connectionName: '',
        database: input.database, collection: input.collection,
        operation: 'insert', count: result.insertedCount
      })
      return result
    }),

  updateMany: procedure
    .input(
      z.object({
        connectionId: z.string().optional(),
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()),
        update: z.record(z.unknown())
      })
    )
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      const result = await mutationActions.updateMany(
        input.database, input.collection, input.filter, input.update, input.connectionId
      )
      changelog.appendChangeLog({
        source: 'user', connectionId: input.connectionId ?? '', connectionName: '',
        database: input.database, collection: input.collection,
        operation: 'update', filter: input.filter, changes: input.update,
        count: result.modifiedCount
      })
      return result
    }),
})
