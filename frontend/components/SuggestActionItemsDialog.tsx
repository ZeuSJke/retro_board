'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Sparkles, User } from 'lucide-react'
import type { ActionItemSuggestion } from '../types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface EditableSuggestion extends ActionItemSuggestion {
  checked: boolean
  assignee: string
}

interface SuggestActionItemsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  suggestions: ActionItemSuggestion[]
  submitting?: boolean
  onCreateSelected: (items: { title: string; text: string; assignee: string | null; source_card_ids: string[] }[]) => Promise<void>
}

export default function SuggestActionItemsDialog({
  open,
  onOpenChange,
  loading,
  suggestions,
  submitting = false,
  onCreateSelected,
}: SuggestActionItemsDialogProps) {
  const [items, setItems] = useState<EditableSuggestion[]>([])

  useEffect(() => {
    setItems(
      suggestions.map((s) => ({
        ...s,
        checked: true,
        assignee: s.assignee_hint || '',
      })),
    )
  }, [suggestions])

  const selectedItems = useMemo(
    () =>
      items
        .filter((i) => i.checked && (i.title.trim() || i.text.trim()))
        .map((i) => ({
          title: i.title.trim() || i.text.trim().slice(0, 70),
          text: i.text.trim() || i.title.trim(),
          assignee: i.assignee.trim() || null,
          source_card_ids: i.source_card_ids || [],
        })),
    [items],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI-подбор Action Items
          </DialogTitle>
          <DialogDescription>
            AI проанализировал карточки и голоса команды. Выберите подходящие задачи и при необходимости подправьте формулировки.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span>Анализируем карточки доски и формулируем задачи...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
            AI не нашёл достаточно данных для предложений. Добавьте больше карточек обсуждения.
          </div>
        ) : (
          <ScrollArea className="max-h-[56vh] pr-2">
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'rounded-xl border p-3 transition-colors',
                    item.checked ? 'border-primary/30 bg-primary/[0.03]' : 'bg-muted/30 opacity-70',
                  )}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Checkbox
                      checked={item.checked}
                      onCheckedChange={(v) =>
                        setItems((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, checked: Boolean(v) } : x)),
                        )
                      }
                      aria-label={`Выбрать задачу ${item.title}`}
                    />
                    <Input
                      value={item.title}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)),
                        )
                      }
                      placeholder="Заголовок задачи"
                      className="h-8 flex-1 text-sm font-medium"
                      maxLength={100}
                    />
                  </div>
                  <div className="space-y-2 pl-6">
                    <Textarea
                      value={item.text}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)),
                        )
                      }
                      rows={2}
                      placeholder="Описание задачи"
                      className="resize-none text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <Input
                        value={item.assignee}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, assignee: e.target.value } : x)),
                          )
                        }
                        placeholder="Ответственный (опционально)"
                        className="h-7 text-xs"
                        maxLength={60}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button
            onClick={() => onCreateSelected(selectedItems)}
            disabled={loading || submitting || selectedItems.length === 0}
            className="gap-1.5"
          >
            <Check className="h-4 w-4" />
            {submitting ? 'Создаём...' : `Добавить выбранные (${selectedItems.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
