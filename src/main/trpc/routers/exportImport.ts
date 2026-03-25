import { router, procedure, z } from '../context'
import * as exportImportActions from '../../actions/exportImport'
import * as migrationActions from '../../actions/migration'

export const exportImportRouter = router({
  exportCollection: procedure
    .input(z.object({
      database: z.string(),
      collection: z.string(),
      format: z.enum(['json', 'csv']).default('json')
    }))
    .mutation(async ({ input }) => {
      return exportImportActions.exportCollection(input.database, input.collection, input.format)
    }),

  exportDatabaseDump: procedure
    .input(z.object({
      connectionId: z.string(),
      database: z.string()
    }))
    .mutation(async ({ input }) => {
      return exportImportActions.exportDatabaseDump(input.connectionId, input.database)
    }),

  importDatabaseDump: procedure
    .input(z.object({
      connectionId: z.string(),
      database: z.string(),
      dropExisting: z.boolean().default(false)
    }))
    .mutation(async ({ input }) => {
      return exportImportActions.importDatabaseDump(input.connectionId, input.database, input.dropExisting)
    }),

  pickDumpFolder: procedure
    .mutation(async () => {
      return exportImportActions.pickDumpFolder()
    }),

  importDatabaseFromDump: procedure
    .input(z.object({
      connectionId: z.string(),
      importDir: z.string(),
      targetDatabase: z.string(),
      dropTarget: z.boolean()
    }))
    .mutation(async ({ input }) => {
      return exportImportActions.importDatabaseFromDump(
        input.connectionId, input.importDir, input.targetDatabase, input.dropTarget
      )
    }),

  cancelOperation: procedure
    .input(z.object({ operationId: z.string() }))
    .mutation(({ input }) => {
      // Try both modules
      const cancelled = exportImportActions.cancelOperation(input.operationId) ||
        migrationActions.cancelOperation(input.operationId)
      return { cancelled }
    }),

  importCollection: procedure
    .input(z.object({
      database: z.string(),
      collection: z.string(),
      dropExisting: z.boolean().default(false)
    }))
    .mutation(async ({ input }) => {
      return exportImportActions.importCollection(input.database, input.collection, input.dropExisting)
    })
})
