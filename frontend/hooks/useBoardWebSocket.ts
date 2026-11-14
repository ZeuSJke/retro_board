'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useWebSocket } from './useWebSocket'
import { useAppStore } from '../store'
import { showToast } from '../store/toastStore'
import { getActionItems } from '../api'
import { asCard, asColumn, asGroup, asActionItem } from '../utils/wsData'
import {
  applyCardCreated,
  applyCardDeleted,
  applyCardMoved,
  applyCardUpdated,
  applyColumnCreated,
  applyColumnDeleted,
  applyColumnUpdated,
  applyGroupCreated,
  applyGroupDeleted,
  applyGroupMoved,
  applyGroupUpdated,
  applyParticipantRenamed,
} from '../lib/board-events'
import type {
  ActionItem,
  BoardListItem,
  BoardMood,
  Column,
  FacilitatorInfo,
  Participant,
  ReactionBubble,
  TypingUser,
  WsMessage,
  WsCardMovedData,
  WsGroupCollapseData,
  WsGroupMovedData,
  WsDeletedData,
  WsGroupDeletedData,
  WsBoardUpdatedData,
  WsSummaryFailedData,
} from '../types'

export interface CursorPos {
  x: number
  y: number
  /** Подпись курсора — имя участника; сам курсор хранится по `participant_id`. */
  name?: string
}

export const NO_FACILITATOR: FacilitatorInfo = { id: null, name: null, online: false }

interface UseBoardWebSocketParams {
  boardId: string
  onTimerWsEvent?: (event: string, data: Record<string, unknown>) => void
  onFacilitatorChanged?: (facilitator: FacilitatorInfo, phase: string | null) => void
  onPhaseChanged?: (phase: string) => void
  onSummaryGenerated?: () => void
  onSummaryFailed?: (message?: string) => void
  onBoardCreated?: (board: BoardListItem) => void
  onBoardUpdated?: (board: WsBoardUpdatedData) => void
  onBoardDeleted?: (id: string) => void
  onMoodUpdated?: (mood: BoardMood) => void
  /** Сервер изменил видимость карточек (раскрытие, начало штурма): доску нужно перечитать. */
  onCardsVisibilityChanged?: () => void
  /** Участник сменил имя. Подписи карточек хук обновляет сам. */
  onParticipantRenamed?: (participantId: string, name: string) => void
}

