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

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'K'], label: 'Палитра команд и поиск по карточкам/доскам' },
  { keys: ['N'], label: 'Быстро добавить карточку в первую колонку' },
  { keys: ['F', '/'], label: 'Фокус на фильтр поиска карточек' },
  { keys: ['M'], label: 'Открыть или скрыть боковую панель «Итоги»' },
  { keys: ['R'], label: 'Открыть панель быстрых реакций' },
  { keys: ['←', '→'], label: 'Предыдущая / следующая карточка в Spotlight (фасилитатор)' },
  { keys: ['Shift + клик'], label: 'Выделить несколько карточек для массовых действий' },
  { keys: ['Esc'], label: 'Снять выделение карточек или закрыть окно' },
  { keys: ['?'], label: 'Показать эту шпаргалку' },
]

export default function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-primary" />
            Горячие клавиши
          </DialogTitle>
          <DialogDescription>
            Работают на доске, когда фокус не находится в текстовом поле.
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border/60">
          {SHORTCUTS.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <span className="text-foreground">{item.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {item.keys.map((k, idx) => (
                  <span key={k} className="inline-flex items-center gap-1">
                    {idx > 0 && item.keys.length === 2 && k === '/' ? (
                      <span className="text-xs text-muted-foreground">или</span>
                    ) : null}
                    <kbd className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
                      {k}
                    </kbd>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
