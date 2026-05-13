import { app, shell, dialog, BrowserWindow } from 'electron'
import { createWriteStream, existsSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'

const RELEASES_URL = 'https://api.github.com/repos/Ashalls/Mango/releases/latest'

interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GitHubRelease {
  tag_name: string
  assets: GitHubAsset[]
}

export interface MacUpdateInfo {
  version: string
  asset: GitHubAsset
}

let downloadedDmgPath: string | null = null
let downloadInFlight: Promise<string> | null = null

function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v.replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0)
  const av = parse(a)
  const bv = parse(b)
  for (let i = 0; i < 3; i++) {
    const diff = (av[i] || 0) - (bv[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function pickDmgAsset(assets: GitHubAsset[]): GitHubAsset | null {
  const dmgs = assets.filter((a) => a.name.endsWith('.dmg'))
  if (dmgs.length === 0) return null
  const archMatch = dmgs.find((a) => a.name.toLowerCase().includes(process.arch))
  return archMatch || dmgs[0]
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const res = await fetch(RELEASES_URL, {
    headers: {
      'User-Agent': 'Mango-Updater',
      Accept: 'application/vnd.github+json'
    }
  })
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)
  return (await res.json()) as GitHubRelease
}

export async function checkForUpdate(): Promise<MacUpdateInfo | null> {
  const release = await fetchLatestRelease()
  if (compareSemver(release.tag_name, app.getVersion()) <= 0) return null
  const asset = pickDmgAsset(release.assets)
  if (!asset) return null
  return { version: release.tag_name.replace(/^v/, ''), asset }
}

async function downloadDmg(
  asset: GitHubAsset,
  onProgress?: (percent: number) => void
): Promise<string> {
  const target = join(app.getPath('downloads'), asset.name)

  if (existsSync(target) && statSync(target).size === asset.size) {
    onProgress?.(100)
    return target
  }
  if (existsSync(target)) unlinkSync(target)

  const res = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'Mango-Updater' },
    redirect: 'follow'
  })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)

  const total = Number(res.headers.get('content-length')) || asset.size
  const out = createWriteStream(target)
  const reader = res.body.getReader()
  let received = 0
  let lastReported = -1

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!out.write(value)) {
        await new Promise<void>((resolve) => out.once('drain', () => resolve()))
      }
      received += value.byteLength
      if (onProgress && total) {
        const pct = Math.floor((received / total) * 100)
        if (pct !== lastReported) {
          lastReported = pct
          onProgress(pct)
        }
      }
    }
  } catch (err) {
    out.destroy()
    if (existsSync(target)) unlinkSync(target)
    throw err
  }

  await new Promise<void>((resolve, reject) => {
    out.end((err?: Error | null) => (err ? reject(err) : resolve()))
  })
  return target
}

export async function downloadUpdate(
  info: MacUpdateInfo,
  onProgress?: (percent: number) => void
): Promise<string> {
  if (downloadedDmgPath && existsSync(downloadedDmgPath)) return downloadedDmgPath
  if (downloadInFlight) return downloadInFlight
  downloadInFlight = downloadDmg(info.asset, onProgress)
    .then((path) => {
      downloadedDmgPath = path
      return path
    })
    .finally(() => {
      downloadInFlight = null
    })
  return downloadInFlight
}

export async function installUpdate(parent?: BrowserWindow): Promise<void> {
  if (!downloadedDmgPath || !existsSync(downloadedDmgPath)) {
    throw new Error('No update has been downloaded')
  }

  const { response } = await dialog.showMessageBox(parent ?? BrowserWindow.getFocusedWindow() ?? undefined as never, {
    type: 'info',
    title: 'Install Mango Update',
    message: 'The new version is ready to install.',
    detail:
      'Mango will quit and open the disk image. Drag the new Mango into your Applications folder, replacing the old version, then re-launch Mango.',
    buttons: ['Install', 'Later'],
    defaultId: 0,
    cancelId: 1
  })

  if (response !== 0) return

  await shell.openPath(downloadedDmgPath)
  setTimeout(() => app.quit(), 600)
}

export function hasDownloadedUpdate(): boolean {
  return downloadedDmgPath !== null && existsSync(downloadedDmgPath)
}
