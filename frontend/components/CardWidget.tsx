'use client'

import { memo, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import {
  ArrowRightLeft,
  Bot,
  Check,
  EyeOff,
  Focus,
  GripVertical,
  ListTodo,
  Minus,
  MoreHorizontal,
  Palette,
  Pencil,
  ThumbsUp,
  Trash2,
  Unlink,
  User,
  X,
} from 'lucide-react'
import { deleteCard, moveCard, toggleLike, updateCard } from '../api'
import {
  CARD_COLOR_PRESETS,
  getCardColorPreset,
  getUserAvatarGradient,
  getUserInitials,
} from '@/lib/board-themes'
import { sameExceptVoteCount } from '@/lib/memo'
import {
  CANNOT_DELETE_CARD_HINT,
  NOT_YOUR_CARD_HINT,
  avatarSeed,
  canDeleteCard,
  canEditCardText,
  countMyVotes,
  formatVoters,
  formatVotesCount,
  isOwnCard,
  summarizeVoters,
  withMyVote,
} from '@/lib/participants'
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RichCardText } from './RichCardText'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface CardWidgetProps {
  card: Card
  /** Идентификатор текущего участника; по умолчанию — участник сессии из стора. */
  currentUserId?: string
  /** Модератор доски (создатель или ведущий) может удалять чужие карточки. */
  isModerator?: boolean
  /** Имена участников по идентификатору — для подписи голосов. */
  voterNames?: Record<string, string>
  maxVotes?: number
  userTotalVotes?: number
  canVote?: boolean
  /** Карточка в ответе сервера (после сохранения, голоса, переноса). */
  onUpdated?: (card: Card) => void
  onUpdate?: (card: Card) => void
  /**
   * Точечная правка карточки в её текущем состоянии — оптимистичное обновление и его откат.
   * Меняется одно поле, поэтому события, пришедшие за время запроса, не затираются.
   * Без этого обработчика правка уходит в `onUpdated` целой карточкой.
   */
  onPatched?: (cardId: string, patch: (card: Card) => Card) => void
  onDeleted?: (id: string) => void
  onDelete?: (id: string) => void
  /** Сервер карточку не удалил: вернуть её на место. */
  onRestored?: (card: Card, error?: unknown) => void
  /** Сервер отклонил голос или смену цвета; локальная правка уже снята. */
  onRejected?: (error: unknown) => void
  inGroup?: boolean
  isGroupTarget?: boolean
  dragDisabled?: boolean
  /** Почему перетаскивание отключено — подсказка на ручке. */
  dragDisabledReason?: string | null
  anonymous?: boolean
  readOnly?: boolean
  isSpotlighted?: boolean
  isNew?: boolean
  justRevealed?: boolean
  revealDelayMs?: number
  onSpotlight?: (cardId: string) => void
  onCreateActionItem?: (card: Card) => void
  onRemoveFromGroup?: (card: Card) => void
  allowMultipleVotes?: boolean
  selected?: boolean
  onToggleSelect?: (cardId: string, shiftKey?: boolean) => void
  otherColumns?: { id: string; title: string; color: string }[]
  onMoved?: (card: Card, targetColumnId: string) => void
}

const NO_NAMES: Record<string, string> = {}

const DRAG_DISABLED_FALLBACK = 'Перетаскивание сейчас отключено'

