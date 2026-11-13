'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import {
  Check,
  EyeOff,
  ListTodo,
  MoreHorizontal,
  Palette,
  Pencil,
  Sparkles,
  ThumbsUp,
  Trash2,
  Unlink,
  User,
  X,
} from 'lucide-react'
import { deleteCard, toggleLike, updateCard } from '../api'
import {
  CARD_COLOR_PRESETS,
  getCardColorPreset,
  getUserAvatarGradient,
  getUserInitials,
} from '@/lib/board-themes'
import { useAppStore } from '../store'
import { showToast } from '../store/toastStore'
import { getApiErrorMessage } from '../utils/apiError'
import type { Card } from '../types'
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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface CardWidgetProps {
  card: Card
  currentUser?: string
  maxVotes?: number
  userTotalVotes?: number
  canVote?: boolean
  onUpdated?: (card: Card) => void
  onUpdate?: (card: Card) => void
  onDeleted?: (id: string) => void
  onDelete?: (id: string) => void
  inGroup?: boolean
  isGroupTarget?: boolean
  dragDisabled?: boolean
  hidden?: boolean
  anonymous?: boolean
  readOnly?: boolean
  isSpotlighted?: boolean
  isNew?: boolean
  justRevealed?: boolean
  revealDelayMs?: number
  onSpotlight?: (cardId: string) => void
  onCreateActionItem?: (card: Card) => void
  onRemoveFromGroup?: () => void
}

