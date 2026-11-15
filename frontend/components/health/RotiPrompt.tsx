'use client'

import { useState } from 'react'
import { Loader2, ThumbsUp } from 'lucide-react'
import type { RotiValue } from '@/types/health'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ROTI_MAX, ROTI_MIN, ROTI_VALUES } from './scale'
import type { HealthCheckController } from './useHealthCheck'

interface RotiPromptProps {
  /** Состояние опроса из `useHealthCheck(boardId)`. */
  health: HealthCheckController
}

const ROTI_HINTS: Record<RotiValue, string> = {
  1: 'зря потратили время',
  2: 'пользы мало',
  3: 'нормально',
  4: 'полезно',
  5: 'очень полезно',
}

/**
 * Оценка встречи одним кликом от 1 до 5. Открывается по событию `roti_requested`
 * (ведущий завершил сессию) или вручную через `health.openRoti()`.
 */
export default function RotiPrompt({ health }: RotiPromptProps) {
  // Какая кнопка сейчас отправляется — чтобы показать индикатор именно на ней
  const [pending, setPending] = useState<RotiValue | null>(null)

  const handleRate = async (value: RotiValue) => {
    if (health.submitting) return
    setPending(value)
    await health.submitRoti(value)
    setPending(null)
  }

  return (
    <Dialog
      open={health.rotiOpen}
      onOpenChange={(open) => {
        if (!open) health.closeRoti()
      }}
    >
      <DialogContent className="max-w-md" data-testid="roti-prompt">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ThumbsUp className="h-5 w-5 text-primary" aria-hidden="true" />
            Оцените встречу
          </DialogTitle>
          <DialogDescription>
            Стоила ли она потраченного времени? Достаточно одного нажатия — команда увидит только
            среднюю оценку.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="grid grid-cols-5 gap-2" role="group" aria-label="Оценка встречи">
            {ROTI_VALUES.map((value) => {
              const selected = health.myRoti === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${value} — ${ROTI_HINTS[value]}`}
                  title={ROTI_HINTS[value]}
                  disabled={health.submitting}
                  data-testid={`roti-option-${value}`}
                  onClick={() => handleRate(value)}
                  className={cn(
                    'flex h-14 items-center justify-center rounded-xl border font-mono text-xl font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:border-primary/60 hover:bg-primary/10',
                  )}
                >
                  {pending === value ? <Loader2 className="h-5 w-5 animate-spin" /> : value}
                </button>
              )
            })}
          </div>
          <div className="flex justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {ROTI_MIN} — {ROTI_HINTS[1]}
            </span>
            <span className="text-right">
              {ROTI_MAX} — {ROTI_HINTS[5]}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={health.closeRoti}>
            Не сейчас
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
