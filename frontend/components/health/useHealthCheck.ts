'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBoardHealth, submitBoardHealth, submitBoardRoti } from '@/api/health'
import { useAppStore } from '@/store'
import { showToast } from '@/store/toastStore'
import { getApiErrorMessage, markApiErrorReported } from '@/utils/apiError'
import type { WsMessage } from '@/types'
import {
  ROTI_KEY,
  type HealthAnswerValue,
  type HealthQuestionSummary,
  type HealthSummary,
  type HealthTeamSummary,
  type RotiValue,
  type WsHealthCheckRequestedData,
} from '@/types/health'
import { isHealthAnswerValue, isRotiValue } from './scale'

/**
 * Сообщение сокета доски, которым опрос запускается у всех участников:
 * `sendMessage(HEALTH_CHECK_START)`. Во время сессии сервер принимает его только от ведущего.
 */
export const HEALTH_CHECK_START: WsMessage = { event: 'health_check_start', data: {} }

export interface HealthCheckController {
  boardId: string | null
  /** Сводка по команде и свои ответы; `null` — ещё не загружена или не загрузилась. */
  summary: HealthSummary | null
  questions: HealthQuestionSummary[]
  /** Свои ответы на вопросы (без оценки встречи). */
  myAnswers: Record<string, HealthAnswerValue>
  /** Своя оценка встречи; `null` — ещё не оценивал. */
  myRoti: RotiValue | null
  /** Участник ответил хотя бы на один вопрос. */
  hasAnswered: boolean
  loading: boolean
  loadError: string | null
  submitting: boolean

  /** Окно опроса. */
  dialogOpen: boolean
  /** Кто запустил опрос у всех (имя); `null` — участник открыл окно сам. */
  requestedBy: string | null
  openDialog: () => void
  closeDialog: () => void

  /** Окно оценки встречи. */
  rotiOpen: boolean
  openRoti: () => void
  closeRoti: () => void

  /** Перечитать сводку с сервера — например, после переподключения сокета. */
  refresh: () => void
  /** Отправить ответы. `true` — сохранено; при ошибке показывает тост и возвращает `false`. */
  submitAnswers: (answers: Record<string, HealthAnswerValue>) => Promise<boolean>
  /** Оценить встречу. `true` — сохранено (окно закрывается); при ошибке — тост и `false`. */
  submitRoti: (value: RotiValue) => Promise<boolean>

  /** Событие `health_check_requested`: открыть окно опроса. */
  onHealthCheckRequested: (data?: WsHealthCheckRequestedData | Record<string, unknown>) => void
  /** Событие `health_updated`: обновить сводку (личные ответы остаются прежними). */
  onHealthUpdated: (data: unknown) => void
  /** Событие `roti_requested`: спросить оценку встречи, если участник её ещё не ставил. */
  onRotiRequested: () => void
  /**
   * Передать сюда сообщение сокета доски: обрабатывает три события выше.
   * Возвращает `true`, если событие относилось к health check.
   */
  handleServerEvent: (msg: WsMessage) => boolean
}

