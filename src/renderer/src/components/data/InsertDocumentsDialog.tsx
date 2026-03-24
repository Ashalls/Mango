import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { trpc } from '@renderer/lib/trpc'

interface InsertDocumentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  database: string
  collection: string
  onInserted: () => void
}

export function InsertDocumentsDialog({
  open,
  onOpenChange,
  database,
  collection,
  onInserted
}: InsertDocumentsDialogProps) {
  const [json, setJson] = useState('')
  const [inserting, setInserting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successCount, setSuccessCount] = useState<number | null>(null)

  const resetForm = () => {
    setJson('')
    setError(null)
    setSuccessCount(null)
  }

  const handleInsert = async () => {
    setError(null)
    setSuccessCount(null)

    let documents: Record<string, unknown>[]
    try {
      const parsed = JSON.parse(json)
      if (!Array.isArray(parsed)) {
        setError('JSON must be an array of documents')
        return
      }
      if (parsed.length === 0) {
        setError('Array must contain at least one document')
        return
      }
      documents = parsed
    } catch {
      setError('Invalid JSON. Please check your syntax.')
      return
    }

    setInserting(true)
    try {
      const result = await trpc.mutation.insertMany.mutate({
        database,
        collection,
        documents
      })
      setSuccessCount(result.insertedCount)
      onInserted()
      // Close after a brief moment so user sees the success message
      setTimeout(() => {
        onOpenChange(false)
      }, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Insert failed')
    } finally {
      setInserting(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) resetForm()
        onOpenChange(o)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">
              Insert Documents
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <p className="mb-2 text-sm text-muted-foreground">
            Paste a JSON array of documents to insert into{' '}
            <span className="font-mono text-foreground">
              {database}.{collection}
            </span>
          </p>

          <textarea
            className="h-64 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={`[{ "name": "Alice", "age": 30 }, { "name": "Bob", "age": 25 }]`}
            value={json}
            onChange={(e) => {
              setJson(e.target.value)
              setError(null)
              setSuccessCount(null)
            }}
            spellCheck={false}
          />

          {error && (
            <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {successCount !== null && (
            <div className="mt-3 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-400">
              Successfully inserted {successCount} document(s).
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline">Cancel</Button>
            </Dialog.Close>
            <Button
              onClick={handleInsert}
              disabled={!json.trim() || inserting}
            >
              {inserting ? 'Inserting...' : 'Insert'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
