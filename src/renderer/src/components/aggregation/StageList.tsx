import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { StageCard } from './StageCard'
import type { AggregationStage } from '@shared/types'

interface StageListProps {
  stages: AggregationStage[]
  selectedStageId: string | null
  onSelectStage: (id: string) => void
  onUpdateStages: (stages: AggregationStage[]) => void
}

export function StageList({
  stages,
  selectedStageId,
  onSelectStage,
  onUpdateStages
}: StageListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = stages.findIndex((s) => s.id === active.id)
    const newIndex = stages.findIndex((s) => s.id === over.id)
    const reordered = arrayMove(stages, oldIndex, newIndex).map((s, i) => ({
      ...s,
      order: i
    }))
    onUpdateStages(reordered)
  }

  const handleAdd = () => {
    const selectedIndex = stages.findIndex((s) => s.id === selectedStageId)
    const insertIndex = selectedIndex >= 0 ? selectedIndex + 1 : stages.length
    const newStage: AggregationStage = {
      id: crypto.randomUUID(),
      type: '$match',
      content: '{}',
      enabled: true,
      order: insertIndex
    }
    const updated = [...stages]
    updated.splice(insertIndex, 0, newStage)
    onUpdateStages(updated.map((s, i) => ({ ...s, order: i })))
    onSelectStage(newStage.id)
  }

  const handleToggle = (id: string) => {
    onUpdateStages(
      stages.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    )
  }

  const handleDelete = (id: string) => {
    const updated = stages.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i }))
    onUpdateStages(updated)
    if (selectedStageId === id) {
      onSelectStage(updated.length > 0 ? updated[0].id : '')
    }
  }

  const handleChangeType = (id: string, type: string) => {
    onUpdateStages(stages.map((s) => (s.id === id ? { ...s, type } : s)))
  }

  return (
    <div className="flex w-56 flex-col border-r border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-foreground">Pipeline Stages</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleAdd}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {stages.map((stage) => (
              <StageCard
                key={stage.id}
                stage={stage}
                isSelected={stage.id === selectedStageId}
                onSelect={() => onSelectStage(stage.id)}
                onToggle={() => handleToggle(stage.id)}
                onDelete={() => handleDelete(stage.id)}
                onChangeType={(type) => handleChangeType(stage.id, type)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {stages.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-xs text-muted-foreground">
            <p>No stages yet</p>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAdd}>
              <Plus className="mr-1 h-3 w-3" />
              Add Stage
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
