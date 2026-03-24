import { readdirSync, readFileSync } from 'fs'
import { join, extname } from 'path'

const DEFAULT_EXTENSIONS = ['.ts', '.js', '.py', '.go', '.java', '.rs', '.rb']
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.next',
  'target',
  'vendor'
])
const MAX_CONTEXT_BYTES = 20_000

interface CodebaseContext {
  summary: string
  matchedFiles: { path: string; excerpts: string[] }[]
}

let cache: { key: string; context: CodebaseContext; timestamp: number } | null = null
const CACHE_TTL = 300_000 // 5 minutes

function walkDir(dir: string, extensions: string[], files: string[] = [], depth = 0): string[] {
  if (depth > 8) return files
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walkDir(join(dir, entry.name), extensions, files, depth + 1)
        }
      } else if (extensions.includes(extname(entry.name))) {
        files.push(join(dir, entry.name))
      }
    }
  } catch {
    /* permission errors, etc */
  }
  return files
}

export function scanCodebase(
  codebasePath: string,
  searchTerms: string[],
  extensions?: string[]
): CodebaseContext {
  const cacheKey = `${codebasePath}:${searchTerms.join(',')}`
  if (cache && cache.key === cacheKey && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.context
  }

  const exts = extensions ?? DEFAULT_EXTENSIONS
  const files = walkDir(codebasePath, exts)

  const matchedFiles: { path: string; excerpts: string[] }[] = []
  let totalBytes = 0
  const lowerTerms = searchTerms.map((t) => t.toLowerCase())

  for (const filePath of files) {
    if (totalBytes >= MAX_CONTEXT_BYTES) break
    try {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')
      const excerpts: string[] = []

      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase()
        if (lowerTerms.some((term) => lower.includes(term))) {
          const start = Math.max(0, i - 3)
          const end = Math.min(lines.length, i + 4)
          const excerpt = lines.slice(start, end).join('\n')
          const excerptBytes = Buffer.byteLength(excerpt)
          if (totalBytes + excerptBytes > MAX_CONTEXT_BYTES) break
          excerpts.push(`Lines ${start + 1}-${end}:\n${excerpt}`)
          totalBytes += excerptBytes
          i = end // skip ahead to avoid overlapping excerpts
        }
      }

      if (excerpts.length > 0) {
        const relPath = filePath.replace(codebasePath, '').replace(/\\/g, '/')
        matchedFiles.push({ path: relPath, excerpts })
      }
    } catch {
      /* read errors */
    }
  }

  const summary = `Scanned ${files.length} files in ${codebasePath}, found ${matchedFiles.length} files referencing the target collections/database.`
  const context = { summary, matchedFiles }
  cache = { key: cacheKey, context, timestamp: Date.now() }
  return context
}

export function formatContext(ctx: CodebaseContext): string {
  if (ctx.matchedFiles.length === 0) return ''

  const lines = ['## Codebase Context', ctx.summary, '']
  for (const file of ctx.matchedFiles) {
    lines.push(`### ${file.path}`)
    for (const excerpt of file.excerpts) {
      lines.push('```')
      lines.push(excerpt)
      lines.push('```')
    }
    lines.push('')
  }
  return lines.join('\n')
}
