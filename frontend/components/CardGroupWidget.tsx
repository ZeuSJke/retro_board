'use client'

import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Layers,
  Pencil,
  ThumbsUp,
  Unlink,
  X,
} from 'lucide-react'
import { deleteGroup, removeCardFromGroup, updateGroup } from '../api'
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
  onToggleCollapse: () => void
  currentUser: string
  maxVotes: number
  userTotalVotes: number
  onUpdated: (group: CardGroup) => void
  onDeleted: (groupId: string) => void
  onCardUpdated: (card: Card) => void
  onCardDeleted: (cardId: string) => void
  groupTargetId: string | null
  dragDisabled?: boolean
  hideOtherCards?: boolean
  anonymous?: boolean
  readOnly?: boolean
  spotlightCardId?: string | null
  onSpotlight?: (cardId: string) => void
  onCreateActionItem?: (card: Card) => void
}

export default function CardGroupWidget({
  group,
  cards,
  collapsed,
  onToggleCollapse,
  currentUser,
  maxVotes,
  userTotalVotes,
  onUpdated,
  onDeleted,
  onCardUpdated,
  onCardDeleted,
  groupTargetId,
  dragDisabled = false,
  hideOtherCards = false,
  anonymous = false,
  readOnly = false,
  spotlightCardId = null,
  onSpotlight,
  onCreateActionItem,
}: CardGroupWidgetProps) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(group.title)
  const [dissolveOpen, setDissolveOpen] = useState(false)

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `group-${group.id}`,
    data: { type: 'group', group },
    disabled: editingTitle || dragDisabled || readOnly,
  })

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
    onDeleted(group.id)
    try {
      await deleteGroup(group.id)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось расформировать группу'), 'error')
    }
  }

  const handleRemoveCard = async (card: Card) => {
    try {
      const updated = await removeCardFromGroup(group.id, card.id)
      onCardUpdated(updated)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось убрать карточку из группы'), 'error')
    }
  }

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'rounded-xl border border-primary/25 bg-primary/[0.04] p-2 transition-all dark:bg-primary/[0.07]',
          isDragging && 'opacity-45',
        )}
      >
        <div
          {...(!editingTitle && !readOnly ? { ...attributes, ...listeners } : {})}
          className={cn(
            'group/hdr flex items-center gap-1.5 px-1 py-1',
            !editingTitle && !readOnly && 'cursor-grab active:cursor-grabbing',
          )}
        >
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onToggleCollapse}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title={collapsed ? 'Развернуть группу' : 'Свернуть группу'}
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
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
                  if (e.key === 'Enter') saveTitle()
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
              className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/hdr:opacity-100 focus-within:opacity-100 shrink-0"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-5 w-5"
                title="Переименовать группу"
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

        {!collapsed && cards.length > 0 && (
          <div className="mt-1.5 space-y-2">
            {cards.map((card) => (
              <CardWidget
                key={card.id}
                card={card}
                currentUser={currentUser}
                maxVotes={maxVotes}
                userTotalVotes={userTotalVotes}
                onUpdated={onCardUpdated}
                onDeleted={onCardDeleted}
                inGroup
                isGroupTarget={groupTargetId === card.id}
                dragDisabled={dragDisabled}
                hidden={hideOtherCards && card.author !== currentUser}
                anonymous={anonymous}
                readOnly={readOnly}
                isSpotlighted={spotlightCardId === card.id}
                onSpotlight={onSpotlight}
                onCreateActionItem={onCreateActionItem}
                onRemoveFromGroup={() => handleRemoveCard(card)}
              />
            ))}
          </div>
        )}
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
