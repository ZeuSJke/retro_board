'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useWebSocket } from './useWebSocket'
import { useAppStore } from '../store'
import type { ActionItem, Column, WsMessage } from '../types'

interface CursorPos {
  x: number
  y: number
}

interface UseBoardWebSocketParams {
  boardId: string
  onTimerWsEvent?: (event: string, data: Record<string, unknown>) => void
}

export function useBoardWebSocket({ boardId, onTimerWsEvent }: UseBoardWebSocketParams) {
  const { username } = useAppStore()
  const [columns, setColumns] = useState<Column[]>([])
  const [cursors, setCursors] = useState<Record<string, CursorPos>>({})
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [activeUsers, setActiveUsers] = useState<string[]>([])
  const [facilitator, setFacilitator] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const cursorTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const lastCursorRef = useRef<CursorPos | null>(null)
  const sendMessageRef = useRef<((msg: WsMessage) => void) | null>(null)

  useEffect(() => {
    return () => {
      Object.values(cursorTimeouts.current).forEach(clearTimeout)
    }
  }, [])

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      const { event, data } = msg

      if (event === 'group_collapse') {
        const { group_id, collapsed } = data as { group_id: string; collapsed: boolean }
        setCollapsedGroups((prev) => ({ ...prev, [group_id]: collapsed }))
        return
      }

      if (event === 'cursor_move') {
        const { username: u, x, y } = data as { username: string; x: number; y: number }
        if (!u) return
        setCursors((prev) => ({ ...prev, [u]: { x, y } }))
        clearTimeout(cursorTimeouts.current[u])
        cursorTimeouts.current[u] = setTimeout(() => {
          setCursors((prev) => {
            const n = { ...prev }
            delete n[u]
            return n
          })
        }, 6000)
        return
      }

      if (event === 'cursor_leave') {
        const { username: u } = data as { username: string }
        if (!u) return
        clearTimeout(cursorTimeouts.current[u])
        setCursors((prev) => {
          const n = { ...prev }
          delete n[u]
          return n
        })
        return
      }

      if (event === 'timer_start' || event === 'timer_pause' || event === 'timer_reset') {
        onTimerWsEvent?.(event, data)
        return
      }

      if (event === 'presence_update') {
        const { users } = data as { users: string[] }
        setActiveUsers(users)
        return
      }

      if (event === 'facilitator_update') {
        const { facilitator: f, phase: p } = data as { facilitator: string | null; phase: string | null }
        setFacilitator(f)
        setPhase(p)
        return
      }

      if (event === 'phase_update') {
        const { phase: p } = data as { phase: string }
        setPhase(p)
        return
      }

      if (event === 'action_item_created') {
        const item = data as unknown as ActionItem
        setActionItems((prev) =>
          prev.find((i) => i.id === item.id) ? prev : [...prev, item],
        )
        return
      }

      if (event === 'action_item_updated') {
        const item = data as unknown as ActionItem
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
          case 'column_created':
            if (prev.find((c) => c.id === (data as { id: string }).id)) return prev
            return [...prev, { ...(data as unknown as Column), cards: [], groups: [] }]
          case 'column_updated':
            return prev.map((c) => (c.id === (data as { id: string }).id ? { ...c, ...(data as unknown as Partial<Column>) } : c))
          case 'column_deleted':
            return prev.filter((c) => c.id !== (data as { id: string }).id)
          case 'card_created': {
            const d = data as { id: string; column_id: string; [key: string]: unknown }
            return prev.map((c) =>
              c.id === d.column_id
                ? {
                    ...c,
                    cards: [
                      ...c.cards.filter((x) => x.id !== d.id),
                      d as unknown as Column['cards'][number],
                    ].sort((a, b) => a.position - b.position),
                  }
                : c,
            )
          }
          case 'card_updated': {
            const d = data as { id: string; [key: string]: unknown }
            return prev.map((c) => ({
              ...c,
              cards: c.cards.map((x) => (x.id === d.id ? (d as unknown as Column['cards'][number]) : x)),
            }))
          }
          case 'card_moved': {
            const { card, old_column_id } = data as { card: Column['cards'][number]; old_column_id: string }
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
          case 'card_deleted': {
            const d = data as { id: string }
            return prev.map((c) => ({
              ...c,
              cards: c.cards.filter((x) => x.id !== d.id),
            }))
          }
          case 'group_created': {
            const d = data as { id: string; column_id: string; [key: string]: unknown }
            return prev.map((c) =>
              c.id === d.column_id
                ? {
                    ...c,
                    groups: [
                      ...(c.groups || []).filter((g) => g.id !== d.id),
                      d as unknown as Column['groups'][number],
                    ],
                  }
                : c,
            )
          }
          case 'group_updated': {
            const d = data as { id: string; [key: string]: unknown }
            return prev.map((c) => ({
              ...c,
              groups: (c.groups || []).map((g) => (g.id === d.id ? (d as unknown as Column['groups'][number]) : g)),
            }))
          }
          case 'group_deleted': {
            const { id, column_id, card_ids } = data as { id: string; column_id: string; card_ids?: string[] }
            return prev.map((c) =>
              c.id === column_id
                ? {
                    ...c,
                    groups: (c.groups || []).filter((g) => g.id !== id),
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
            const { group, old_column_id, cards } = data as {
              group: Column['groups'][number]
              old_column_id: string
              cards: Column['cards']
            }
            const movedCardIds = cards.map((c) => c.id)
            return prev.map((c) => {
              if (c.id === old_column_id) {
                return {
                  ...c,
                  groups: (c.groups || []).filter((g) => g.id !== group.id),
                  cards: c.cards.filter((card) => !movedCardIds.includes(card.id)),
                }
              }
              if (c.id === group.column_id) {
                return {
                  ...c,
                  groups: [
                    ...(c.groups || []).filter((g) => g.id !== group.id),
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
    [onTimerWsEvent],
  )

  const { sendMessage } = useWebSocket(
    boardId,
    handleWsMessage,
    useCallback(() => {
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
    cursors,
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
