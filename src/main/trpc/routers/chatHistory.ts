import { router, procedure, z } from '../context'
import * as chatHistory from '../../services/chatHistory'

export const chatHistoryRouter = router({
  save: procedure
    .input(
      z.object({
        tabId: z.string(),
        sessionId: z.string(),
        messages: z.array(
          z.object({
            id: z.string(),
            role: z.enum(['user', 'assistant']),
            content: z.string(),
            toolCalls: z.array(z.unknown()).optional(),
            timestamp: z.number()
          })
        )
      })
    )
    .mutation(({ input }) => {
      return chatHistory.saveSession(input.tabId, input.sessionId, input.messages)
    }),

  load: procedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      return chatHistory.loadSession(input.sessionId)
    }),

  list: procedure
    .input(z.object({ tabId: z.string() }))
    .query(({ input }) => {
      return chatHistory.listSessions(input.tabId)
    }),

  delete: procedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      chatHistory.deleteSession(input.sessionId)
      return { deleted: true }
    })
})
