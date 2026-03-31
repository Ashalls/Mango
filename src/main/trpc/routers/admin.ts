import { router, procedure, z } from '../context'
import * as adminActions from '../../actions/admin'
import * as connectionActions from '../../actions/connection'

export const adminRouter = router({
  dropDatabase: procedure
    .input(z.object({ database: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      await adminActions.dropDatabase(input.database)
      return { dropped: true }
    }),

  dropCollection: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      await adminActions.dropCollection(input.database, input.collection)
      return { dropped: true }
    }),

  truncateCollection: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      const result = await adminActions.truncateCollection(input.database, input.collection)
      return { truncated: true, deletedCount: result.deletedCount }
    }),

  createCollection: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      await adminActions.createCollection(input.database, input.collection)
      return { created: true }
    }),

  renameCollection: procedure
    .input(z.object({ database: z.string(), oldName: z.string(), newName: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly()
      if (blocked) throw new Error(blocked)
      await adminActions.renameCollection(input.database, input.oldName, input.newName)
      return { renamed: true }
    }),

  listIndexes: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .query(async ({ input }) => {
      return adminActions.listIndexes(input.database, input.collection)
    }),

  createIndex: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        fields: z.record(z.union([z.number(), z.string()])),
        options: z.object({
          unique: z.boolean().optional(),
          sparse: z.boolean().optional(),
          expireAfterSeconds: z.number().optional(),
          partialFilterExpression: z.record(z.unknown()).optional(),
          name: z.string().optional()
        }).optional().default({})
      })
    )
    .mutation(async ({ input }) => {
      const name = await adminActions.createIndex(
        input.database, input.collection, input.fields, input.options
      )
      return { created: true, indexName: name }
    }),

  dropIndex: procedure
    .input(z.object({ database: z.string(), collection: z.string(), indexName: z.string() }))
    .mutation(async ({ input }) => {
      await adminActions.dropIndex(input.database, input.collection, input.indexName)
      return { dropped: true }
    }),

  indexStats: procedure
    .input(z.object({ database: z.string(), collection: z.string() }))
    .query(async ({ input }) => {
      return adminActions.getIndexStats(input.database, input.collection)
    }),
})
