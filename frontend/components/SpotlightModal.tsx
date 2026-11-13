'use client'

import { ListTodo, Sparkles, ThumbsUp, User } from 'lucide-react'
import { getCardColorPreset } from '@/lib/board-themes'
import type { Card, Column } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface SpotlightModalProps {
  card: Card | null
  column?: Column
  anonymous: boolean
  isFacilitator: boolean
  currentUser: string
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
  onClose,
  onCreateActionItem,
  onLike,
}: SpotlightModalProps) {
  if (!card) return null
  const preset = getCardColorPreset(card.color)
  const liked = card.likes.includes(currentUser)

  return (
    <Dialog open={Boolean(card)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl" hideClose={!isFacilitator}>
        <DialogHeader>
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
        </DialogHeader>

        <div className={`rounded-2xl border p-5 shadow-sm ${preset.cardClass}`}>
          <p className="text-lg font-medium leading-relaxed text-foreground whitespace-pre-wrap">
            {card.text}
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
              onClick={() => onLike(card.id)}
              className="gap-1.5 font-mono"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              {card.likes.length}
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onCreateActionItem(card)}
          >
            <ListTodo className="h-4 w-4 text-primary" />
            Создать Action Item
          </Button>
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
