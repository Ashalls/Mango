import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { X, Copy, Download, Check } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { trpc } from '@renderer/lib/trpc'
import type { CodegenLanguage } from '@shared/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodeGenModalProps {
  open: boolean
  onClose: () => void
  type: 'find' | 'aggregate'
  filter?: Record<string, unknown>
  projection?: Record<string, unknown>
  sort?: Record<string, unknown>
  skip?: number
  limit?: number
  pipeline?: Record<string, unknown>[]
}

// ---------------------------------------------------------------------------
// Language config
// ---------------------------------------------------------------------------

const LANGUAGES: { id: CodegenLanguage; label: string; monacoLang: string; ext: string }[] = [
  { id: 'javascript', label: 'JavaScript', monacoLang: 'javascript', ext: 'js' },
  { id: 'python',     label: 'Python',     monacoLang: 'python',     ext: 'py' },
  { id: 'java',       label: 'Java',       monacoLang: 'java',       ext: 'java' },
  { id: 'csharp',     label: 'C#',         monacoLang: 'csharp',     ext: 'cs' },
  { id: 'php',        label: 'PHP',        monacoLang: 'php',        ext: 'php' },
  { id: 'ruby',       label: 'Ruby',       monacoLang: 'ruby',       ext: 'rb' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeGenModal({
  open,
  onClose,
  type,
  filter,
  projection,
  sort,
  skip,
  limit,
  pipeline,
}: CodeGenModalProps) {
  const [language, setLanguage] = useState<CodegenLanguage>('javascript')
  const [includeBoilerplate, setIncludeBoilerplate] = useState(true)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const effectiveTheme = useSettingsStore((s) => s.effectiveTheme)
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))

  const database = tab?.database ?? ''
  const collection = tab?.collection ?? ''

  const fetchCode = useCallback(async () => {
    if (!open || !database || !collection) return
    setLoading(true)
    try {
      const result = await trpc.query.generateCode.query({
        type,
        database,
        collection,
        filter,
        projection,
        sort,
        skip,
        limit,
        pipeline,
        includeBoilerplate,
        language,
      })
      setCode(result.code)
    } catch (err) {
      setCode(`// Error generating code: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [open, database, collection, type, filter, projection, sort, skip, limit, pipeline, includeBoilerplate, language])

  useEffect(() => {
    fetchCode()
  }, [fetchCode])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  const handleDownload = () => {
    const langConfig = LANGUAGES.find((l) => l.id === language)
    const ext = langConfig?.ext ?? 'txt'
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `query.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!open) return null

  const activeLang = LANGUAGES.find((l) => l.id === language)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="flex flex-col rounded-lg border border-border bg-card shadow-2xl"
        style={{ width: 700, height: '70vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Generated Code</h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tab row + boilerplate toggle */}
        <div className="flex items-center justify-between border-b border-border px-4">
          {/* Language tabs */}
          <div className="flex items-center gap-0">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.id}
                className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  language === lang.id
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setLanguage(lang.id)}
              >
                {lang.label}
              </button>
            ))}
          </div>

          {/* Boilerplate toggle */}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeBoilerplate}
              onChange={(e) => setIncludeBoilerplate(e.target.checked)}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            Include connection boilerplate
          </label>
        </div>

        {/* Editor */}
        <div className="relative flex-1 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/80">
              <span className="text-xs text-muted-foreground">Generating...</span>
            </div>
          )}
          <Editor
            height="100%"
            language={activeLang?.monacoLang ?? 'javascript'}
            value={code}
            theme={effectiveTheme === 'dark' ? 'vs-dark' : 'light'}
            options={{
              readOnly: true,
              fontSize: 12,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              lineNumbers: 'on',
              folding: true,
            }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCopy}>
            {copied ? (
              <Check className="mr-1 h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="mr-1 h-3.5 w-3.5" />
            )}
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleDownload}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Download as File
          </Button>
        </div>
      </div>
    </div>
  )
}
