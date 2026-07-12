import { router, procedure, z } from '../context'
import * as adminActions from '../../actions/admin'
import * as connectionActions from '../../actions/connection'

export const adminRouter = router({
  dropDatabase: procedure
    .input(z.object({ connectionId: z.string().optional(), database: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      await adminActions.dropDatabase(input.database, input.connectionId)
      return { dropped: true }
    }),

  dropCollection: procedure
    .input(z.object({ connectionId: z.string().optional(), database: z.string(), collection: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      await adminActions.dropCollection(input.database, input.collection, input.connectionId)
      return { dropped: true }
    }),

  truncateCollection: procedure
    .input(z.object({ connectionId: z.string().optional(), database: z.string(), collection: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      const result = await adminActions.truncateCollection(input.database, input.collection, input.connectionId)
      return { truncated: true, deletedCount: result.deletedCount }
    }),

  createCollection: procedure
    .input(z.object({ connectionId: z.string().optional(), database: z.string(), collection: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      await adminActions.createCollection(input.database, input.collection, input.connectionId)
      return { created: true }
    }),

  renameCollection: procedure
    .input(z.object({ connectionId: z.string().optional(), database: z.string(), oldName: z.string(), newName: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      await adminActions.renameCollection(input.database, input.oldName, input.newName, input.connectionId)
      return { renamed: true }
    }),

  listIndexes: procedure
    .input(z.object({ connectionId: z.string().optional(), database: z.string(), collection: z.string() }))
    .query(async ({ input }) => {
      return adminActions.listIndexes(input.database, input.collection, input.connectionId)
    }),

  createIndex: procedure
    .input(
      z.object({
        connectionId: z.string().optional(),
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
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      const name = await adminActions.createIndex(
        input.database, input.collection, input.fields, input.options, input.connectionId
      )
      return { created: true, indexName: name }
    }),

  dropIndex: procedure
    .input(z.object({ connectionId: z.string().optional(), database: z.string(), collection: z.string(), indexName: z.string() }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      await adminActions.dropIndex(input.database, input.collection, input.indexName, input.connectionId)
      return { dropped: true }
    }),

  indexStats: procedure
    .input(z.object({ connectionId: z.string().optional(), database: z.string(), collection: z.string() }))
    .query(async ({ input }) => {
      return adminActions.getIndexStats(input.database, input.collection, input.connectionId)
    }),

  getValidator: procedure
    .input(z.object({ connectionId: z.string().optional(), database: z.string(), collection: z.string() }))
    .query(async ({ input }) => {
      return adminActions.getValidator(input.database, input.collection, input.connectionId)
    }),

  setValidator: procedure
    .input(z.object({
      connectionId: z.string().optional(),
      database: z.string(),
      collection: z.string(),
      validator: z.record(z.unknown()).nullable(),
      validationLevel: z.enum(['off', 'strict', 'moderate']).default('strict'),
      validationAction: z.enum(['error', 'warn']).default('error')
    }))
    .mutation(async ({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      await adminActions.setValidator(
        input.database, input.collection, input.validator,
        input.validationLevel, input.validationAction, input.connectionId
      )
      return { applied: true }
    }),

  validateSample: procedure
    .input(z.object({
      connectionId: z.string().optional(),
      database: z.string(),
      collection: z.string(),
      validator: z.record(z.unknown()),
      sampleSize: z.number().int().positive().max(2000).default(200)
    }))
    .mutation(async ({ input }) => {
      return adminActions.validateSample(
        input.database, input.collection, input.validator, input.sampleSize, input.connectionId
      )
    }),
})
