'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Inbox, Loader2, RefreshCw, Settings2, Sparkles, User } from 'lucide-react'
import type { ActionItemSuggestion } from '../types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface EditableSuggestion extends ActionItemSuggestion {
  checked: boolean
  assignee: string
}

/**
 * Почему предложений нет, если дело не в данных: `not_configured` — AI на сервере не настроен
 * (повторять бессмысленно), `error` — сервис не ответил или вернул ошибку (можно повторить).
 * Пустой список без `failure` — AI отработал, но предложить нечего («мало данных»).
 */
export interface SuggestFailure {
  kind: 'error' | 'not_configured'
  message: string
}

interface SuggestActionItemsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  suggestions: ActionItemSuggestion[]
  failure?: SuggestFailure | null
  /** Повторить запрос после ошибки. */
  onRetry?: () => void
  submitting?: boolean
  onCreateSelected: (
    items: { title: string; text: string; assignee: string | null; source_card_ids: string[] }[],
  ) => Promise<void>
}

export default function SuggestActionItemsDialog({
  open,
  onOpenChange,
  loading,
  suggestions,
  failure = null,
  onRetry,
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

  const allSelected = items.length > 0 && items.every((i) => i.checked)

  const handleToggleAll = () => {
    const next = !allSelected
    setItems((prev) => prev.map((x) => ({ ...x, checked: next })))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="structured" className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI-подбор задач
          </DialogTitle>
          <DialogDescription>
            AI предлагает задачи по карточкам и голосам команды. Выберите подходящие и при
            необходимости скорректируйте формулировки.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3 bg-muted/15">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span>Анализируем карточки доски и формулируем задачи...</span>
            </div>
          ) : failure?.kind === 'not_configured' ? (
            <div
              data-testid="suggest-not-configured"
              className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-background/60 px-6 py-10 text-center text-sm text-muted-foreground"
            >
              <Settings2 className="h-6 w-6 opacity-60" aria-hidden="true" />
              <p className="font-medium text-foreground">AI на этом сервере не настроен</p>
              <p className="max-w-md">
                Подбор задач недоступен. Задачи можно добавить вручную — кнопкой «Добавить» или
                прямо с карточки.
              </p>
            </div>
          ) : failure ? (
            <div
              role="alert"
              data-testid="suggest-error"
              className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-6 py-10 text-center text-sm text-muted-foreground"
            >
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
              <p className="font-medium text-foreground">{failure.message}</p>
              <p className="max-w-md">
                AI-сервис не ответил или вернул ошибку. Попробуйте ещё раз — или добавьте задачи
                вручную.
              </p>
              {onRetry && (
                <Button type="button" size="sm" className="mt-1" onClick={onRetry}>
                  <RefreshCw className="h-4 w-4" />
                  Повторить
                </Button>
              )}
            </div>
          ) : items.length === 0 ? (
            <div
              data-testid="suggest-empty"
              className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-background/60 px-6 py-10 text-center text-sm text-muted-foreground"
            >
              <Inbox className="h-6 w-6 opacity-60" aria-hidden="true" />
              <p className="font-medium text-foreground">Предложить пока нечего</p>
              <p className="max-w-md">
                На доске мало карточек, или в них нет того, что можно превратить в задачу.
                Добавьте карточки с проблемами и идеями и попробуйте ещё раз.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
                <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-foreground/85 transition-colors hover:text-primary">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={handleToggleAll}
                    aria-label={allSelected ? 'Снять все' : 'Выбрать все'}
                  />
                  <span>{allSelected ? 'Снять все' : 'Выбрать все'}</span>
                </label>
                <span className="tabular-nums">
                  Выбрано: {selectedItems.length} из {items.length}
                </span>
              </div>

              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border bg-card p-3.5 transition-all',
                      item.checked
                        ? 'border-primary/35 ring-1 ring-primary/10'
                        : 'border-border/70 bg-muted/40 opacity-65',
                    )}
                  >
                    <Checkbox
                      checked={item.checked}
                      onCheckedChange={(v) =>
                        setItems((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, checked: Boolean(v) } : x)),
                        )
                      }
                      aria-label={`Выбрать задачу ${item.title}`}
                      className="mt-2 shrink-0"
                    />
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <Input
                        value={item.title}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)),
                          )
                        }
                        placeholder="Заголовок задачи"
                        className="h-8 bg-background/80 text-sm font-medium"
                        maxLength={100}
                      />
                      <Textarea
                        autoResize
                        value={item.text}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)),
                          )
                        }
                        placeholder="Описание задачи и ожидаемый результат"
                        className="min-h-[68px] bg-background/80 text-sm leading-relaxed"
                      />
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <Input
                          value={item.assignee}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, assignee: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="Ответственный (опционально)"
                          className="h-7 bg-background/80 text-xs sm:max-w-xs"
                          maxLength={60}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogBody>

        <DialogFooter>
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
