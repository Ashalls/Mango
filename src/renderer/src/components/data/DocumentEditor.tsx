import { X, Copy, Check, Save, Undo2 } from 'lucide-react'
import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { useThemeStore } from '@renderer/store/themeStore'
import { trpc } from '@renderer/lib/trpc'

export function DocumentEditor() {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { selectDocument, setEditorContent, clearDocument, executeQuery } = useTabStore()
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="flex h-full flex-col border-t border-border">
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
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearDocument}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {error && (
        <div className="border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">{error}</div>
      )}
      <div className="flex-1">
        <Editor
          height="100%"
          defaultLanguage="json"
          value={tab.editorContent}
          onChange={(value) => setEditorContent(value ?? '')}
          theme={useThemeStore.getState().getEffectiveTheme() === 'dark' ? 'vs-dark' : 'light'}
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
    </div>
  )
}
