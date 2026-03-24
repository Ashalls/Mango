import { useState, useEffect, useRef } from 'react'
import { Button } from './button'
import { Input } from './input'

interface InputDialogProps {
  title: string
  fields: { key: string; label: string; placeholder?: string; defaultValue?: string }[]
  onSubmit: (values: Record<string, string>) => void
  onCancel: () => void
  submitLabel?: string
}

export function InputDialog({ title, fields, onSubmit, onCancel, submitLabel = 'Create' }: InputDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of fields) init[f.key] = f.defaultValue || ''
    return init
  })
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    const allFilled = fields.every((f) => values[f.key]?.trim())
    if (allFilled) onSubmit(values)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <div className="space-y-3">
          {fields.map((field, i) => (
            <div key={field.key}>
              <label className="mb-1 block text-sm text-muted-foreground">{field.label}</label>
              <Input
                ref={i === 0 ? firstRef : undefined}
                placeholder={field.placeholder}
                value={values[field.key]}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit()
                  if (e.key === 'Escape') onCancel()
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!fields.every((f) => values[f.key]?.trim())}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
