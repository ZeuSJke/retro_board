'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock,
  Focus,
  ListTodo,
  Minus,
  Plus,
  ThumbsUp,
  User,
} from 'lucide-react'
import { ACTION_ITEM_STATUS_META } from '@/lib/action-items'
import { getCardColorPreset, getUserAvatarGradient, getUserInitials } from '@/lib/board-themes'
import { avatarSeed, countMyVotes, isOwnCard } from '@/lib/participants'
import { timerDisplaySeconds } from '@/lib/timer'
import type { ActionItem, Card, Column, TimerState } from '@/types'
import { RichCardText } from './RichCardText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

function formatMmSs(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function SpotlightTimerBadge({ timer }: { timer: TimerState }) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    if (!timer.running) return
    let active = true
    void Promise.resolve().then(() => {
      if (active) setNow(Date.now())
    })
    const id = setInterval(() => {
      setNow(Date.now())
    }, 500)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [timer.running])

  const displaySeconds =
    timer.running && now !== null
      ? timerDisplaySeconds(timer, now)
      : Math.ceil(Math.max(0, timer.remaining))
  const low = displaySeconds <= 30 && displaySeconds > 0

  return (
    <Badge
      variant="outline"
      data-testid="spotlight-timer-badge"
      className={cn(
        'gap-1 font-mono text-xs tabular-nums',
        timer.running && !low && 'border-primary/40 bg-primary/5 text-primary',
        low && 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      )}
    >
      <Clock className="h-3 w-3" />
      {formatMmSs(displaySeconds)}
    </Badge>
  )
}

function SpotlightQuickTaskForm({
  card,
  readOnly,
  onSubmit,
}: {
  card: Card
  readOnly: boolean
  onSubmit: (card: Card, text: string, assignee: string | null) => Promise<void> | void
}) {
  const [text, setText] = useState('')
  const [assignee, setAssignee] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || readOnly || saving) return
    setSaving(true)
    try {
      await onSubmit(card, trimmed, assignee.trim() || null)
      setText('')
      setAssignee('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 pt-1">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Быстрая задача по этой карточке..."
        disabled={readOnly || saving}
        maxLength={500}
        className="h-8 min-w-[180px] flex-1 text-xs"
        data-testid="spotlight-quick-task-input"
      />
      <Input
        value={assignee}
        onChange={(e) => setAssignee(e.target.value)}
        placeholder="Ответственный"
        disabled={readOnly || saving}
        maxLength={80}
        className="h-8 w-36 text-xs"
        data-testid="spotlight-quick-task-assignee"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={readOnly || saving || !text.trim()}
        className="h-8 gap-1 text-xs"
        data-testid="spotlight-quick-task-submit"
      >
        <Plus className="h-3.5 w-3.5" />
        Добавить
      </Button>
    </form>
  )
}

export interface SpotlightQueueItem {
  card: Card
  columnTitle: string
}

interface SpotlightModalProps {
  card: Card | null
  column?: Column
  anonymous: boolean
  /**
   * Участник управляет фокусом (ведущий сессии, а вне сессии — любой): для него закрытие окна
   * снимает фокус у всех (`onClose`). Остальные закрывают окно только у себя.
   */
  isFacilitator: boolean
  /** Идентификатор текущего участника: по нему считаются «мои» голоса и «моя» карточка. */
  currentUserId: string
  readOnly?: boolean
  maxVotes?: number
  userTotalVotes?: number
  allowMultipleVotes?: boolean
  queueCards?: SpotlightQueueItem[]
  queueMode?: 'all' | 'top_votes'
  onQueueModeChange?: (mode: 'all' | 'top_votes') => void
  onSelectCard?: (cardId: string) => void
  onClose: () => void
  onCreateActionItem: (card: Card) => void
  onQuickCreateActionItem?: (card: Card, text: string, assignee: string | null) => Promise<void> | void
  onLike: (cardId: string) => void
  onRemoveVote?: (cardId: string) => void
  timer?: TimerState
  actionItems?: ActionItem[]
}