function isParticipant(value: unknown): value is Participant {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Participant).id === 'string' &&
    (value as Participant).id.length > 0 &&
    typeof (value as Participant).name === 'string'
  )
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export function useBoardWebSocket({
  boardId,
  onTimerWsEvent,
  onFacilitatorChanged,
  onPhaseChanged,
  onSummaryGenerated,
  onSummaryFailed,
  onBoardCreated,
  onBoardUpdated,
  onBoardDeleted,
  onMoodUpdated,
  onCardsVisibilityChanged,
  onParticipantRenamed,
}: UseBoardWebSocketParams) {
  // Личность — участник сессии; имя нужно только для подписи в уведомлениях
  const myId = useAppStore((s) => s.participant?.id ?? '')
  const myName = useAppStore((s) => s.participant?.name ?? s.username)
  const [columns, setColumns] = useState<Column[]>([])
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
  const [sessionSynced, setSessionSynced] = useState(false)
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const cursorTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const reactionTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const lastCursorRef = useRef<CursorPos | null>(null)
  const lastCursorSentAtRef = useRef<number>(0)
  const lastCursorSentPosRef = useRef<CursorPos | null>(null)
  const sendMessageRef = useRef<((msg: WsMessage) => void) | null>(null)

  useEffect(() => {
    setSessionSynced(false)
    setFacilitator(NO_FACILITATOR)
    setPhase(null)
    setParticipants([])
    setKnownNames({})
    setReadyIds([])
    setSpotlightCardId(null)
    setTypingUsers([])
    setReactions([])
    Object.values(cursorTimeouts.current).forEach(clearTimeout)
    cursorTimeouts.current = {}
    if (Object.keys(cursorsRef.current).length > 0) {
      cursorsRef.current = {}
      notifyCursorListeners()
    }
    lastCursorSentAtRef.current = 0
    lastCursorSentPosRef.current = null
  }, [boardId])

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
    const cTimeouts = cursorTimeouts.current
    const rTimeouts = reactionTimeouts.current
    return () => {
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

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      const { event, data } = msg

      if (event === 'group_collapse') {
        const { group_id, collapsed } = data as unknown as WsGroupCollapseData
        setCollapsedGroups((prev) => ({ ...prev, [group_id]: collapsed }))
        return
      }

      if (event === 'cursor_move') {
        const id = typeof data.participant_id === 'string' ? data.participant_id : ''
        const x = typeof data.x === 'number' ? data.x : null
        const y = typeof data.y === 'number' ? data.y : null
        if (!id || x === null || y === null) return
        const name = typeof data.username === 'string' ? data.username : ''
        const prevCursor = cursorsRef.current[id]
        cursorsRef.current = { ...cursorsRef.current, [id]: { x, y, name } }
        // Only trigger a React tree re-render when a peer cursor appears for the first time
        // (or its label changes); CursorMarker animates x/y directly via requestAnimationFrame.
        if (!prevCursor || prevCursor.name !== name) {
          notifyCursorListeners()
        }
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
        onTimerWsEvent?.(event, data)
        return
      }

      if (event === 'presence_update') {
        const list = Array.isArray(data.participants) ? data.participants.filter(isParticipant) : []
        setParticipants(list)
        rememberNames(list)
        return
      }

      if (event === 'ready_update') {
        setReadyIds(stringList(data.ready_ids))
        return
      }

      if (event === 'spotlight_update') {
        const cardId = typeof data.card_id === 'string' ? data.card_id : null
        setSpotlightCardId(cardId)
        return
      }

      if (event === 'typing_update') {
        const list = Array.isArray(data.typing)
          ? data.typing.filter(
              (item): item is TypingUser =>
                typeof item === 'object' &&
                item !== null &&
                typeof (item as TypingUser).participant_id === 'string' &&
                typeof (item as TypingUser).username === 'string' &&
                typeof (item as TypingUser).column_id === 'string',
            )
          : []
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

      if (event === 'mood_updated') {
        if (typeof data?.id === 'string' && typeof data?.score === 'number') {
          onMoodUpdated?.(data as unknown as BoardMood)
        }
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
        setFacilitator(next)
        setPhase(p)
        setSessionSynced(true)
        if (next.id && next.name) rememberNames([{ id: next.id, name: next.name }])
        if (!next.id) {
          setReadyIds([])
          setSpotlightCardId(null)
        }
        onFacilitatorChanged?.(next, p)
        return
      }

      if (event === 'phase_update') {
        const p = typeof data.phase === 'string' ? data.phase : null
        if (!p) return
        setPhase(p)
        setReadyIds([])
        setSpotlightCardId(null)
        onPhaseChanged?.(p)
        return
      }

      if (event === 'cards_visibility_changed') {
        onCardsVisibilityChanged?.()
        return
      }

      if (event === 'participant_renamed') {
        const id = typeof data.participant_id === 'string' ? data.participant_id : ''
        const name = typeof data.name === 'string' ? data.name : ''
        if (!id || !name) return
        setColumns((prev) => applyParticipantRenamed(prev, id, name))
        setParticipants((prev) =>
          prev.some((p) => p.id === id && p.name !== name)
            ? prev.map((p) => (p.id === id ? { ...p, name } : p))
            : prev,
        )
        setKnownNames((prev) => (prev[id] === name ? prev : { ...prev, [id]: name }))
        setFacilitator((prev) => (prev.id === id && prev.name !== name ? { ...prev, name } : prev))
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
        onParticipantRenamed?.(id, name)
        return
      }

      if (event === 'action_item_created') {
        try {
          const item = asActionItem(data)
          setActionItems((prev) => (prev.find((i) => i.id === item.id) ? prev : [...prev, item]))
        } catch {
          /* ignore malformed action item */
        }
        return
      }

      if (event === 'action_item_updated') {
        try {
          const item = asActionItem(data)
          setActionItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))
        } catch {
          /* ignore malformed action item */
        }
        return
      }

      if (event === 'action_item_deleted') {
        const { id } = data as { id: string }
        if (id) setActionItems((prev) => prev.filter((i) => i.id !== id))
        return
      }

      if (event === 'auto_cluster_completed') {
        // В событии только имя инициатора (идентификатора участника нет): себя узнаём по имени
        const u = typeof data.username === 'string' ? data.username : ''
        if (u && u !== myName) {
          showToast(`${u} сгруппировал(а) карточки`, 'info')
        }
        return
      }

      if (event === 'summary_generated') {
        onSummaryGenerated?.()
        return
      }

      if (event === 'summary_failed') {
        const { message } = data as unknown as WsSummaryFailedData
        onSummaryFailed?.(message)
        return
      }

      if (event === 'board_created') {
        const board = data as unknown as BoardListItem
        if (board?.id) onBoardCreated?.(board)
        return
      }

      if (event === 'board_updated') {
        const upd = data as unknown as WsBoardUpdatedData
        if (upd?.id) onBoardUpdated?.(upd)
        return
      }

      if (event === 'board_deleted') {
        const { id } = data as unknown as WsDeletedData
        if (id) onBoardDeleted?.(id)
        return
      }

      let updater: ((prev: Column[]) => Column[]) | null = null
      try {
        switch (event) {
          case 'column_created': {
            const col = asColumn(data)
            updater = (prev) => applyColumnCreated(prev, col)
            break
          }
          case 'column_updated': {
            const col = asColumn(data)
            updater = (prev) => applyColumnUpdated(prev, col)
            break
          }
          case 'column_deleted': {
            const deletedId = (data as unknown as WsDeletedData)?.id
            if (deletedId) updater = (prev) => applyColumnDeleted(prev, deletedId)
            break
          }
          case 'card_created': {
            const card = asCard(data)
            updater = (prev) => applyCardCreated(prev, card)
            break
          }
          case 'card_updated': {
            const card = asCard(data)
            updater = (prev) => applyCardUpdated(prev, card)
            break
          }
          case 'card_moved': {
            const moved = data as unknown as WsCardMovedData
            if (!moved?.card || !moved.old_column_id) break
            const payload: WsCardMovedData = { ...moved, card: asCard(moved.card as unknown as Record<string, unknown>) }
            updater = (prev) => applyCardMoved(prev, payload)
            break
          }
          case 'card_deleted': {
            const deletedId = (data as unknown as WsDeletedData)?.id
            if (deletedId) updater = (prev) => applyCardDeleted(prev, deletedId)
            break
          }
          case 'group_created': {
            const g = asGroup(data)
            updater = (prev) => applyGroupCreated(prev, g)
            break
          }
          case 'group_updated': {
            const g = asGroup(data)
            updater = (prev) => applyGroupUpdated(prev, g)
            break
          }
          case 'group_deleted': {
            const del = data as unknown as WsGroupDeletedData
            if (!del?.id || !del.column_id) break
            updater = (prev) => applyGroupDeleted(prev, del)
            break
          }
          case 'group_moved': {
            const moved = data as unknown as WsGroupMovedData
            if (!moved?.group || !moved.old_column_id || !Array.isArray(moved.cards)) break
            updater = (prev) => applyGroupMoved(prev, moved)
            break
          }
          default:
            break
        }
      } catch {
        return
      }
      if (updater) setColumns(updater)
    },
    [
      onTimerWsEvent,
      onFacilitatorChanged,
      onPhaseChanged,
      onSummaryGenerated,
      onSummaryFailed,
      onBoardCreated,
      onBoardUpdated,
      onBoardDeleted,
      onMoodUpdated,
      onCardsVisibilityChanged,
      onParticipantRenamed,
      notifyCursorListeners,
      rememberNames,
      removeCursor,
      myName,
    ],
  )

  const { sendMessage, connected } = useWebSocket(
    boardId,
    handleWsMessage,
    useCallback(() => {
      // Личность сокета сервер берёт из сессии. `identify` — запрос состава доски
      // и состояния сессии ведущего (ответ: presence_update и facilitator_update).
      sendMessageRef.current?.({ event: 'identify', data: {} })
      const pos = lastCursorRef.current
      if (pos) {
        sendMessageRef.current?.({ event: 'cursor_move', data: { x: pos.x, y: pos.y } })
      }
    }, []),
  )

  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

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

  return {
    columns,
    setColumns,
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
    actionItems,
    setActionItems,
    sendMessage,
    handleMouseMove,
    handleMouseLeave,
  }
}
