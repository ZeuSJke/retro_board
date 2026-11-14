'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { playTimerChime } from '@/lib/board-themes'
import type { TimerState, WsMessage } from '../types'

const SOUND_MUTE_KEY = 'retro_timer_muted'

export function useTimer(boardId: string, sendWs: (msg: WsMessage) => void) {
  const [timer, setTimer] = useState<TimerState>({ duration: 300, remaining: 300, running: false })
  const [autoAdvance, setAutoAdvance] = useState(false)
  const [soundMuted, setSoundMuted] = useState(false)
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRestoredRef = useRef(false)
  const soundMutedRef = useRef(false)

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

  useEffect(() => {
    if (!boardId || !timerRestoredRef.current) return
    try {
      localStorage.setItem(
        `retro_timer_${boardId}`,
        JSON.stringify({
          duration: timer.duration,
          remaining: timer.remaining,
          running: timer.running,
          savedAt: Date.now(),
        }),
      )
    } catch {
      /* ignore */
    }
  }, [timer.duration, timer.remaining, timer.running, boardId])

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    }
  }, [])

  const startCountdown = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    timerIntervalRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev.remaining <= 0) {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
          return { ...prev, remaining: 0, running: false }
        }
        const next = Math.max(0, prev.remaining - 1)
        if (next <= 0) {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
          if (!soundMutedRef.current) {
            playTimerChime()
          }
          return { ...prev, remaining: 0, running: false }
        }
        return { ...prev, remaining: next }
      })
    }, 1000)
  }, [])

  const restoreTimer = useCallback(
    (id: string) => {
      timerRestoredRef.current = false
      try {
        const saved = localStorage.getItem(`retro_timer_${id}`)
        if (saved) {
          const { duration, remaining, running, savedAt } = JSON.parse(saved) as {
            duration: number
            remaining: number
            running: boolean
            savedAt: number
          }
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
          if (running) {
            const elapsed = Math.floor((Date.now() - savedAt) / 1000)
            const adjusted = Math.max(0, remaining - elapsed)
            setTimer({ duration, remaining: adjusted, running: adjusted > 0 })
            if (adjusted > 0) startCountdown()
          } else {
            setTimer({ duration, remaining, running: false })
          }
        }
      } catch {
        /* ignore corrupted timer data */
      }
      timerRestoredRef.current = true
    },
    [startCountdown],
  )

  const handleTimerWsEvent = useCallback(
    (event: string, data: Record<string, unknown>) => {
      if (event === 'timer_start') {
        const ts = data.ts as number | undefined
        const rawDelay = ts ? (Date.now() - ts) / 1000 : 0
        const networkDelay = Math.abs(rawDelay) <= 5 ? Math.max(0, Math.min(2, rawDelay)) : 0
        const adjusted = Math.max(0, Math.round((data.remaining as number) - networkDelay))
        setTimer({ duration: data.duration as number, remaining: adjusted, running: adjusted > 0 })
        if (adjusted > 0) startCountdown()
      } else if (event === 'timer_pause') {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
        setTimer((prev) => ({
          ...prev,
          ...(data.duration != null ? { duration: data.duration as number } : {}),
          remaining: data.remaining as number,
          running: false,
        }))
      } else if (event === 'timer_reset') {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
        setTimer({
          duration: data.duration as number,
          remaining: data.duration as number,
          running: false,
        })
      }
    },
    [startCountdown],
  )

  const handleTimerStart = useCallback(
    (duration: number, remaining: number) => {
      sendWs({ event: 'timer_start', data: { duration, remaining, ts: Date.now() } })
    },
    [sendWs],
  )

  const handleTimerPause = useCallback(() => {
    sendWs({ event: 'timer_pause', data: { remaining: timer.remaining, duration: timer.duration } })
  }, [sendWs, timer.remaining, timer.duration])

  const handleTimerReset = useCallback(
    (duration: number) => {
      sendWs({ event: 'timer_reset', data: { duration } })
    },
    [sendWs],
  )

  const handleAddTime = useCallback(
    (extraSeconds: number) => {
      const nextDuration = Math.max(timer.duration + extraSeconds, timer.remaining + extraSeconds)
      const nextRemaining = timer.remaining + extraSeconds
      if (timer.running) {
        sendWs({
          event: 'timer_start',
          data: { duration: nextDuration, remaining: nextRemaining, ts: Date.now() },
        })
      } else {
        sendWs({
          event: 'timer_pause',
          data: { duration: nextDuration, remaining: nextRemaining },
        })
      }
    },
    [sendWs, timer.duration, timer.remaining, timer.running],
  )

  return {
    timer,
    autoAdvance,
    setAutoAdvance,
    soundMuted,
    toggleSoundMuted,
    restoreTimer,
    handleTimerWsEvent,
    handleTimerStart,
    handleTimerPause,
    handleTimerReset,
    handleAddTime,
  }
}
