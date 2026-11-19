'use client'

import { useState } from 'react'
import type { useDraggable } from '@dnd-kit/core'
import { ExternalLink, Focus, GripVertical, Trash2 } from 'lucide-react'
import { ACTION_ITEM_NEXT_STATUS, ACTION_ITEM_STATUS_META } from '@/lib/action-items'
import { getUserAvatarGradient, getUserInitials } from '@/lib/board-themes'
import { cn } from '@/lib/utils'
import type { ActionItem, ActionItemStatus, DashboardActionItem } from '@/types'
import ActionItemExternalLink from '../ActionItemExternalLink'
import { RichCardText } from '../RichCardText'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'

export interface ActionItemCardProps {
  item: DashboardActionItem
  kanbanMode?: boolean
  dragNodeRef?: (el: HTMLElement | null) => void
  dragActivatorRef?: (el: HTMLElement | null) => void
  dragAttributes?: ReturnType<typeof useDraggable>['attributes']
  dragListeners?: ReturnType<typeof useDraggable>['listeners']
  isDragging?: boolean
  isOverlay?: boolean
  onStatusChange?: (item: DashboardActionItem, nextStatus: ActionItemStatus) => void
  onSaveTitle?: (id: string, title: string) => Promise<void> | void
  onSaveText?: (id: string, text: string) => Promise<void> | void
  onSaveAssignee?: (id: string, assignee: string | null) => Promise<void> | void
  onDelete?: (item: DashboardActionItem) => void
  onExternalLinkUpdated?: (updated: ActionItem) => void
  onNavigateBoard?: (boardId: string) => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  compact?: boolean
}

/**
 * Карточка задачи команды для списка и 3-колоночного канбана (Dashboard и CreateBoardDialog).
 */
