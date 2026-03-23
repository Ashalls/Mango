import { router } from './context'
import { connectionRouter } from './routers/connection'
import { explorerRouter } from './routers/explorer'
import { queryRouter } from './routers/query'
import { mutationRouter } from './routers/mutation'
import { adminRouter } from './routers/admin'
import { migrationRouter } from './routers/migration'
import { exportImportRouter } from './routers/exportImport'
import { claudeRouter } from './routers/claude'

export const appRouter = router({
  connection: connectionRouter,
  explorer: explorerRouter,
  query: queryRouter,
  mutation: mutationRouter,
  admin: adminRouter,
  migration: migrationRouter,
  exportImport: exportImportRouter,
  claude: claudeRouter
})

export type AppRouter = typeof appRouter
