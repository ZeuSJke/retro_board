'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRightLeft,
  Check,
  GitMerge,
  Layers,
  ListTodo,
  Palette,
  Trash2,
  X,
} from 'lucide-react'
import { CARD_COLOR_PRESETS } from '@/lib/board-themes'
import type { Card, Column } from '@/types'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface BulkActionsBarProps {
  selectedCards: Card[]
  columns: Column[]
  busy?: boolean
  onClear: () => void
  onBulkGroup: (title: string) => Promise<void>
  onBulkColor: (hex: string) => Promise<void>
  onBulkMove: (columnId: string) => Promise<void>
  onBulkCreateActionItem: () => Promise<void>
  onBulkDelete: () => Promise<void>
  /** Можно ли удалить выбранное: чужие карточки удаляет только модератор доски. */
  canDelete?: boolean
  onMergeCards: (targetText: string) => Promise<void>
  /** Почему выбранное нельзя объединить (чужие карточки, скрытый сбор); пусто — можно. */
  mergeBlockedReason?: string | null
}

export default function BulkActionsBar({
  selectedCards,
  columns,
  busy = false,
  onClear,
  onBulkGroup,
  onBulkColor,
  onBulkMove,
  onBulkCreateActionItem,
  onBulkDelete,
  canDelete = true,
  onMergeCards,
  mergeBlockedReason = null,
}: BulkActionsBarProps) {
  const [groupTitle, setGroupTitle] = useState('')
  const [groupOpen, setGroupOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeText, setMergeText] = useState('')

  const count = selectedCards.length
  const distinctCols = new Set(selectedCards.map((c) => c.column_id))
  const sameColumn = distinctCols.size === 1

  const openMergeModal = () => {
    const joined = selectedCards
      .map((c) => c.text.trim())
      .filter(Boolean)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .join('\n')
      .slice(0, 2000)
    setMergeText(joined)
    setMergeOpen(true)
  }

  return (
    <>
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            data-testid="bulk-actions-bar"
            className="no-print fixed bottom-5 left-1/2 z-40 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-2xl border bg-popover/95 px-3 py-2 shadow-xl backdrop-blur-md"
          >
            <Badge variant="default" className="h-7 gap-1 px-2.5 text-xs font-semibold">
              Выбрано: {count}
            </Badge>

            <Popover open={groupOpen} onOpenChange={setGroupOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || count < 2 || !sameColumn}
                  title={
                    !sameColumn
                      ? 'Выберите карточки из одной колонки'
                      : count < 2
                        ? 'Выберите минимум 2 карточки'
                        : 'Объединить в группу'
                  }
                  className="h-8 gap-1.5 text-xs"
                >
                  <Layers className="h-3.5 w-3.5" />
                  Сгруппировать
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" className="w-64 p-3">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault()
                    await onBulkGroup(groupTitle.trim() || 'Новая группа')
                    setGroupTitle('')
                    setGroupOpen(false)
                  }}
                  className="space-y-2"
                >
                  <div className="text-xs font-semibold">Название группы</div>
                  <Input
                    value={groupTitle}
                    onChange={(e) => setGroupTitle(e.target.value)}
                    placeholder="Например: CI/CD"
                    autoFocus
                    className="h-8 text-xs"
                    maxLength={120}
                  />
                  <Button type="submit" size="sm" className="h-8 w-full text-xs" disabled={busy}>
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Создать группу
                  </Button>
                </form>
              </PopoverContent>
            </Popover>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || count < 2 || Boolean(mergeBlockedReason)}
              onClick={openMergeModal}
              title={mergeBlockedReason || 'Объединить дубли в одну карточку с сохранением голосов'}
              className="h-8 gap-1.5 text-xs"
              data-testid="bulk-merge-btn"
            >
              <GitMerge className="h-3.5 w-3.5" />
              Объединить
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onBulkCreateActionItem}
              title="Создать общую задачу по выбранным карточкам"
              className="h-8 gap-1.5 text-xs"
            >
              <ListTodo className="h-3.5 w-3.5 text-primary" />
              В задачу
            </Button>

            <Popover open={colorOpen} onOpenChange={setColorOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Palette className="h-3.5 w-3.5" />
                  Цвет
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" className="w-auto p-2.5">
                <div className="flex items-center gap-1.5">
                  {CARD_COLOR_PRESETS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      title={c.name}
                      aria-label={`Цвет карточек: ${c.name}`}
                      onClick={async () => {
                        await onBulkColor(c.hex)
                        setColorOpen(false)
                      }}
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full border transition-transform hover:scale-110 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary',
                        c.swatchClass,
                      )}
                    >
                      {c.id !== 'default' && (
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: c.accentDot }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {columns.length > 1 && (
              <Popover open={moveOpen} onOpenChange={setMoveOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    В колонку
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" className="w-56 p-1.5">
                  <div className="space-y-0.5">
                    {columns.map((col) => (
                      <button
                        key={col.id}
                        type="button"
                        onClick={async () => {
                          await onBulkMove(col.id)
                          setMoveOpen(false)
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: col.color }}
                        />
                        <span className="truncate">{col.title}</span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || !canDelete}
              onClick={() => setDeleteConfirmOpen(true)}
              title={
                canDelete
                  ? undefined
                  : 'Среди выбранных есть чужие карточки: удалить их может создатель доски или ведущий'
              }
              data-testid="bulk-delete-btn"
              className="h-8 gap-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Удалить
            </Button>

            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onClear}
              title="Снять выделение (Esc)"
              aria-label="Снять выделение"
              className="h-7 w-7"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="h-4 w-4 text-primary" />
              Объединить дубли ({count} карточек)
            </DialogTitle>
            <DialogDescription>
              Выбранные карточки будут объединены в одну, а их голоса суммируются без дублирования.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={mergeText}
            onChange={(e) => setMergeText(e.target.value)}
            rows={5}
            maxLength={2000}
            className="text-sm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)} disabled={busy}>
              Отмена
            </Button>
            <Button
              disabled={busy || !mergeText.trim()}
              onClick={async () => {
                await onMergeCards(mergeText.trim())
                setMergeOpen(false)
              }}
            >
              Объединить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить выбранные карточки ({count})?</AlertDialogTitle>
            <AlertDialogDescription>
              Все выделенные карточки будут удалены с доски для всей команды.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setDeleteConfirmOpen(false)
                await onBulkDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить ({count})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
