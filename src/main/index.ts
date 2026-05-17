import { app, shell, BrowserWindow, nativeImage, ipcMain, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { createIPCHandler } from 'electron-trpc/main'
import { appRouter } from './trpc/router'
import * as mongoService from './services/mongodb'
import * as claudeService from './services/claude'
import * as macUpdater from './services/macUpdater'
import { startMcpServer, stopMcpServer } from './mcp/server'
import { setToolsMainWindow } from './mcp/tools'

let mcpPort: number = 27088
const isMac = process.platform === 'darwin'
let updateMainWindow: BrowserWindow | null = null
let pendingMacUpdateVersion: string | null = null
let isQuitting = false

/** Recursively schedule fn with ±30% jitter — avoids synchronized polling
 * across all installed clients hitting GitHub at the same minute. */
function scheduleJittered(fn: () => void, baseMs: number): void {
  const jitter = baseMs * (0.7 + Math.random() * 0.6)
  setTimeout(() => {
    try { fn() } catch (e) { console.error(e) }
    scheduleJittered(fn, baseMs)
  }, jitter)
}

/** Escape a value for safe injection into executeJavaScript. */
function setSplashText(splash: BrowserWindow, id: string, text: string, asHtml = false): void {
  if (splash.isDestroyed()) return
  const prop = asHtml ? 'innerHTML' : 'innerText'
  splash.webContents.executeJavaScript(
    `(()=>{const el=document.getElementById(${JSON.stringify(id)});if(el)el.${prop}=${JSON.stringify(text)};})()`
  ).catch(() => {})
}

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
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Block navigation to external origins — preserves loopback/file/devtools but
  // prevents the renderer from being navigated away by injected content.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    try {
      const u = new URL(url)
      const isDev = !!process.env['ELECTRON_RENDERER_URL']
      const allowed =
        u.protocol === 'file:' ||
        u.protocol === 'devtools:' ||
        (isDev && u.hostname === 'localhost') ||
        (isDev && u.hostname === '127.0.0.1')
      if (!allowed) e.preventDefault()
    } catch {
      e.preventDefault()
    }
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

  // Content Security Policy — defense in depth against a renderer XSS chain.
  // Permits inline styles (Tailwind injected styles + Monaco) and loopback
  // connect for the MCP/tRPC IPC bridge. Vite dev needs 'unsafe-eval' for HMR.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isDev = !!process.env['ELECTRON_RENDERER_URL']
    const scriptSrc = isDev ? "'self' 'unsafe-eval' 'unsafe-inline'" : "'self' 'unsafe-inline'"
    const csp = [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https://api.github.com",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'none'"
    ].join('; ')
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    // Reject preload changes from <webview> and prevent <webview> attachment
    window.webContents.on('will-attach-webview', (e) => e.preventDefault())
  })

  // Show splash
  const splash = createSplashWindow()
  const splashStart = Date.now()

  // Set version on splash screen (escaped)
  splash.webContents.once('did-finish-load', () => {
    setSplashText(splash, 'version', `v${app.getVersion()}`)
  })

  // Check for updates during splash (production only)
  if (!is.dev) {
    let splashAlive = true
    splash.on('closed', () => { splashAlive = false })

    const setSplashDownloading = (): void => {
      if (splashAlive) {
        // Static HTML — safe; the dots are decoration, not interpolated data.
        setSplashText(
          splash,
          'status',
          'Downloading update<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>',
          true
        )
      }
    }
    const setSplashUpToDate = (): void => {
      if (splashAlive) setSplashText(splash, 'status', 'Up to date!')
    }
    const setSplashFallback = (): void => {
      if (splashAlive) setSplashText(splash, 'status', 'Starting...')
    }

    if (isMac) {
      // Custom updater for Mac — Squirrel.Mac inside electron-updater requires a
      // signed app, which Mango is not. We download the .dmg ourselves and let
      // the user drag-replace the app from Finder.
      macUpdater
        .checkForUpdate()
        .then(async (info) => {
          if (!info) {
            setSplashUpToDate()
            return
          }
          setSplashDownloading()
          try {
            await macUpdater.downloadUpdate(info)
            pendingMacUpdateVersion = info.version
            if (updateMainWindow && !updateMainWindow.isDestroyed()) {
              updateMainWindow.webContents.send('update:downloaded', {
                version: info.version,
                requiresManualInstall: true
              })
              pendingMacUpdateVersion = null
            }
          } catch (err) {
            console.error('Mac update download failed:', err)
            setSplashFallback()
          }
        })
        .catch((err) => {
          console.error('Mac update check failed:', err)
          setSplashFallback()
        })
    } else {
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.logger = console
      autoUpdater.on('update-available', setSplashDownloading)
      autoUpdater.on('update-not-available', setSplashUpToDate)
      autoUpdater.on('error', (err) => {
        console.error('Auto-updater error:', err)
        setSplashFallback()
      })
      autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err))
    }
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
  updateMainWindow = mainWindow
  claudeService.setMainWindow(mainWindow)
  setToolsMainWindow(mainWindow)
  createIPCHandler({ router: appRouter, windows: [mainWindow] })

  // Mac: hide the window when the user clicks the red X rather than
  // destroying it, so clicking the dock icon can bring it back without
  // losing IPC handler and service references to the live window.
  if (isMac) {
    mainWindow.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault()
        mainWindow.hide()
      }
    })
  }

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
        if (isMac) {
          // Flush any update that finished downloading during the splash
          if (pendingMacUpdateVersion) {
            mainWindow.webContents.send('update:downloaded', {
              version: pendingMacUpdateVersion,
              requiresManualInstall: true
            })
            pendingMacUpdateVersion = null
          }
          const recheckMac = async (): Promise<void> => {
            try {
              const info = await macUpdater.checkForUpdate()
              if (!info) return
              await macUpdater.downloadUpdate(info)
              mainWindow.webContents.send('update:downloaded', {
                version: info.version,
                requiresManualInstall: true
              })
            } catch (err) {
              console.error('Mac update re-check failed:', err)
            }
          }
          scheduleJittered(recheckMac, 30 * 60 * 1000)
        } else {
          autoUpdater.removeAllListeners('update-downloaded')
          autoUpdater.on('update-downloaded', (info) => {
            console.log('Update downloaded:', info.version)
            mainWindow.webContents.send('update:downloaded', { version: info.version })
          })
          autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err))
          scheduleJittered(() => autoUpdater.checkForUpdates().catch((err) => console.error('Update re-check failed:', err)), 30 * 60 * 1000)
        }
      }
    }, remaining)
  })

  app.on('activate', () => {
    const w = updateMainWindow
    if (w && !w.isDestroyed()) {
      if (!w.isVisible()) w.show()
      w.focus()
      return
    }
    const win = createWindow()
    updateMainWindow = win
    createIPCHandler({ router: appRouter, windows: [win] })
    win.once('ready-to-show', () => win.show())
  })
})

ipcMain.handle('update:install', async () => {
  if (isMac) {
    await macUpdater.installUpdate(updateMainWindow ?? undefined)
    return
  }
  autoUpdater.quitAndInstall()
})

ipcMain.handle('app:getVersion', () => app.getVersion())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  isQuitting = true
  await stopMcpServer()
  await mongoService.disconnectAll()
})