export default function ActionItemCard({
  item,
  kanbanMode = false,
  dragNodeRef,
  dragActivatorRef,
  dragAttributes,
  dragListeners,
  isDragging = false,
  isOverlay = false,
  onStatusChange,
  onSaveTitle,
  onSaveText,
  onSaveAssignee,
  onDelete,
  onExternalLinkUpdated,
  onNavigateBoard,
  selectable = false,
  selected = false,
  onToggleSelect,
  compact = false,
}: ActionItemCardProps) {
  const [editingField, setEditingField] = useState<'title' | 'text' | 'assignee' | null>(null)
  const [draft, setDraft] = useState('')

  const meta = ACTION_ITEM_STATUS_META[item.status]
  const nextMeta = ACTION_ITEM_STATUS_META[ACTION_ITEM_NEXT_STATUS[item.status]]
  const StatusIcon = meta.Icon
  const isDone = item.status === 'done'
  const isEditing = editingField !== null
  const editable = Boolean(onSaveTitle || onSaveText || onSaveAssignee)
  const titleText = item.title || item.text
  const hasSeparateDescription = Boolean(item.text && item.text !== item.title)

  const commitTitle = () => {
    const trimmed = draft.trim()
    setEditingField(null)
    if (trimmed && onSaveTitle) {
      void onSaveTitle(item.id, trimmed)
    }
  }

  const commitText = () => {
    const trimmed = draft.trim()
    setEditingField(null)
    if (trimmed && onSaveText) {
      void onSaveText(item.id, trimmed)
    }
  }

  const commitAssignee = () => {
    const trimmed = draft.trim()
    setEditingField(null)
    const nextAssignee = trimmed || null
    if (onSaveAssignee && nextAssignee !== (item.assignee || null)) {
      void onSaveAssignee(item.id, nextAssignee)
    }
  }

  const stopPointerDown = (e: React.PointerEvent) => e.stopPropagation()

  const sourceCount = item.source_card_ids?.length ?? 0

  return (
    <div
      ref={dragNodeRef}
      data-testid={`action-item-card-${item.id}`}
      className={cn(
        'group rounded-xl border bg-card shadow-xs transition-all hover:shadow-md',
        compact ? 'p-2.5' : 'p-3.5',
        isDone && 'opacity-75',
        isDragging && 'opacity-35 ring-1 ring-primary/40',
        isOverlay && 'rotate-1 scale-[1.02] border-primary/40 opacity-95 shadow-2xl',
      )}
    >
      <div className="flex items-start gap-2">
        {kanbanMode &&
          (isOverlay || !dragActivatorRef || isEditing ? (
            <span
              data-testid={`kanban-drag-handle-${item.id}`}
              aria-hidden="true"
              className="mt-0.5 flex h-5 w-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/55"
            >
              <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          ) : (
            <button
              type="button"
              ref={dragActivatorRef}
              {...dragAttributes}
              {...dragListeners}
              data-testid={`kanban-drag-handle-${item.id}`}
              aria-label="Перетащить задачу в другую колонку"
              title="Перетащить задачу в другую колонку (с клавиатуры: пробел — взять, стрелки — двигать)"
              className="mt-0.5 flex h-5 w-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/55 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary group-hover:text-muted-foreground active:cursor-grabbing dark:hover:bg-white/15"
            >
              <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ))}

        {selectable && !isOverlay && (
          <div className="mt-0.5 shrink-0" onPointerDown={stopPointerDown}>
            <Checkbox
              checked={selected}
              disabled={isDone}
              onCheckedChange={() => onToggleSelect?.(item.id)}
              aria-label={`Перенести на новую доску: ${titleText}`}
              title={isDone ? 'Выполненные задачи не переносятся' : 'Перенести на новую доску'}
              data-testid={`carry-select-${item.id}`}
            />
          </div>
        )}

        <button
          type="button"
          onPointerDown={stopPointerDown}
          disabled={!onStatusChange}
          onClick={() => onStatusChange?.(item, ACTION_ITEM_NEXT_STATUS[item.status])}
          title={`${meta.label} → ${nextMeta.label}`}
          className={cn('mt-0.5 shrink-0 transition-transform hover:scale-110', meta.colorClass)}
        >
          <StatusIcon className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1 space-y-1">
          {editingField === 'title' ? (
            <Input
              value={draft}
              onPointerDown={stopPointerDown}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle()
                if (e.key === 'Escape') setEditingField(null)
              }}
              autoFocus
              className="h-7 text-xs font-semibold"
            />
          ) : (
            <div
              onDoubleClick={
                onSaveTitle
                  ? () => {
                      setEditingField('title')
                      setDraft(titleText)
                    }
                  : undefined
              }
              title={onSaveTitle ? 'Двойной клик — редактировать' : undefined}
              className={cn(
                compact ? 'text-xs font-semibold leading-snug' : 'text-sm font-semibold leading-snug',
                editable && 'cursor-text',
                isDone && 'line-through',
              )}
            >
              <RichCardText text={titleText} />
            </div>
          )}

          {editingField === 'text' ? (
            <Textarea
              autoResize
              value={draft}
              onPointerDown={stopPointerDown}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) commitText()
                if (e.key === 'Escape') setEditingField(null)
              }}
              autoFocus
              className="min-h-[54px] text-xs"
            />
          ) : (!compact || hasSeparateDescription) && item.text ? (
            <p
              onDoubleClick={
                onSaveText
                  ? () => {
                      setEditingField('text')
                      setDraft(item.text)
                    }
                  : undefined
              }
              title={onSaveText ? 'Двойной клик — редактировать описание' : undefined}
              className={cn(
                'whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground',
                compact && 'line-clamp-2',
                onSaveText && 'cursor-text',
              )}
            >
              <RichCardText text={item.text} />
            </p>
          ) : null}
        </div>

        {onDelete && !isOverlay && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onPointerDown={stopPointerDown}
            className="h-7 w-7 text-muted-foreground opacity-80 transition-opacity hover:text-destructive focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            onClick={() => onDelete(item)}
            aria-label="Удалить задачу"
            title="Удалить"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 border-t text-xs',
          compact ? 'mt-2 pt-2' : 'mt-3 pt-2.5',
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {editingField === 'assignee' ? (
            <Input
              value={draft}
              onPointerDown={stopPointerDown}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitAssignee}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitAssignee()
                if (e.key === 'Escape') setEditingField(null)
              }}
              placeholder="Ответственный"
              autoFocus
              className="h-6 w-36 text-xs"
            />
          ) : onSaveAssignee ? (
            <button
              type="button"
              onPointerDown={stopPointerDown}
              onClick={() => {
                setEditingField('assignee')
                setDraft(item.assignee || '')
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] hover:bg-accent"
            >
              {item.assignee ? (
                <>
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full bg-linear-to-br/srgb text-[8px] font-bold text-white ${getUserAvatarGradient(item.assignee)}`}
                  >
                    {getUserInitials(item.assignee)}
                  </span>
                  <span>{item.assignee}</span>
                </>
              ) : (
                <span className="text-muted-foreground">+ Назначить</span>
              )}
            </button>
          ) : item.assignee ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px]">
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full bg-linear-to-br/srgb text-[8px] font-bold text-white ${getUserAvatarGradient(item.assignee)}`}
              >
                {getUserInitials(item.assignee)}
              </span>
              <span>{item.assignee}</span>
            </span>
          ) : null}

          {onNavigateBoard ? (
            <button
              type="button"
              onPointerDown={stopPointerDown}
              onClick={() => onNavigateBoard(item.board_id)}
              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              <span className="max-w-[140px] truncate">{item.board_name}</span>
            </button>
          ) : (
            <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <span className="max-w-[140px] truncate">{item.board_name}</span>
            </span>
          )}

          {onExternalLinkUpdated && (
            <ActionItemExternalLink
              item={item}
              editDisabled={Boolean(item.superseded_by_id)}
              disabledReason="Задача перенесена на другую доску — изменения доступны в копии"
              stopPointerDown
              onUpdated={onExternalLinkUpdated}
            />
          )}

          {sourceCount > 0 && (
            <span
              data-testid={`action-item-source-cards-chip-${item.id}`}
              title={`Связано с исходными карточками (${sourceCount})`}
              className="inline-flex items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              <Focus className="h-2.5 w-2.5 text-primary" />
              {sourceCount} карт.
            </span>
          )}
        </div>

        {kanbanMode && onStatusChange && !isOverlay && (
          <div className="flex items-center gap-1" onPointerDown={stopPointerDown}>
            {item.status !== 'open' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => onStatusChange(item, 'open')}
              >
                Открыть
              </Button>
            )}
            {item.status !== 'in_progress' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => onStatusChange(item, 'in_progress')}
              >
                В работу
              </Button>
            )}
            {item.status !== 'done' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-emerald-700 dark:text-emerald-400"
                onClick={() => onStatusChange(item, 'done')}
              >
                Готово
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
