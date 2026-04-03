import { router, procedure } from '../context'
import { z } from 'zod'
import * as profilerActions from '../../actions/profiler'
import * as queryLog from '../../services/queryLog'

export const profilerRouter = router({
  getStatus: procedure
    .input(z.object({ database: z.string() }))
    .query(({ input }) => profilerActions.getProfilingStatus(input.database)),

  setLevel: procedure
    .input(z.object({
      database: z.string(),
      level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      slowms: z.number().optional()
    }))
    .mutation(({ input }) => profilerActions.setProfilingLevel(input.database, input.level, input.slowms)),

  getData: procedure
    .input(z.object({
      database: z.string(),
      limit: z.number().optional().default(100),
      namespace: z.string().optional()
    }))
    .query(({ input }) => profilerActions.getProfilingData(input.database, input.limit, input.namespace)),

  getCurrentOps: procedure
    .input(z.object({
      database: z.string(),
      limit: z.number().optional().default(100)
    }))
    .query(({ input }) => profilerActions.getCurrentOps(input.database, input.limit)),

  getAppLog: procedure
    .input(z.object({
      limit: z.number().optional().default(100),
      namespace: z.string().optional()
    }))
    .query(({ input }) => queryLog.getEntries(input.limit, input.namespace)),

  clearAppLog: procedure
    .mutation(() => { queryLog.clear() }),

  clear: procedure
    .input(z.object({ database: z.string() }))
    .mutation(({ input }) => profilerActions.clearProfilingData(input.database))
})