function CardWidget({
  card,
  currentUserId,
  isModerator = false,
  voterNames = NO_NAMES,
  maxVotes = 0,
  userTotalVotes = 0,
  canVote = true,
  onUpdated,
  onUpdate,
  onPatched,
  onDeleted,
  onDelete,
  onRestored,
  onRejected,
  inGroup = false,
  isGroupTarget = false,
  dragDisabled = false,
  dragDisabledReason = null,
  anonymous = false,
  readOnly = false,
  isSpotlighted = false,
  isNew = false,
  justRevealed = false,
  revealDelayMs = 0,
  onSpotlight,
  onCreateActionItem,
  onRemoveFromGroup,
  allowMultipleVotes = false,
  selected = false,
  onToggleSelect,
  otherColumns,
  onMoved,
}: CardWidgetProps) {
  const storeUserId = useAppStore((s) => s.participant?.id ?? '')
  const myId = currentUserId ?? storeUserId
  // Чужая карточка до раскрытия: сервер прислал её без текста, автора и голосов
  const hidden = Boolean(card.masked)
  const emitUpdated = onUpdated ?? onUpdate ?? (() => {})
  const emitDeleted = onDeleted ?? onDelete ?? (() => {})
  // Оптимистичная правка и её откат: меняем одно поле карточки в её текущем состоянии
  const patchCard = (patch: (current: Card) => Card) => {
    if (onPatched) onPatched(card.id, patch)
    else emitUpdated(patch(card))
  }

  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(card.text)
  const [editColor, setEditColor] = useState(card.color || '#FFFFFF')
  const [saving, setSaving] = useState(false)
  const [liking, setLiking] = useState(false)
  const [voteBurstKey, setVoteBurstKey] = useState(0)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: { type: 'card', card },
    disabled: editing || dragDisabled || readOnly || hidden,
  })
  // Указателем карточку тащат за любое место, с клавиатуры — за ручку: у самой карточки нет
  // роли кнопки, иначе кнопки внутри неё оказались бы вложенными в кнопку
  const { onKeyDown: keyboardDragListener, ...pointerDragListeners } = (listeners ?? {}) as {
    onKeyDown?: React.KeyboardEventHandler<HTMLElement>
  } & Record<string, unknown>

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
  // «Мой голос» и «моя карточка» — по идентификатору участника, не по имени
  const myVotesOnCard = countMyVotes(card, myId)
  const liked = myVotesOnCard > 0
  const own = isOwnCard(card, myId)
  const canEditText = canEditCardText(card, myId, { anonymous })
  const canDelete = canDeleteCard(card, myId, { anonymous, moderator: isModerator })
  // В анонимном режиме сервер отдаёт автора только владельцу карточки, а карточки агентов видны всегда
  const isAgent = card.author_kind === 'agent' && !card.masked
  const showAuthorName = !anonymous || own || isAgent
  const authorLabel = isAgent
    ? card.author
    : anonymous
      ? own
        ? 'Вы'
        : 'Участник'
      : card.author
  const canAddVote = canVote && !(maxVotes > 0 && userTotalVotes >= maxVotes)
  const limitReached = allowMultipleVotes ? !canAddVote : !liked && !canAddVote
  const voteDisabled = allowMultipleVotes
    ? (!canAddVote && myVotesOnCard === 0) || readOnly || liking
    : limitReached || readOnly || liking
  const voteTitle = readOnly
    ? 'Доска заблокирована для правок'
    : limitReached
      ? 'Лимит голосов исчерпан'
      : liked && !allowMultipleVotes
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
  const moveTargets = (otherColumns || []).filter((c) => c.id !== card.column_id)

  const startEdit = () => {
    if (readOnly || !canEditText) return
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
    const previousColor = card.color
    patchCard((current) => ({ ...current, color: hex }))
    try {
      const updated = await updateCard(card.id, { color: hex })
      emitUpdated(updated)
    } catch (err) {
      // Возвращаем только цвет — и только если его за это время не сменили ещё раз
      patchCard((current) =>
        current.color === hex ? { ...current, color: previousColor } : current,
      )
      showToast(getApiErrorMessage(err, 'Не удалось обновить цвет'), 'error')
      onRejected?.(err)
    }
  }

  const handleToggleLike = async (e: React.MouseEvent, dotAction?: 'add' | 'remove') => {
    e.stopPropagation()
    if (allowMultipleVotes) {
      if (readOnly || liking) return
      const act = dotAction || 'add'
      if (act === 'add' && !canAddVote) return
      if (act === 'remove' && myVotesOnCard <= 0) return
      setLiking(true)
      if (act === 'add') setVoteBurstKey((k) => k + 1)
      patchCard((current) => ({ ...current, likes: withMyVote(current.likes || [], myId, act) }))
      try {
        const updated = await toggleLike(card.id, act)
        emitUpdated(updated)
      } catch (err) {
        // Откат точечный: снимаем или возвращаем только свой голос. Чужие голоса и правки,
        // пришедшие, пока шёл запрос, остаются.
        const undo = act === 'add' ? 'remove' : 'add'
        patchCard((current) => ({ ...current, likes: withMyVote(current.likes || [], myId, undo) }))
        showToast(getApiErrorMessage(err, 'Не удалось обновить голос'), 'error')
        onRejected?.(err)
      } finally {
        setLiking(false)
      }
      return
    }

    if (voteDisabled) return
    setLiking(true)
    if (!liked) {
      setVoteBurstKey((k) => k + 1)
    }
    const wasLiked = liked
    patchCard((current) => ({
      ...current,
      likes: wasLiked
        ? (current.likes || []).filter((voterId) => voterId !== myId)
        : withMyVote(current.likes || [], myId, 'add'),
    }))
    try {
      const updated = await toggleLike(card.id)
      emitUpdated(updated)
    } catch (err) {
      // Откат точечный: возвращаем или снимаем только свой голос
      patchCard((current) => ({
        ...current,
        likes: withMyVote(current.likes || [], myId, wasLiked ? 'add' : 'remove'),
      }))
      showToast(getApiErrorMessage(err, 'Не удалось обновить голос'), 'error')
      onRejected?.(err)
    } finally {
      setLiking(false)
    }
  }

  const handleMoveToColumn = async (targetColumnId: string) => {
    if (readOnly || targetColumnId === card.column_id) return
    try {
      const updated = await moveCard(card.id, { column_id: targetColumnId, position: 0 })
      if (onMoved) {
        onMoved(updated, targetColumnId)
      } else {
        emitUpdated(updated)
      }
      showToast('Карточка перемещена', 'success')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось переместить карточку'), 'error')
    }
  }

  const handleConfirmDelete = async () => {
    setDeleteOpen(false)
    if (!canDelete) return
    const removed = card
    emitDeleted(card.id)
    try {
      await deleteCard(card.id)
    } catch (err) {
      // Сервер карточку не удалил: возвращаем её на место
      onRestored?.(removed, err)
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
        {...(!editing && !readOnly ? pointerDragListeners : {})}
        className={cn(
          'group/card relative rounded-xl border p-3.5 shadow-xs transition-[border-color,box-shadow,background-color,opacity] duration-150',
          // Подсветка после перехода к карточке из палитры команд (атрибут ставит доска)
          'data-[flash=true]:border-primary data-[flash=true]:ring-2 data-[flash=true]:ring-primary data-[flash=true]:shadow-lg',
          preset.cardClass,
          !editing && !readOnly && 'cursor-default hover:border-primary/40 hover:shadow-md',
          selected && 'ring-2 ring-primary/60 border-primary',
          isDragging && 'z-30 opacity-45 scale-[0.98]',
          isGroupTarget && 'ring-2 ring-primary bg-primary/5',
          isSpotlighted && 'ring-2 ring-primary shadow-md shadow-primary/15',
          isNew && 'animate-[card-enter_0.32s_cubic-bezier(0.22,1,0.36,1)_both,card-glow_1.3s_ease-out_forwards]',
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

        {/* Header: drag handle + avatar (swaps to selection checkbox on hover/selected without layout shift) + author + quick hover actions */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {!editing && !readOnly && (
              <button
                type="button"
                ref={setActivatorNodeRef}
                data-testid="card-drag-handle"
                {...attributes}
                onKeyDown={keyboardDragListener}
                aria-roledescription="перетаскиваемая карточка"
                aria-label={
                  dragDisabled
                    ? (dragDisabledReason ?? DRAG_DISABLED_FALLBACK)
                    : 'Перетащить карточку'
                }
                title={
                  dragDisabled
                    ? (dragDisabledReason ?? DRAG_DISABLED_FALLBACK)
                    : 'Перетащить карточку (с клавиатуры: пробел — взять, стрелки — двигать)'
                }
                className={cn(
                  'flex h-5 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/55 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary',
                  dragDisabled
                    ? 'cursor-not-allowed opacity-40'
                    : 'cursor-grab hover:bg-foreground/10 hover:text-foreground active:cursor-grabbing group-hover/card:text-muted-foreground dark:hover:bg-white/15',
                )}
              >
                <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}

            <div className="group/select relative flex h-5 w-5 shrink-0 items-center justify-center">
              {!showAuthorName ? (
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground transition-opacity duration-150',
                    onToggleSelect &&
                      !readOnly &&
                      (selected
                        ? 'opacity-0'
                        : 'group-hover/card:opacity-0 group-focus-within/select:opacity-0 [@media(hover:none)]:opacity-0'),
                  )}
                >
                  <User className="h-3 w-3" />
                </span>
              ) : isAgent ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/30 transition-opacity duration-150 dark:text-violet-300',
                    onToggleSelect &&
                      !readOnly &&
                      (selected
                        ? 'opacity-0'
                        : 'group-hover/card:opacity-0 group-focus-within/select:opacity-0 [@media(hover:none)]:opacity-0'),
                  )}
                >
                  <Bot className="h-3 w-3" />
                </span>
              ) : (
                <span
                  className={cn(
                    `flex h-5 w-5 items-center justify-center rounded-full bg-linear-to-br/srgb text-[9px] font-bold text-white transition-opacity duration-150 ${getUserAvatarGradient(avatarSeed(card.author_id, card.author))}`,
                    onToggleSelect &&
                      !readOnly &&
                      (selected
                        ? 'opacity-0'
                        : 'group-hover/card:opacity-0 group-focus-within/select:opacity-0 [@media(hover:none)]:opacity-0'),
                  )}
                >
                  {getUserInitials(card.author)}
                </span>
              )}

              {onToggleSelect && !readOnly && (
                <button
                  type="button"
                  data-testid={`card-select-${card.id}`}
                  aria-label={selected ? 'Снять выделение' : 'Выбрать карточку'}
                  aria-pressed={selected}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleSelect(card.id, e.shiftKey)
                  }}
                  className={cn(
                    'absolute inset-0 flex h-5 w-5 items-center justify-center rounded-full border transition-all duration-150',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground opacity-100'
                      : // На сенсорном экране наведения нет: кружок выбора виден всегда
                        'border-muted-foreground/50 bg-background/90 text-transparent opacity-0 group-hover/card:opacity-100 focus:opacity-100 hover:border-primary [@media(hover:none)]:opacity-100',
                  )}
                >
                  <Check className="h-2.5 w-2.5 stroke-3" />
                </button>
              )}
            </div>

            <span
              className="truncate text-[11px] font-medium text-muted-foreground"
              title={
                isAgent
                  ? 'Карточка ИИ-агента'
                  : anonymous && own
                    ? 'Анонимный режим: автор виден только вам'
                    : undefined
              }
            >
              {authorLabel}
            </span>
            {isAgent && (
              <span
                data-testid="card-agent-badge"
                className="inline-flex shrink-0 items-center rounded-full border border-violet-500/25 bg-violet-500/10 px-1.5 py-0 text-[9px] font-medium text-violet-700 dark:text-violet-300"
              >
                Агент
              </span>
            )}
          </div>

          {!editing && (
            <div
              className="flex items-center gap-0.5 opacity-80 sm:opacity-0 transition-opacity sm:group-hover/card:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-80"
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
                      <Focus className="h-3.5 w-3.5" />
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
                      title="В задачу"
                    >
                      <ListTodo className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Создать задачу</TooltipContent>
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
                    <DropdownMenuItem
                      onClick={startEdit}
                      disabled={!canEditText}
                      data-testid="card-edit-item"
                    >
                      <Pencil className="mr-2 h-3.5 w-3.5" />
                      Редактировать
                    </DropdownMenuItem>
                    {/* Причина — отдельной строкой: у отключённого пункта текст приглушён */}
                    {!canEditText && (
                      <p className="px-2.5 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                        {NOT_YOUR_CARD_HINT}
                      </p>
                    )}
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
                                void handleQuickColorChange(c.hex)
                                setMenuOpen(false)
                              }}
                              className={cn(
                                'flex h-5 w-5 items-center justify-center rounded-full border transition-transform hover:scale-110 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary',
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
                    {moveTargets.length > 0 && (
                      <>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                            <span>Переместить в колонку</span>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {moveTargets.map((targetCol) => (
                              <DropdownMenuItem
                                key={targetCol.id}
                                onClick={() => {
                                  void handleMoveToColumn(targetCol.id)
                                  setMenuOpen(false)
                                }}
                              >
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: targetCol.color }}
                                />
                                <span className="truncate">{targetCol.title}</span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    {inGroup && onRemoveFromGroup && (
                      <DropdownMenuItem onClick={() => onRemoveFromGroup(card)}>
                        <Unlink className="mr-2 h-3.5 w-3.5" />
                        Убрать из группы
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => setDeleteOpen(true)}
                      disabled={!canDelete}
                      data-testid="card-delete-item"
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Удалить
                    </DropdownMenuItem>
                    {!canDelete && (
                      <p className="px-2.5 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                        {CANNOT_DELETE_CARD_HINT}
                      </p>
                    )}
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
                  void handleSave()
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
                    aria-label={`Цвет карточки: ${c.name}`}
                    aria-pressed={editColor.toLowerCase() === c.hex.toLowerCase()}
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border transition-transform hover:scale-110 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary',
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
            onDoubleClick={canEditText ? startEdit : undefined}
            className="whitespace-pre-wrap wrap-break-word text-[13.5px] leading-relaxed text-foreground"
          >
            <RichCardText text={card.text} />
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
                  <Focus className="h-2.5 w-2.5" />В фокусе
                </span>
              )}
            </div>

            {(() => {
              const voteButton =
                allowMultipleVotes && myVotesOnCard > 0 ? (
                  <div
                    className={cn(
                      'relative inline-flex h-6 items-center overflow-hidden rounded-full border border-primary/40 bg-primary/15 text-xs font-medium text-primary transition-all',
                      liking && 'opacity-70',
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
                    {!readOnly && (
                      <button
                        type="button"
                        title="Убрать голос"
                        disabled={liking}
                        onClick={(e) => handleToggleLike(e, 'remove')}
                        className="flex h-full items-center px-1.5 hover:bg-primary/20 active:scale-95"
                        aria-label="Убрать один голос"
                      >
                        <Minus className="h-2.5 w-2.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      title={voteTitle}
                      disabled={readOnly || liking || limitReached}
                      onClick={(e) => handleToggleLike(e, 'add')}
                      className={cn(
                        'inline-flex h-full items-center gap-1 px-1.5 hover:bg-primary/20 active:scale-95',
                        (readOnly || limitReached) && 'pointer-events-none opacity-60',
                      )}
                    >
                      <ThumbsUp className="h-3 w-3 fill-current" />
                      <span className="tabular-nums">{likes.length}</span>
                      <span className="text-[10px] font-semibold opacity-80">×{myVotesOnCard}</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    title={voteTitle}
                    disabled={voteDisabled}
                    onClick={(e) => handleToggleLike(e, allowMultipleVotes ? 'add' : undefined)}
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
                      <div>
                        {anonymous
                          ? `${formatVotesCount(likes.length)} (анонимно)`
                          : formatVoters(summarizeVoters(likes, voterNames, myId))}
                      </div>
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

/**
 * Карточка перерисовывается, только когда меняется она сама или то, что на ней показано:
 * лайк на соседней карточке её не трогает.
 */
export default memo(CardWidget, sameExceptVoteCount)
