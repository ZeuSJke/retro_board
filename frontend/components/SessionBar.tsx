'use client'

import { useState } from 'react'
import {
  ArrowRight,
  Check,
  Crown,
  Lock,
  SmilePlus,
  Square,
  Vote,
} from 'lucide-react'
import { QUICK_REACTIONS } from '@/lib/board-themes'
import type { TimerState } from '@/types'
import PhaseProgress from './PhaseProgress'
import TimerWidget from './TimerWidget'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface SessionBarProps {
  facilitator: string | null
  phase: string | null
  username: string
  activeUsers: string[]
  readyUsers: string[]
  isLocked: boolean
  usedVotes: number
  maxVotes: number
  timer: TimerState
  autoAdvance: boolean
  soundMuted: boolean
  onToggleSoundMuted: () => void
  onAutoAdvanceChange: (v: boolean) => void
  onTimerStart: (duration: number, remaining: number) => void
  onTimerPause: () => void
  onTimerReset: (duration: number) => void
  onAddTime: (extraSeconds: number) => void
  onFacilitatorStart: () => void
  onFacilitatorStop: (lockBoard: boolean) => void
  onPhaseChange: (phase: string) => void
  onNextPhase: () => void
  onToggleReady: () => void
  onSendReaction: (emoji: string) => void
}

export default function SessionBar({
  facilitator,
  phase,
  username,
  activeUsers,
  readyUsers,
  isLocked,
  usedVotes,
  maxVotes,
  timer,
  autoAdvance,
  soundMuted,
  onToggleSoundMuted,
  onAutoAdvanceChange,
  onTimerStart,
  onTimerPause,
  onTimerReset,
  onAddTime,
  onFacilitatorStart,
  onFacilitatorStop,
  onPhaseChange,
  onNextPhase,
  onToggleReady,
  onSendReaction,
}: SessionBarProps) {
  const [stopDialogOpen, setStopDialogOpen] = useState(false)
  const [lockOnStop, setLockOnStop] = useState(false)

  const isFacilitator = Boolean(facilitator && facilitator === username)
  const amIReady = readyUsers.includes(username)
  const totalOnline = Math.max(activeUsers.length, 1)
  const canControlTimer = !facilitator || isFacilitator

  return (
    <>
      <div className="no-print border-b bg-muted/35 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
          {!facilitator ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge variant="outline" className="gap-1.5 bg-background font-normal">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {isLocked ? 'Доска заблокирована для правок' : 'Свободный режим'}
              </Badge>
              <Button
                type="button"
                size="sm"
                onClick={onFacilitatorStart}
                title="Стать ведущим"
                data-testid="become-facilitator-btn"
              >
                <Crown className="h-3.5 w-3.5" />
                Стать ведущим
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <Badge variant="secondary" className="gap-1.5">
                <Crown className="h-3.5 w-3.5 text-amber-500" />
                <span className="max-w-[120px] truncate">{facilitator}</span>
              </Badge>

              <PhaseProgress
                phase={phase}
                isFacilitator={isFacilitator}
                onPhaseChange={onPhaseChange}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {phase === 'vote' && (
              <div
                className="flex items-center gap-2 rounded-full border bg-background px-2.5 py-1 text-xs"
                title={`Использовано ${usedVotes} из ${maxVotes} голосов`}
              >
                <Vote className="h-3.5 w-3.5 text-primary" />
                {maxVotes <= 10 ? (
                  <div className="flex items-center gap-1">
                    {Array.from({ length: maxVotes }).map((_, idx) => (
                      <span
                        key={idx}
                        className={cn(
                          'h-2 w-2 rounded-full transition-colors',
                          idx < usedVotes ? 'bg-primary' : 'bg-muted-foreground/30',
                        )}
                      />
                    ))}
                  </div>
                ) : null}
                <span className="font-mono font-semibold">
                  {Math.max(0, maxVotes - usedVotes)}/{maxVotes}
                </span>
              </div>
            )}

            {facilitator && (
              <Button
                type="button"
                size="sm"
                variant={amIReady ? 'default' : 'outline'}
                onClick={onToggleReady}
                data-testid="ready-toggle-btn"
                className={cn(
                  'h-8 rounded-full text-xs',
                  amIReady && 'bg-emerald-600 hover:bg-emerald-700 text-white',
                )}
              >
                <Check className="h-3.5 w-3.5" />
                {amIReady ? 'Готов(а)' : 'Я закончил(а)'}
                {readyUsers.length > 0 && (
                  <span className="ml-0.5 font-mono opacity-85">
                    {readyUsers.length}/{totalOnline}
                  </span>
                )}
              </Button>
            )}

            <TimerWidget
              timer={timer}
              canControl={canControlTimer}
              autoAdvance={autoAdvance}
              soundMuted={soundMuted}
              onToggleSoundMuted={onToggleSoundMuted}
              onAutoAdvanceChange={onAutoAdvanceChange}
              onStart={onTimerStart}
              onPause={onTimerPause}
              onReset={onTimerReset}
              onAddTime={onAddTime}
            />

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="h-8 w-8 rounded-full"
                  title="Отправить реакцию"
                  aria-label="Отправить реакцию"
                >
                  <SmilePlus className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-1.5">
                <div className="flex items-center gap-1">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => onSendReaction(emoji)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-transform hover:scale-125 hover:bg-muted"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {isFacilitator && (
              <div className="flex items-center gap-1.5">
                {phase !== 'summary' && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={onNextPhase}
                    className="h-8 text-xs"
                    data-testid="next-phase-btn"
                  >
                    Далее
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setLockOnStop(false)
                    setStopDialogOpen(true)
                  }}
                  className="h-8 text-xs"
                  title="Завершить режим ведущего"
                  data-testid="stop-facilitator-btn"
                >
                  <Square className="h-3 w-3" />
                  <span className="hidden lg:inline">Завершить режим ведущего</span>
                  <span className="lg:hidden">Завершить</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Завершить режим ведущего?</AlertDialogTitle>
            <AlertDialogDescription>
              Сессия фасилитации будет остановлена, все скрытые карточки станут видны команде.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border bg-muted/40 p-3 text-sm">
            <Checkbox
              checked={lockOnStop}
              onCheckedChange={(v) => setLockOnStop(Boolean(v))}
            />
            <div className="flex items-center gap-1.5">
              <Lock className="h-4 w-4 text-amber-500" />
              <span>Заблокировать доску от дальнейших изменений (архив)</span>
            </div>
          </label>

          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onFacilitatorStop(lockOnStop)
                setStopDialogOpen(false)
              }}
            >
              Завершить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
