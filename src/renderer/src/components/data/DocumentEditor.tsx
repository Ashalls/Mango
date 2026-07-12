import { X, Copy, Check, Save, Undo2, Maximize2, Minimize2 } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { Button } from '@renderer/components/ui/button'
import { useTabStore } from '@renderer/store/tabStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { trpc } from '@renderer/lib/trpc'
import { parseShellDocument } from '@renderer/lib/shellJson'

export function DocumentEditor({
  expanded,
  onExpandedChange
}: {
  expanded: boolean
  onExpandedChange: (value: boolean) => void
}) {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { selectDocument, setEditorContent, clearDocument, executeQuery } = useTabStore()
  const effectiveTheme = useSettingsStore((s) => s.effectiveTheme)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // True once the typed shell source has loaded for the current document. While
  // false the editor is showing the lossy plain-JSON fallback, and saving would
  // write dates/ObjectIds as strings — so Save warns first.
  const [sourceLoaded, setSourceLoaded] = useState(false)
  // Top-level field names of the FULL typed source (not the possibly-projected
  // grid row), captured when the source loads — used to compute $unset so a
  // field the user deletes is actually removed, even under a projection.
  const originalKeysRef = useRef<string[]>([])
  // Bumped after a save/discard to re-pull the document's shell source (its _id
  // is unchanged, so this is what re-triggers the fetch effect below).
  const [refreshTick, setRefreshTick] = useState(0)

  // Upgrade the editor from the plain-JSON snapshot (set synchronously on row
  // click) to server-rendered shell source, so ObjectId/date fields show as
  // ObjectId("...") / ISODate("...") and round-trip with their real BSON type.
  // Falls back silently to the plain JSON already in the editor if the fetch
  // fails. Keyed on a stringified _id so an object _id doesn't loop the effect.
  const selectedId = tab?.selectedDocument?._id
  const selectedIdKey =
    selectedId === undefined || selectedId === null
      ? null
      : typeof selectedId === 'object'
        ? JSON.stringify(selectedId)
        : String(selectedId)
  const database = tab?.database
  const collection = tab?.collection
  useEffect(() => {
    if (selectedIdKey === null || !database || !collection) return
    let cancelled = false
    setSourceLoaded(false)
    trpc.query.documentSource
      .query({ connectionId: tab?.connectionId, database, collection, id: selectedId })
      .then((res) => {
        if (cancelled || !res?.source) return
        const s = useTabStore.getState()
        const live = s.tabs.find((t) => t.id === s.activeTabId)
        // Only replace if the user hasn't started editing this same document.
        const liveId = live?.selectedDocument?._id
        const liveKey =
          liveId === undefined || liveId === null
            ? null
            : typeof liveId === 'object'
              ? JSON.stringify(liveId)
              : String(liveId)
        // Only mark the source as loaded if we actually installed the typed
        // shell source. If the user started editing before the fetch resolved
        // (isDirty), the editor is still on the lossy JSON fallback, so leaving
        // sourceLoaded false keeps the Save warning armed.
        if (live && !live.isDirty && liveKey === selectedIdKey) {
          s.setEditorContentPristine(res.source)
          try {
            originalKeysRef.current = Object.keys(parseShellDocument(res.source) as Record<string, unknown>)
          } catch { originalKeysRef.current = [] }
          if (!cancelled) setSourceLoaded(true)
        }
      })
      .catch(() => { /* keep plain-JSON fallback; sourceLoaded stays false */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdKey, database, collection, refreshTick, tab?.id, tab?.connectionId])

  // Escape restores the docked editor when popped out. Content lives in the
  // tab store, so collapsing never loses edits.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExpandedChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, onExpandedChange])

  if (!tab?.selectedDocument) return null

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tab.editorContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDiscard = () => {
    // Restore a pristine view synchronously (plain JSON), then let the effect
    // upgrade it back to shell source.
    selectDocument(tab.selectedDocument)
    setError(null)
    setRefreshTick((t) => t + 1)
  }

  const handleSave = async () => {
    if (!tab) return
    // Refuse to save while the editor is on the lossy JSON fallback — writing it
    // would flatten dates/ObjectIds/Decimals to strings, violating the
    // lossless-write rule. Re-attempt the typed-source fetch instead of offering
    // a "save anyway" that corrupts types.
    if (!sourceLoaded) {
      setError("The document's typed source hasn't loaded yet, so saving could corrupt BSON types. Retrying — please try again in a moment.")
      setRefreshTick((t) => t + 1)
      return
    }
    setError(null)
    setSaving(true)
    try {
      // parseShellDocument accepts shell syntax (ObjectId(...), ISODate(...))
      // as well as plain JSON, emitting Extended-JSON markers the main process
      // revives into real BSON.
      const updated = parseShellDocument(tab.editorContent) as Record<string, unknown>
      const docId = tab.selectedDocument!._id
      if (docId === undefined || docId === null) { setError('Document has no _id field'); return }
      const { _id: _ignoredId, ...fields } = updated
      // $unset any top-level field that existed on the loaded typed source but
      // was removed in the editor — a plain $set leaves deleted fields in place,
      // so they'd silently reappear on the next refresh. Keyed off the full
      // source (originalKeysRef), not the possibly-projected grid row.
      const originalKeys = originalKeysRef.current.filter((k) => k !== '_id')
      const nextKeys = new Set(Object.keys(fields))
      const unset: Record<string, ''> = {}
      for (const k of originalKeys) if (!nextKeys.has(k)) unset[k] = ''
      const update: Record<string, unknown> = { $set: fields }
      if (Object.keys(unset).length > 0) update.$unset = unset
      const result = await trpc.mutation.updateOne.mutate({
        connectionId: tab.connectionId,
        database: tab.database,
        collection: tab.collection,
        filter: { _id: docId },
        update
      })
      // matchedCount 0 means nothing was written (deleted doc, or an _id whose
      // BSON type didn't match) — surface it instead of showing a false success.
      if (result.matchedCount === 0) {
        setError('No document matched this _id — nothing was saved. It may have been deleted, or its _id type does not match.')
        return
      }
      // Clear the dirty flag and re-pull the freshly-stored document as shell
      // source (the fetch effect re-renders the editor with canonical types).
      useTabStore.getState().updateTab(tab.id, { isDirty: false })
      setRefreshTick((t) => t + 1)
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
            onClick={() => onExpandedChange(!expanded)}
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
          defaultLanguage="javascript"
          value={tab.editorContent}
          onChange={(value) => setEditorContent(value ?? '')}
          theme={effectiveTheme === 'dark' ? 'vs-dark' : 'light'}
          beforeMount={(monaco) => {
            // The editor shows MongoDB shell syntax (ObjectId("..."),
            // ISODate("...")), which isn't valid JSON or plain JS — disable the
            // TS/JS validators so those don't render as spurious error squiggles.
            monaco.languages.typescript?.javascriptDefaults?.setDiagnosticsOptions({
              noSemanticValidation: true,
              noSyntaxValidation: true
            })
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            // Read-only until the typed shell source has loaded, so the user can
            // never edit (and then save) the lossy JSON fallback — this prevents
            // the edit-before-load race rather than trapping the save afterward.
            readOnly: !sourceLoaded,
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
