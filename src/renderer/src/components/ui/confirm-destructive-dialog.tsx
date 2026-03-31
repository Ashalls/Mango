import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

interface ConfirmDestructiveDialogProps {
  title: string
  description: string
  confirmText: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDestructiveDialog({
  title,
  description,
  confirmText,
  confirmLabel,
  onConfirm,
  onCancel
}: ConfirmDestructiveDialogProps) {
  const [input, setInput] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[420px] rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{description}</p>
        <div className="mb-4">
          <label className="mb-1 block text-sm text-muted-foreground">
            Type <span className="font-mono font-medium text-foreground">{confirmText}</span> to confirm
          </label>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={confirmText}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && input === confirmText) onConfirm()
              if (e.key === 'Escape') onCancel()
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={input !== confirmText}
            onClick={onConfirm}
          >
            {confirmLabel || title}
          </Button>
        </div>
      </div>
    </div>
  )
}
