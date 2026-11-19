'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  ArrowRight,
  Check,
  Crown,
  EyeOff,
  FileText,
  Lock,
  RotateCcw,
  Shield,
  SmilePlus,
  Sparkles,
  Square,
  UserCheck,
  Vote,
  WifiOff,
} from 'lucide-react'
import { FACILITATOR_TAKEOVER_SECONDS } from '@/hooks/useFacilitator'
import { QUICK_REACTIONS } from '@/lib/board-themes'
import type { FacilitatorInfo, TimerState } from '@/types'
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
  /** Ведущий сессии: роль привязана к участнику (`id`), имя — подпись. */
  facilitator: FacilitatorInfo
  phase: string | null
  /** Идентификатор текущего участника. */
  myId: string
  /** Сколько участников сейчас на доске. */
  onlineCount: number
  /** Идентификаторы участников, отметивших готовность. */
  readyIds: string[]
  /** Забрать роль у ведущего, который пропал из сети. */
  onFacilitatorTakeover?: () => void
  isLocked: boolean
  usedVotes: number
  maxVotes: number
  votedParticipantsCount?: number
  onResetMyVotes?: () => void
  resettingVotes?: boolean
  reactionsOpen?: boolean
  onReactionsOpenChange?: (open: boolean) => void
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
  /** Правила доски для компактных бейджей и индикатора живого штурма. */
  hideCardsUntilReveal?: boolean
  anonymousVotes?: boolean
  allowMultipleVotes?: boolean
  cardsCount?: number
}

/**
 * Кнопка «Забрать роль». Монтируется, когда клиент узнал, что ведущий не в сети, и отсчитывает
 * порог с этого момента. Сервер считает с момента отключения — то есть не позже, — поэтому
 * к концу отсчёта он роль уже отдаст. Фаза и таймер сессии при этом сохраняются.
 */
function FacilitatorTakeover({ onTakeover }: { onTakeover: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(FACILITATOR_TAKEOVER_SECONDS)

  useEffect(() => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const left = Math.max(
        0,
        FACILITATOR_TAKEOVER_SECONDS - Math.floor((Date.now() - startedAt) / 1000),
      )
      setSecondsLeft(left)
      if (left === 0) clearInterval(timer)
    }, 500)
    return () => clearInterval(timer)
  }, [])

  const ready = secondsLeft === 0
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={!ready}
      onClick={onTakeover}
      className="h-7 gap-1.5 px-2.5 text-xs"
      title={
        ready
          ? 'Стать ведущим вместо отсутствующего: фаза и таймер сохранятся'
          : 'Роль можно забрать, если ведущий не вернётся'
      }
      data-testid="takeover-facilitator-btn"
    >
      <Crown className="h-3.5 w-3.5 text-amber-500" />
      {ready ? 'Забрать роль' : `Забрать роль через ${secondsLeft} с`}
    </Button>
  )
}

