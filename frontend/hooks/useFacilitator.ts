'use client'

import { useState, useCallback } from 'react'
import type { WsMessage } from '../types'

export const PHASE_ORDER = ['brainstorm', 'reveal', 'discuss', 'vote', 'summary'] as const
export type PhaseKey = (typeof PHASE_ORDER)[number]

export function useFacilitator(
  sendWs: (msg: WsMessage) => void,
  timerDuration: number,
  resetTimer: (duration: number) => void,
) {
  const [facilitator, setFacilitator] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)

  const handleFacilitatorStart = useCallback(() => {
    sendWs({ event: 'facilitator_start', data: {} })
  }, [sendWs])

  const handleFacilitatorStop = useCallback(
    (lockBoard = false) => {
      sendWs({ event: 'facilitator_stop', data: { lock_board: lockBoard } })
    },
    [sendWs],
  )

  const handlePhaseChange = useCallback(
    (p: string) => {
      sendWs({ event: 'phase_change', data: { phase: p } })
    },
    [sendWs],
  )

  const handleNextPhase = useCallback(() => {
    if (!phase) return
    const idx = PHASE_ORDER.indexOf(phase as PhaseKey)
    if (idx >= 0 && idx < PHASE_ORDER.length - 1) {
      const next = PHASE_ORDER[idx + 1]
      sendWs({ event: 'phase_change', data: { phase: next } })
      resetTimer(timerDuration)
    }
  }, [phase, timerDuration, sendWs, resetTimer])

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
    handleFacilitatorStart,
    handleFacilitatorStop,
    handlePhaseChange,
    handleNextPhase,
    handleFacilitatorChanged,
    handlePhaseChanged,
  }
}
