'use client'

import { Keyboard } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ShortcutRow {
  /** Клавиши одной строки: `keys` нажимаются вместе, `alternatives` — любая из них. */
  keys?: string[]
  alternatives?: string[]
  label: string
}

/**
 * Шпаргалка описывает то, что доска делает на самом деле: обработчики клавиш — в `BoardPage`,
 * `CommandPaletteLazy` и `SpotlightModal`, выделение — в `CardWidget` (кружок на месте аватара),
 * группировка перетаскиванием — в `hooks/useBoardDragDrop.ts`. Меняете поведение там — поправьте здесь.
 */
export const KEYBOARD_SHORTCUTS: ShortcutRow[] = [
  { keys: ['Ctrl', 'K'], label: 'Палитра команд: поиск досок, карточек и действий' },
  { keys: ['N'], label: 'Добавить карточку в первую колонку' },
  { alternatives: ['F', '/'], label: 'Перейти к поиску по карточкам' },
  { keys: ['M'], label: 'Открыть или скрыть панель «Задачи»' },
  { keys: ['R'], label: 'Открыть быстрые реакции' },
  {
    alternatives: ['←', '→'],
    label: 'Предыдущая или следующая карточка в окне фокуса — у ведущего, а вне сессии у любого участника',
  },
  { keys: ['Esc'], label: 'Снять выделение карточек или закрыть окно' },
  { keys: ['?'], label: 'Показать эту шпаргалку' },
]

export const MOUSE_SHORTCUTS: ShortcutRow[] = [
  {
    keys: ['Клик'],
    label: 'По кружку слева от автора (появляется при наведении) — выделить карточку для действий с несколькими',
  },
  {
    keys: ['Shift', 'клик'],
    label: 'По кружку другой карточки — выделить все карточки между ней и выбранной раньше',
  },
  {
    keys: ['Перетащить'],
    label: 'На карточку из группы — добавить в эту группу; в панель «Задачи» — создать задачу',
  },
  {
    alternatives: ['Alt', 'Shift'],
    label: 'Удерживать, перетаскивая карточку на другую, — объединить их в новую группу',
  },
]

function Keys({ row }: { row: ShortcutRow }) {
  const combo = row.keys ?? []
  const options = row.alternatives ?? []
  return (
    <span className="flex shrink-0 items-center gap-1">
      {combo.map((key, idx) => (
        <span key={key} className="inline-flex items-center gap-1">
          {idx > 0 && <span className="text-xs text-muted-foreground">+</span>}
          <kbd className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
            {key}
          </kbd>
        </span>
      ))}
      {options.map((key, idx) => (
        <span key={key} className="inline-flex items-center gap-1">
          {idx > 0 && <span className="text-xs text-muted-foreground">или</span>}
          <kbd className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
            {key}
          </kbd>
        </span>
      ))}
    </span>
  )
}

function ShortcutList({ title, rows }: { title: string; rows: ShortcutRow[] }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border/60">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 py-2 text-sm"
            data-testid="shortcut-row"
          >
            <span className="text-foreground">{row.label}</span>
            <Keys row={row} />
          </div>
        ))}
      </div>
    </section>
  )
}

export default function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-primary" />
            Горячие клавиши
          </DialogTitle>
          <DialogDescription>
            Клавиши работают на доске, когда курсор не в текстовом поле и не открыто окно или меню.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ShortcutList title="Клавиатура" rows={KEYBOARD_SHORTCUTS} />
          <ShortcutList title="Мышь" rows={MOUSE_SHORTCUTS} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
