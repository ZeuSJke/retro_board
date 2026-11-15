import { useCallback, useEffect, useRef, useState } from 'react'
import { getBoardSummary } from '../api'
import { useAppStore } from '../store'
import { getApiErrorMessage } from '../utils/apiError'
import type { BoardSummary } from '../types'

function triggerConfetti() {
  if (typeof window === 'undefined') return
  import('canvas-confetti')
    .then((mod) => {
      // Без воркера: по умолчанию библиотека создаёт его из blob:, а CSP (script-src 'self')
      // это запрещает — браузер писал ошибку в консоль при каждом салюте
      void mod.default?.create(undefined, { resize: true })({
        particleCount: 70,
        spread: 65,
        origin: { y: 0.65 },
      })
    })
    .catch(() => {})
}

interface UseBoardSummaryOptions {
  boardId: string
  hasSummary: boolean
  onMarkHasSummary: () => void
}

/** Состояние и загрузка AI-итогов ретроспективы, синхронизированные с WS-событиями доски. */
export function useBoardSummary({
  boardId,
  hasSummary,
  onMarkHasSummary,
}: UseBoardSummaryOptions) {
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summary, setSummary] = useState<BoardSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const boardIdRef = useRef(boardId)
  useEffect(() => {
    boardIdRef.current = boardId
  }, [boardId])

  const loadSummary = useCallback(
    async (known = hasSummary) => {
      // Итогов у доски нет и события о них не было: запрос вслепую вернул бы 404
      if (!known) return
      setSummaryLoading(true)
      setSummaryError(null)
      try {
        const data = await getBoardSummary(boardId)
        setSummary(data)
      } catch (err) {
        setSummaryError(getApiErrorMessage(err, 'Не удалось загрузить AI-итоги'))
      } finally {
        setSummaryLoading(false)
      }
    },
    [boardId, hasSummary],
  )

  const handleSummaryGenerated = useCallback(
    (regenerated: boolean) => {
      void loadSummary(true)
      if (!hasSummary) onMarkHasSummary()
      // Итоги пересоздали кнопкой: у остальных окно не открываем, только обновляем содержимое
      if (regenerated) return
      setSummaryOpen(true)
      triggerConfetti()
    },
    [hasSummary, loadSummary, onMarkHasSummary],
  )

  // Открыть окно итогов; запрашивать ли сами итоги, решает loadSummary (по has_summary)
  const openSummary = useCallback(() => {
    setSummaryOpen(true)
    void loadSummary()
  }, [loadSummary])

  const handleSummaryFailed = useCallback((msg?: string) => {
    setSummaryLoading(false)
    // Не одинокий тост: окно итогов объясняет, что случилось, и предлагает повторить или
    // открыть экспорт. Без настроенного AI это не сбой — причина написана в самом окне
    if (useAppStore.getState().aiEnabled !== false) {
      setSummaryError(msg || 'Не удалось сгенерировать итоги')
    }
    setSummaryOpen(true)
  }, [])

  const resetSummary = useCallback((targetBoardId: string, initialHasSummary: boolean) => {
    setSummary(null)
    setSummaryError(null)
    if (initialHasSummary) {
      getBoardSummary(targetBoardId)
        .then((s) => {
          if (s && boardIdRef.current === targetBoardId) setSummary(s)
        })
        .catch(() => {})
    }
  }, [])

  return {
    summaryOpen,
    setSummaryOpen,
    summary,
    setSummary,
    summaryLoading,
    summaryError,
    openSummary,
    handleSummaryGenerated,
    handleSummaryFailed,
    resetSummary,
  }
}
