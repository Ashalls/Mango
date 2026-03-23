import { router, procedure, z } from '../context'
import * as migrationActions from '../../actions/migration'

export const migrationRouter = router({
  copyDatabase: procedure
    .input(
      z.object({
        sourceConnectionId: z.string(),
        sourceDatabase: z.string(),
        targetConnectionId: z.string(),
        targetDatabase: z.string(),
        collections: z.array(z.string()).optional(),
        dropTarget: z.boolean().optional()
      })
    )
    .mutation(async ({ input }) => {
      // Runs async — progress emitted via IPC events
      migrationActions.copyDatabase(input)
      return { started: true }
    })
})
