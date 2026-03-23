import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { exposeElectronTRPC } from 'electron-trpc/main'

// Expose electron API
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
}

// Expose tRPC IPC bridge
process.once('loaded', async () => {
  exposeElectronTRPC()
})
