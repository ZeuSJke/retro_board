'use client'

import { useEffect } from 'react'
import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight, ListTodo, Sparkles, ThumbsUp, User } from 'lucide-react'
import { getCardColorPreset } from '@/lib/board-themes'
import type { Card, Column } from '@/types'
import { RichCardText } from './RichCardText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface SpotlightQueueItem {
  card: Card
  columnTitle: string
}

interface SpotlightModalProps {
  card: Card | null
  column?: Column
  anonymous: boolean
  isFacilitator: boolean
  currentUser: string
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
  onLike: (cardId: string) => void
}

export default function SpotlightModal({
  card,
  column,
  anonymous,
  isFacilitator,
  currentUser,
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
  onLike,
}: SpotlightModalProps) {
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
  const myVotes = card.likes.filter((u) => u === currentUser).length
  const liked = myVotes > 0
  const canAddMore = !(maxVotes > 0 && userTotalVotes >= maxVotes)
  const limitReached = allowMultipleVotes ? !canAddMore : !liked && !canAddMore
  const voteDisabled = readOnly || limitReached

  return (
    <Dialog open={Boolean(card)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl" hideClose={!isFacilitator}>
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              В фокусе обсуждения
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

            {queueCards.length > 0 && currentIdx >= 0 && (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {currentIdx + 1} / {queueCards.length}
              </span>
            )}
          </div>

          {isFacilitator && queueCards.length > 1 && onSelectCard && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
              {onQueueModeChange ? (
                <div className="inline-flex rounded-lg border bg-muted/50 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => onQueueModeChange('all')}
                    className={cn(
                      'rounded-md px-2 py-1 font-medium transition-colors',
                      queueMode === 'all'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Все подряд
                  </button>
                  <button
                    type="button"
                    onClick={() => onQueueModeChange('top_votes')}
                    className={cn(
                      'rounded-md px-2 py-1 font-medium transition-colors',
                      queueMode === 'top_votes'
                        ? 'bg-background text-foreground shadow-xs'
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
                  className="h-7 px-2 text-xs"
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
                  className="h-7 px-2 text-xs"
                >
                  Следующая
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </DialogHeader>

        <motion.div
          key={card.id}
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className={`rounded-2xl border p-5 shadow-sm ${preset.cardClass}`}
        >
          <p className="whitespace-pre-wrap break-words text-lg font-medium leading-relaxed text-foreground">
            <RichCardText text={card.text} />
          </p>

          <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              <span>
                {anonymous && card.author !== currentUser
                  ? 'Анонимный участник'
                  : card.author}
              </span>
            </div>
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
        </motion.div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onCreateActionItem(card)}
            >
              <ListTodo className="h-4 w-4 text-primary" />
              Создать Action Item
            </Button>
            {isFacilitator && nextItem && onSelectCard && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onCreateActionItem(card)
                  onSelectCard(nextItem.card.id)
                }}
              >
                В задачу и далее
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
          {isFacilitator && (
            <Button type="button" onClick={onClose}>
              Снять фокус для всех
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
