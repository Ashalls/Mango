import { router, procedure, z } from '../context'
import * as queryActions from '../../actions/query'
import * as queryHistory from '../../services/queryHistory'
import { parseExplainResult } from '../../services/explainParser'
import { generateCode } from '../../services/queryCodegen'

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

  aggregateWithStagePreview: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        pipeline: z.array(z.record(z.unknown())),
        stageIndex: z.number(),
        sampleSize: z.number().optional().default(20)
      })
    )
    .query(async ({ input }) => {
      return queryActions.aggregateWithStagePreview(
        input.database,
        input.collection,
        input.pipeline,
        input.stageIndex,
        input.sampleSize
      )
    }),

  explain: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()).optional().default({}),
        pipeline: z.array(z.record(z.unknown())).optional()
      })
    )
    .query(async ({ input }) => {
      return queryActions.explain(input.database, input.collection, input.filter, input.pipeline)
    }),

  parsedExplain: procedure
    .input(
      z.object({
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()).optional().default({}),
        pipeline: z.array(z.record(z.unknown())).optional()
      })
    )
    .query(async ({ input }) => {
      const raw = await queryActions.explain(input.database, input.collection, input.filter, input.pipeline)
      return parseExplainResult(raw)
    }),

  valueSearch: procedure
    .input(
      z.object({
        searchTerm: z.string(),
        scope: z.object({
          type: z.enum(['server', 'database', 'collection']),
          database: z.string().optional(),
          collection: z.string().optional()
        }),
        regex: z.boolean().optional().default(false),
        caseInsensitive: z.boolean().optional().default(true),
        maxResults: z.number().optional().default(200)
      })
    )
    .query(async ({ input }) => {
      return queryActions.valueSearch(
        input.searchTerm,
        input.scope,
        { regex: input.regex, caseInsensitive: input.caseInsensitive, maxResults: input.maxResults }
      )
    }),

  generateCode: procedure
    .input(z.object({
      type: z.enum(['find', 'aggregate']),
      database: z.string(),
      collection: z.string(),
      filter: z.record(z.unknown()).optional(),
      projection: z.record(z.unknown()).optional(),
      sort: z.record(z.unknown()).optional(),
      skip: z.number().optional(),
      limit: z.number().optional(),
      pipeline: z.array(z.record(z.unknown())).optional(),
      includeBoilerplate: z.boolean(),
      language: z.enum(['javascript', 'python', 'java', 'csharp', 'php', 'ruby'])
    }))
    .query(({ input }) => {
      const { language, ...codegenInput } = input
      return { code: generateCode(codegenInput, language) }
    }),

  getHistory: procedure
    .query(async () => {
      return queryHistory.loadHistory()
    }),

  saveHistory: procedure
    .input(
      z.object({
        connectionId: z.string(),
        database: z.string(),
        collection: z.string(),
        filter: z.record(z.unknown()),
        sort: z.record(z.number()).nullable(),
        projection: z.record(z.number()).nullable(),
        limit: z.number(),
        resultCount: z.number()
      })
    )
    .mutation(async ({ input }) => {
      return queryHistory.saveEntry(input)
    }),

  deleteHistory: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      queryHistory.deleteEntry(input.id)
      return { deleted: true }
    }),

  togglePinHistory: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      queryHistory.togglePin(input.id)
      return { toggled: true }
    }),

  clearHistory: procedure
    .mutation(async () => {
      queryHistory.clearHistory()
      return { cleared: true }
    }),
})
