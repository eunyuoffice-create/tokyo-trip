// 카드를 길게(0.35초) 눌러 끌어서 순서 바꾸기. 짧게 누르거나 바로 움직이면 평소대로(펼치기·스크롤).
import { DndContext, MouseSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'

export function SortableList({ ids, onReorder, children }: { ids: string[]; onReorder: (ids: string[]) => void; children: ReactNode }) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 350, tolerance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function end(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id))
    if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to))
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => { try { navigator.vibrate?.(12) } catch { /* */ } }} onDragEnd={end}>
    <SortableContext items={ids} strategy={rectSortingStrategy}>{children}</SortableContext>
  </DndContext>
}

export function SortableItem({ id, disabled, className, children }: { id: string; disabled?: boolean; className?: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  return <div ref={setNodeRef} className={(className || '') + (isDragging ? ' dragging' : '') + (disabled ? '' : ' sortable')}
    style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners} tabIndex={-1}>
    {children}
  </div>
}
