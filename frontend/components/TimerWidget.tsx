'use client'

import { useState } from 'react'
import { Pause, Play, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react'
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

interface TimerWidgetProps {
  timer: TimerState
  canControl: boolean
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
  const ratio = timer.duration > 0 ? Math.max(0, Math.min(1, timer.remaining / timer.duration)) : 0
  const urgent = timer.running && timer.remaining <= 30 && timer.remaining > 0
  const circumference = 2 * Math.PI * 10
  const strokeDashoffset = circumference * (1 - ratio)

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
              timer.running
                ? urgent
                  ? 'border-destructive/40 bg-destructive/10 text-destructive animate-pulse'
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
              />
            </svg>
            <span className="font-mono text-xs font-bold tabular-nums">
              {formatTime(timer.remaining)}
            </span>
          </button>
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
            {formatTime(timer.remaining)}
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

              <div className="flex items-center justify-between border-t pt-2.5 text-xs">
                <span className="text-muted-foreground">Авто-переход после 00:00</span>
                <Switch checked={autoAdvance} onCheckedChange={onAutoAdvanceChange} />
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