export default function CardWidget({
  card,
  currentUser,
  maxVotes = 0,
  userTotalVotes = 0,
  canVote = true,
  onUpdated,
  onUpdate,
  onDeleted,
  onDelete,
  inGroup = false,
  isGroupTarget = false,
  dragDisabled = false,
  hidden = false,
  anonymous = false,
  readOnly = false,
  isSpotlighted = false,
  isNew = false,
  justRevealed = false,
  revealDelayMs = 0,
  onSpotlight,
  onCreateActionItem,
  onRemoveFromGroup,
}: CardWidgetProps) {
  const storeUser = useAppStore((s) => s.username)
  const resolvedUser = currentUser ?? storeUser
  const emitUpdated = onUpdated ?? onUpdate ?? (() => {})
  const emitDeleted = onDeleted ?? onDelete ?? (() => {})

  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(card.text)
  const [editColor, setEditColor] = useState(card.color || '#FFFFFF')
  const [saving, setSaving] = useState(false)
  const [liking, setLiking] = useState(false)
  const [voteBurstKey, setVoteBurstKey] = useState(0)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', card },
    disabled: editing || dragDisabled || readOnly || hidden,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(justRevealed && revealDelayMs > 0 ? { animationDelay: `${revealDelayMs}ms` } : {}),
  }

  if (hidden) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        aria-label="Карточка скрыта"
        className="relative overflow-hidden rounded-xl border border-dashed border-border/80 bg-muted/40 p-3.5 select-none"
      >
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
            <EyeOff className="h-3 w-3" />
          </div>
          <span className="font-medium">Карточка скрыта</span>
        </div>
        <div className="space-y-1.5 blur-[3px] opacity-40" aria-hidden="true">
          <div className="h-3 w-11/12 rounded bg-muted-foreground/30" />
          <div className="h-3 w-3/4 rounded bg-muted-foreground/25" />
        </div>
      </div>
    )
  }

  const preset = getCardColorPreset(card.color)
  const likes = card.likes || []
  const liked = likes.includes(resolvedUser)
  const limitReached = !liked && (!canVote || (maxVotes > 0 && userTotalVotes >= maxVotes))
  const voteDisabled = limitReached || readOnly || liking
  const voteTitle = readOnly
    ? 'Доска заблокирована для правок'
    : limitReached
      ? 'Лимит голосов исчерпан'
      : liked
        ? 'Убрать лайк'
        : 'Лайк'
  const voteBlockedReason = readOnly
    ? 'Доска заблокирована для голосования'
    : limitReached
      ? canVote
        ? `Лимит голосов исчерпан (${userTotalVotes}/${maxVotes}). Снимите голос с другой карточки или измените лимит в настройках.`
        : 'Голосование недоступно'
      : null
  const showAccentBar = preset.id !== 'default'

  const startEdit = () => {
    if (readOnly) return
    setEditText(card.text)
    setEditColor(card.color || '#FFFFFF')
    setEditing(true)
  }

  const handleSave = async () => {
    const trimmed = editText.trim()
    if (!trimmed) {
      showToast('Текст карточки не может быть пустым', 'info')
      return
    }
    setSaving(true)
    try {
      const updated = await updateCard(card.id, { text: trimmed, color: editColor })
      emitUpdated(updated)
      setEditing(false)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось обновить карточку'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleQuickColorChange = async (hex: string) => {
    if (readOnly || (card.color || '#FFFFFF').toLowerCase() === hex.toLowerCase()) return
    const prev = card
    emitUpdated({ ...card, color: hex })
    try {
      const updated = await updateCard(card.id, { color: hex })
      emitUpdated(updated)
    } catch (err) {
      emitUpdated(prev)
      showToast(getApiErrorMessage(err, 'Не удалось обновить цвет'), 'error')
    }
  }

  const handleToggleLike = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (voteDisabled) return
    setLiking(true)
    if (!liked) {
      setVoteBurstKey((k) => k + 1)
    }
    const optimisticLikes = liked
      ? likes.filter((u) => u !== resolvedUser)
      : [...likes, resolvedUser]
    emitUpdated({ ...card, likes: optimisticLikes })
    try {
      const updated = await toggleLike(card.id, resolvedUser)
      emitUpdated(updated)
    } catch (err) {
      emitUpdated(card)
      showToast(getApiErrorMessage(err, 'Не удалось обновить голос'), 'error')
    } finally {
      setLiking(false)
    }
  }

  const handleConfirmDelete = async () => {
    setDeleteOpen(false)
    emitDeleted(card.id)
    try {
      await deleteCard(card.id)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось удалить карточку'), 'error')
    }
  }

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        data-testid="card-widget"
        data-card-id={card.id}
        {...(!editing && !readOnly ? { ...attributes, ...listeners } : {})}
        className={cn(
          'group/card relative rounded-xl border p-3.5 shadow-sm transition-all duration-150',
          preset.cardClass,
          !editing && !readOnly && 'cursor-grab active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-md',
          isDragging && 'z-30 opacity-45 scale-[0.98]',
          isGroupTarget && 'ring-2 ring-primary bg-primary/5',
          isSpotlighted && 'ring-2 ring-primary shadow-md shadow-primary/15',
          isNew && '[animation:card-enter_0.32s_cubic-bezier(0.22,1,0.36,1)_both,card-glow_1.3s_ease-out_forwards]',
          !isNew && justRevealed && 'animate-card-reveal',
        )}
      >
        {showAccentBar && (
          <div
            className="absolute bottom-2.5 left-0 top-2.5 w-1 rounded-r-full"
            style={{ backgroundColor: preset.accentDot }}
            aria-hidden="true"
          />
        )}

        {/* Header: author + quick hover actions */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {anonymous ? (
              <>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <User className="h-3 w-3" />
                </span>
                <span className="truncate text-[11px] font-medium text-muted-foreground">
                  Участник
                </span>
              </>
            ) : (
              <>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[9px] font-bold text-white ${getUserAvatarGradient(card.author)}`}
                >
                  {getUserInitials(card.author)}
                </span>
                <span className="truncate text-[11px] font-medium text-muted-foreground">
                  {card.author}
                </span>
              </>
            )}
          </div>

          {!editing && (
            <div
              className="flex items-center gap-0.5 opacity-80 sm:opacity-0 transition-opacity sm:group-hover/card:opacity-100 focus-within:opacity-100"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {onSpotlight && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={cn(
                        'h-6 w-6',
                        isSpotlighted && 'bg-primary/15 text-primary opacity-100',
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSpotlight(card.id)
                      }}
                      title="В фокус обсуждения"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>В фокус обсуждения</TooltipContent>
                </Tooltip>
              )}

              {onCreateActionItem && !readOnly && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCreateActionItem(card)
                      }}
                      title="В Action Item"
                    >
                      <ListTodo className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Создать Action Item</TooltipContent>
                </Tooltip>
              )}

              {!readOnly && (
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Действия с карточкой"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-52"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuItem onClick={startEdit}>
                      <Pencil className="mr-2 h-3.5 w-3.5" />
                      Редактировать
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5" role="group" aria-label="Цвет стикера">
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Palette className="h-3.5 w-3.5" />
                        <span>Цвет стикера</span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        {CARD_COLOR_PRESETS.map((c) => {
                          const isActive = preset.id === c.id
                          return (
                            <button
                              key={c.id}
                              type="button"
                              data-testid={`card-color-option-${c.id}`}
                              aria-label={`Цвет: ${c.name}`}
                              title={c.name}
                              onClick={() => {
                                handleQuickColorChange(c.hex)
                                setMenuOpen(false)
                              }}
                              className={cn(
                                'flex h-5 w-5 items-center justify-center rounded-full border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                c.swatchClass,
                                isActive && 'ring-2 ring-primary ring-offset-1 ring-offset-popover',
                              )}
                            >
                              {c.id !== 'default' && (
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: c.accentDot }}
                                />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    {inGroup && onRemoveFromGroup && (
                      <DropdownMenuItem onClick={onRemoveFromGroup}>
                        <Unlink className="mr-2 h-3.5 w-3.5" />
                        Убрать из группы
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => setDeleteOpen(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Удалить
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        {editing ? (
          <div className="space-y-2.5" onPointerDown={(e) => e.stopPropagation()}>
            <Textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={3}
              autoFocus
              className="min-h-[72px] resize-none bg-background/80 text-[13px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSave()
                } else if (e.key === 'Escape') {
                  setEditing(false)
                }
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {CARD_COLOR_PRESETS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setEditColor(c.hex)}
                    title={c.name}
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border transition-transform hover:scale-110',
                      c.swatchClass,
                      editColor.toLowerCase() === c.hex.toLowerCase() &&
                        'ring-2 ring-primary ring-offset-1 ring-offset-card',
                    )}
                  >
                    {c.id !== 'default' && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: c.accentDot }}
                      />
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditing(false)}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Отмена
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={saving}
                  onClick={handleSave}
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Сохранить
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p
            onDoubleClick={startEdit}
            className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground"
          >
            {card.text}
          </p>
        )}

        {/* Footer: vote pill */}
        {!editing && (
          <div
            className="mt-2.5 flex items-center justify-between gap-2"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/75">
              {isSpotlighted && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                  <Sparkles className="h-2.5 w-2.5" />В фокусе
                </span>
              )}
            </div>

            {(() => {
              const voteButton = (
                <button
                  type="button"
                  title={voteTitle}
                  disabled={voteDisabled}
                  onClick={handleToggleLike}
                  className={cn(
                    'relative inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium transition-all active:scale-95',
                    liked
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border/80 bg-background/70 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                    voteDisabled && 'pointer-events-none',
                    voteDisabled && !liked && 'opacity-50',
                  )}
                >
                  {voteBurstKey > 0 && (
                    <span
                      key={voteBurstKey}
                      aria-hidden="true"
                      className="animate-vote-pop pointer-events-none absolute -top-2 left-1/2 font-mono text-[11px] font-bold text-primary"
                    >
                      +1
                    </span>
                  )}
                  <motion.span
                    key={liked ? 'liked' : 'idle'}
                    initial={liked ? { scale: 1.35, rotate: -14 } : false}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 520, damping: 18 }}
                    className="inline-flex"
                  >
                    <ThumbsUp className={cn('h-3 w-3', liked && 'fill-current')} />
                  </motion.span>
                  <span className="tabular-nums">{likes.length}</span>
                </button>
              )

              if (likes.length === 0 && !voteBlockedReason) {
                return voteButton
              }

              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={cn('inline-flex', voteDisabled && 'cursor-not-allowed')}>
                      {voteButton}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {likes.length > 0 && (
                      <div>{anonymous ? `${likes.length} голосов (анонимно)` : likes.join(', ')}</div>
                    )}
                    {voteBlockedReason && (
                      <div className={likes.length > 0 ? 'mt-1 opacity-80' : undefined}>
                        {voteBlockedReason}
                      </div>
                    )}
                  </TooltipContent>
                </Tooltip>
              )
            })()}
          </div>
        )}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить карточку?</AlertDialogTitle>
            <AlertDialogDescription>
              Карточка будет удалена с доски для всех участников.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
