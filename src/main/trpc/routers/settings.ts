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
    })
})
