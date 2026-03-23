import { router, procedure, z } from '../context'
import * as queryActions from '../../actions/query'

export const queryRouter = router({
  find: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()).optional().default({}),
        projection: z.record(z.number()).optional(),
        sort: z.record(z.number()).optional(),
        skip: z.number().optional().default(0),
        limit: z.number().optional().default(50)
      })
    )
    .query(async ({ input }) => {
      return queryActions.find(input)
    }),

  count: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()).optional().default({})
      })
    )
    .query(async ({ input }) => {
      return queryActions.count(input.database, input.collection, input.filter)
    }),

  aggregate: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        pipeline: z.array(z.record(z.unknown()))
      })
    )
    .query(async ({ input }) => {
      return queryActions.aggregate(input.database, input.collection, input.pipeline)
    }),

  distinct: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        field: z.string(),
        filter: z.record(z.unknown()).optional().default({})
      })
    )
    .query(async ({ input }) => {
      return queryActions.distinct(input.database, input.collection, input.field, input.filter)
    }),

  explain: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()).optional().default({})
      })
    )
    .query(async ({ input }) => {
      return queryActions.explain(input.database, input.collection, input.filter)
    })
})