export default function SessionBar({
  facilitator,
  phase,
  myId,
  onlineCount,
  readyIds,
  onFacilitatorTakeover,
  isLocked,
  usedVotes,
  maxVotes,
  votedParticipantsCount,
  onResetMyVotes,
  resettingVotes = false,
  reactionsOpen,
  onReactionsOpenChange,
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
  hideCardsUntilReveal = false,
  anonymousVotes = false,
  allowMultipleVotes = false,
  cardsCount,
}: SessionBarProps) {
  const [stopDialogOpen, setStopDialogOpen] = useState(false)
  const [lockOnStop, setLockOnStop] = useState(false)

  const hasSession = Boolean(facilitator.id)
  // Ведущий — участник с этим идентификатором; тёзка ведущего ведущим не считается
  const isFacilitator = hasSession && Boolean(myId) && facilitator.id === myId
  const amIReady = Boolean(myId) && readyIds.includes(myId)
  const totalOnline = Math.max(onlineCount, 1)
  const canControlTimer = !hasSession || isFacilitator
  const facilitatorAway = hasSession && !facilitator.online && !isFacilitator
  // Свои голоса и «Сброс» нужны всегда, когда голоса есть: голосовать можно в любой фазе и вне сессии
  const showVotes = phase === 'vote' || usedVotes > 0
  const limitReached = maxVotes > 0 && usedVotes >= maxVotes

  return (
    <>
      <div className="no-print border-b bg-muted/35 backdrop-blur-xs">
        {/* От 1280 px панель — одна строка: место уступают этапы (см. PhaseProgress), а не перенос */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 px-3 py-2 sm:px-4 xl:flex-nowrap">
          {!hasSession ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-2.5">
              {/* На телефоне обычное состояние не подписываем: место нужно кнопкам */}
              <Badge
                variant="outline"
                className={cn(
                  'gap-1.5 bg-background font-normal',
                  !isLocked && 'hidden sm:inline-flex',
                )}
              >
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    isLocked ? 'bg-amber-500' : 'bg-emerald-500',
                  )}
                />
                {isLocked ? (
                  <>
                    <span className="hidden sm:inline">Доска заблокирована для правок</span>
                    <span className="sm:hidden">Заблокирована</span>
                  </>
                ) : (
                  'Свободный режим'
                )}
              </Badge>
              {/* Сессия начинается со «Штурма», а он скрывает чужие карточки у всех:
                  на заблокированной доске (архив) это только спрятало бы её содержимое.
                  На телефоне отключённую кнопку не показываем: причину там называет плашка. */}
              <Button
                type="button"
                size="sm"
                disabled={isLocked}
                className={cn(isLocked && 'hidden sm:inline-flex')}
                onClick={onFacilitatorStart}
                title={
                  isLocked
                    ? 'Доска заблокирована: сессию ведущего начать нельзя. Разблокируйте доску в настройках.'
                    : 'Стать ведущим'
                }
                data-testid="become-facilitator-btn"
              >
                <Crown className="h-3.5 w-3.5" />
                Стать ведущим
              </Button>
              {isLocked && (
                <span
                  className="hidden text-xs text-muted-foreground md:inline"
                  data-testid="locked-session-hint"
                >
                  Чтобы провести сессию, разблокируйте доску в настройках
                </span>
              )}
            </div>
          ) : (
            <div className="flex min-w-0 flex-[1_1_26rem] flex-wrap items-center gap-2 sm:gap-2.5">
              <Badge
                variant="secondary"
                className="shrink-0 gap-1.5"
                data-testid="facilitator-badge"
              >
                <Crown className="h-3.5 w-3.5 text-amber-500" />
                <span className="max-w-[72px] truncate sm:max-w-[120px]">
                  {facilitator.name || 'Ведущий'}
                </span>
                {isFacilitator && <span className="-ml-0.5 shrink-0"> (вы)</span>}
              </Badge>

              {facilitatorAway && (
                <>
                  <Badge
                    variant="outline"
                    className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    data-testid="facilitator-offline-badge"
                  >
                    <WifiOff className="h-3 w-3" />
                    Ведущий не в сети
                  </Badge>
                  {onFacilitatorTakeover && (
                    <FacilitatorTakeover
                      key={facilitator.id ?? 'none'}
                      onTakeover={onFacilitatorTakeover}
                    />
                  )}
                </>
              )}

              <PhaseProgress
                phase={phase}
                isFacilitator={isFacilitator}
                onPhaseChange={onPhaseChange}
                className="flex-[1_1_13rem]"
              />
            </div>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2 xl:shrink-0 xl:flex-nowrap">
            {(hideCardsUntilReveal || anonymousVotes || allowMultipleVotes) && (
              <div
                className="hidden items-center gap-1 lg:flex"
                data-testid="board-rules-badges"
              >
                {hideCardsUntilReveal && (
                  <Badge
                    variant="outline"
                    className="gap-1 bg-background/80 text-[11px] font-normal text-muted-foreground"
                    title="Карточки скрыты до раскрытия ведущим или создателем"
                  >
                    <EyeOff className="h-3 w-3" />
                    Скрытый сбор
                  </Badge>
                )}
                {anonymousVotes && (
                  <Badge
                    variant="outline"
                    className="gap-1 bg-background/80 text-[11px] font-normal text-muted-foreground"
                    title="Авторы карточек и голосов скрыты"
                  >
                    <Shield className="h-3 w-3" />
                    Анонимно
                  </Badge>
                )}
                {allowMultipleVotes && (
                  <Badge
                    variant="outline"
                    className="gap-1 bg-background/80 text-[11px] font-normal text-muted-foreground"
                    title="Можно отдавать несколько голосов одной карточке"
                  >
                    <Sparkles className="h-3 w-3 text-primary" />
                    Dot Voting
                  </Badge>
                )}
              </div>
            )}

            {hasSession && phase === 'brainstorm' && hideCardsUntilReveal && typeof cardsCount === 'number' && (
              <Badge
                variant="outline"
                className="hidden gap-1.5 border-emerald-500/35 bg-emerald-500/10 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 sm:inline-flex"
                data-testid="brainstorm-cards-pulse"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                <FileText className="h-3 w-3" />
                Написано карточек: {cardsCount}
              </Badge>
            )}

            {hasSession && isLocked && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                title="Доска заблокирована — редактирование и голосование отключены. Разблокировать можно в настройках доски."
              >
                <Lock className="h-3 w-3" />
                Только чтение
              </Badge>
            )}

            {showVotes && (
              <div
                data-testid="my-votes"
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors',
                  limitReached
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'bg-background',
                )}
                title={
                  limitReached
                    ? `Лимит голосов исчерпан (${usedVotes} из ${maxVotes})`
                    : `Мои голоса: использовано ${usedVotes} из ${maxVotes}`
                }
              >
                <Vote className={cn('h-3.5 w-3.5', limitReached ? 'text-amber-500' : 'text-primary')} />
                {maxVotes <= 10 ? (
                  // Точки дублируют число: в сессии они уступают место этапам и кнопкам ведущего
                  <div
                    className={cn(
                      'items-center gap-1',
                      hasSession ? 'hidden min-[1680px]:flex' : 'hidden sm:flex',
                    )}
                  >
                    {Array.from({ length: maxVotes }).map((_, idx) => {
                      const used = idx < usedVotes
                      return (
                        <motion.span
                          key={idx}
                          animate={{ scale: used ? [1, 1.3, 1] : 1 }}
                          transition={{ duration: 0.22 }}
                          className={cn(
                            'h-2 w-2 rounded-full transition-colors',
                            used
                              ? limitReached
                                ? 'bg-amber-500'
                                : 'bg-primary'
                              : 'bg-muted-foreground/30',
                          )}
                        />
                      )
                    })}
                  </div>
                ) : null}
                <span className="font-mono font-semibold">
                  {Math.max(0, maxVotes - usedVotes)}/{maxVotes}
                  {limitReached ? ' · лимит' : ''}
                </span>
                {!isLocked && usedVotes > 0 && onResetMyVotes && (
                  <button
                    type="button"
                    disabled={resettingVotes}
                    onClick={onResetMyVotes}
                    title="Сбросить все мои голоса"
                    aria-label="Сбросить все мои голоса"
                    data-testid="reset-votes-btn"
                    className="ml-1 inline-flex h-5 items-center gap-1 rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span className={hasSession ? 'hidden min-[1680px]:inline' : 'hidden sm:inline'}>
                      Сброс
                    </span>
                  </button>
                )}
              </div>
            )}

            {hasSession && phase === 'vote' && votedParticipantsCount !== undefined && (
              <Badge
                variant="secondary"
                className="hidden h-7 shrink-0 gap-1 rounded-full px-2.5 text-xs font-normal sm:inline-flex"
                title="Проголосовали: участники на доске, поставившие хотя бы один голос"
                data-testid="voted-count"
              >
                <UserCheck className="h-3.5 w-3.5 min-[1680px]:hidden" aria-hidden="true" />
                <span className="hidden min-[1680px]:inline">Проголосовали </span>
                {votedParticipantsCount}/{totalOnline}
              </Badge>
            )}

            {hasSession && (
              <Button
                type="button"
                size="sm"
                variant={amIReady ? 'default' : 'outline'}
                onClick={onToggleReady}
                data-testid="ready-toggle-btn"
                title={amIReady ? 'Снять отметку готовности' : 'Отметить, что вы закончили этап'}
                className={cn(
                  'h-8 shrink-0 rounded-full text-xs',
                  amIReady && 'bg-emerald-700 hover:bg-emerald-800 text-white',
                )}
              >
                <Check className="h-3.5 w-3.5" />
                {amIReady ? (
                  'Готов(а)'
                ) : (
                  <>
                    <span className="hidden sm:inline">Я закончил(а)</span>
                    <span className="sm:hidden">Готово</span>
                  </>
                )}
                {readyIds.length > 0 && (
                  <span className="ml-0.5 hidden font-mono opacity-85 sm:inline">
                    {readyIds.length}/{totalOnline}
                  </span>
                )}
              </Button>
            )}

            <TimerWidget
              timer={timer}
              canControl={canControlTimer}
              // Авто-переход переключает этапы сессии: вне сессии переходить некуда
              autoAdvanceAvailable={hasSession}
              autoAdvance={autoAdvance}
              soundMuted={soundMuted}
              onToggleSoundMuted={onToggleSoundMuted}
              onAutoAdvanceChange={onAutoAdvanceChange}
              onStart={onTimerStart}
              onPause={onTimerPause}
              onReset={onTimerReset}
              onAddTime={onAddTime}
            />

            <Popover open={reactionsOpen} onOpenChange={onReactionsOpenChange}>
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
                    <motion.button
                      key={emoji}
                      type="button"
                      whileHover={{ scale: 1.28, y: -2 }}
                      whileTap={{ scale: 0.88 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                      onClick={() => onSendReaction(emoji)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-muted"
                    >
                      {emoji}
                    </motion.button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {isFacilitator && (
              <div className="flex shrink-0 items-center gap-1.5">
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
                  {/* Полная подпись — в подсказке и в окне подтверждения: в одной строке ей нет места */}
                  Завершить
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
              Сессия закончится у всех участников: этапы, таймер и отметки готовности
              сбросятся.{' '}
              {phase === 'brainstorm'
                ? 'Сейчас идёт «Штурм»: карточки, которые каждый видел только у себя, откроются всей команде.'
                : 'Карточки уже раскрыты и останутся видны всей команде.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border bg-muted/40 p-3 text-sm">
            <Checkbox
              checked={lockOnStop}
              onCheckedChange={(v) => setLockOnStop(Boolean(v))}
            />
            <div className="flex items-center gap-1.5">
              <Lock className="h-4 w-4 shrink-0 text-amber-500" />
              <span>
                Заблокировать доску (архив): карточки и голоса больше нельзя будет менять
              </span>
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
