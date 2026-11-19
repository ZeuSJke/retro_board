'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  useWebSocket,
  WS_CLOSE_POLICY_VIOLATION,
  type WsCloseInfo,
  type WsOpenInfo,
  type WsStatus,
} from './useWebSocket'
import { useAppStore } from '../store'
import { showToast } from '../store/toastStore'
import { getActionItems, getBoard } from '../api'
import { getApiErrorStatus, markApiErrorReported } from '../utils/apiError'
import {
  asActionItem,
  asCard,
  asColumn,
  asGroup,
  isBoardListItem,
  isBoardUpdatedData,
  isCardMovedData,
  isDeletedData,
  isGroupCollapseData,
  isGroupDeletedData,
  isGroupMovedData,
  isGroupsCollapsedData,
  isParticipant,
  isRecord,
  isSummaryFailedData,
  isTypingUser,
} from '../utils/wsData'
import {
  applyActionItemDeleted,
  applyActionItemSaved,
  applyBoardChange,
  describeBoardChange,
  hasBoardEntity,
  type BoardChange,
} from '../lib/board-events'
import { BoardEventSequencer } from '../lib/board-sync'
import type {
  ActionItem,
  Board,
  BoardListItem,
  Column,
  FacilitatorInfo,
  Participant,
  ReactionBubble,
  TypingUser,
  WsBoardUpdatedData,
  WsMessage,
} from '../types'

export interface CursorPos {
  x: number
  y: number
  /** Подпись курсора — имя участника; сам курсор хранится по `participant_id`. */
  name?: string
}

export const NO_FACILITATOR: FacilitatorInfo = { id: null, name: null, online: false }

/**
 * Откуда пришло изменение доски:
 * - `ws` — событие сервера, источник истины;
 * - `rest` — ответ на собственный запрос; не применяется, если событие сокета об этой же
 *   сущности уже пришло (оно не старше ответа, а запоздавший ответ затёр бы чужую правку);
 * - `local` — оптимистичная правка или её откат.
 */
export type ChangeSource = 'ws' | 'rest' | 'local'

/** Почему доска перечитывается (для отладки и для владельца хука). */
export type ResyncReason =
  | 'open'
  | 'reconnect'
  | 'gap'
  | 'visibility'
  | 'confirm'
  | 'snapshot'
  | 'rejected'
  | 'drag'
  | 'retry'

/**
 * Состояние связи для интерфейса:
 * - `connecting` — первое подключение;
 * - `online` — связь есть, доска сверена;
 * - `reconnecting` — связь потеряна, идут попытки подключиться;
 * - `syncing` — связь вернулась, доска перечитывается;
 * - `sync-failed` — связь есть, но перечитать доску не удаётся (попытки продолжаются);
 * - `closed` — сервер закрыл соединение, автоматических попыток больше нет.
 */
export type BoardConnection =
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'syncing'
  | 'sync-failed'
  | 'closed'

/** Ответ REST не применяется, если событие сокета о той же сущности пришло не раньше этого срока. */
const REST_AFTER_WS_WINDOW_MS = 3000
const RESYNC_RETRY_BASE_MS = 2000
const RESYNC_RETRY_MAX_MS = 30000

