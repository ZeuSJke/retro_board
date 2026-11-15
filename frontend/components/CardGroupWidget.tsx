'use client'

import { memo, useCallback, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  ChevronDown,
  GripVertical,
  Layers,
  Pencil,
  ThumbsUp,
  Unlink,
  X,
} from 'lucide-react'
import { deleteGroup, removeCardFromGroup, updateGroup } from '../api'
import { sameExceptVoteCount } from '@/lib/memo'
import { showToast } from '../store/toastStore'
import { getApiErrorMessage } from '../utils/apiError'
import type { Card, CardGroup } from '../types'
import CardWidget from './CardWidget'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface CardGroupWidgetProps {
  group: CardGroup
  cards: Card[]
  collapsed: boolean
  onToggleCollapse: (groupId: string) => void
  /** Идентификатор текущего участника. */
  currentUserId: string
  isModerator?: boolean
  voterNames?: Record<string, string>
  maxVotes: number
  userTotalVotes: number
  onUpdated: (group: CardGroup) => void
  onDeleted: (groupId: string) => void
  /** Сервер группу не расформировал: вернуть её вместе с карточками. */
  onRestored?: (group: CardGroup, cardIds: string[], error?: unknown) => void
  onCardUpdated: (card: Card) => void
  onCardPatched?: (cardId: string, patch: (card: Card) => Card) => void
  onCardDeleted: (cardId: string) => void
  onCardRestored?: (card: Card, error?: unknown) => void
  onCardRejected?: (error: unknown) => void
  groupTargetId: string | null
  dragDisabled?: boolean
  /** Почему перетаскивание отключено — подсказка на ручке. */
  dragDisabledReason?: string | null
  anonymous?: boolean
  readOnly?: boolean
  spotlightCardId?: string | null
  newCardIds?: Set<string>
  revealedCardIds?: Set<string>
  revealDelayMap?: Record<string, number>
  onSpotlight?: (cardId: string) => void
  onCreateActionItem?: (card: Card) => void
  allowMultipleVotes?: boolean
  selectedCardIds?: Set<string>
  onToggleSelectCard?: (cardId: string, shiftKey?: boolean) => void
  otherColumns?: { id: string; title: string; color: string }[]
  onCardMoved?: (card: Card, targetColumnId: string) => void
}

const DRAG_DISABLED_FALLBACK = 'Перетаскивание сейчас отключено'

