'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { TimerState } from '../types'

export interface SendTimerRef {
  start: (duration: number, remaining: number) => void
  pause: (remaining: number) => void
  reset: (duration: number) => void
}

export function useTimer(boardId: string) {
  const [timer, setTimer] = useState<TimerState>({ duration: 300, remaining: 300, running: false })
  const [autoAdvance, setAutoAdvance] = useState(false)
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sendTimerRef = useRef<SendTimerRef | null>(null)
  const timerRestoredRef = useRef(false)

  // Persist timer state to localStorage
  useEffect(() => {
    if (!boardId || !timerRestoredRef.current) return
    localStorage.setItem(
      `retro_timer_${boardId}`,
      JSON.stringify({
        duration: timer.duration,
        remaining: timer.remaining,
        running: timer.running,
        savedAt: Date.now(),
      }),
    )
  }, [timer.duration, timer.remaining, timer.running, boardId])

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    }
  }, [])

  const startCountdown = useCallback((remaining: number) => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    timerIntervalRef.current = setInterval(() => {
      setTimer((prev) => {
        const next = Math.max(0, prev.remaining - 1)
        if (next <= 0) {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
          return { ...prev, remaining: 0, running: false }
        }
        return { ...prev, remaining: next }
      })
    }, 1000)
  }, [])

  const restoreTimer = useCallback((id: string) => {
    timerRestoredRef.current = false
    try {
      const saved = localStorage.getItem(`retro_timer_${id}`)
      if (saved) {
        const { duration, remaining, running, savedAt } = JSON.parse(saved)
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
        if (running) {
          const elapsed = Math.floor((Date.now() - savedAt) / 1000)
          const adjusted = Math.max(0, remaining - elapsed)
          setTimer({ duration, remaining: adjusted, running: adjusted > 0 })
          if (adjusted > 0) startCountdown(adjusted)
        } else {
          setTimer({ duration, remaining, running: false })
        }
      }
    } catch { /* ignore corrupted timer data */ }
    timerRestoredRef.current = true
  }, [startCountdown])

  const handleTimerWsEvent = useCallback(
    (event: string, data: Record<string, unknown>) => {
      if (event === 'timer_start') {
        const networkDelay = (Date.now() - ((data.ts as number) || Date.now())) / 1000
        const adjusted = Math.max(0, Math.round((data.remaining as number) - networkDelay))
        setTimer({ duration: data.duration as number, remaining: adjusted, running: true })
        startCountdown(adjusted)
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
        setTimer({ duration: data.duration as number, remaining: data.duration as number, running: false })
      }
    },
    [startCountdown],
  )

  const handleTimerStart = useCallback((duration: number, remaining: number) => {
    sendTimerRef.current?.start(duration, remaining)
  }, [])

  const handleTimerPause = useCallback(() => {
    sendTimerRef.current?.pause(timer.remaining)
  }, [timer.remaining])

  const handleTimerReset = useCallback((duration: number) => {
    sendTimerRef.current?.reset(duration)
  }, [])

  return {
    timer,
    autoAdvance,
    setAutoAdvance,
    sendTimerRef,
    restoreTimer,
    handleTimerWsEvent,
    handleTimerStart,
    handleTimerPause,
    handleTimerReset,
  }
}