interface UseBoardWebSocketParams {
  boardId: string
  /** Колонки из загруженного снимка: доска рисуется сразу, без пустого кадра до чтения. */
  initialColumns?: Column[]
  onTimerWsEvent?: (event: string, data: Record<string, unknown>) => void
  /** После подключения сервер не прислал таймер — значит, на сервере он не запущен. */
  onTimerAbsent?: () => void
  onFacilitatorChanged?: (facilitator: FacilitatorInfo, phase: string | null) => void
  onPhaseChanged?: (phase: string) => void
  /** `regenerated` — итоги пересоздали кнопкой: окно итогов у остальных открывать не нужно. */
  onSummaryGenerated?: (regenerated: boolean) => void
  onSummaryFailed?: (message?: string) => void
  onBoardCreated?: (board: BoardListItem) => void
  onBoardUpdated?: (board: WsBoardUpdatedData) => void
  onBoardDeleted?: (id: string) => void
  /** Участник сменил имя. Подписи карточек хук обновляет сам. */
  onParticipantRenamed?: (participantId: string, name: string) => void
  /**
   * Доска перечитана с сервера: колонки хук уже заменил, владельцу остаётся обновить
   * остальное (настройки доски).
   */
  onBoardSnapshot?: (board: Board) => void
  /** Перечитывание завершено (после переподключения, пропуска событий и т. п.). */
  onResynced?: (reason: ResyncReason) => void
  /** Доски больше нет (удалена или недоступна): подключаться бессмысленно. */
  onBoardGone?: () => void
  /**
   * События, которые хук не обрабатывает сам (здоровье команды). Вернуть `true`, если событие
   * обработано. Пронумерованные события приходят сюда уже по порядку.
   */
  onServerEvent?: (msg: WsMessage) => boolean
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** Что сервер присылает сразу после подключения, только если оно есть. */
interface AwaitedState {
  timer: boolean
  spotlight: boolean
  ready: boolean
  typing: boolean
  groupsCollapsed: boolean
}

const NOTHING_AWAITED: AwaitedState = {
  timer: false,
  spotlight: false,
  ready: false,
  typing: false,
  groupsCollapsed: false,
}

interface SyncState {
  running: boolean
  /** Пока шло чтение, появился новый повод перечитать доску. */
  again: boolean
  /** Перечитывание отложено до конца перетаскивания. */
  wanted: boolean
  failures: number
  retryTimer: ReturnType<typeof setTimeout> | null
  disposed: boolean
}

export function useBoardWebSocket({
  boardId,
  initialColumns,
  onTimerWsEvent,
  onTimerAbsent,
  onFacilitatorChanged,
  onPhaseChanged,
  onSummaryGenerated,
  onSummaryFailed,
  onBoardCreated,
  onBoardUpdated,
  onBoardDeleted,
  onParticipantRenamed,
  onBoardSnapshot,
  onResynced,
  onBoardGone,
  onServerEvent,
}: UseBoardWebSocketParams) {
  // Личность — участник сессии
  const myId = useAppStore((s) => s.participant?.id ?? '')
  const [columns, setColumns] = useState<Column[]>(() => initialColumns ?? [])
  // Курсоры хранятся по идентификатору участника: у тёзок они разные
  const cursorsRef = useRef<Record<string, CursorPos>>({})
  const cursorListenersRef = useRef<Set<() => void>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [participants, setParticipants] = useState<Participant[]>([])
  // Имена всех, кого мы видели на доске: по ним подписываются голоса ушедших участников
  const [knownNames, setKnownNames] = useState<Record<string, string>>({})
  const [readyIds, setReadyIds] = useState<string[]>([])
  const [spotlightCardId, setSpotlightCardId] = useState<string | null>(null)
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const [reactions, setReactions] = useState<ReactionBubble[]>([])
  const [facilitator, setFacilitator] = useState<FacilitatorInfo>(NO_FACILITATOR)
  const [phase, setPhase] = useState<string | null>(null)
  const [trackedBoardId, setTrackedBoardId] = useState(boardId)
  const [sessionSynced, setSessionSynced] = useState(false)
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  // Связь терялась: пока доска не перечитана, пропущенные события не учтены
  const [recovering, setRecovering] = useState(false)
  const [syncFailed, setSyncFailed] = useState(false)
  const [boardGone, setBoardGone] = useState(false)
  const facilitatorRef = useRef<FacilitatorInfo>(NO_FACILITATOR)
  const phaseRef = useRef<string | null>(null)

  if (trackedBoardId !== boardId) {
    setTrackedBoardId(boardId)
    setSessionSynced(false)
    setFacilitator(NO_FACILITATOR)
    setPhase(null)
    setCollapsedGroups({})
    setParticipants([])
    setKnownNames({})
    setReadyIds([])
    setSpotlightCardId(null)
    setTypingUsers([])
    setReactions([])
    setRecovering(false)
    setSyncFailed(false)
    setBoardGone(false)
  }
  const cursorTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const reactionTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const lastCursorRef = useRef<CursorPos | null>(null)
  const lastCursorSentAtRef = useRef<number>(0)
  const lastCursorSentPosRef = useRef<CursorPos | null>(null)
  const sendMessageRef = useRef<((msg: WsMessage) => void) | null>(null)

  // Учёт номеров событий: один на всё время жизни хука
  const [sequencer] = useState(() => new BoardEventSequencer<WsMessage>())
  const syncRef = useRef<SyncState>({
    running: false,
    again: false,
    wanted: false,
    failures: 0,
    retryTimer: null,
    disposed: false,
  })
  // Когда событие сокета последний раз касалось сущности (`card:<id>` и т. п.)
  const touchedRef = useRef<Map<string, number>>(new Map())
  const awaitedRef = useRef<AwaitedState>(NOTHING_AWAITED)
  const boardIdRef = useRef(boardId)
  const statusRef = useRef<WsStatus>('connecting')
  const stopSocketRef = useRef<() => void>(() => {})
  const dispatchRef = useRef<(msg: WsMessage) => void>(() => {})
  const resyncRef = useRef<(reason: ResyncReason, snapshot?: Board) => void>(() => {})

  const myIdRef = useRef(myId)
  // Обработчики владельца — через ref: перечитывание и разбор событий живут дольше одного рендера
  const callbacksRef = useRef({
    onTimerWsEvent,
    onTimerAbsent,
    onFacilitatorChanged,
    onPhaseChanged,
    onSummaryGenerated,
    onSummaryFailed,
    onBoardCreated,
    onBoardUpdated,
    onBoardDeleted,
    onParticipantRenamed,
    onBoardSnapshot,
    onResynced,
    onBoardGone,
    onServerEvent,
  })
  useEffect(() => {
    myIdRef.current = myId
    callbacksRef.current = {
      onTimerWsEvent,
      onTimerAbsent,
      onFacilitatorChanged,
      onPhaseChanged,
      onSummaryGenerated,
      onSummaryFailed,
      onBoardCreated,
      onBoardUpdated,
      onBoardDeleted,
      onParticipantRenamed,
      onBoardSnapshot,
      onResynced,
      onBoardGone,
      onServerEvent,
    }
  })

  const subscribeCursors = useCallback((cb: () => void) => {
    cursorListenersRef.current.add(cb)
    return () => {
      cursorListenersRef.current.delete(cb)
    }
  }, [])

  const notifyCursorListeners = useCallback(() => {
    cursorListenersRef.current.forEach((cb) => cb())
  }, [])

  useEffect(() => {
    boardIdRef.current = boardId
    facilitatorRef.current = NO_FACILITATOR
    phaseRef.current = null
    Object.values(cursorTimeouts.current).forEach(clearTimeout)
    cursorTimeouts.current = {}
    Object.values(reactionTimeouts.current).forEach(clearTimeout)
    reactionTimeouts.current = {}
    if (Object.keys(cursorsRef.current).length > 0) {
      cursorsRef.current = {}
      notifyCursorListeners()
    }
    lastCursorSentAtRef.current = 0
    lastCursorSentPosRef.current = null
    touchedRef.current.clear()
    awaitedRef.current = NOTHING_AWAITED
    const sync = syncRef.current
    if (sync.retryTimer) clearTimeout(sync.retryTimer)
    sync.retryTimer = null
    sync.again = false
    sync.wanted = false
    sync.failures = 0
  }, [boardId, notifyCursorListeners])

  useEffect(() => {
    const cTimeouts = cursorTimeouts.current
    const rTimeouts = reactionTimeouts.current
    const sync = syncRef.current
    sync.disposed = false
    return () => {
      sync.disposed = true
      if (sync.retryTimer) clearTimeout(sync.retryTimer)
      sync.retryTimer = null
      Object.values(cTimeouts).forEach(clearTimeout)
      Object.values(rTimeouts).forEach(clearTimeout)
    }
  }, [])

  useEffect(() => {
    getActionItems(boardId)
      .then(setActionItems)
      .catch((err) => console.error('Failed to load action items:', err))
  }, [boardId])

  const rememberNames = useCallback((people: Participant[]) => {
    setKnownNames((prev) => {
      let next = prev
      for (const person of people) {
        if (person.name && next[person.id] !== person.name) {
          if (next === prev) next = { ...prev }
          next[person.id] = person.name
        }
      }
      return next
    })
  }, [])

  const removeCursor = useCallback(
    (id: string) => {
      clearTimeout(cursorTimeouts.current[id])
      delete cursorTimeouts.current[id]
      if (id in cursorsRef.current) {
        const next = { ...cursorsRef.current }
        delete next[id]
        cursorsRef.current = next
        notifyCursorListeners()
      }
    },
    [notifyCursorListeners],
  )

  /**
   * Применить изменение к колонкам — одна точка для события сокета, ответа REST и
   * оптимистичной правки (см. `applyBoardChange`).
   */
  const applyChange = useCallback((change: BoardChange, source: ChangeSource = 'local') => {
    const { key, creates } = describeBoardChange(change)
    if (key && source === 'ws') {
      const touched = touchedRef.current
      const now = Date.now()
      if (touched.size > 400) {
        for (const [k, at] of touched) {
          if (now - at >= REST_AFTER_WS_WINDOW_MS) touched.delete(k)
        }
      }
      touched.set(key, now)
    }
    if (key && source === 'rest') {
      const touchedAt = touchedRef.current.get(key)
      // Событие сокета об этой сущности уже пришло: оно не старше ответа REST
      if (touchedAt !== undefined && Date.now() - touchedAt < REST_AFTER_WS_WINDOW_MS) return
      if (creates) {
        setColumns((prev) => (hasBoardEntity(prev, key) ? prev : applyBoardChange(prev, change)))
        return
      }
    }
    setColumns((prev) => applyBoardChange(prev, change))
  }, [])

  /** Начальное состояние доски (снимок, с которым открыта страница). */
  const resetBoard = useCallback(
    (board: Pick<Board, 'columns' | 'event_seq' | 'event_epoch'>) => {
      sequencer.reset({ epoch: board.event_epoch, seq: board.event_seq })
      touchedRef.current.clear()
      setColumns(board.columns || [])
    },
    [sequencer],
  )

  // Сервер присылает готовность, фокус, набор текста и таймер при подключении, только если
  // они есть. Состав доски (`presence_update`) приходит последним: чего к этому моменту нет —
  // того нет и на сервере, и состояние, оставшееся с прошлого подключения, пора сбросить.
  const settleAwaitedState = useCallback(() => {
    const awaited = awaitedRef.current
    if (!awaited.timer && !awaited.spotlight && !awaited.ready && !awaited.typing && !awaited.groupsCollapsed) {
      return
    }
    awaitedRef.current = NOTHING_AWAITED
    if (awaited.ready) setReadyIds((prev) => (prev.length > 0 ? [] : prev))
    if (awaited.spotlight) setSpotlightCardId(null)
    if (awaited.typing) setTypingUsers((prev) => (prev.length > 0 ? [] : prev))
    if (awaited.groupsCollapsed) {
      setCollapsedGroups((prev) => (Object.keys(prev).length > 0 ? {} : prev))
    }
    if (awaited.timer) callbacksRef.current.onTimerAbsent?.()
  }, [])

  const noLongerAwaited = useCallback((part: keyof AwaitedState) => {
    if (awaitedRef.current[part]) awaitedRef.current = { ...awaitedRef.current, [part]: false }
  }, [])

  /** Разобрать и применить событие. Порядок пронумерованных событий уже проверен. */
  const dispatch = useCallback(
    (msg: WsMessage) => {
      const { event } = msg
      const rawData: unknown = msg.data ?? {}
      const data: Record<string, unknown> = isRecord(rawData) ? rawData : {}
      const callbacks = callbacksRef.current

      if (callbacks.onServerEvent?.(msg)) return

      if (event === 'groups_collapsed') {
        noLongerAwaited('groupsCollapsed')
        if (!isGroupsCollapsedData(rawData)) return
        const next: Record<string, boolean> = {}
        for (const id of rawData.group_ids) {
          if (id) next[id] = true
        }
        setCollapsedGroups(next)
        return
      }

      if (event === 'group_collapse') {
        noLongerAwaited('groupsCollapsed')
        if (!isGroupCollapseData(rawData)) return
        const { group_id, collapsed } = rawData
        setCollapsedGroups((prev) => ({ ...prev, [group_id]: collapsed }))
        return
      }

      if (event === 'cursor_move') {
        const id = typeof data.participant_id === 'string' ? data.participant_id : ''
        const x = typeof data.x === 'number' ? data.x : null
        const y = typeof data.y === 'number' ? data.y : null
        if (!id || x === null || y === null) return
        const name = typeof data.username === 'string' ? data.username : ''
        cursorsRef.current = { ...cursorsRef.current, [id]: { x, y, name } }
        // Будим слой курсоров и анимацию перемещения без лишнего перерендера доски.
        notifyCursorListeners()
        clearTimeout(cursorTimeouts.current[id])
        cursorTimeouts.current[id] = setTimeout(() => removeCursor(id), 6000)
        return
      }

      if (event === 'cursor_leave') {
        const id = typeof data.participant_id === 'string' ? data.participant_id : ''
        if (id) removeCursor(id)
        return
      }

      if (event === 'timer_start' || event === 'timer_pause' || event === 'timer_reset') {
        noLongerAwaited('timer')
        callbacks.onTimerWsEvent?.(event, data)
        return
      }

      if (event === 'presence_update') {
        const list = Array.isArray(data.participants) ? data.participants.filter(isParticipant) : []
        setParticipants(list)
        rememberNames(list)
        settleAwaitedState()
        return
      }

      if (event === 'ready_update') {
        noLongerAwaited('ready')
        setReadyIds(stringList(data.ready_ids))
        return
      }

      if (event === 'spotlight_update') {
        noLongerAwaited('spotlight')
        const cardId = typeof data.card_id === 'string' ? data.card_id : null
        setSpotlightCardId(cardId)
        return
      }

      if (event === 'typing_update') {
        noLongerAwaited('typing')
        const list = Array.isArray(data.typing) ? data.typing.filter(isTypingUser) : []
        setTypingUsers(list)
        return
      }

      if (event === 'reaction') {
        const emoji = typeof data.emoji === 'string' ? data.emoji : ''
        const sender = typeof data.username === 'string' ? data.username : ''
        const participantId = typeof data.participant_id === 'string' ? data.participant_id : undefined
        const id =
          typeof data.id === 'string'
            ? data.id
            : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        if (!emoji) return
        const xOffset = 8 + Math.floor(Math.random() * 84)
        setReactions((prev) => [
          ...prev.slice(-23),
          { id, emoji, username: sender, participantId, xOffset },
        ])
        reactionTimeouts.current[id] = setTimeout(() => {
          setReactions((prev) => prev.filter((r) => r.id !== id))
          delete reactionTimeouts.current[id]
        }, 3500)
        return
      }

      if (event === 'facilitator_update') {
        const id = typeof data.facilitator_id === 'string' && data.facilitator_id ? data.facilitator_id : null
        const next: FacilitatorInfo = id
          ? {
              id,
              name: typeof data.facilitator === 'string' ? data.facilitator : null,
              online: data.facilitator_online !== false,
            }
          : NO_FACILITATOR
        const p = typeof data.phase === 'string' ? data.phase : null
        facilitatorRef.current = next
        phaseRef.current = p
        setFacilitator(next)
        setPhase(p)
        setSessionSynced(true)
        if (next.id && next.name) rememberNames([{ id: next.id, name: next.name }])
        if (!next.id) {
          setReadyIds([])
          setSpotlightCardId(null)
        }
        callbacks.onFacilitatorChanged?.(next, p)
        return
      }

      if (event === 'phase_update') {
        const p = typeof data.phase === 'string' ? data.phase : null
        if (!p) return
        phaseRef.current = p
        setPhase(p)
        setReadyIds([])
        setSpotlightCardId(null)
        callbacks.onPhaseChanged?.(p)
        return
      }

      if (event === 'cards_visibility_changed') {
        // Что показывать участнику, решает сервер: карточки заново придут в нужном виде
        resyncRef.current('visibility')
        return
      }

      if (event === 'participant_renamed') {
        const id = typeof data.participant_id === 'string' ? data.participant_id : ''
        const name = typeof data.name === 'string' ? data.name : ''
        if (!id || !name) return
        applyChange({ type: 'participant_renamed', participant_id: id, name }, 'ws')
        setParticipants((prev) =>
          prev.some((p) => p.id === id && p.name !== name)
            ? prev.map((p) => (p.id === id ? { ...p, name } : p))
            : prev,
        )
        setKnownNames((prev) => (prev[id] === name ? prev : { ...prev, [id]: name }))
        if (facilitatorRef.current.id === id && facilitatorRef.current.name !== name) {
          const updatedFac = { ...facilitatorRef.current, name }
          facilitatorRef.current = updatedFac
          setFacilitator(updatedFac)
          callbacks.onFacilitatorChanged?.(updatedFac, phaseRef.current)
        }
        setTypingUsers((prev) =>
          prev.some((t) => t.participant_id === id && t.username !== name)
            ? prev.map((t) => (t.participant_id === id ? { ...t, username: name } : t))
            : prev,
        )
        const cursor = cursorsRef.current[id]
        if (cursor && cursor.name !== name) {
          cursorsRef.current = { ...cursorsRef.current, [id]: { ...cursor, name } }
          notifyCursorListeners()
        }
        callbacks.onParticipantRenamed?.(id, name)
        return
      }

      if (event === 'action_item_created' || event === 'action_item_updated') {
        try {
          const item = asActionItem(data)
          setActionItems((prev) => applyActionItemSaved(prev, item))
        } catch {
          /* ignore malformed action item */
        }
        return
      }

      if (event === 'action_item_deleted') {
        if (isDeletedData(rawData)) {
          setActionItems((prev) => applyActionItemDeleted(prev, rawData.id))
        }
        return
      }

      if (event === 'auto_cluster_completed') {
        // «Это запустил я» — по идентификатору участника: у тёзок имена совпадают
        const initiatorId = typeof data.participant_id === 'string' ? data.participant_id : ''
        const name = typeof data.username === 'string' ? data.username : ''
        const mine = Boolean(initiatorId) && initiatorId === myIdRef.current
        if (name && !mine) {
          showToast(`${name} сгруппировал(а) карточки`, 'info')
        }
        return
      }

      if (event === 'summary_generated') {
        callbacks.onSummaryGenerated?.(data.regenerated === true)
        return
      }

      if (event === 'summary_failed') {
        if (isSummaryFailedData(rawData)) {
          callbacks.onSummaryFailed?.(rawData.message)
        } else {
          callbacks.onSummaryFailed?.(typeof data.message === 'string' ? data.message : undefined)
        }
        return
      }

      if (event === 'board_created') {
        if (isBoardListItem(rawData)) callbacks.onBoardCreated?.(rawData)
        return
      }

      if (event === 'board_updated') {
        if (isBoardUpdatedData(rawData)) callbacks.onBoardUpdated?.(rawData)
        return
      }

      if (event === 'board_deleted') {
        if (isDeletedData(rawData)) callbacks.onBoardDeleted?.(rawData.id)
        return
      }

      let change: BoardChange | null = null
      try {
        switch (event) {
          case 'column_created':
            change = { type: 'column_created', column: asColumn(rawData) }
            break
          case 'column_updated':
            change = { type: 'column_updated', column: asColumn(rawData) }
            break
          case 'column_deleted':
            if (isDeletedData(rawData)) change = { type: 'column_deleted', id: rawData.id }
            break
          case 'card_created':
            change = { type: 'card_created', card: asCard(rawData) }
            break
          case 'card_updated':
            change = { type: 'card_updated', card: asCard(rawData) }
            break
          case 'card_moved':
            if (isCardMovedData(rawData)) {
              change = {
                ...rawData,
                type: 'card_moved',
                card: asCard(rawData.card),
              }
            }
            break
          case 'card_deleted':
            if (isDeletedData(rawData)) change = { type: 'card_deleted', id: rawData.id }
            break
          case 'group_created':
            change = { type: 'group_created', group: asGroup(rawData) }
            break
          case 'group_updated':
            change = { type: 'group_updated', group: asGroup(rawData) }
            break
          case 'group_deleted':
            if (isGroupDeletedData(rawData)) {
              change = { ...rawData, type: 'group_deleted' }
              setCollapsedGroups((prev) => {
                if (!(rawData.id in prev)) return prev
                const next = { ...prev }
                delete next[rawData.id]
                return next
              })
            }
            break
          case 'group_moved':
            if (isGroupMovedData(rawData)) change = { ...rawData, type: 'group_moved' }
            break
          default:
            break
        }
      } catch {
        return
      }
      if (change) applyChange(change, 'ws')
    },
    [
      applyChange,
      noLongerAwaited,
      notifyCursorListeners,
      rememberNames,
      removeCursor,
      settleAwaitedState,
    ],
  )

  /**
   * Перечитать доску и задачи с сервера. Пока идёт чтение, пронумерованные события копятся
   * и применяются поверх снимка — ничего не теряется и не применяется дважды. `snapshot` —
   * доска, уже полученная ответом REST (сохранение настроек, раскрытие карточек).
   */
  const resync = useCallback(
    (reason: ResyncReason, snapshot?: Board) => {
      const sync = syncRef.current
      const id = boardIdRef.current
      if (!id || sync.disposed) return
      if (sync.running) {
        sync.again = true
        return
      }
      if (sequencer.isPaused) {
        // Участник тащит карточку: состояние под указателем не подменяем
        sync.wanted = true
        return
      }
      if (sync.retryTimer) clearTimeout(sync.retryTimer)
      sync.retryTimer = null
      sync.running = true
      const before = sequencer.current
      sequencer.beginSnapshot()

      const stale = () => sync.disposed || boardIdRef.current !== id

      void (async () => {
        let error: unknown = null
        let failed = false
        let followUp: ResyncReason | null = null
        try {
          const fresh = snapshot ?? (await getBoard(id))
          if (stale()) return
          // Первое подключение: номер событий тот же, что у снимка, с которым открыта
          // страница, — между снимком и подпиской на события ничего не произошло
          const unchanged =
            reason === 'open' &&
            Boolean(fresh.event_epoch) &&
            fresh.event_epoch === before.epoch &&
            fresh.event_seq === before.seq
          // Задачи читаются после доски: их список не старше номера снимка
          const items = unchanged ? null : await getActionItems(id)
          if (stale()) return
          if (sequencer.isPaused) {
            sequencer.abortSnapshot()
            sync.wanted = true
            return
          }
          const result = sequencer.completeSnapshot({
            epoch: fresh.event_epoch,
            seq: fresh.event_seq,
          })
          if (result.fresh && !unchanged) {
            setColumns(fresh.columns || [])
            callbacksRef.current.onBoardSnapshot?.(fresh)
          }
          if (items) setActionItems(items)
          for (const msg of result.replay) dispatchRef.current(msg)
          sync.failures = 0
          setRecovering(false)
          setSyncFailed(false)
          if (!unchanged) callbacksRef.current.onResynced?.(reason)
          if (result.resync) followUp = 'gap'
          else if (result.overlap && reason !== 'confirm') followUp = 'confirm'
        } catch (err) {
          error = err
          failed = true
          sequencer.abortSnapshot()
        } finally {
          sync.running = false
        }

        if (stale()) return
        if (failed) {
          // Фоновая сверка: общий тост об ошибке не нужен
          markApiErrorReported(error)
          const status = getApiErrorStatus(error)
          // 401: перехватчик сбросил сессию — приложение само покажет экран входа
          if (status === 401) return
          if (status === 404) {
            stopSocketRef.current()
            setBoardGone(true)
            callbacksRef.current.onBoardGone?.()
            return
          }
          sync.failures += 1
          sync.again = false
          // Без связи повторять бессмысленно: доска перечитается при подключении
          if (statusRef.current === 'open') {
            setSyncFailed(true)
            const delay = Math.min(
              RESYNC_RETRY_BASE_MS * 2 ** (sync.failures - 1),
              RESYNC_RETRY_MAX_MS,
            )
            sync.retryTimer = setTimeout(() => {
              sync.retryTimer = null
              resyncRef.current('retry')
            }, delay)
          }
          return
        }
        if (sync.again) {
          sync.again = false
          resyncRef.current(followUp ?? 'retry')
        } else if (followUp) {
          resyncRef.current(followUp)
        }
      })()
    },
    [sequencer],
  )

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      const verdict = sequencer.accept(msg)
      if (verdict === 'skip' || verdict === 'hold') return
      if (verdict === 'resync') {
        resync('gap')
        return
      }
      dispatch(msg)
    },
    [dispatch, resync, sequencer],
  )

  // Сокет закрылся при рукопожатии или сервером: выясняем, не пропала ли доска или сессия.
  // Отказ при рукопожатии браузер видит как обычный обрыв (код 1006), поэтому по коду
  // закрытия причину не узнать — спрашиваем REST.
  const verifyAccess = useCallback(async () => {
    const id = boardIdRef.current
    if (!id) return
    try {
      await getBoard(id)
    } catch (err) {
      markApiErrorReported(err)
      if (syncRef.current.disposed || boardIdRef.current !== id) return
      // 401 сбрасывает сессию в перехватчике: приложение покажет вход, сокет остановится сам
      if (getApiErrorStatus(err) === 404) {
        stopSocketRef.current()
        setBoardGone(true)
        callbacksRef.current.onBoardGone?.()
      }
    }
  }, [])

  const { sendMessage, connected, status, reconnect, stop } = useWebSocket(
    boardId,
    handleWsMessage,
    useCallback(
      (info?: WsOpenInfo) => {
        // Личность сокета сервер берёт из сессии. `identify` — запрос состава доски
        // и состояния сессии ведущего (ответ: presence_update и facilitator_update).
        sendMessageRef.current?.({ event: 'identify', data: {} })
        const pos = lastCursorRef.current
        if (pos) {
          sendMessageRef.current?.({ event: 'cursor_move', data: { x: pos.x, y: pos.y } })
        }
        awaitedRef.current = {
          timer: true,
          spotlight: true,
          ready: true,
          typing: true,
          groupsCollapsed: true,
        }
        statusRef.current = 'open'
        // Пока сокета не было, события могли пройти мимо: копим новые до снимка
        if (info?.reconnected) sequencer.markStale()
        resyncRef.current(info?.reconnected ? 'reconnect' : 'open')
      },
      [sequencer],
    ),
    {
      // Сокет доски отвечает на ping: по молчанию видно зависшее соединение
      expectPong: true,
      onClose: useCallback(
        (info: WsCloseInfo) => {
          if (info.wasOpen) setRecovering(true)
          const refusedAtHandshake =
            !info.wasOpen && (info.failedAttempts === 1 || info.failedAttempts % 4 === 0)
          if (info.code === WS_CLOSE_POLICY_VIOLATION || refusedAtHandshake) {
            void verifyAccess()
          }
        },
        [verifyAccess],
      ),
    },
  )

  useEffect(() => {
    sendMessageRef.current = sendMessage
    stopSocketRef.current = stop
    statusRef.current = status
    dispatchRef.current = dispatch
    resyncRef.current = resync
  }, [sendMessage, stop, status, dispatch, resync])

  /** Перетаскивание началось: чужие изменения и перечитывание откладываются. */
  const holdRemoteChanges = useCallback(() => {
    sequencer.pause()
  }, [sequencer])

  /** Перетаскивание закончилось: применить отложенное. */
  const releaseRemoteChanges = useCallback(() => {
    if (!sequencer.isPaused) return
    const sync = syncRef.current
    const drained = sequencer.resume()
    for (const msg of drained.replay) dispatchRef.current(msg)
    if (sync.wanted || drained.resync || sequencer.needsSnapshot) {
      sync.wanted = false
      resyncRef.current('drag')
    }
  }, [sequencer])

  /** Применить доску из ответа REST как снимок (и дочитать к ней задачи). */
  const applySnapshot = useCallback((board: Board) => {
    resyncRef.current('snapshot', board)
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent, boardEl: HTMLDivElement | null) => {
      if (!boardEl) return
      const rect = boardEl.getBoundingClientRect()
      const pos = {
        x: Math.round(e.clientX - rect.left + boardEl.scrollLeft),
        y: Math.round(e.clientY - rect.top + boardEl.scrollTop),
      }
      lastCursorRef.current = pos
      const now = performance.now()
      const prevSent = lastCursorSentPosRef.current
      const movedEnough =
        !prevSent || Math.abs(pos.x - prevSent.x) >= 3 || Math.abs(pos.y - prevSent.y) >= 3
      if (!movedEnough || now - lastCursorSentAtRef.current < 50) return
      lastCursorSentAtRef.current = now
      lastCursorSentPosRef.current = pos
      sendMessage({ event: 'cursor_move', data: pos })
    },
    [sendMessage],
  )

  const handleMouseLeave = useCallback(() => {
    sendMessage({ event: 'cursor_leave', data: {} })
  }, [sendMessage])

  const connection: BoardConnection = boardGone
    ? 'closed'
    : status === 'open'
      ? syncFailed
        ? 'sync-failed'
        : recovering
          ? 'syncing'
          : 'online'
      : status

  return {
    columns,
    setColumns,
    /** Применить изменение доски (событие, ответ REST или оптимистичная правка). */
    applyChange,
    /** Задать начальное состояние из снимка доски. */
    resetBoard,
    /** Применить доску из ответа REST как снимок. */
    applySnapshot,
    /** Перечитать доску с сервера. */
    resync,
    holdRemoteChanges,
    releaseRemoteChanges,
    cursorsRef,
    subscribeCursors,
    collapsedGroups,
    setCollapsedGroups,
    /** Идентификатор текущего участника (пустая строка, пока сессии нет). */
    myId,
    /** Участники, подключённые к доске сейчас. */
    participants,
    /** Имена всех, кого клиент видел на доске: `participant_id → имя`. */
    knownNames,
    /** Идентификаторы участников, отметивших готовность. */
    readyIds,
    spotlightCardId,
    typingUsers,
    reactions,
    facilitator,
    phase,
    sessionSynced,
    connected,
    /** Состояние связи для баннера на доске. */
    connection,
    /** Подключиться снова вручную (после `closed`). */
    reconnect,
    actionItems,
    setActionItems,
    sendMessage,
    handleMouseMove,
    handleMouseLeave,
  }
}
