import { router, procedure, z } from '../context'
import * as claudeService from '../../services/claude'

export const claudeRouter = router({
  sendMessage: procedure
    .input(
      z.object({
        message: z.string(),
        context: z.object({
          connectionName: z.string().optional(),
          connectionUri: z.string().optional(),
          database: z.string().optional(),
          collection: z.string().optional(),
          currentFilter: z.record(z.unknown()).optional(),
          resultCount: z.number().optional(),
          page: z.number().optional(),
          totalPages: z.number().optional(),
          openDocumentId: z.string().optional()
        }),
        mcpPort: z.number().optional()
      })
    )
    .mutation(async ({ input }) => {
      // This runs asynchronously — results stream back via IPC events
      claudeService.sendMessage(input.message, input.context, input.mcpPort)
      return { started: true }
    }),

  abort: procedure.mutation(async () => {
    claudeService.abortCurrentQuery()
    return { aborted: true }
  })
})
