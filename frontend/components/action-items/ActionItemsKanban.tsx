'use client'

import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  ACTION_ITEM_STATUS_META,
  ACTION_ITEM_STATUS_ORDER,
  KANBAN_VISIBLE_LIMIT,
} from '@/lib/action-items'
import { cn } from '@/lib/utils'
import type { ActionItem, ActionItemStatus, DashboardActionItem } from '@/types'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import ActionItemCard from './ActionItemCard'

function KanbanColumnDropzone({
  status,
  count,
  collapsed,
  onToggleCollapse,
  children,
}: {
  status: ActionItemStatus
  count: number
  collapsed: boolean
  onToggleCollapse: () => void
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const meta = ACTION_ITEM_STATUS_META[status]
  const Icon = meta.Icon

  return (
    <div
      ref={setNodeRef}
      data-testid={`kanban-column-${status}`}
      className={cn(
        'flex flex-col rounded-2xl border bg-muted/30 p-3 transition-colors',
        isOver && 'border-primary/70 bg-primary/5 ring-2 ring-primary/15',
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Развернуть колонку ${meta.label}` : `Свернуть колонку ${meta.label}`}
          className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-primary"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <Icon className={cn('h-4 w-4 shrink-0', meta.colorClass)} />
          <span className="truncate">{meta.label}</span>
        </button>
        <Badge variant="secondary" className="tabular-nums">
          {count}
        </Badge>
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-xl border border-dashed border-border/80 bg-background/50 px-3 py-4 text-center text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          Колонка свёрнута ({count}) — нажмите, чтобы развернуть
        </button>
      ) : (
        children
      )}
    </div>
  )
}

function KanbanDraggableCard({
  item,
  selectable,
  selected,
  compact,
  onStatusChange,
  onSaveTitle,
  onSaveText,
  onSaveAssignee,
  onDelete,
  onExternalLinkUpdated,
  onNavigateBoard,
  onToggleSelect,
}: {
  item: DashboardActionItem
  selectable?: boolean
  selected?: boolean
  compact?: boolean
  onStatusChange: (item: DashboardActionItem, nextStatus: ActionItemStatus) => void
  onSaveTitle?: (id: string, title: string) => Promise<void> | void
  onSaveText?: (id: string, text: string) => Promise<void> | void
  onSaveAssignee?: (id: string, assignee: string | null) => Promise<void> | void
  onDelete?: (item: DashboardActionItem) => void
  onExternalLinkUpdated?: (updated: ActionItem) => void
  onNavigateBoard?: (boardId: string) => void
  onToggleSelect?: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { status: item.status },
  })

  return (
    <ActionItemCard
      item={item}
      kanbanMode
      dragNodeRef={setNodeRef}
      dragActivatorRef={setActivatorNodeRef}
      dragAttributes={attributes}
      dragListeners={listeners}
      isDragging={isDragging}
      compact={compact}
      selectable={selectable}
      selected={selected}
      onToggleSelect={onToggleSelect}
      onStatusChange={onStatusChange}
      onSaveTitle={onSaveTitle}
      onSaveText={onSaveText}
      onSaveAssignee={onSaveAssignee}
      onDelete={onDelete}
      onExternalLinkUpdated={onExternalLinkUpdated}
      onNavigateBoard={onNavigateBoard}
    />
  )
}

export interface ActionItemsKanbanProps {
  items: DashboardActionItem[]
  onStatusChange: (item: DashboardActionItem, nextStatus: ActionItemStatus) => void
  onSaveTitle?: (id: string, title: string) => Promise<void> | void
  onSaveText?: (id: string, text: string) => Promise<void> | void
  onSaveAssignee?: (id: string, assignee: string | null) => Promise<void> | void
  onDelete?: (item: DashboardActionItem) => void
  onExternalLinkUpdated?: (updated: ActionItem) => void
  onNavigateBoard?: (boardId: string) => void
  selectable?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  compact?: boolean
  /** Начать колонку «Выполнено» сразу свёрнутой (удобно для компактного обзора перед созданием доски). */
  defaultDoneCollapsed?: boolean
  emptyHint?: string
}

/**
 * Переиспользуемый 3-колоночный канбан задач («Открыто» / «В работе» / «Выполнено»)
 * с drag-and-drop, сворачиванием колонок и опциональным выбором задач для переноса.
 */
export default function ActionItemsKanban({
  items,
  onStatusChange,
  onSaveTitle,
  onSaveText,
  onSaveAssignee,
  onDelete,
  onExternalLinkUpdated,
  onNavigateBoard,
  selectable = false,
  selectedIds,
  onToggleSelect,
  compact = false,
  defaultDoneCollapsed = false,
  emptyHint = 'Перетащите задачу сюда',
}: ActionItemsKanbanProps) {
  const [collapsedCols, setCollapsedCols] = useState<Record<ActionItemStatus, boolean>>({
    open: false,
    in_progress: false,
    done: defaultDoneCollapsed,
  })
  const [expandedCols, setExpandedCols] = useState<Record<ActionItemStatus, boolean>>({
    open: false,
    in_progress: false,
    done: false,
  })
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const activeDragItem = useMemo(
    () => (activeDragId ? items.find((i) => i.id === activeDragId) ?? null : null),
    [activeDragId, items],
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null)
    if (!event.over) return
    const targetStatus = String(event.over.id) as ActionItemStatus
    if (targetStatus !== 'open' && targetStatus !== 'in_progress' && targetStatus !== 'done') {
      return
    }
    const dragged = items.find((i) => i.id === String(event.active.id))
    if (dragged && dragged.status !== targetStatus) {
      onStatusChange(dragged, targetStatus)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDragId(null)}
    >
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {ACTION_ITEM_STATUS_ORDER.map((st) => {
          const colItems = items.filter((i) => i.status === st)
          const isCollapsed = collapsedCols[st]
          const isExpanded = expandedCols[st]
          const visibleItems = isExpanded ? colItems : colItems.slice(0, KANBAN_VISIBLE_LIMIT)
          const hiddenCount = colItems.length - visibleItems.length

          return (
            <KanbanColumnDropzone
              key={st}
              status={st}
              count={colItems.length}
              collapsed={isCollapsed}
              onToggleCollapse={() =>
                setCollapsedCols((prev) => ({ ...prev, [st]: !prev[st] }))
              }
            >
              <div className="space-y-2.5">
                {colItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed py-8 text-center text-xs text-muted-foreground">
                    {emptyHint}
                  </div>
                ) : (
                  <>
                    {visibleItems.map((it) => (
                      <KanbanDraggableCard
                        key={it.id}
                        item={it}
                        compact={compact}
                        selectable={selectable}
                        selected={selectedIds?.has(it.id) ?? false}
                        onToggleSelect={onToggleSelect}
                        onStatusChange={onStatusChange}
                        onSaveTitle={onSaveTitle}
                        onSaveText={onSaveText}
                        onSaveAssignee={onSaveAssignee}
                        onDelete={onDelete}
                        onExternalLinkUpdated={onExternalLinkUpdated}
                        onNavigateBoard={onNavigateBoard}
                      />
                    ))}
                    {(hiddenCount > 0 || (isExpanded && colItems.length > KANBAN_VISIBLE_LIMIT)) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-full text-xs text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          setExpandedCols((prev) => ({
                            ...prev,
                            [st]: !prev[st],
                          }))
                        }
                      >
                        {isExpanded ? 'Свернуть список' : `Показать ещё ${hiddenCount}`}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </KanbanColumnDropzone>
          )
        })}
      </div>

      <DragOverlay>
        {activeDragItem ? (
          <ActionItemCard
            item={activeDragItem}
            kanbanMode
            compact={compact}
            isOverlay
            selectable={selectable}
            selected={selectedIds?.has(activeDragItem.id) ?? false}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
