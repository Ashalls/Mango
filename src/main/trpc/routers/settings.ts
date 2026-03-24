import { router, procedure, z } from '../context'
import * as configService from '../../services/config'

export const settingsRouter = router({
  get: procedure
    .input(z.object({ key: z.string() }))
    .query(({ input }) => {
      const settings = configService.loadSettings()
      return settings[input.key] ?? null
    }),

  set: procedure
    .input(z.object({ key: z.string(), value: z.unknown() }))
    .mutation(({ input }) => {
      const settings = configService.loadSettings()
      settings[input.key] = input.value
      configService.saveSettings(settings)
      return { ok: true }
    }),

  pickFolder: procedure
    .input(z.object({ title: z.string().optional(), defaultPath: z.string().optional() }))
    .mutation(async ({ input }) => {
      const { dialog, BrowserWindow } = await import('electron')
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { canceled: true, path: null }
      const { filePaths, canceled } = await dialog.showOpenDialog(win, {
        title: input.title || 'Select Folder',
        defaultPath: input.defaultPath || undefined,
        properties: ['openDirectory']
      })
      if (canceled || filePaths.length === 0) return { canceled: true, path: null }
      return { canceled: false, path: filePaths[0] }
    })
})
