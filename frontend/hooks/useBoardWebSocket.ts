'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useWebSocket } from './useWebSocket'
import { useAppStore } from '../store'
import { showToast } from '../store/toastStore'
import { getActionItems } from '../api'
import { asCard, asColumn, asGroup, asActionItem } from '../utils/wsData'
import type {
  ActionItem,
  BoardListItem,
  Column,
  WsMessage,
  WsCursorMoveData,
  WsCursorLeaveData,
  WsPresenceData,
  WsFacilitatorData,
  WsPhaseData,
  WsGroupCollapseData,
  WsCardMovedData,
  WsGroupMovedData,
  WsDeletedData,
  WsGroupDeletedData,
  WsBoardUpdatedData,
  WsSummaryFailedData,
} from '../types'

export interface CursorPos {
  x: number
  y: number
}

interface UseBoardWebSocketParams {
  boardId: string
  onTimerWsEvent?: (event: string, data: Record<string, unknown>) => void
  onFacilitatorChanged?: (facilitator: string | null, phase: string | null) => void
  onPhaseChanged?: (phase: string) => void
  onSummaryGenerated?: () => void
  onSummaryFailed?: (message?: string) => void
  onBoardCreated?: (board: BoardListItem) => void
  onBoardUpdated?: (board: WsBoardUpdatedData) => void
  onBoardDeleted?: (id: string) => void
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
}: UseBoardWebSocketParams) {
  const username = useAppStore((s) => s.username)
  const [columns, setColumns] = useState<Column[]>([])
  const cursorsRef = useRef<Record<string, CursorPos>>({})
  const cursorListenersRef = useRef<Set<() => void>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [activeUsers, setActiveUsers] = useState<string[]>([])
  const [facilitator, setFacilitator] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const [sessionSynced, setSessionSynced] = useState(false)
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const cursorTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const lastCursorRef = useRef<CursorPos | null>(null)
  const sendMessageRef = useRef<((msg: WsMessage) => void) | null>(null)
  const prevUsernameRef = useRef(username)

  useEffect(() => {
    setSessionSynced(false)
  }, [boardId])

  const subscribeCursors = useCallback((cb: () => void) => {
    cursorListenersRef.current.add(cb)
    return () => { cursorListenersRef.current.delete(cb) }
  }, [])

  const notifyCursorListeners = useCallback(() => {
    cursorListenersRef.current.forEach((cb) => cb())
  }, [])

  useEffect(() => {
    return () => {
      Object.values(cursorTimeouts.current).forEach(clearTimeout)
    }
  }, [])

  // Load existing action items on mount
  useEffect(() => {
    getActionItems(boardId).then(setActionItems).catch((err) => console.error('Failed to load action items:', err))
  }, [boardId])

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      const { event, data } = msg

      if (event === 'group_collapse') {
        const { group_id, collapsed } = data as unknown as WsGroupCollapseData
        setCollapsedGroups((prev) => ({ ...prev, [group_id]: collapsed }))
        return
      }

      if (event === 'cursor_move') {
        const { username: u, x, y } = data as unknown as WsCursorMoveData
        if (!u) return
        cursorsRef.current = { ...cursorsRef.current, [u]: { x, y } }
        notifyCursorListeners()
        clearTimeout(cursorTimeouts.current[u])
        cursorTimeouts.current[u] = setTimeout(() => {
          const n = { ...cursorsRef.current }
          delete n[u]
          cursorsRef.current = n
          notifyCursorListeners()
        }, 6000)
        return
      }

      if (event === 'cursor_leave') {
        const { username: u } = data as unknown as WsCursorLeaveData
        if (!u) return
        clearTimeout(cursorTimeouts.current[u])
        const n = { ...cursorsRef.current }
        delete n[u]
        cursorsRef.current = n
        notifyCursorListeners()
        return
      }

      if (event === 'timer_start' || event === 'timer_pause' || event === 'timer_reset') {
        onTimerWsEvent?.(event, data)
        return
      }

      if (event === 'presence_update') {
        const { users } = data as unknown as WsPresenceData
        setActiveUsers(users)
        return
      }

      if (event === 'facilitator_update') {
        const { facilitator: f, phase: p } = data as unknown as WsFacilitatorData
        setFacilitator(f)
        setPhase(p)
        setSessionSynced(true)
        onFacilitatorChanged?.(f, p)
        return
      }

      if (event === 'phase_update') {
        const { phase: p } = data as unknown as WsPhaseData
        setPhase(p)
        onPhaseChanged?.(p)
        return
      }

      if (event === 'action_item_created') {
        try {
          const item = asActionItem(data)
          setActionItems((prev) =>
            prev.find((i) => i.id === item.id) ? prev : [...prev, item],
          )
        } catch {
          /* ignore malformed action item */
        }
        return
      }

      if (event === 'action_item_updated') {
        try {
          const item = asActionItem(data)
          setActionItems((prev) =>
            prev.map((i) => (i.id === item.id ? item : i)),
          )
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
        const u = data.username as string | undefined
        if (u && u !== username) {
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
            updater = (prev) =>
              prev.find((c) => c.id === col.id) ? prev : [...prev, { ...col, cards: [], groups: [] }]
            break
          }
          case 'column_updated': {
            const col = asColumn(data)
            updater = (prev) => prev.map((c) => (c.id === col.id ? { ...c, ...col } : c))
            break
          }
          case 'column_deleted': {
            const deletedId = (data as unknown as WsDeletedData)?.id
            if (deletedId) {
              updater = (prev) => prev.filter((c) => c.id !== deletedId)
            }
            break
          }
          case 'card_created': {
            const card = asCard(data)
            updater = (prev) =>
              prev.map((c) =>
                c.id === card.column_id
                  ? {
                      ...c,
                      cards: [
                        ...c.cards.filter((x) => x.id !== card.id),
                        card,
                      ].sort((a, b) => a.position - b.position),
                    }
                  : c,
              )
            break
          }
          case 'card_updated': {
            const card = asCard(data)
            updater = (prev) =>
              prev.map((c) => ({
                ...c,
                cards: c.cards.map((x) => (x.id === card.id ? card : x)),
              }))
            break
          }
          case 'card_moved': {
            const moved = data as unknown as WsCardMovedData
            if (!moved?.card || !moved.old_column_id) break
            const { card, old_column_id } = moved
            updater = (prev) =>
              prev.map((c) => {
                if (c.id === old_column_id && c.id === card.column_id) {
                  const cards = [
                    ...c.cards.filter((x) => x.id !== card.id),
                    card,
                  ].sort((a, b) => a.position - b.position)
                  return { ...c, cards }
                }
                if (c.id === old_column_id)
                  return { ...c, cards: c.cards.filter((x) => x.id !== card.id) }
                if (c.id === card.column_id) {
                  const cards = [
                    ...c.cards.filter((x) => x.id !== card.id),
                    card,
                  ].sort((a, b) => a.position - b.position)
                  return { ...c, cards }
                }
                return c
              })
            break
          }
          case 'card_deleted': {
            const deletedId = (data as unknown as WsDeletedData)?.id
            if (deletedId) {
              updater = (prev) =>
                prev.map((c) => ({
                  ...c,
                  cards: c.cards.filter((x) => x.id !== deletedId),
                }))
            }
            break
          }
          case 'group_created': {
            const g = asGroup(data)
            updater = (prev) =>
              prev.map((c) =>
                c.id === g.column_id
                  ? {
                      ...c,
                      groups: [
                        ...(c.groups || []).filter((x) => x.id !== g.id),
                        g,
                      ],
                    }
                  : c,
              )
            break
          }
          case 'group_updated': {
            const g = asGroup(data)
            updater = (prev) =>
              prev.map((c) => ({
                ...c,
                groups: (c.groups || []).map((x) => (x.id === g.id ? g : x)),
              }))
            break
          }
          case 'group_deleted': {
            const del = data as unknown as WsGroupDeletedData
            if (!del?.id || !del.column_id) break
            const { id, column_id, card_ids } = del
            updater = (prev) =>
              prev.map((c) =>
                c.id === column_id
                  ? {
                      ...c,
                      groups: (c.groups || []).filter((x) => x.id !== id),
                      cards: c.cards.map((card) =>
                        (card_ids || []).includes(card.id)
                          ? { ...card, group_id: null }
                          : card,
                      ),
                    }
                  : c,
              )
            break
          }
          case 'group_moved': {
            const moved = data as unknown as WsGroupMovedData
            if (!moved?.group || !moved.old_column_id || !Array.isArray(moved.cards)) break
            const { group, old_column_id, cards } = moved
            const movedCardIds = cards.map((c) => c.id)
            updater = (prev) =>
              prev.map((c) => {
                if (c.id === old_column_id) {
                  return {
                    ...c,
                    groups: (c.groups || []).filter((x) => x.id !== group.id),
                    cards: c.cards.filter((card) => !movedCardIds.includes(card.id)),
                  }
                }
                if (c.id === group.column_id) {
                  return {
                    ...c,
                    groups: [
                      ...(c.groups || []).filter((x) => x.id !== group.id),
                      group,
                    ],
                    cards: [
                      ...c.cards.filter((card) => !movedCardIds.includes(card.id)),
                      ...cards,
                    ],
                  }
                }
                return c
              })
            break
          }
          default:
            break
        }
      } catch {
        /* ignore malformed ws payload */
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
      notifyCursorListeners,
      username,
    ],
  )

  const { sendMessage, connected } = useWebSocket(
    boardId,
    handleWsMessage,
    useCallback(() => {
      // Announce username immediately on connect
      sendMessageRef.current?.({
        event: 'identify',
        data: { username },
      })
      const pos = lastCursorRef.current
      if (pos)
        sendMessageRef.current?.({
          event: 'cursor_move',
          data: { username, ...pos },
        })
    }, [username]),
  )
  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

  useEffect(() => {
    if (prevUsernameRef.current !== username) {
      prevUsernameRef.current = username
      if (connected && username) {
        sendMessage({ event: 'identify', data: { username } })
      }
    }
  }, [connected, username, sendMessage])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent, boardEl: HTMLDivElement | null) => {
      if (!boardEl) return
      const rect = boardEl.getBoundingClientRect()
      const pos = {
        x: e.clientX - rect.left + boardEl.scrollLeft,
        y: e.clientY - rect.top + boardEl.scrollTop,
      }
      lastCursorRef.current = pos
      sendMessage({ event: 'cursor_move', data: { username, ...pos } })
    },
    [username, sendMessage],
  )

  const handleMouseLeave = useCallback(() => {
    sendMessage({ event: 'cursor_leave', data: { username } })
  }, [username, sendMessage])

  return {
    columns,
    setColumns,
    cursorsRef,
    subscribeCursors,
    collapsedGroups,
    activeUsers,
    facilitator,
    phase,
    sessionSynced,
    actionItems,
    setActionItems,
    sendMessage,
    handleMouseMove,
    handleMouseLeave,
  }
}
