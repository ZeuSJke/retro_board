'use client'

import { useState, useRef, useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { SendTimerRef } from './useTimer'

export interface SendFacilitatorRef {
  start: () => void
  stop: () => void
  changePhase: (phase: string) => void
}

export function useFacilitator(
  sendTimerRef: MutableRefObject<SendTimerRef | null>,
  timerDuration: number,
) {
  const [facilitator, setFacilitator] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const sendFacilitatorRef = useRef<SendFacilitatorRef | null>(null)

  const handleFacilitatorStart = useCallback(() => {
    sendFacilitatorRef.current?.start()
  }, [])

  const handleFacilitatorStop = useCallback(() => {
    sendFacilitatorRef.current?.stop()
  }, [])

  const handlePhaseChange = useCallback((p: string) => {
    sendFacilitatorRef.current?.changePhase(p)
  }, [])

  const handleNextPhase = useCallback(() => {
    if (!phase) return
    const PHASE_ORDER = ['brainstorm', 'reveal', 'discuss', 'vote', 'summary']
    const idx = PHASE_ORDER.indexOf(phase)
    if (idx >= 0 && idx < PHASE_ORDER.length - 1) {
      const next = PHASE_ORDER[idx + 1]
      sendFacilitatorRef.current?.changePhase(next)
      // Reset timer for new phase
      sendTimerRef.current?.reset(timerDuration)
    }
  }, [phase, timerDuration, sendTimerRef])

  const handleFacilitatorChanged = useCallback((f: string | null, p: string | null) => {
    setFacilitator(f)
    setPhase(p)
  }, [])

  const handlePhaseChanged = useCallback((p: string) => {
    setPhase(p)
  }, [])

  return {
    facilitator,
    phase,
    sendFacilitatorRef,
    handleFacilitatorStart,
    handleFacilitatorStop,
    handlePhaseChange,
    handleNextPhase,
    handleFacilitatorChanged,
    handlePhaseChanged,
  }
}
