'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useWebSocket } from './useWebSocket'
import { useAppStore } from '../store'
import { getActionItems } from '../api'
import { asCard, asColumn, asGroup, asActionItem } from '../utils/wsData'
import type {
  ActionItem,
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
}

export function useBoardWebSocket({ boardId, onTimerWsEvent, onFacilitatorChanged, onPhaseChanged }: UseBoardWebSocketParams) {
  const username = useAppStore((s) => s.username)
  const [columns, setColumns] = useState<Column[]>([])
  const cursorsRef = useRef<Record<string, CursorPos>>({})
  const cursorListenersRef = useRef<Set<() => void>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [activeUsers, setActiveUsers] = useState<string[]>([])
  const [facilitator, setFacilitator] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const cursorTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const lastCursorRef = useRef<CursorPos | null>(null)
  const sendMessageRef = useRef<((msg: WsMessage) => void) | null>(null)

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
        const item = asActionItem(data)
        setActionItems((prev) =>
          prev.find((i) => i.id === item.id) ? prev : [...prev, item],
        )
        return
      }

      if (event === 'action_item_updated') {
        const item = asActionItem(data)
        setActionItems((prev) =>
          prev.map((i) => (i.id === item.id ? item : i)),
        )
        return
      }

      if (event === 'action_item_deleted') {
        const { id } = data as { id: string }
        setActionItems((prev) => prev.filter((i) => i.id !== id))
        return
      }

      setColumns((prev) => {
        switch (event) {
          case 'column_created': {
            const col = asColumn(data)
            if (prev.find((c) => c.id === col.id)) return prev
            return [...prev, { ...col, cards: [], groups: [] }]
          }
          case 'column_updated': {
            const col = asColumn(data)
            return prev.map((c) => (c.id === col.id ? { ...c, ...col } : c))
          }
          case 'column_deleted':
            return prev.filter((c) => c.id !== (data as unknown as WsDeletedData).id)
          case 'card_created': {
            const card = asCard(data)
            return prev.map((c) =>
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
          }
          case 'card_updated': {
            const card = asCard(data)
            return prev.map((c) => ({
              ...c,
              cards: c.cards.map((x) => (x.id === card.id ? card : x)),
            }))
          }
          case 'card_moved': {
            const { card, old_column_id } = data as unknown as WsCardMovedData
            return prev.map((c) => {
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
          }
          case 'card_deleted':
            return prev.map((c) => ({
              ...c,
              cards: c.cards.filter((x) => x.id !== (data as unknown as WsDeletedData).id),
            }))
          case 'group_created': {
            const g = asGroup(data)
            return prev.map((c) =>
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
          }
          case 'group_updated': {
            const g = asGroup(data)
            return prev.map((c) => ({
              ...c,
              groups: (c.groups || []).map((x) => (x.id === g.id ? g : x)),
            }))
          }
          case 'group_deleted': {
            const { id, column_id, card_ids } = data as unknown as WsGroupDeletedData
            return prev.map((c) =>
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
          }
          case 'group_moved': {
            const { group, old_column_id, cards } = data as unknown as WsGroupMovedData
            const movedCardIds = cards.map((c) => c.id)
            return prev.map((c) => {
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
          }
          default:
            return prev
        }
      })
    },
    [onTimerWsEvent, onFacilitatorChanged, onPhaseChanged, notifyCursorListeners],
  )

  const { sendMessage } = useWebSocket(
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
  sendMessageRef.current = sendMessage

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
    actionItems,
    setActionItems,
    sendMessage,
    handleMouseMove,
    handleMouseLeave,
  }
}
