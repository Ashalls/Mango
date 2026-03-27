import { app, shell, BrowserWindow, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { createIPCHandler } from 'electron-trpc/main'
import { appRouter } from './trpc/router'
import * as mongoService from './services/mongodb'
import * as claudeService from './services/claude'
import { startMcpServer, stopMcpServer } from './mcp/server'
import { setToolsMainWindow } from './mcp/tools'

let mcpPort: number = 27088

/** Resolve a resource file — works in both dev and packaged builds */
function resourcePath(filename: string): string {
  if (is.dev) {
    return join(__dirname, '../../resources', filename)
  }
  return join(process.resourcesPath, filename)
}

function createSplashWindow(): BrowserWindow {
  const icon = nativeImage.createFromPath(resourcePath('icon.png'))

  const splash = new BrowserWindow({
    width: 420,
    height: 480,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  splash.loadFile(resourcePath('splash.html'))
  splash.center()
  splash.show()

  return splash
}

function createWindow(): BrowserWindow {
  const icon = nativeImage.createFromPath(resourcePath('icon.png'))

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    title: 'Mango',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0) {
      if (windows[0].isMinimized()) windows[0].restore()
      windows[0].focus()
    }
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.mango.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Show splash
  const splash = createSplashWindow()
  const splashStart = Date.now()

  // Set version on splash screen
  splash.webContents.executeJavaScript(
    `document.getElementById("version").innerText = "v${app.getVersion()}"`
  )

  // Check for updates during splash (production only)
  if (!is.dev) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = console
    let splashAlive = true
    autoUpdater.on('update-available', () => {
      if (splashAlive) {
        splash.webContents.executeJavaScript(
          'document.getElementById("status").innerHTML = "Downloading update<span class=\\"dot\\">.</span><span class=\\"dot\\">.</span><span class=\\"dot\\">.</span>"'
        )
      }
    })
    autoUpdater.on('update-not-available', () => {
      if (splashAlive) {
        splash.webContents.executeJavaScript(
          'document.getElementById("status").innerText = "Up to date!"'
        )
      }
    })
    autoUpdater.on('error', (err) => {
      console.error('Auto-updater error:', err)
      if (splashAlive) {
        splash.webContents.executeJavaScript(
          'document.getElementById("status").innerText = "Starting..."'
        )
      }
    })
    splash.on('closed', () => { splashAlive = false })
    autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err))
  }

  // Start MCP server while splash is showing
  try {
    mcpPort = await startMcpServer()
    console.log(`Mango MCP server running on port ${mcpPort}`)
  } catch (err) {
    console.error('Failed to start MCP server:', err)
  }

  // Create main window (hidden)
  const mainWindow = createWindow()
  claudeService.setMainWindow(mainWindow)
  setToolsMainWindow(mainWindow)
  createIPCHandler({ router: appRouter, windows: [mainWindow] })

  // Wait for main window to be ready, then swap
  mainWindow.once('ready-to-show', () => {
    const splashMinTime = 3000
    const remaining = Math.max(0, splashMinTime - (Date.now() - splashStart))

    setTimeout(() => {
      splash.destroy()
      mainWindow.show()
      if (is.dev) {
        mainWindow.webContents.openDevTools()
      }

      // Update notification — always notify user in the main window
      if (!is.dev) {
        // Replace all previous listeners with the main window notification
        autoUpdater.removeAllListeners('update-downloaded')
        autoUpdater.on('update-downloaded', (info) => {
          console.log('Update downloaded:', info.version)
          mainWindow.webContents.send('update:downloaded', { version: info.version })
        })
        // If an update was already downloaded during splash, notify immediately
        // Otherwise check again now (splash check may have started download)
        autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err))
        // Re-check every 30 minutes
        setInterval(() => autoUpdater.checkForUpdates().catch((err) => console.error('Update re-check failed:', err)), 30 * 60 * 1000)
      }
    }, remaining)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createWindow()
      createIPCHandler({ router: appRouter, windows: [win] })
    }
  })
})

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('app:getVersion', () => app.getVersion())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  await stopMcpServer()
  await mongoService.disconnectAll()
})