export default function SpotlightModal({
  card,
  column,
  anonymous,
  isFacilitator,
  currentUserId,
  readOnly = false,
  maxVotes = 0,
  userTotalVotes = 0,
  allowMultipleVotes = false,
  queueCards = [],
  queueMode = 'all',
  onQueueModeChange,
  onSelectCard,
  onClose,
  onCreateActionItem,
  onQuickCreateActionItem,
  onLike,
  onRemoveVote,
  timer,
  actionItems,
}: SpotlightModalProps) {
  // Участник закрыл окно у себя: фокус ведущего остаётся, доска снова доступна. Пока ведущий
  // листает карточки, окно не всплывает заново; новый фокус (после снятия) откроет его снова.
  const hasCard = Boolean(card)
  const [dismissed, setDismissed] = useState(false)
  const [hadCard, setHadCard] = useState(hasCard)
  if (hasCard !== hadCard) {
    setHadCard(hasCard)
    if (!hasCard) setDismissed(false)
  }
  const hiddenLocally = dismissed && !isFacilitator

  const currentIdx = card ? queueCards.findIndex((item) => item.card.id === card.id) : -1
  const prevItem =
    currentIdx >= 0 && queueCards.length > 1
      ? queueCards[(currentIdx - 1 + queueCards.length) % queueCards.length]
      : null
  const nextItem =
    currentIdx >= 0 && queueCards.length > 1
      ? queueCards[(currentIdx + 1) % queueCards.length]
      : null

  useEffect(() => {
    if (!card || !isFacilitator || !onSelectCard || queueCards.length <= 1) return
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      if (e.key === 'ArrowLeft' && prevItem) {
        e.preventDefault()
        onSelectCard(prevItem.card.id)
      } else if (e.key === 'ArrowRight' && nextItem) {
        e.preventDefault()
        onSelectCard(nextItem.card.id)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [card, isFacilitator, onSelectCard, queueCards.length, prevItem, nextItem])

  if (!card) return null
  const preset = getCardColorPreset(card.color)
  const myVotes = countMyVotes(card, currentUserId)
  const liked = myVotes > 0
  const canAddMore = !(maxVotes > 0 && userTotalVotes >= maxVotes)
  const limitReached = allowMultipleVotes ? !canAddMore : !liked && !canAddMore
  const voteDisabled = readOnly || limitReached
  const isAgent = card.author_kind === 'agent' && !card.masked
  const showAuthor = !anonymous || isOwnCard(card, currentUserId) || isAgent
  const linkedTasks = (actionItems ?? []).filter(
    (item) => !item.superseded_by_id && item.source_card_ids?.includes(card.id),
  )
  const showTimerBadge = Boolean(timer && (timer.running || timer.remaining !== timer.duration))

  // Крестик, Esc и клик по фону: у управляющего фокусом снимают его для всех,
  // у остальных только прячут окно на своём экране
  const handleDismiss = () => {
    if (isFacilitator) onClose()
    else setDismissed(true)
  }

  if (hiddenLocally) {
    // Строка в потоке страницы, а не плавающая плашка: доска — колонка на всю высоту экрана,
    // и строка встаёт под ней, ничего не перекрывая (ни карточки, ни «Добавить карточку»)
    return (
      <div
        role="status"
        data-testid="spotlight-minimized"
        className="no-print flex shrink-0 items-center justify-center gap-2 border-t bg-primary/5 px-3 py-1.5 text-xs"
      >
        <Focus className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 truncate">
          <span className="font-medium">В фокусе обсуждения: </span>
          <span className="text-muted-foreground">
            <RichCardText text={card.text} />
          </span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 shrink-0 px-2.5 text-[11px]"
          onClick={() => setDismissed(false)}
        >
          Открыть
        </Button>
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && handleDismiss()}>
      <DialogContent
        layout="structured"
        className="max-w-2xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Focus className="h-4 w-4 text-primary" />
              <span>В фокусе обсуждения</span>
              {column && (
                <Badge variant="outline" className="ml-1 gap-1.5 font-normal">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: column.color }}
                  />
                  {column.title}
                </Badge>
              )}
            </DialogTitle>

            <div className="flex items-center gap-2">
              {showTimerBadge && timer && <SpotlightTimerBadge timer={timer} />}
              {queueCards.length > 0 && currentIdx >= 0 && (
                <Badge variant="secondary" className="font-mono text-xs tabular-nums">
                  {currentIdx + 1} / {queueCards.length}
                </Badge>
              )}
            </div>
          </div>

          <DialogDescription className="text-xs">
            {isFacilitator
              ? 'Карточку видят все участники. Закрытие окна снимает фокус у всех.'
              : 'Карточку показывает ведущий. Окно можно закрыть у себя — фокус останется, пока ведущий его не снимет.'}
          </DialogDescription>

          {isFacilitator && queueCards.length > 1 && onSelectCard && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              {onQueueModeChange ? (
                <div className="inline-flex rounded-lg border bg-muted/60 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => onQueueModeChange('all')}
                    className={cn(
                      'rounded-md px-2.5 py-1 font-medium transition-colors',
                      queueMode === 'all'
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Все подряд
                  </button>
                  <button
                    type="button"
                    onClick={() => onQueueModeChange('top_votes')}
                    className={cn(
                      'rounded-md px-2.5 py-1 font-medium transition-colors',
                      queueMode === 'top_votes'
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Топ по голосам
                  </button>
                </div>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => prevItem && onSelectCard(prevItem.card.id)}
                  title="Предыдущая (←)"
                  className="h-7 gap-1 px-2.5 text-xs"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Предыдущая
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => nextItem && onSelectCard(nextItem.card.id)}
                  title="Следующая (→)"
                  className="h-7 gap-1 px-2.5 text-xs"
                >
                  Следующая
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4 py-5">
          {/* Фиксированная высота самой карточки исключает прыжки при перелистывании, а прокручиваемый DialogBody вмещает и задачи ниже */}
          <div className={cn('relative flex h-[280px] sm:h-[300px] shrink-0 flex-col rounded-2xl border p-5 transition-colors', preset.cardClass)}>
            {preset.id !== 'default' && (
              <div
                className="absolute bottom-4 left-0 top-4 w-1 rounded-r-full"
                style={{ backgroundColor: preset.accentDot }}
                aria-hidden="true"
              />
            )}

            <motion.div
              key={card.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="flex min-h-0 flex-1 flex-col justify-between"
            >
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle pr-1">
                <p className="whitespace-pre-wrap wrap-break-word text-base font-medium leading-relaxed text-foreground sm:text-lg">
                  <RichCardText text={card.text} />
                </p>
              </div>

              <div className="mt-4 flex shrink-0 items-center justify-between border-t border-border/60 pt-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {showAuthor ? (
                    <>
                      {isAgent ? (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/30 dark:text-violet-300">
                          <Bot className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full bg-linear-to-br/srgb text-[10px] font-bold text-white ${getUserAvatarGradient(avatarSeed(card.author_id, card.author))}`}
                        >
                          {getUserInitials(card.author)}
                        </span>
                      )}
                      <span className="font-medium text-foreground/85">{card.author}</span>
                      {isAgent && (
                        <Badge variant="outline" className="h-4 border-violet-500/30 bg-violet-500/10 px-1.5 text-[10px] text-violet-700 dark:text-violet-300">
                          Агент
                        </Badge>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <User className="h-3.5 w-3.5" />
                      </span>
                      <span>Анонимный участник</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {allowMultipleVotes && myVotes > 0 && onRemoveVote && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      disabled={readOnly}
                      title={readOnly ? 'Доска заблокирована для правок' : 'Убрать один голос'}
                      aria-label="Убрать голос"
                      onClick={() => onRemoveVote(card.id)}
                      data-testid="spotlight-unlike-btn"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={liked ? 'default' : 'outline'}
                    disabled={voteDisabled}
                    title={
                      readOnly
                        ? 'Доска заблокирована для правок'
                        : limitReached
                          ? 'Лимит голосов исчерпан'
                          : liked && !allowMultipleVotes
                            ? 'Убрать лайк'
                            : 'Лайк'
                    }
                    onClick={() => onLike(card.id)}
                    className="gap-1.5 font-mono transition-transform active:scale-95"
                  >
                    <motion.span
                      key={liked ? 'liked' : 'idle'}
                      initial={liked ? { scale: 1.3, rotate: -12 } : false}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                      className="inline-flex"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </motion.span>
                    {card.likes.length}
                    {allowMultipleVotes && myVotes > 0 ? ` (×${myVotes})` : ''}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>

          {(linkedTasks.length > 0 || onQuickCreateActionItem) && (
            <div
              className="shrink-0 space-y-2 rounded-xl border bg-muted/25 p-3"
              data-testid="spotlight-tasks-section"
            >
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <ListTodo className="h-3.5 w-3.5 text-primary" />
                  Задачи по карточке
                </span>
                {linkedTasks.length > 0 && (
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                    {linkedTasks.length}
                  </Badge>
                )}
              </div>

              {linkedTasks.length > 0 && (
                <ul className="space-y-1.5">
                  {linkedTasks.map((t) => {
                    const statusMeta = ACTION_ITEM_STATUS_META[t.status]
                    return (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-2 rounded-lg border bg-background/80 px-2.5 py-1.5 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {t.title || t.text}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {t.assignee && (
                            <span className="max-w-[90px] truncate text-[11px] text-muted-foreground">
                              {t.assignee}
                            </span>
                          )}
                          <Badge variant={statusMeta.badgeVariant} className="text-[10px]">
                            {statusMeta.label}
                          </Badge>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}

              {onQuickCreateActionItem && (
                <SpotlightQuickTaskForm
                  key={card.id}
                  card={card}
                  readOnly={readOnly}
                  onSubmit={onQuickCreateActionItem}
                />
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={readOnly}
              title={readOnly ? 'Доска заблокирована для правок' : undefined}
              onClick={() => onCreateActionItem(card)}
              className="gap-1.5"
            >
              <ListTodo className="h-4 w-4 text-primary" />
              Создать задачу
            </Button>
            {isFacilitator && nextItem && onSelectCard && (
              <Button
                type="button"
                variant="outline"
                disabled={readOnly}
                title={readOnly ? 'Доска заблокирована для правок' : undefined}
                onClick={() => {
                  onCreateActionItem(card)
                  onSelectCard(nextItem.card.id)
                }}
                className="gap-1"
              >
                В задачу и далее
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
          {isFacilitator ? (
            <Button type="button" onClick={onClose} className="shrink-0">
              Снять фокус для всех
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={handleDismiss}
              className="shrink-0"
              data-testid="spotlight-close-local-btn"
            >
              Закрыть у себя
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
