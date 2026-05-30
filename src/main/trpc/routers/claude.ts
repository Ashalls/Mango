import { router, procedure, z } from '../context'
import * as claudeService from '../../services/claude'
import * as claudeHealth from '../../services/claudeHealth'
import * as configService from '../../services/config'

const ContextSchema = z.object({
  connectionName: z.string().optional(),
  connectionUri: z.string().optional(),
  database: z.string().optional(),
  collection: z.string().optional(),
  currentFilter: z.record(z.unknown()).optional(),
  resultCount: z.number().optional(),
  page: z.number().optional(),
  totalPages: z.number().optional(),
  openDocumentId: z.string().optional()
})

export const claudeRouter = router({
  sendMessage: procedure
    .input(
      z.object({
        message: z.string(),
        context: ContextSchema,
        mcpPort: z.number().optional(),
        model: z.string().optional(),
        resumeSessionId: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      if (claudeHealth.getAvailability().status !== 'ready') {
        return { started: false, reason: 'claude-unavailable' }
      }
      claudeService.sendMessage(input.message, input.context, input.mcpPort, {
        model: input.model,
        resumeSessionId: input.resumeSessionId,
        emitSessionId: true
      })
      return { started: true }
    }),

  abort: procedure.mutation(async () => {
    claudeService.abortCurrentQuery()
    return { aborted: true }
  }),

  availability: procedure.query(() => claudeHealth.getAvailability()),

  recheck: procedure.mutation(async () => claudeHealth.probe()),

  hasApiKey: procedure.query(() => configService.hasClaudeApiKey()),

  setApiKey: procedure
    .input(z.object({ key: z.string() }))
    .mutation(async ({ input }) => {
      const res = configService.saveClaudeApiKey(input.key)
      if (!res.ok) return { ok: false, reason: res.reason, availability: claudeHealth.getAvailability() }
      const availability = await claudeHealth.probe()
      return { ok: true, availability }
    }),

  clearApiKey: procedure.mutation(async () => {
    configService.clearClaudeApiKey()
    const availability = await claudeHealth.probe()
    return { ok: true, availability }
  }),

  /**
   * Feature 19 — one-click "Recommend indexes". Builds a constrained prompt
   * that asks Claude to use the MCP tools to: read profiler slow queries,
   * list existing indexes, sample the collection schema, search the linked
   * codebase if available, and propose ranked createIndex calls.
   */
  recommendIndexes: procedure
    .input(z.object({ context: ContextSchema, mcpPort: z.number().optional() }))
    .mutation(async ({ input }) => {
      const { database, collection } = input.context
      if (!database || !collection) throw new Error('database + collection required')
      if (claudeHealth.getAvailability().status !== 'ready') {
        return { started: false, reason: 'claude-unavailable' }
      }
      const prompt = [
        `Analyse the ${database}.${collection} collection and recommend indexes.`,
        '',
        'Required workflow — call these MCP tools in order:',
        '1. mongo_list_indexes — see what already exists',
        '2. mongo_index_stats — find unused indexes worth dropping',
        `3. mongo_query_profiler with database: "${database}" — read slow queries (namespace filter recommended)`,
        `4. mongo_collection_schema with database: "${database}", collection: "${collection}", sampleSize: 200 — understand field types`,
        '5. mongo_search_codebase (if a codebase is linked) — find actual application query patterns',
        '',
        'Output format:',
        '- For each recommendation: an explicit createIndex call (compound order, direction, partial filter if applicable, TTL if applicable)',
        '- Rationale citing the slow query or code pattern that motivates it',
        '- Estimated cardinality / selectivity if visible from the schema sample',
        '- Drop suggestions for unused indexes',
        '',
        'Do NOT execute mongo_create_index or mongo_drop_index yourself — only print the calls. The user will run them after review.'
      ].join('\n')
      claudeService.sendMessage(prompt, input.context, input.mcpPort)
      return { started: true }
    }),

  /**
   * Feature 23 — AI explain interpretation. Asks Claude to read the explain
   * output for the current query and produce a human-readable diagnosis plus
   * concrete remediation steps.
   */
  interpretExplain: procedure
    .input(
      z.object({
        context: ContextSchema,
        filter: z.record(z.unknown()).optional(),
        pipeline: z.array(z.record(z.unknown())).optional(),
        mcpPort: z.number().optional()
      })
    )
    .mutation(async ({ input }) => {
      const { database, collection } = input.context
      if (!database || !collection) throw new Error('database + collection required')
      if (claudeHealth.getAvailability().status !== 'ready') {
        return { started: false, reason: 'claude-unavailable' }
      }
      const queryKind = input.pipeline?.length ? 'aggregation pipeline' : 'find query'
      const queryJson = JSON.stringify(input.pipeline ?? input.filter ?? {}, null, 2)
      const prompt = [
        `Run mongo_explain and mongo_list_indexes on ${database}.${collection}, then explain — in plain English — what the query plan is doing.`,
        '',
        `Query (${queryKind}):`,
        '```json',
        queryJson,
        '```',
        '',
        'In your response:',
        "1. Summarise the chosen plan (COLLSCAN vs IXSCAN, FETCH stage, SORT_KEY_GENERATOR, etc.) and why it was chosen.",
        '2. Identify the bottleneck — high docsExamined:nReturned ratio, in-memory sort, missing index for $match prefix, etc.',
        '3. Propose ONE concrete createIndex call that would fix the worst issue. Include the field order and direction.',
        '4. Mention any rejected plans the optimizer considered and why the winner won.',
        '',
        "Do NOT execute mongo_create_index yourself — only suggest. Keep the response under 400 words."
      ].join('\n')
      claudeService.sendMessage(prompt, input.context, input.mcpPort)
      return { started: true }
    })
})
