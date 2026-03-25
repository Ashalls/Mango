import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Plus, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { trpc } from '@renderer/lib/trpc'

interface FieldRow {
  name: string
  direction: string
}

export interface EditIndexInfo {
  name: string
  key: Record<string, number | string>
  unique?: boolean
  sparse?: boolean
  expireAfterSeconds?: number
}

interface CreateIndexDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  database: string
  collection: string
  onCreated: () => void
  /** If provided, dialog opens in edit mode — pre-filled, drops old index on save */
  editIndex?: EditIndexInfo
}

export function CreateIndexDialog({
  open,
  onOpenChange,
  database,
  collection,
  onCreated,
  editIndex
}: CreateIndexDialogProps) {
  const isEdit = !!editIndex
  const [fields, setFields] = useState<FieldRow[]>([{ name: '', direction: '1' }])
  const [unique, setUnique] = useState(false)
  const [sparse, setSparse] = useState(false)
  const [ttl, setTtl] = useState('')
  const [customName, setCustomName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-fill when editing
  useEffect(() => {
    if (editIndex && open) {
      setFields(
        Object.entries(editIndex.key).map(([name, dir]) => ({
          name,
          direction: String(dir)
        }))
      )
      setUnique(editIndex.unique || false)
      setSparse(editIndex.sparse || false)
      setTtl(editIndex.expireAfterSeconds !== undefined ? String(editIndex.expireAfterSeconds) : '')
      setCustomName(editIndex.name === '_id_' ? '' : editIndex.name)
    }
  }, [editIndex, open])

  const addField = () => {
    setFields([...fields, { name: '', direction: '1' }])
  }

  const removeField = (index: number) => {
    if (fields.length <= 1) return
    setFields(fields.filter((_, i) => i !== index))
  }

  const updateField = (index: number, updates: Partial<FieldRow>) => {
    setFields(fields.map((f, i) => (i === index ? { ...f, ...updates } : f)))
  }

  const resetForm = () => {
    setFields([{ name: '', direction: '1' }])
    setUnique(false)
    setSparse(false)
    setTtl('')
    setCustomName('')
    setError(null)
  }

  const handleCreate = async () => {
    const validFields = fields.filter((f) => f.name.trim())
    if (validFields.length === 0) return

    setCreating(true)
    setError(null)
    try {
      const fieldsObj: Record<string, number | string> = {}
      for (const f of validFields) {
        const dir = f.direction
        fieldsObj[f.name.trim()] = dir === 'text' || dir === '2dsphere' ? dir : Number(dir)
      }

      const options: {
        unique?: boolean
        sparse?: boolean
        expireAfterSeconds?: number
        name?: string
      } = {}
      if (unique) options.unique = true
      if (sparse) options.sparse = true
      if (ttl.trim() && Number(ttl) > 0) options.expireAfterSeconds = Number(ttl)
      if (customName.trim()) options.name = customName.trim()

      // In edit mode, drop the old index first
      if (isEdit && editIndex) {
        try {
          await trpc.admin.dropIndex.mutate({ database, collection, indexName: editIndex.name })
        } catch {
          // Old index may already be gone
        }
      }

      await trpc.admin.createIndex.mutate({ database, collection, fields: fieldsObj, options })
      resetForm()
      onCreated()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create index')
    } finally {
      setCreating(false)
    }
  }

  const canCreate = fields.some((f) => f.name.trim())

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">{isEdit ? 'Edit Index' : 'Create Index'}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            {/* Index fields */}
            <div>
              <label className="mb-2 block text-sm font-medium">Fields</label>
              <div className="space-y-2">
                {fields.map((field, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="Field name"
                      value={field.name}
                      onChange={(e) => updateField(i, { name: e.target.value })}
                      className="flex-1"
                      autoFocus={i === 0}
                    />
                    <select
                      value={field.direction}
                      onChange={(e) => updateField(i, { direction: e.target.value })}
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="1">1 (Asc)</option>
                      <option value="-1">-1 (Desc)</option>
                      <option value="text">text</option>
                      <option value="2dsphere">2dsphere</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => removeField(i)}
                      disabled={fields.length <= 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-xs text-muted-foreground"
                onClick={addField}
              >
                <Plus className="mr-1 h-3 w-3" /> Add field
              </Button>
            </div>

            {/* Options */}
            <div>
              <label className="mb-2 block text-sm font-medium">Options</label>
              <div className="space-y-3 rounded-md border border-border p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={unique}
                    onChange={(e) => setUnique(e.target.checked)}
                    className="rounded border-input"
                  />
                  Unique
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sparse}
                    onChange={(e) => setSparse(e.target.checked)}
                    className="rounded border-input"
                  />
                  Sparse
                </label>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">
                    TTL (expireAfterSeconds)
                  </label>
                  <Input
                    type="number"
                    placeholder="e.g. 3600"
                    value={ttl}
                    onChange={(e) => setTtl(e.target.value)}
                    min={0}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">Custom name</label>
                  <Input
                    placeholder="Optional index name"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline">Cancel</Button>
            </Dialog.Close>
            <Button onClick={handleCreate} disabled={!canCreate || creating}>
              {creating ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Index' : 'Create Index')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
