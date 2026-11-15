'use client'

import { useState, useCallback } from 'react'
import type { FacilitatorInfo, WsMessage } from '../types'

export const PHASE_ORDER = ['brainstorm', 'reveal', 'discuss', 'vote', 'summary'] as const
export type PhaseKey = (typeof PHASE_ORDER)[number]

/** Сколько ведущий должен отсутствовать, чтобы роль можно было забрать (порог задаёт сервер). */
export const FACILITATOR_TAKEOVER_SECONDS = 15

const NO_FACILITATOR: FacilitatorInfo = { id: null, name: null, online: false }

/**
 * Сессия ведущего. Роль привязана к участнику (`facilitator.id`), а не к имени:
 * тёзка ведущего ведущим не становится, смена имени роль не отнимает.
 */
export function useFacilitator(
  sendWs: (msg: WsMessage) => void,
  timerDuration: number,
  resetTimer: (duration: number) => void,
) {
  const [facilitator, setFacilitator] = useState<FacilitatorInfo>(NO_FACILITATOR)
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

  /** Ведущий передаёт роль участнику, который сейчас на доске. */
  const handleFacilitatorTransfer = useCallback(
    (participantId: string) => {
      if (!participantId) return
      sendWs({ event: 'facilitator_transfer', data: { participant_id: participantId } })
    },
    [sendWs],
  )

  /** Забрать роль у ведущего, который не в сети дольше порога. Фаза и таймер сохраняются. */
  const handleFacilitatorTakeover = useCallback(() => {
    sendWs({ event: 'facilitator_takeover', data: {} })
  }, [sendWs])

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

  const handleFacilitatorChanged = useCallback((f: FacilitatorInfo | null, p: string | null) => {
    setFacilitator((prev) => {
      const next = f && f.id ? f : NO_FACILITATOR
      return prev.id === next.id && prev.name === next.name && prev.online === next.online
        ? prev
        : next
    })
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
    handleFacilitatorTransfer,
    handleFacilitatorTakeover,
    handlePhaseChange,
    handleNextPhase,
    handleFacilitatorChanged,
    handlePhaseChanged,
  }
}