interface LoadedState {
  key: string
  summary: HealthSummary | null
  error: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Сводка из события `health_updated`; `null`, если данные не похожи на сводку. */
export function parseTeamSummary(data: unknown): HealthTeamSummary | null {
  if (!isRecord(data) || typeof data.board_id !== 'string' || !Array.isArray(data.questions)) {
    return null
  }
  const questions = data.questions.filter(
    (q): q is HealthQuestionSummary => isRecord(q) && typeof q.key === 'string',
  )
  const roti = isRecord(data.roti) ? data.roti : {}
  return {
    board_id: data.board_id,
    participants: typeof data.participants === 'number' ? data.participants : 0,
    questions,
    roti: {
      average: typeof roti.average === 'number' ? roti.average : null,
      answers: typeof roti.answers === 'number' ? roti.answers : 0,
    },
  }
}

/**
 * Состояние health check и оценки встречи для одной доски.
 *
 * Хук сам читает сводку (`GET /api/boards/{id}/health`) и отправляет ответы; серверные
 * события ему передаёт владелец сокета — одним вызовом `handleServerEvent(msg)` или
 * явными методами `onHealthCheckRequested` / `onHealthUpdated` / `onRotiRequested`.
 * От сокета хук не зависит, поэтому его можно объявить раньше, чем сокет доски.
 * Окна — `<HealthCheckDialog health={…} />` и `<RotiPrompt health={…} />`.
 */
export function useHealthCheck(boardId: string | null | undefined): HealthCheckController {
  const participantId = useAppStore((s) => s.participant?.id ?? null)
  // Свои ответы зависят от участника: ключ состояния — доска и участник
  const key = boardId && participantId ? `${boardId}:${participantId}` : null

  const [loaded, setLoaded] = useState<LoadedState | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [dialog, setDialog] = useState<{ key: string; requestedBy: string | null } | null>(null)
  const [roti, setRoti] = useState<{ key: string; auto: boolean } | null>(null)

  const keyRef = useRef(key)
  useEffect(() => {
    keyRef.current = key
  }, [key])

  // Сводку меняют три источника: чтение (GET), собственные ответы (POST) и событие
  // `health_updated`. Счётчики ниже не дают более раннему чтению затереть то, что пришло позже.
  const writesRef = useRef(0) // сколько раз сервер подтвердил наши ответы
  const eventsRef = useRef(0) // сколько событий `health_updated` применено

  useEffect(() => {
    if (!boardId || !key) return
    let cancelled = false
    const writesAtStart = writesRef.current
    const eventsAtStart = eventsRef.current
    getBoardHealth(boardId)
      .then((summary) => {
        // Пока шло чтение, участник ответил: ответ сервера на отправку свежее
        if (cancelled || writesRef.current !== writesAtStart) return
        setLoaded((prev) =>
          // Пока шло чтение, пришло событие: сводка из события свежее, свои ответы — из чтения
          eventsRef.current !== eventsAtStart && prev?.key === key && prev.summary
            ? { key, summary: { ...prev.summary, mine: summary.mine }, error: null }
            : { key, summary, error: null },
        )
      })
      .catch((err: unknown) => {
        // Ошибку показывает окно опроса — общий тост не нужен
        markApiErrorReported(err)
        if (cancelled || writesRef.current !== writesAtStart) return
        const error = getApiErrorMessage(err, 'Не удалось загрузить сводку опроса')
        setLoaded((prev) =>
          prev && prev.key === key && prev.summary ? prev : { key, summary: null, error },
        )
      })
    return () => {
      cancelled = true
    }
  }, [boardId, key, reloadToken])

  const current = loaded && loaded.key === key ? loaded : null
  const summary = current?.summary ?? null
  const loading = Boolean(key) && current === null
  const loadError = current?.error ?? null

  const myAnswers = useMemo(() => {
    const answers: Record<string, HealthAnswerValue> = {}
    for (const [question, value] of Object.entries(summary?.mine ?? {})) {
      if (question !== ROTI_KEY && isHealthAnswerValue(value)) answers[question] = value
    }
    return answers
  }, [summary])
  const rawRoti = summary?.mine?.[ROTI_KEY]
  const myRoti = isRotiValue(rawRoti) ? rawRoti : null
  const hasAnswered = Object.keys(myAnswers).length > 0

  const refresh = useCallback(() => {
    // Сводку, которая уже есть, оставляем на экране; после неудачной загрузки — снова «загрузка»
    setLoaded((prev) => (prev?.summary ? prev : null))
    setReloadToken((token) => token + 1)
  }, [])

  const openDialog = useCallback(() => {
    if (!key) return
    setDialog({ key, requestedBy: null })
    // Окно всегда открывается со свежей сводкой — даже если события сокета были пропущены
    refresh()
  }, [key, refresh])
  const closeDialog = useCallback(() => setDialog(null), [])

  const openRoti = useCallback(() => {
    if (key) setRoti({ key, auto: false })
  }, [key])
  const closeRoti = useCallback(() => setRoti(null), [])

  const submitAnswers = useCallback(
    async (answers: Record<string, HealthAnswerValue>): Promise<boolean> => {
      if (!boardId || !key || Object.keys(answers).length === 0) return false
      setSubmitting(true)
      try {
        const next = await submitBoardHealth(boardId, answers)
        writesRef.current += 1
        if (keyRef.current === key) setLoaded({ key, summary: next, error: null })
        return true
      } catch (err) {
        showToast(getApiErrorMessage(err, 'Не удалось сохранить ответы'), 'error')
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [boardId, key],
  )

  const submitRoti = useCallback(
    async (value: RotiValue): Promise<boolean> => {
      if (!boardId || !key) return false
      setSubmitting(true)
      try {
        const next = await submitBoardRoti(boardId, value)
        writesRef.current += 1
        if (keyRef.current === key) setLoaded({ key, summary: next, error: null })
        setRoti(null)
        showToast('Спасибо! Оценка встречи сохранена', 'success')
        return true
      } catch (err) {
        showToast(getApiErrorMessage(err, 'Не удалось сохранить оценку встречи'), 'error')
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [boardId, key],
  )

  const onHealthCheckRequested = useCallback(
    (data?: WsHealthCheckRequestedData | Record<string, unknown>) => {
      if (!key) return
      const startedByMe =
        typeof data?.participant_id === 'string' && data.participant_id === participantId
      const requestedBy =
        !startedByMe && typeof data?.requested_by === 'string' && data.requested_by
          ? data.requested_by
          : null
      setDialog({ key, requestedBy })
      refresh()
      if (startedByMe) showToast('Опрос открыт у всех, кто сейчас на доске', 'success')
    },
    [key, participantId, refresh],
  )

  const onHealthUpdated = useCallback((data: unknown) => {
    const team = parseTeamSummary(data)
    // Событие другой доски (или пришедшее без сессии) не наше
    if (!team || !keyRef.current?.startsWith(`${team.board_id}:`)) return
    eventsRef.current += 1
    // Личных ответов в событии нет — свои остаются теми, что вернул сервер на наш запрос.
    // Событие до первой загрузки пропускаем: сводку целиком принесёт GET.
    setLoaded((prev) =>
      prev?.summary && prev.summary.board_id === team.board_id
        ? { ...prev, summary: { ...team, mine: prev.summary.mine } }
        : prev,
    )
  }, [])

  const onRotiRequested = useCallback(() => {
    if (key) setRoti({ key, auto: true })
  }, [key])

  const handleServerEvent = useCallback(
    (msg: WsMessage): boolean => {
      switch (msg.event) {
        case 'health_check_requested':
          onHealthCheckRequested(msg.data)
          return true
        case 'health_updated':
          onHealthUpdated(msg.data)
          return true
        case 'roti_requested':
          onRotiRequested()
          return true
        default:
          return false
      }
    },
    [onHealthCheckRequested, onHealthUpdated, onRotiRequested],
  )

  const dialogOpen = dialog !== null && dialog.key === key
  const rotiRequested = roti !== null && roti.key === key
  // По запросу сервера не переспрашиваем того, кто уже оценил встречу;
  // пока сводка грузится, ждём — иначе окно мелькнёт и закроется
  const rotiOpen = rotiRequested && (!roti.auto || (!loading && myRoti === null))

  return useMemo(
    () => ({
      boardId: boardId ?? null,
      summary,
      questions: summary?.questions ?? [],
      myAnswers,
      myRoti,
      hasAnswered,
      loading,
      loadError,
      submitting,
      dialogOpen,
      requestedBy: dialogOpen ? (dialog?.requestedBy ?? null) : null,
      openDialog,
      closeDialog,
      rotiOpen,
      openRoti,
      closeRoti,
      refresh,
      submitAnswers,
      submitRoti,
      onHealthCheckRequested,
      onHealthUpdated,
      onRotiRequested,
      handleServerEvent,
    }),
    [
      boardId,
      summary,
      myAnswers,
      myRoti,
      hasAnswered,
      loading,
      loadError,
      submitting,
      dialogOpen,
      dialog,
      openDialog,
      closeDialog,
      rotiOpen,
      openRoti,
      closeRoti,
      refresh,
      submitAnswers,
      submitRoti,
      onHealthCheckRequested,
      onHealthUpdated,
      onRotiRequested,
      handleServerEvent,
    ],
  )
}
