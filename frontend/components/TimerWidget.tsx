'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Pause, Play, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { timerDisplaySeconds } from '@/lib/timer'
import type { TimerState } from '@/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const PRESETS = [
  { label: '3 мин', seconds: 180 },
  { label: '5 мин', seconds: 300 },
  { label: '10 мин', seconds: 600 },
  { label: '15 мин', seconds: 900 },
]

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

/** Как часто виджет сверяется с часами; на экране число меняется раз в секунду. */
const TICK_MS = 200

/**
 * Остаток идущего таймера в секундах. Тик живёт здесь, внутри виджета: состояние таймера
 * у владельца не меняется каждую секунду, и доска из-за отсчёта не перерисовывается.
 */
function useTimerSeconds(timer: TimerState): number {
  const [live, setLive] = useState<{ endsAt: number; seconds: number } | null>(null)

  useEffect(() => {
    if (!timer.running || timer.endsAt == null) return
    const endsAt = timer.endsAt
    const update = () => {
      const seconds = timerDisplaySeconds(timer)
      setLive((prev) =>
        prev && prev.endsAt === endsAt && prev.seconds === seconds ? prev : { endsAt, seconds },
      )
    }
    const interval = setInterval(update, TICK_MS)
    // В фоновой вкладке тик замедляется: при возврате показываем верное число сразу
    document.addEventListener('visibilitychange', update)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', update)
    }
  }, [timer])

  if (timer.running && timer.endsAt != null && live?.endsAt === timer.endsAt) return live.seconds
  return Math.ceil(Math.max(0, timer.remaining))
}

interface TimerWidgetProps {
  /** Состояние таймера: у идущего — момент окончания, а не тикающий счётчик. */
  timer: TimerState
  canControl: boolean
  /** Есть ли что переключать: авто-переход работает только в сессии ведущего. */
  autoAdvanceAvailable?: boolean
  autoAdvance: boolean
  soundMuted: boolean
  onToggleSoundMuted: () => void
  onAutoAdvanceChange: (v: boolean) => void
  onStart: (duration: number, remaining: number) => void
  onPause: () => void
  onReset: (duration: number) => void
  onAddTime: (extraSeconds: number) => void
}

export default function TimerWidget({
  timer,
  canControl,
  autoAdvanceAvailable = true,
  autoAdvance,
  soundMuted,
  onToggleSoundMuted,
  onAutoAdvanceChange,
  onStart,
  onPause,
  onReset,
  onAddTime,
}: TimerWidgetProps) {
  const [open, setOpen] = useState(false)
  const [justExpired, setJustExpired] = useState(false)
  const prevRemainingRef = useRef(timer.remaining)

  useEffect(() => {
    const prev = prevRemainingRef.current
    prevRemainingRef.current = timer.remaining
    if (prev > 0 && timer.remaining === 0) {
      setJustExpired(true)
      const t = setTimeout(() => setJustExpired(false), 2600)
      return () => clearTimeout(t)
    }
  }, [timer.remaining])

  const seconds = useTimerSeconds(timer)
  const ratio = timer.duration > 0 ? Math.max(0, Math.min(1, seconds / timer.duration)) : 0
  const urgent = timer.running && seconds <= 30 && seconds > 0
  const circumference = 2 * Math.PI * 10
  const strokeDashoffset = circumference * (1 - ratio)

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <motion.button
            type="button"
            animate={justExpired ? { scale: [1, 1.08, 0.97, 1.04, 1] } : { scale: 1 }}
            transition={{ duration: 0.55 }}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
              justExpired
                ? 'border-amber-500/70 bg-amber-500/15 text-amber-600 ring-2 ring-amber-500/35 dark:text-amber-400'
                : timer.running
                  ? urgent
                    ? 'border-destructive/50 bg-destructive/10 text-destructive animate-pulse ring-2 ring-destructive/20'
                    : 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border bg-background hover:bg-muted/70 text-foreground',
            )}
          >
            <svg className="h-5 w-5 -rotate-90" viewBox="0 0 24 24" aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                className="opacity-20"
              />
              <circle
                cx="12"
                cy="12"
                r="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-[stroke-dashoffset] duration-1000 ease-linear"
              />
            </svg>
            <span className="font-mono text-xs font-bold tabular-nums" data-testid="timer-display">
              {formatTime(seconds)}
            </span>
          </motion.button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-72 space-y-3 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Таймер этапа
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onToggleSoundMuted}
              title={soundMuted ? 'Включить звук' : 'Отключить звук'}
            >
              {soundMuted ? (
                <VolumeX className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Volume2 className="h-4 w-4 text-primary" />
              )}
            </Button>
          </div>

          <div className="text-center font-mono text-3xl font-bold tabular-nums text-foreground">
            {formatTime(seconds)}
          </div>

          {canControl ? (
            <>
              <div className="flex items-center justify-center gap-2">
                {timer.running ? (
                  <Button size="sm" variant="secondary" onClick={onPause} className="flex-1">
                    <Pause className="h-3.5 w-3.5" />
                    Пауза
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() =>
                      onStart(timer.duration, timer.remaining > 0 ? timer.remaining : timer.duration)
                    }
                    className="flex-1"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Старт
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onReset(timer.duration)}
                  title="Сбросить"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  onClick={() => onAddTime(60)}
                >
                  <Plus className="h-3 w-3" />1 мин
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  onClick={() => onAddTime(120)}
                >
                  <Plus className="h-3 w-3" />2 мин
                </Button>
              </div>

              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {PRESETS.map((p) => (
                  <Button
                    key={p.seconds}
                    type="button"
                    size="sm"
                    variant={timer.duration === p.seconds ? 'secondary' : 'ghost'}
                    className="h-7 px-1 text-xs"
                    onClick={() => onReset(p.seconds)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 border-t pt-2.5 text-xs">
                <span className="text-muted-foreground">
                  Авто-переход после 00:00
                  {!autoAdvanceAvailable && (
                    <span className="block text-[11px]" data-testid="auto-advance-hint">
                      Работает в сессии ведущего: переключает этапы
                    </span>
                  )}
                </span>
                <Switch
                  checked={autoAdvanceAvailable && autoAdvance}
                  disabled={!autoAdvanceAvailable}
                  onCheckedChange={onAutoAdvanceChange}
                  aria-label="Авто-переход после 00:00"
                />
              </div>
            </>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              Таймером управляет ведущий сессии
            </p>
          )}
        </PopoverContent>
      </Popover>

      {canControl && (
        <div className="hidden md:flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={
              timer.running
                ? onPause
                : () =>
                    onStart(timer.duration, timer.remaining > 0 ? timer.remaining : timer.duration)
            }
            aria-label={timer.running ? 'Пауза таймера' : 'Запустить таймер'}
          >
            {timer.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}
    </div>
  )
}
