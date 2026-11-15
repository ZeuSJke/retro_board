'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { playTimerChime } from '@/lib/board-themes'
import {
  IDLE_TIMER,
  runningTimer,
  stoppedTimer,
  timerDisplaySeconds,
  timerRemainingSeconds,
} from '@/lib/timer'
import type { TimerState, WsMessage } from '../types'

const SOUND_MUTE_KEY = 'retro_timer_muted'
/** Реже этого срок окончания не перепроверяется: в фоновой вкладке таймеры браузера опаздывают. */
const EXPIRY_RECHECK_MS = 60_000

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

interface UseTimerOptions {
  /** Таймер дошёл до нуля на этом клиенте. */
  onExpire?: () => void
}

/**
 * Общий таймер этапа. Состояние приходит с сервера (события `timer_*` и начальное состояние
 * при подключении) и нигде на клиенте не сохраняется. Идущий таймер хранится моментом
 * окончания (`endsAt`), поэтому состояние не меняется каждую секунду: тикает только виджет.
 * Таймер у каждой доски свой — хук живёт вместе со страницей доски.
 */
export function useTimer(sendWs: (msg: WsMessage) => void, options?: UseTimerOptions) {
  const [timer, setTimer] = useState<TimerState>(IDLE_TIMER)
  const [autoAdvance, setAutoAdvance] = useState(false)
  const [soundMuted, setSoundMuted] = useState(false)
  const soundMutedRef = useRef(false)
  const timerRef = useRef(timer)
  const onExpireRef = useRef(options?.onExpire)

  useEffect(() => {
    timerRef.current = timer
    onExpireRef.current = options?.onExpire
  })

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SOUND_MUTE_KEY) === 'true'
      setSoundMuted(saved)
      soundMutedRef.current = saved
    } catch {
      /* ignore */
    }
  }, [])

  const toggleSoundMuted = useCallback(() => {
    setSoundMuted((prev) => {
      const next = !prev
      soundMutedRef.current = next
      try {
        localStorage.setItem(SOUND_MUTE_KEY, String(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  // Окончание: один таймер браузера до момента `endsAt`. Срок перепроверяется, когда
  // вкладка снова видна, — в фоне таймеры срабатывают с опозданием.
  useEffect(() => {
    if (!timer.running || timer.endsAt == null) return
    const endsAt = timer.endsAt
    let timeout: ReturnType<typeof setTimeout> | null = null

    const check = () => {
      timeout = null
      const left = endsAt - Date.now()
      if (left > 0) {
        timeout = setTimeout(check, Math.min(left, EXPIRY_RECHECK_MS))
        return
      }
      setTimer((prev) =>
        prev.running && prev.endsAt === endsAt ? stoppedTimer(prev.duration, 0) : prev,
      )
      if (!soundMutedRef.current) playTimerChime()
      onExpireRef.current?.()
    }

    const recheck = () => {
      if (document.visibilityState !== 'visible') return
      if (timeout) clearTimeout(timeout)
      check()
    }

    timeout = setTimeout(check, Math.max(0, Math.min(endsAt - Date.now(), EXPIRY_RECHECK_MS)))
    document.addEventListener('visibilitychange', recheck)
    return () => {
      if (timeout) clearTimeout(timeout)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [timer.running, timer.endsAt])

  const handleTimerWsEvent = useCallback((event: string, data: Record<string, unknown>) => {
    if (event === 'timer_start') {
      const duration = finiteNumber(data.duration)
      const remaining = finiteNumber(data.remaining)
      if (duration === null || remaining === null) return
      // Остаток уже нулевой — таймер на сервере истёк, пока нас не было: звука не нужно
      setTimer(remaining > 0 ? runningTimer(duration, remaining) : stoppedTimer(duration, 0))
    } else if (event === 'timer_pause') {
      const remaining = finiteNumber(data.remaining)
      if (remaining === null) return
      const duration = finiteNumber(data.duration)
      setTimer((prev) => stoppedTimer(duration ?? prev.duration, remaining))
    } else if (event === 'timer_reset') {
      const duration = finiteNumber(data.duration)
      if (duration === null) return
      setTimer(stoppedTimer(duration, duration))
    }
  }, [])

  /**
   * После подключения сервер не прислал таймер: на сервере он не запущен (сессию завершили,
   * пока клиент был не в сети). Локальный отсчёт, оставшийся с прошлого подключения, сбрасывается.
   */
  const handleTimerAbsent = useCallback(() => {
    setTimer((prev) =>
      prev.running || prev.remaining !== prev.duration
        ? stoppedTimer(prev.duration, prev.duration)
        : prev,
    )
  }, [])

  const handleTimerStart = useCallback(
    (duration: number, remaining: number) => {
      sendWs({ event: 'timer_start', data: { duration, remaining, ts: Date.now() } })
    },
    [sendWs],
  )

  const handleTimerPause = useCallback(() => {
    const current = timerRef.current
    // На паузе все видят то же число, что видел нажавший
    sendWs({
      event: 'timer_pause',
      data: { remaining: timerDisplaySeconds(current), duration: current.duration },
    })
  }, [sendWs])

  const handleTimerReset = useCallback(
    (duration: number) => {
      sendWs({ event: 'timer_reset', data: { duration } })
    },
    [sendWs],
  )

  const handleAddTime = useCallback(
    (extraSeconds: number) => {
      const current = timerRef.current
      if (current.running) {
        const remaining = timerRemainingSeconds(current) + extraSeconds
        sendWs({
          event: 'timer_start',
          data: {
            duration: Math.max(current.duration + extraSeconds, remaining),
            remaining,
            ts: Date.now(),
          },
        })
      } else {
        const remaining = current.remaining + extraSeconds
        sendWs({
          event: 'timer_pause',
          data: { duration: Math.max(current.duration + extraSeconds, remaining), remaining },
        })
      }
    },
    [sendWs],
  )

  return {
    timer,
    autoAdvance,
    setAutoAdvance,
    soundMuted,
    toggleSoundMuted,
    handleTimerWsEvent,
    handleTimerAbsent,
    handleTimerStart,
    handleTimerPause,
    handleTimerReset,
    handleAddTime,
  }
}
