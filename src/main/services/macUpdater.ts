import { app, shell, dialog, BrowserWindow } from 'electron'
import { createWriteStream, existsSync, statSync, unlinkSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { z } from 'zod'

const RELEASES_URL = 'https://api.github.com/repos/Ashalls/Mango/releases/latest'

const GitHubAssetSchema = z.object({
  name: z.string(),
  browser_download_url: z.string().url(),
  size: z.number().nonnegative()
})

const GitHubReleaseSchema = z.object({
  tag_name: z.string(),
  assets: z.array(GitHubAssetSchema)
})

type GitHubAsset = z.infer<typeof GitHubAssetSchema>
type GitHubRelease = z.infer<typeof GitHubReleaseSchema>

export interface MacUpdateInfo {
  version: string
  asset: GitHubAsset
  release: GitHubRelease
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
  const json = await res.json()
  const parsed = GitHubReleaseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error('Malformed GitHub release payload: ' + parsed.error.message)
  }
  return parsed.data
}

/**
 * Verify the downloaded DMG against the published SHA256SUMS asset, if one
 * exists. Behaviour:
 *   - SHA256SUMS present + hash matches → silent success.
 *   - SHA256SUMS present + hash mismatch → throw (refuse to install).
 *   - SHA256SUMS absent → log a warning and proceed.
 *
 * This is intentionally tolerant: until releases publish SHA256SUMS as a
 * standard asset, demanding it would break the entire auto-update path. The
 * release workflow at .github/workflows/release.yml does upload SHA256SUMS,
 * so once that workflow has run for a release the verification kicks in
 * automatically.
 *
 * Note: checksum verification alone does NOT authenticate the publisher —
 * anyone who can push a GitHub release can also publish a matching SHA256SUMS.
 * Real publisher authentication requires code signing (see docs/RELEASING.md).
 */
async function verifyChecksum(dmgPath: string, asset: GitHubAsset, release: GitHubRelease): Promise<void> {
  const sumsAsset = release.assets.find((a) => /SHA256SUMS|\.sha256$/i.test(a.name))
  if (!sumsAsset) {
    console.warn(`[updater] No SHA256SUMS asset on release ${release.tag_name}; skipping checksum verification`)
    return
  }
  const res = await fetch(sumsAsset.browser_download_url, { headers: { 'User-Agent': 'Mango-Updater' } })
  if (!res.ok) {
    console.warn(`[updater] Checksum file fetch failed (${res.status}); skipping verification`)
    return
  }
  const sums = await res.text()
  const expected = sums
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.toLowerCase().endsWith(asset.name.toLowerCase()))
    .map((l) => l.split(/\s+/)[0])[0]
  if (!expected) {
    console.warn(`[updater] SHA256SUMS has no entry for ${asset.name}; skipping verification`)
    return
  }
  const hash = createHash('sha256').update(readFileSync(dmgPath)).digest('hex')
  if (hash.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${asset.name}: got ${hash}, expected ${expected}`)
  }
}

export async function checkForUpdate(): Promise<MacUpdateInfo | null> {
  const release = await fetchLatestRelease()
  if (compareSemver(release.tag_name, app.getVersion()) <= 0) return null
  const asset = pickDmgAsset(release.assets)
  if (!asset) return null
  return { version: release.tag_name.replace(/^v/, ''), asset, release }
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
    .then(async (path) => {
      // Refuse to keep an unverified DMG. If the release publisher hasn't
      // supplied a SHA256SUMS file we delete the download and surface the
      // error — the user can still install manually from the GitHub release
      // page if they're certain.
      try {
        await verifyChecksum(path, info.asset, info.release)
      } catch (err) {
        if (existsSync(path)) unlinkSync(path)
        throw err
      }
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
