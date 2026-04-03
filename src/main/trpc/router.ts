import { router } from './context'
import { connectionRouter } from './routers/connection'
import { explorerRouter } from './routers/explorer'
import { queryRouter } from './routers/query'
import { mutationRouter } from './routers/mutation'
import { adminRouter } from './routers/admin'
import { migrationRouter } from './routers/migration'
import { exportImportRouter } from './routers/exportImport'
import { settingsRouter } from './routers/settings'
import { claudeRouter } from './routers/claude'
import { chatHistoryRouter } from './routers/chatHistory'
import { mongoshRouter } from './routers/mongosh'
import { profilerRouter } from './routers/profiler'

export const appRouter = router({
  connection: connectionRouter,
  explorer: explorerRouter,
  query: queryRouter,
  mutation: mutationRouter,
  admin: adminRouter,
  migration: migrationRouter,
  exportImport: exportImportRouter,
  settings: settingsRouter,
  claude: claudeRouter,
  chatHistory: chatHistoryRouter,
  mongosh: mongoshRouter,
  profiler: profilerRouter
})

export type AppRouter = typeof appRouter
