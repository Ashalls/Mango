import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'
import type { AggregationStage } from '@shared/types'

export const STAGE_TYPES = [
  '$match',
  '$group',
  '$project',
  '$sort',
  '$limit',
  '$skip',
  '$unwind',
  '$lookup',
  '$addFields',
  '$replaceRoot',
  '$out',
  '$merge',
  '$count',
  '$set',
  '$unset',
  '$sample',
  '$bucket',
  '$bucketAuto',
  '$facet',
  '$graphLookup',
  '$redact',
  '$replaceWith',
  '$sortByCount',
  '$unionWith'
]

interface StageCardProps {
  stage: AggregationStage
  isSelected: boolean
  onSelect: () => void
  onToggle: () => void
  onDelete: () => void
  onChangeType: (type: string) => void
}

export function StageCard({
  stage,
  isSelected,
  onSelect,
  onToggle,
  onDelete,
  onChangeType
}: StageCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: stage.id
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: stage.enabled ? 1 : 0.4
  }

  const summary = stage.content.length > 40 ? stage.content.slice(0, 40) + '...' : stage.content

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 rounded border px-1.5 py-1 text-xs cursor-pointer ${
        isSelected
          ? 'border-emerald-500 bg-emerald-500/10'
          : 'border-border bg-card hover:border-muted-foreground/40'
      }`}
      onClick={onSelect}
    >
      <button
        className="cursor-grab text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <input
        type="checkbox"
        checked={stage.enabled}
        onChange={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        onClick={(e) => e.stopPropagation()}
        className="h-3 w-3 accent-emerald-500"
      />

      <select
        className="h-5 w-[90px] truncate rounded border-none bg-transparent text-[11px] font-medium text-foreground focus:outline-none"
        value={stage.type}
        onChange={(e) => {
          e.stopPropagation()
          onChangeType(e.target.value)
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {STAGE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <span className="flex-1 truncate text-[10px] text-muted-foreground">{summary}</span>

      <button
        className="text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}
