import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Search } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { trpc } from '@renderer/lib/trpc'

interface UpdateManyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  database: string
  collection: string
  currentFilter: Record<string, unknown>
  onUpdated: () => void
}

export function UpdateManyDialog({
  open,
  onOpenChange,
  database,
  collection,
  currentFilter,
  onUpdated
}: UpdateManyDialogProps) {
  const [filterJson, setFilterJson] = useState('')
  const [updateJson, setUpdateJson] = useState('')
  const [updating, setUpdating] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [successCount, setSuccessCount] = useState<number | null>(null)

  const resetForm = () => {
    setFilterJson('')
    setUpdateJson('')
    setError(null)
    setPreviewCount(null)
    setSuccessCount(null)
  }

  // Initialize filter when dialog opens
  const handleOpenChange = (o: boolean) => {
    if (o) {
      const filterStr =
        Object.keys(currentFilter).length > 0
          ? JSON.stringify(currentFilter, null, 2)
          : '{}'
      setFilterJson(filterStr)
      setUpdateJson('')
      setError(null)
      setPreviewCount(null)
      setSuccessCount(null)
    } else {
      resetForm()
    }
    onOpenChange(o)
  }

  const parseFilter = (): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(filterJson || '{}')
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError('Filter must be a JSON object')
        return null
      }
      return parsed
    } catch {
      setError('Invalid filter JSON')
      return null
    }
  }

  const parseUpdate = (): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(updateJson)
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError('Update expression must be a JSON object')
        return null
      }
      return parsed
    } catch {
      setError('Invalid update expression JSON')
      return null
    }
  }

  const handlePreview = async () => {
    setError(null)
    setPreviewCount(null)

    const filter = parseFilter()
    if (!filter) return

    setPreviewing(true)
    try {
      const count = await trpc.query.count.query({ database, collection, filter })
      setPreviewCount(count)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  const handleUpdate = async () => {
    setError(null)
    setSuccessCount(null)

    const filter = parseFilter()
    if (!filter) return

    const update = parseUpdate()
    if (!update) return

    setUpdating(true)
    try {
      const result = await trpc.mutation.updateMany.mutate({
        database,
        collection,
        filter,
        update
      })
      setSuccessCount(result.modifiedCount)
      onUpdated()
      setTimeout(() => {
        onOpenChange(false)
      }, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">
              Update Many Documents
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <p className="mb-3 text-sm text-muted-foreground">
            Bulk update documents in{' '}
            <span className="font-mono text-foreground">
              {database}.{collection}
            </span>
          </p>

          <div className="space-y-4">
            {/* Filter */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-sm font-medium">Filter</label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-muted-foreground"
                  onClick={handlePreview}
                  disabled={previewing}
                >
                  <Search className="mr-1 h-3 w-3" />
                  {previewing ? 'Counting...' : 'Preview'}
                </Button>
              </div>
              <textarea
                className="h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="{}"
                value={filterJson}
                onChange={(e) => {
                  setFilterJson(e.target.value)
                  setError(null)
                  setPreviewCount(null)
                  setSuccessCount(null)
                }}
                spellCheck={false}
              />
              {previewCount !== null && (
                <p className="mt-1 text-xs text-blue-400">
                  {previewCount} document(s) match this filter
                </p>
              )}
            </div>

            {/* Update expression */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Update Expression
              </label>
              <textarea
                className="h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={`{ "$set": { "status": "archived" } }`}
                value={updateJson}
                onChange={(e) => {
                  setUpdateJson(e.target.value)
                  setError(null)
                  setSuccessCount(null)
                }}
                spellCheck={false}
              />
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {successCount !== null && (
            <div className="mt-3 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-400">
              Successfully updated {successCount} document(s).
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline">Cancel</Button>
            </Dialog.Close>
            <Button
              onClick={handleUpdate}
              disabled={!updateJson.trim() || updating}
            >
              {updating ? 'Updating...' : 'Update'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
