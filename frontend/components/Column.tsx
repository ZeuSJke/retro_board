'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence, motion } from 'motion/react'
import { Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { autoClusterColumn, createCard, deleteColumn, updateColumn } from '../api'
import { CARD_COLOR_PRESETS, COLUMN_COLOR_PALETTE, getCardColorPreset } from '@/lib/board-themes'
import { CANNOT_DELETE_COLUMN_HINT, isOwnCard } from '@/lib/participants'
import { useAppStore } from '../store'
import { showToast } from '../store/toastStore'
import { getApiErrorMessage } from '../utils/apiError'
import type { Card, CardGroup, Column as ColumnType } from '../types'
import CardWidget from './CardWidget'
import CardGroupWidget from './CardGroupWidget'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface ColumnProps {
  column: ColumnType
  maxVotes?: number
  userTotalVotes?: number
  /** Идентификатор текущего участника; по умолчанию — участник сессии из стора. */
  currentUserId?: string
  /** Модератор доски: удаляет чужие карточки и колонки с карточками. */
  isModerator?: boolean
  /** Имена участников по идентификатору — для подписи голосов. */
  voterNames?: Record<string, string>
  onUpdate: (col: ColumnType) => void
  onDelete: (colId: string) => void
  onCardCreated: (card: Card) => void
  onCardUpdated: (card: Card) => void
  onCardDeleted: (cardId: string) => void
  onGroupCreated: (group: CardGroup, cardIds: string[]) => void
  onGroupUpdated: (group: CardGroup) => void
  onGroupDeleted: (groupId: string) => void
  groupTargetId: string | null
  collapsedGroups: Record<string, boolean>
  onToggleCollapse: (groupId: string) => void
  /** Сервер сейчас скрывает чужие карточки (скрытый сбор или фаза «Штурм»). */
  cardsHidden?: boolean
  anonymous?: boolean
  dragDisabled?: boolean
  readOnly?: boolean
  cardCreationDisabled?: boolean
  searchQuery?: string
  onlyMine?: boolean
  sortBy?: 'order' | 'votes'
  spotlightCardId?: string | null
  index?: number
  className?: string
  onSpotlight?: (cardId: string) => void
  onCreateActionItem?: (card: Card) => void
  onPreviewAutoCluster?: (column: ColumnType) => Promise<void> | void
  allowMultipleVotes?: boolean
  selectedCardIds?: Set<string>
  onToggleSelectCard?: (cardId: string, shiftKey?: boolean) => void
  otherColumns?: { id: string; title: string; color: string }[]
  onCardMoved?: (card: Card, targetColumnId: string) => void
  colorFilter?: string | null
  typingUsernames?: string[]
  onTypingChange?: (columnId: string, isTyping: boolean) => void
}

export default function Column({
  column,
  maxVotes = 0,
  userTotalVotes = 0,
  currentUserId,
  isModerator = false,
  voterNames,
  onUpdate,
  onDelete,
  onCardCreated,
  onCardUpdated,
  onCardDeleted,
  onGroupCreated,
  onGroupUpdated,
  onGroupDeleted,
  groupTargetId,
  collapsedGroups,
  onToggleCollapse,
  cardsHidden = false,
  anonymous = false,
  dragDisabled = false,
  readOnly = false,
  cardCreationDisabled = false,
  searchQuery = '',
  onlyMine = false,
  sortBy = 'order',
  spotlightCardId = null,
  index = 0,
  className,
  onSpotlight,
  onCreateActionItem,
  onPreviewAutoCluster,
  allowMultipleVotes = false,
  selectedCardIds,
  onToggleSelectCard,
  otherColumns,
  onCardMoved,
  colorFilter = null,
  typingUsernames = [],
  onTypingChange,
}: ColumnProps) {
  const storeUserId = useAppStore((s) => s.participant?.id ?? '')
  const aiEnabled = useAppStore((s) => s.aiEnabled)
  const myId = currentUserId ?? storeUserId
  // Удаление колонки стирает её карточки: с карточками это действие модератора
  const canDeleteColumn = isModerator || column.cards.length === 0

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(column.title)
  const [clustering, setClustering] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Inline card creation
  const [composerOpen, setComposerOpen] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftColor, setDraftColor] = useState<string>('#FFFFFF')
  const [creating, setCreating] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const emitTyping = (active: boolean) => {
    if (!onTypingChange) return
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current)
      typingTimerRef.current = null
    }
    onTypingChange(column.id, active)
    if (active) {
      typingTimerRef.current = setTimeout(() => {
        onTypingChange(column.id, false)
      }, 3500)
    }
  }

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      onTypingChange?.(column.id, false)
    }
  }, [column.id, onTypingChange])

  // Отслеживаем свежесозданные/прилетевшие по WS карточки и эффект проявки при Reveal
  const initializedCardsRef = useRef(false)
  const prevCardIdsRef = useRef<Set<string>>(new Set())
  const prevHiddenIdsRef = useRef<Set<string>>(new Set())
  const [recentNewIds, setRecentNewIds] = useState<Set<string>>(() => new Set())
  const [revealedCardIds, setRevealedCardIds] = useState<Set<string>>(() => new Set())
  const [revealDelayMap, setRevealDelayMap] = useState<Record<string, number>>({})

  useEffect(() => {
    const cards = column.cards || []
    const currentIds = new Set(cards.map((c) => c.id))
    // Скрытые карточки — те, что сервер прислал без содержимого (masked)
    const currentHiddenIds = new Set(cards.filter((c) => c.masked).map((c) => c.id))

    if (!initializedCardsRef.current) {
      initializedCardsRef.current = true
      prevCardIdsRef.current = currentIds
      prevHiddenIdsRef.current = currentHiddenIds
      return
    }

    const added = cards.filter((c) => !prevCardIdsRef.current.has(c.id)).map((c) => c.id)
    const revealed = cards
      .filter((c) => prevHiddenIdsRef.current.has(c.id) && !currentHiddenIds.has(c.id))
      .map((c) => c.id)

    prevCardIdsRef.current = currentIds
    prevHiddenIdsRef.current = currentHiddenIds

    const timers: ReturnType<typeof setTimeout>[] = []

    if (added.length > 0) {
      setRecentNewIds((prev) => {
        const next = new Set(prev)
        added.forEach((id) => next.add(id))
        return next
      })
      timers.push(
        setTimeout(() => {
          setRecentNewIds((prev) => {
            const next = new Set(prev)
            added.forEach((id) => next.delete(id))
            return next
          })
        }, 1450),
      )
    }

    if (revealed.length > 0) {
      const delays: Record<string, number> = {}
      revealed.forEach((id, idx) => {
        delays[id] = Math.min(idx * 35, 280)
      })
      setRevealDelayMap((prev) => ({ ...prev, ...delays }))
      setRevealedCardIds((prev) => {
        const next = new Set(prev)
        revealed.forEach((id) => next.add(id))
        return next
      })
      timers.push(
        setTimeout(() => {
          setRevealedCardIds((prev) => {
            const next = new Set(prev)
            revealed.forEach((id) => next.delete(id))
            return next
          })
        }, 850),
      )
    }

    return () => {
      timers.forEach(clearTimeout)
    }
  }, [column.cards])

  const { setNodeRef, isOver } = useDroppable({
    id: `col-${column.id}`,
  })

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isScrolling, setIsScrolling] = useState(false)
  const [hasMoreBelow, setHasMoreBelow] = useState(false)

  const updateScrollIndicator = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    setHasMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
  }, [])

  const setCardsAreaRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node
      setNodeRef(node)
    },
    [setNodeRef],
  )

  const handleCardsScroll = useCallback(() => {
    updateScrollIndicator()
    setIsScrolling(true)
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      setIsScrolling(false)
    }, 900)
  }, [updateScrollIndicator])

  useEffect(() => {
    updateScrollIndicator()
    const el = scrollContainerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(updateScrollIndicator)
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateScrollIndicator, column.cards, collapsedGroups])

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    }
  }, [])

  const filteredAndSortedCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = (column.cards || []).filter((card) => {
      const isHidden = Boolean(card.masked)
      if (onlyMine && !isOwnCard(card, myId)) return false
      if (colorFilter) {
        if (isHidden) return false
        if (getCardColorPreset(card.color).id !== colorFilter) return false
      }
      if (q) {
        if (isHidden) return false
        const matchText = card.text.toLowerCase().includes(q)
        const matchAuthor = !anonymous && card.author.toLowerCase().includes(q)
        if (!matchText && !matchAuthor) return false
      }
      return true
    })

    return [...filtered].sort((a, b) => {
      if (sortBy === 'votes') {
        const diff = (b.likes?.length || 0) - (a.likes?.length || 0)
        if (diff !== 0) return diff
      }
      return (a.position ?? 0) - (b.position ?? 0)
    })
  }, [column.cards, searchQuery, onlyMine, colorFilter, sortBy, myId, anonymous])

  // Список приходит уже без текущего участника (он исключён по идентификатору)
  const otherTypingUsers = typingUsernames

  const groups = column.groups || []
  const groupIds = new Set(groups.map((g) => g.id))
  const ungroupedCards = filteredAndSortedCards.filter(
    (c) => !c.group_id || !groupIds.has(c.group_id),
  )
  const ungroupedTotalCount = (column.cards || []).filter(
    (c) => !c.group_id || !groupIds.has(c.group_id),
  ).length

  const saveTitle = async () => {
    setEditingTitle(false)
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === column.title) return
    onUpdate({ ...column, title: trimmed })
    try {
      const updated = await updateColumn(column.id, { title: trimmed })
      onUpdate({ ...column, ...updated })
    } catch (err) {
      onUpdate(column)
      showToast(getApiErrorMessage(err, 'Не удалось переименовать колонку'), 'error')
    }
  }

  const handleColorChange = async (color: string) => {
    if (readOnly) return
    onUpdate({ ...column, color })
    try {
      const updated = await updateColumn(column.id, { color })
      onUpdate({ ...column, ...updated })
    } catch (err) {
      onUpdate(column)
      showToast(getApiErrorMessage(err, 'Не удалось изменить цвет колонки'), 'error')
    }
  }

  const handleConfirmDelete = async () => {
    setDeleteOpen(false)
    onDelete(column.id)
    try {
      await deleteColumn(column.id)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось удалить колонку'), 'error')
    }
  }

  const handleAutoCluster = async () => {
    if (onPreviewAutoCluster) {
      if (clustering || readOnly) return
      setClustering(true)
      try {
        await onPreviewAutoCluster(column)
      } finally {
        setClustering(false)
      }
      return
    }
    if (clustering || readOnly) return
    setClustering(true)
    try {
      const result = await autoClusterColumn(column.id)
      const createdGroups: Array<{ group: CardGroup; card_ids: string[] }> =
        result?.created_groups || []
      if (createdGroups.length === 0) {
        showToast('AI не нашёл похожих карточек для группировки', 'info')
        return
      }
      for (const entry of createdGroups) {
        if (entry?.group) {
          onGroupCreated(entry.group, entry.card_ids || [])
        }
      }
      showToast('Карточки сгруппированы', 'info')
    } catch (err: unknown) {
      // Одно сообщение по делу: причину сообщает сервер
      showToast(getApiErrorMessage(err, 'Не удалось сгруппировать карточки'), 'error')
    } finally {
      setClustering(false)
    }
  }

  const handleAddCard = async () => {
    const text = draftText.trim()
    if (!text || creating || readOnly || cardCreationDisabled) return
    setCreating(true)
    try {
      const created = await createCard({
        column_id: column.id,
        text,
        color: draftColor,
      })
      onCardCreated(created)
      setDraftText('')
      textareaRef.current?.focus()
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось создать карточку'), 'error')
    } finally {
      setCreating(false)
    }
  }

  const canCreateCard = !readOnly && !cardCreationDisabled

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.24,
          delay: Math.min(index * 0.04, 0.2),
          ease: [0.22, 1, 0.36, 1],
        }}
        data-testid="board-column"
        data-column-id={column.id}
        className={cn(
          'flex max-h-full w-[86vw] max-w-[380px] shrink-0 snap-center flex-col overflow-hidden rounded-2xl border bg-card/85 shadow-xs backdrop-blur-xs transition-[border-color,box-shadow] md:w-auto md:min-w-[280px] md:max-w-[580px] md:flex-1 md:shrink-0 md:snap-none',
          isOver && 'border-primary/70 ring-2 ring-primary/20 shadow-md',
          className,
        )}
      >
        {/* Top accent strip */}
        <div
          className="h-1 w-full shrink-0"
          style={{ backgroundColor: column.color || '#6366F1' }}
        />

        {/* Header */}
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
          {readOnly ? (
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: column.color || '#6366F1' }}
            />
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title="Изменить цвет"
                  className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-transparent transition-transform hover:scale-110 hover:ring-border"
                  style={{ backgroundColor: column.color || '#6366F1' }}
                />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-2.5">
                <div className="flex items-center gap-1.5">
                  {COLUMN_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleColorChange(c)}
                      className={cn(
                        'h-5 w-5 rounded-full transition-transform hover:scale-110',
                        column.color === c && 'ring-2 ring-primary ring-offset-2',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {editingTitle ? (
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              autoFocus
              className="h-7 flex-1 px-2 text-sm font-semibold"
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveTitle()
                if (e.key === 'Escape') {
                  setTitleDraft(column.title)
                  setEditingTitle(false)
                }
              }}
            />
          ) : (
            <h3
              title={readOnly ? undefined : 'Двойной клик чтобы редактировать'}
              onDoubleClick={() => {
                if (!readOnly) {
                  setTitleDraft(column.title)
                  setEditingTitle(true)
                }
              }}
              className={cn(
                'min-w-0 flex-1 truncate text-sm font-semibold text-foreground',
                !readOnly && 'cursor-text',
              )}
            >
              {column.title}
            </h3>
          )}

          <Badge variant="secondary" className="h-5 shrink-0 px-2 text-xs font-medium">
            {column.cards.length}
          </Badge>

          {/* Без настроенного AI кнопки нет; пока карточки скрыты — отключена с пояснением */}
          {!readOnly && aiEnabled !== false && ungroupedTotalCount >= 2 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn('inline-flex shrink-0', cardsHidden && 'cursor-not-allowed')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 shrink-0 text-primary hover:bg-primary/10"
                    onClick={handleAutoCluster}
                    disabled={clustering || cardsHidden}
                    aria-label="Сгруппировать похожие (AI)"
                    title={cardsHidden ? undefined : 'Сгруппировать похожие (AI)'}
                    data-testid="ai-cluster-btn"
                  >
                    {clustering ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {cardsHidden
                  ? 'AI-группировка станет доступна после раскрытия карточек'
                  : 'Сгруппировать похожие (AI)'}
              </TooltipContent>
            </Tooltip>
          )}

          {!readOnly && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn('inline-flex shrink-0', !canDeleteColumn && 'cursor-not-allowed')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                    disabled={!canDeleteColumn}
                    aria-label="Удалить колонку"
                    title={canDeleteColumn ? 'Удалить колонку' : undefined}
                    data-testid="delete-column-btn"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {canDeleteColumn ? 'Удалить колонку' : CANNOT_DELETE_COLUMN_HINT}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Scrollable cards area */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={setCardsAreaRef}
            onScroll={handleCardsScroll}
            data-scrolling={isScrolling ? 'true' : undefined}
            className="scrollbar-subtle flex-1 space-y-2.5 overflow-y-auto px-3 pt-1.5 pb-3 min-h-[72px]"
          >
          <SortableContext
            items={filteredAndSortedCards.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {groups.map((group) => {
              const groupCards = filteredAndSortedCards.filter((c) => c.group_id === group.id)
              if (groupCards.length === 0 && (searchQuery.trim() || onlyMine || Boolean(colorFilter))) return null
              return (
                <CardGroupWidget
                  key={group.id}
                  group={group}
                  cards={groupCards}
                  collapsed={Boolean(collapsedGroups[group.id])}
                  onToggleCollapse={() => onToggleCollapse(group.id)}
                  currentUserId={myId}
                  isModerator={isModerator}
                  voterNames={voterNames}
                  maxVotes={maxVotes}
                  userTotalVotes={userTotalVotes}
                  onUpdated={onGroupUpdated}
                  onDeleted={onGroupDeleted}
                  onCardUpdated={onCardUpdated}
                  onCardDeleted={onCardDeleted}
                  groupTargetId={groupTargetId}
                  dragDisabled={dragDisabled}
                  anonymous={anonymous}
                  readOnly={readOnly}
                  spotlightCardId={spotlightCardId}
                  newCardIds={recentNewIds}
                  revealedCardIds={revealedCardIds}
                  revealDelayMap={revealDelayMap}
                  onSpotlight={onSpotlight}
                  onCreateActionItem={onCreateActionItem}
                  allowMultipleVotes={allowMultipleVotes}
                  selectedCardIds={selectedCardIds}
                  onToggleSelectCard={onToggleSelectCard}
                  otherColumns={otherColumns}
                  onCardMoved={onCardMoved}
                />
              )
            })}

            {ungroupedCards.map((card) => (
              <CardWidget
                key={card.id}
                card={card}
                currentUserId={myId}
                isModerator={isModerator}
                voterNames={voterNames}
                maxVotes={maxVotes}
                userTotalVotes={userTotalVotes}
                onUpdated={onCardUpdated}
                onDeleted={onCardDeleted}
                isGroupTarget={groupTargetId === card.id}
                dragDisabled={dragDisabled}
                anonymous={anonymous}
                readOnly={readOnly}
                isSpotlighted={spotlightCardId === card.id}
                isNew={recentNewIds.has(card.id)}
                justRevealed={revealedCardIds.has(card.id)}
                revealDelayMs={revealDelayMap[card.id] ?? 0}
                onSpotlight={onSpotlight}
                onCreateActionItem={onCreateActionItem}
                allowMultipleVotes={allowMultipleVotes}
                selected={selectedCardIds?.has(card.id) ?? false}
                onToggleSelect={onToggleSelectCard}
                otherColumns={otherColumns}
                onMoved={onCardMoved}
              />
            ))}
          </SortableContext>

          {filteredAndSortedCards.length === 0 && !composerOpen && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-xs text-muted-foreground">
              <span>Пока нет карточек</span>
            </div>
          )}

          {otherTypingUsers.length > 0 && (
            <div
              data-testid={`column-typing-${column.id}`}
              className="flex items-center gap-1.5 px-1.5 py-1 text-[11px] text-muted-foreground"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              <span className="truncate">
                {cardsHidden || anonymous
                  ? otherTypingUsers.length > 1
                    ? 'Несколько участников пишут...'
                    : 'Кто-то пишет...'
                  : otherTypingUsers.length === 1
                    ? `${otherTypingUsers[0]} пишет...`
                    : `${otherTypingUsers.slice(0, 2).join(', ')} пишут...`}
              </span>
            </div>
          )}
          </div>
          {hasMoreBelow && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-linear-to-t/srgb from-card/90 to-transparent"
            />
          )}
        </div>

        {/* Inline card composer */}
        <div className="shrink-0 border-t px-3 py-2.5">
          <AnimatePresence initial={false}>
            {composerOpen && canCreateCard ? (
              <motion.div
                key="composer-form"
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="space-y-2 rounded-xl border bg-background p-2.5 shadow-xs"
              >
                <Textarea
                  ref={textareaRef}
                  value={draftText}
                  onChange={(e) => {
                    const nextVal = e.target.value
                    setDraftText(nextVal)
                    emitTyping(nextVal.trim().length > 0)
                  }}
                  onBlur={() => emitTyping(false)}
                  rows={2}
                  autoFocus
                  placeholder="Опишите мысль... (Enter — добавить)"
                  className="min-h-[60px] resize-none border-0 bg-transparent p-1 text-sm focus-visible:ring-0"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      emitTyping(false)
                      void handleAddCard()
                    } else if (e.key === 'Escape') {
                      emitTyping(false)
                      setComposerOpen(false)
                    }
                  }}
                />
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1">
                    {CARD_COLOR_PRESETS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setDraftColor(c.hex)}
                        title={c.name}
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-full border transition-transform hover:scale-110',
                          c.swatchClass,
                          draftColor.toLowerCase() === c.hex.toLowerCase() &&
                            'ring-2 ring-primary ring-offset-1 ring-offset-background',
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
                      size="icon-sm"
                      className="h-7 w-7"
                      onClick={() => {
                        emitTyping(false)
                        setComposerOpen(false)
                      }}
                      aria-label="Отменить"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-3 text-xs"
                      disabled={!draftText.trim() || creating}
                      onClick={() => {
                        emitTyping(false)
                        void handleAddCard()
                      }}
                    >
                      {creating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      Добавить
                    </Button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <Button
                key="composer-btn"
                type="button"
                variant="ghost"
                data-column-add-btn="true"
                disabled={!canCreateCard}
                onClick={() => setComposerOpen(true)}
                className="w-full justify-start gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
                Добавить карточку
              </Button>
            )}
          </AnimatePresence>
        </div>
      </motion.section>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить колонку «{column.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Колонка и все её карточки ({column.cards.length}) будут удалены безвозвратно.
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