function CardGroupWidget({
  group,
  cards,
  collapsed,
  onToggleCollapse,
  currentUserId,
  isModerator = false,
  voterNames,
  maxVotes,
  userTotalVotes,
  onUpdated,
  onDeleted,
  onRestored,
  onCardUpdated,
  onCardPatched,
  onCardDeleted,
  onCardRestored,
  onCardRejected,
  groupTargetId,
  dragDisabled = false,
  dragDisabledReason = null,
  anonymous = false,
  readOnly = false,
  spotlightCardId = null,
  newCardIds,
  revealedCardIds,
  revealDelayMap,
  onSpotlight,
  onCreateActionItem,
  allowMultipleVotes = false,
  selectedCardIds,
  onToggleSelectCard,
  otherColumns,
  onCardMoved,
}: CardGroupWidgetProps) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(group.title)
  const [dissolveOpen, setDissolveOpen] = useState(false)

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({
      id: `group-${group.id}`,
      data: { type: 'group', group },
      disabled: editingTitle || dragDisabled || readOnly,
    })
  // Указателем группу тащат за шапку, с клавиатуры — за ручку (у шапки нет роли кнопки:
  // внутри неё свои кнопки)
  const { onKeyDown: keyboardDragListener, ...pointerDragListeners } = (listeners ?? {}) as {
    onKeyDown?: React.KeyboardEventHandler<HTMLElement>
  } & Record<string, unknown>

  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {}

  const totalLikes = cards.reduce((sum, c) => sum + (c.likes?.length || 0), 0)

  const saveTitle = async () => {
    setEditingTitle(false)
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === group.title) return
    onUpdated({ ...group, title: trimmed })
    try {
      const updated = await updateGroup(group.id, { title: trimmed })
      onUpdated(updated)
    } catch (err) {
      onUpdated(group)
      showToast(getApiErrorMessage(err, 'Не удалось переименовать группу'), 'error')
    }
  }

  const handleDissolve = async () => {
    setDissolveOpen(false)
    const removed = group
    const memberIds = cards.map((card) => card.id)
    onDeleted(group.id)
    try {
      await deleteGroup(group.id)
    } catch (err) {
      // Сервер группу не расформировал: возвращаем её вместе с карточками
      onRestored?.(removed, memberIds, err)
      showToast(getApiErrorMessage(err, 'Не удалось расформировать группу'), 'error')
    }
  }

  const groupId = group.id
  const handleRemoveCard = useCallback(
    async (card: Card) => {
      try {
        const updated = await removeCardFromGroup(groupId, card.id)
        onCardUpdated(updated)
      } catch (err) {
        showToast(getApiErrorMessage(err, 'Не удалось убрать карточку из группы'), 'error')
      }
    },
    [groupId, onCardUpdated],
  )

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'rounded-xl border border-primary/25 bg-primary/4 p-2 transition-all dark:bg-primary/[0.07]',
          isDragging && 'opacity-45',
        )}
      >
        <div
          {...(!editingTitle && !readOnly ? pointerDragListeners : {})}
          className="group/hdr flex cursor-default items-center gap-1.5 px-1 py-1"
        >
          {!editingTitle && !readOnly && (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              onKeyDown={keyboardDragListener}
              aria-roledescription="перетаскиваемая группа"
              aria-label={
                dragDisabled
                  ? (dragDisabledReason ?? DRAG_DISABLED_FALLBACK)
                  : `Перетащить группу «${group.title}»`
              }
              title={
                dragDisabled
                  ? (dragDisabledReason ?? DRAG_DISABLED_FALLBACK)
                  : 'Перетащить группу в другую колонку'
              }
              data-testid="group-drag-handle"
              className={cn(
                'flex h-5 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/55 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary',
                dragDisabled
                  ? 'cursor-not-allowed opacity-40'
                  : 'cursor-grab hover:bg-foreground/10 hover:text-foreground active:cursor-grabbing dark:hover:bg-white/15',
              )}
            >
              <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onToggleCollapse(group.id)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Развернуть группу' : 'Свернуть группу'}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={collapsed ? 'Развернуть группу' : 'Свернуть группу'}
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-200',
                collapsed && '-rotate-90',
              )}
            />
          </button>

          <Layers className="h-3.5 w-3.5 shrink-0 text-primary" />

          {editingTitle ? (
            <div
              className="flex flex-1 items-center gap-1"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                autoFocus
                className="h-6 px-2 text-xs font-semibold"
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle()
                  if (e.key === 'Escape') {
                    setTitleDraft(group.title)
                    setEditingTitle(false)
                  }
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6 shrink-0"
                onClick={saveTitle}
              >
                <Check className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6 shrink-0"
                onClick={() => {
                  setTitleDraft(group.title)
                  setEditingTitle(false)
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <span
              onDoubleClick={() => {
                if (!readOnly) {
                  setTitleDraft(group.title)
                  setEditingTitle(true)
                }
              }}
              className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground"
            >
              {group.title}
            </span>
          )}

          {!readOnly && !editingTitle && (
            <div
              // На сенсорном экране наведения нет: действия группы видны всегда
              className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/hdr:opacity-100 focus-within:opacity-100 shrink-0 [@media(hover:none)]:opacity-100"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-5 w-5"
                title="Переименовать группу"
                aria-label="Переименовать группу"
                onClick={() => {
                  setTitleDraft(group.title)
                  setEditingTitle(true)
                }}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-5 w-5 text-muted-foreground hover:text-destructive"
                title="Расформировать группу"
                aria-label="Расформировать группу"
                onClick={() => setDissolveOpen(true)}
              >
                <Unlink className="h-3 w-3" />
              </Button>
            </div>
          )}

          {totalLikes > 0 && (
            <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px] shrink-0">
              <ThumbsUp className="h-2.5 w-2.5" />
              {totalLikes}
            </Badge>
          )}
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] shrink-0">
            {cards.length}
          </Badge>
        </div>

        <AnimatePresence initial={false}>
          {!collapsed && cards.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-1.5 space-y-2">
                {cards.map((card) => (
                  <CardWidget
                    key={card.id}
                    card={card}
                    currentUserId={currentUserId}
                    isModerator={isModerator}
                    voterNames={voterNames}
                    maxVotes={maxVotes}
                    userTotalVotes={userTotalVotes}
                    onUpdated={onCardUpdated}
                    onPatched={onCardPatched}
                    onDeleted={onCardDeleted}
                    onRestored={onCardRestored}
                    onRejected={onCardRejected}
                    inGroup
                    isGroupTarget={groupTargetId === card.id}
                    dragDisabled={dragDisabled}
                    dragDisabledReason={dragDisabledReason}
                    anonymous={anonymous}
                    readOnly={readOnly}
                    isSpotlighted={spotlightCardId === card.id}
                    isNew={newCardIds?.has(card.id)}
                    justRevealed={revealedCardIds?.has(card.id)}
                    revealDelayMs={revealDelayMap?.[card.id] ?? 0}
                    onSpotlight={onSpotlight}
                    onCreateActionItem={onCreateActionItem}
                    allowMultipleVotes={allowMultipleVotes}
                    selected={selectedCardIds?.has(card.id) ?? false}
                    onToggleSelect={onToggleSelectCard}
                    otherColumns={otherColumns}
                    onMoved={onCardMoved}
                    onRemoveFromGroup={handleRemoveCard}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AlertDialog open={dissolveOpen} onOpenChange={setDissolveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Расформировать группу «{group.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Группа будет удалена, но все карточки останутся в этой колонке.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDissolve}>Расформировать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default memo(CardGroupWidget, sameExceptVoteCount)
