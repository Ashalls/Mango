import { router, procedure } from '../context'
import { z } from 'zod'
import * as profilerActions from '../../actions/profiler'
import * as connectionActions from '../../actions/connection'
import * as queryLog from '../../services/queryLog'

export const profilerRouter = router({
  getStatus: procedure
    .input(z.object({ connectionId: z.string().optional(), database: z.string() }))
    .query(({ input }) => profilerActions.getProfilingStatus(input.database, input.connectionId)),

  setLevel: procedure
    .input(z.object({
      connectionId: z.string().optional(),
      database: z.string(),
      level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      slowms: z.number().optional()
    }))
    .mutation(({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      return profilerActions.setProfilingLevel(input.database, input.level, input.slowms, input.connectionId)
    }),

  getData: procedure
    .input(z.object({
      connectionId: z.string().optional(),
      database: z.string(),
      limit: z.number().optional().default(100),
      namespace: z.string().optional()
    }))
    .query(({ input }) => profilerActions.getProfilingData(input.database, input.limit, input.namespace, input.connectionId)),

  getCurrentOps: procedure
    .input(z.object({
      connectionId: z.string().optional(),
      database: z.string(),
      limit: z.number().optional().default(100)
    }))
    .query(({ input }) => profilerActions.getCurrentOps(input.database, input.limit, input.connectionId)),

  getAppLog: procedure
    .input(z.object({
      limit: z.number().optional().default(100),
      namespace: z.string().optional()
    }))
    .query(({ input }) => queryLog.getEntries(input.limit, input.namespace)),

  clearAppLog: procedure
    .mutation(() => { queryLog.clear() }),

  clear: procedure
    .input(z.object({ connectionId: z.string().optional(), database: z.string() }))
    .mutation(({ input }) => {
      const blocked = connectionActions.checkReadOnly(input.connectionId)
      if (blocked) throw new Error(blocked)
      return profilerActions.clearProfilingData(input.database, input.connectionId)
    })
})
