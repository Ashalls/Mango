import { X, Copy, Check, Save, Undo2, Maximize2, Minimize2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { trpc } from '@renderer/lib/trpc'

export function DocumentEditor() {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { selectDocument, setEditorContent, clearDocument, executeQuery } = useTabStore()
  const effectiveTheme = useSettingsStore((s) => s.effectiveTheme)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Escape restores the docked editor when popped out. Content lives in the
  // tab store, so collapsing never loses edits.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  if (!tab?.selectedDocument) return null

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tab.editorContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDiscard = () => {
    selectDocument(tab.selectedDocument)
    setError(null)
  }

  const handleSave = async () => {
    if (!tab) return
    setError(null)
    setSaving(true)
    try {
      const updated = JSON.parse(tab.editorContent)
      const docId = tab.selectedDocument!._id
      if (!docId) { setError('Document has no _id field'); return }
      const { _id, ...fields } = updated
      await trpc.mutation.updateOne.mutate({
        database: tab.database,
        collection: tab.collection,
        filter: { _id: docId },
        update: { $set: fields }
      })
      selectDocument(updated)
      executeQuery()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const body = (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Document Editor</span>
          {tab.isDirty && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-400">Modified</span>
          )}
        </div>
        <div className="flex gap-1">
          {tab.isDirty && (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleDiscard}>
                <Undo2 className="mr-1 h-3.5 w-3.5" /> Discard
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving}>
                <Save className="mr-1 h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save'}
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Restore editor (Esc)' : 'Pop out editor'}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearDocument}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {error && (
        <div className="border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">{error}</div>
      )}
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage="json"
          value={tab.editorContent}
          onChange={(value) => setEditorContent(value ?? '')}
          theme={effectiveTheme === 'dark' ? 'vs-dark' : 'light'}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            readOnly: false,
            automaticLayout: true,
            tabSize: 2
          }}
        />
      </div>
    </>
  )

  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-6">
        <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
          {body}
        </div>
      </div>
    )
  }

  return <div className="flex h-full flex-col border-t border-border">{body}</div>
}
