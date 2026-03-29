'use client'

import { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import Column from './Column'
import CardWidget from './CardWidget'
import CursorMarker from './CursorMarker'
import MasterColumn from './MasterColumn'
import Dialog from './Dialog'
import type { DragEndEvent } from '@dnd-kit/core'
import { createColumn, createActionItem } from '../api'
import { useAppStore } from '../store'
import { useBoardWebSocket } from '../hooks/useBoardWebSocket'
import { useBoardDragDrop } from '../hooks/useBoardDragDrop'
import { exportBoardToPDF } from '../utils/exportPDF'
import type { ActionItem, Board, Card, CardGroup, Column as ColumnType } from '../types'
import styles from './BoardPage.module.css'

const COLUMN_COLORS = [
  '#6750A4', '#0061A4', '#006E1C', '#BA1A1A', '#E8760A',
  '#006A60', '#7D5260', '#FF6D00', '#43A047', '#1B6CA8',
]

interface BoardPageProps {
  board: Board
  onBoardUpdate: (board: Board) => void
  exportRef: React.MutableRefObject<(() => void) | null>
  onTimerWsEvent?: (event: string, data: Record<string, unknown>) => void
  sendTimerRef: React.MutableRefObject<{
    start: (duration: number, remaining: number) => void
    pause: (remaining: number) => void
    reset: (duration: number) => void
  } | null>
  onVotesChanged?: (used: number) => void
  onPresenceChanged?: (users: string[]) => void
  onFacilitatorChanged?: (facilitator: string | null, phase: string | null) => void
  onPhaseChanged?: (phase: string) => void
  sendFacilitatorRef: React.MutableRefObject<{
    start: () => void
    stop: () => void
    changePhase: (phase: string) => void
  } | null>
}

export default function BoardPage({
  board,
  onBoardUpdate,
  exportRef,
  onTimerWsEvent,
  sendTimerRef,
  onVotesChanged,
  onPresenceChanged,
  onFacilitatorChanged,
  onPhaseChanged,
  sendFacilitatorRef,
}: BoardPageProps) {
  const [addColOpen, setAddColOpen] = useState(false)
  const [newColTitle, setNewColTitle] = useState('')
  const [newColColor, setNewColColor] = useState('#6750A4')
  const [colCreating, setColCreating] = useState(false)
  const colCreatingRef = useRef(false)
  const [masterOpen, setMasterOpen] = useState(false)
  const boardRef = useRef<HTMLDivElement>(null)
  const lastSentRef = useRef(0)

  const {
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
    handleMouseMove: wsMouseMove,
    handleMouseLeave,
  } = useBoardWebSocket({
    boardId: board.id,
    onTimerWsEvent,
    onFacilitatorChanged,
    onPhaseChanged,
  })

  // Subscribe to cursor user list changes (add/remove only, not position)
  const cursorUserKeys = useSyncExternalStore(
    subscribeCursors,
    () => Object.keys(cursorsRef.current).join('\n'),
    () => '',
  )
  const cursorUsers = useMemo(
    () => (cursorUserKeys ? cursorUserKeys.split('\n') : []),
    [cursorUserKeys],
  )

  const username = useAppStore((s) => s.username)

  // Track if retro session ended (facilitator was active then stopped)
  // Persisted to localStorage so state survives navigation (dashboard → board)
  const lockKey = `retro_locked_${board.id}`
  const hadFacilitatorRef = useRef(false)
  const [boardLocked, setBoardLocked] = useState(() => {
    try { return localStorage.getItem(lockKey) === '1' } catch { return false }
  })

  useEffect(() => {
    if (facilitator) {
      hadFacilitatorRef.current = true
      setBoardLocked(false)
      try { localStorage.removeItem(lockKey) } catch { /* ignore */ }
    } else if (hadFacilitatorRef.current) {
      setBoardLocked(true)
      try { localStorage.setItem(lockKey, '1') } catch { /* ignore */ }
    }
  }, [facilitator, lockKey])

  // Initialize columns from board prop
  useEffect(() => {
    setColumns(board.columns || [])
  }, [board.columns, setColumns])

  // Cards used in action items — from persisted source_card_ids
  const usedCardIds = useMemo(() => {
    const ids = new Set<string>()
    for (const ai of actionItems) {
      for (const cid of ai.source_card_ids || []) ids.add(cid)
    }
    return ids
  }, [actionItems])

  // Count votes used by current user
  const votesUsed = useMemo(() => {
    let count = 0
    for (const col of columns) {
      for (const card of col.cards || []) {
        if ((card.likes || []).includes(username)) count++
      }
    }
    return count
  }, [columns, username])

  useEffect(() => {
    onVotesChanged?.(votesUsed)
  }, [votesUsed, onVotesChanged])

  useEffect(() => {
    onPresenceChanged?.(activeUsers)
  }, [activeUsers, onPresenceChanged])

  // Sync facilitator/phase to App — covers initial state and any edge cases
  useEffect(() => {
    onFacilitatorChanged?.(facilitator, phase)
  }, [facilitator, phase, onFacilitatorChanged])

  const votingAllowed = boardLocked ? false : !facilitator || phase === 'vote'
  const canVote = votingAllowed && votesUsed < (board.max_votes ?? 5)

  const {
    sensors,
    collisionDetection,
    activeCard,
    activeGroup,
    groupTargetId,
    onDragStart,
    onDragOver,
    onDragEnd,
  } = useBoardDragDrop({ columns, setColumns })

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const overId = event.over ? String(event.over.id) : ''
      const droppingOnMaster = overId === 'master-col'
      const blockedByFacilitator = facilitator && facilitator !== username

      if (droppingOnMaster && activeCard) {
        if (blockedByFacilitator) {
          onDragEnd({ ...event, over: null } as DragEndEvent)
          return
        }
        try {
          const item = await createActionItem({
            board_id: board.id,
            title: 'Новая задача',
            text: activeCard.text,
            assignee: activeCard.author,
            source_card_ids: [activeCard.id],
          })
          setActionItems((prev) =>
            prev.find((i) => i.id === item.id) ? prev : [...prev, item],
          )
        } catch { /* toast via interceptor */ }
        onDragEnd({ ...event, over: null } as DragEndEvent)
        return
      }

      if (droppingOnMaster && activeGroup) {
        if (blockedByFacilitator) {
          onDragEnd({ ...event, over: null } as DragEndEvent)
          return
        }
        // Collect all cards from this group
        const groupCards = columns
          .flatMap((col) => col.cards)
          .filter((c) => c.group_id === activeGroup.id)
        const combinedText = groupCards.map((c) => c.text).join(' ')
        try {
          const item = await createActionItem({
            board_id: board.id,
            title: activeGroup.title,
            text: combinedText || activeGroup.title,
            assignee: groupCards[0]?.author ?? null,
            source_card_ids: groupCards.map((c) => c.id),
          })
          setActionItems((prev) =>
            prev.find((i) => i.id === item.id) ? prev : [...prev, item],
          )
        } catch { /* toast via interceptor */ }
        onDragEnd({ ...event, over: null } as DragEndEvent)
        return
      }

      onDragEnd(event)
    },
    [activeCard, activeGroup, board.id, columns, setActionItems, onDragEnd, facilitator, username],
  )

  // Expose export function via ref
  useEffect(() => {
    if (exportRef) {
      exportRef.current = () => exportBoardToPDF(board, columns, actionItems)
    }
  }, [exportRef, board, columns, actionItems])

  // Expose WS timer send functions via ref
  useEffect(() => {
    if (sendTimerRef) {
      sendTimerRef.current = {
        start: (duration: number, remaining: number) =>
          sendMessage({
            event: 'timer_start',
            data: { duration, remaining, ts: Date.now() },
          }),
        pause: (remaining: number) =>
          sendMessage({ event: 'timer_pause', data: { remaining } }),
        reset: (duration: number) =>
          sendMessage({ event: 'timer_reset', data: { duration } }),
      }
    }
  }, [sendTimerRef, sendMessage])

  // Expose WS facilitator send functions via ref
  useEffect(() => {
    if (sendFacilitatorRef) {
      sendFacilitatorRef.current = {
        start: () => sendMessage({ event: 'facilitator_start', data: {} }),
        stop: () => sendMessage({ event: 'facilitator_stop', data: {} }),
        changePhase: (p: string) =>
          sendMessage({ event: 'phase_change', data: { phase: p } }),
      }
    }
  }, [sendFacilitatorRef, sendMessage])

  const isBrainstorm = phase === 'brainstorm'
  const cardCreationDisabled = boardLocked || !facilitator
  const readOnly = boardLocked

  const handleColumnUpdate = useCallback(
    (updated: ColumnType) =>
      setColumns((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
      ),
    [setColumns],
  )

  const handleColumnDelete = useCallback(
    (id: string) => setColumns((prev) => prev.filter((c) => c.id !== id)),
    [setColumns],
  )

  const handleCardCreated = useCallback(
    (colId: string, card: Card) =>
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId && !c.cards.find((x) => x.id === card.id)
            ? { ...c, cards: [...c.cards, card] }
            : c,
        ),
      ),
    [setColumns],
  )

  const handleCardUpdated = useCallback(
    (colId: string, card: Card) =>
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId
            ? { ...c, cards: c.cards.map((x) => (x.id === card.id ? card : x)) }
            : c,
        ),
      ),
    [setColumns],
  )

  const handleCardDeleted = useCallback(
    (colId: string, cardId: string) =>
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId
            ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) }
            : c,
        ),
      ),
    [setColumns],
  )

  const handleGroupCreated = useCallback(
    (colId: string, group: CardGroup) =>
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId
            ? {
                ...c,
                groups: [
                  ...(c.groups || []).filter((g) => g.id !== group.id),
                  group,
                ],
              }
            : c,
        ),
      ),
    [setColumns],
  )

  const handleGroupUpdated = useCallback(
    (colId: string, group: CardGroup) =>
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId
            ? {
                ...c,
                groups: (c.groups || []).map((g) =>
                  g.id === group.id ? group : g,
                ),
              }
            : c,
        ),
      ),
    [setColumns],
  )

  const handleGroupDeleted = useCallback(
    (colId: string, groupId: string) =>
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId
            ? {
                ...c,
                groups: (c.groups || []).filter((g) => g.id !== groupId),
                cards: c.cards.map((card) =>
                  card.group_id === groupId ? { ...card, group_id: null } : card,
                ),
              }
            : c,
        ),
      ),
    [setColumns],
  )

  const handleToggleCollapse = useCallback(
    (groupId: string) => {
      const newCollapsed = !collapsedGroups[groupId]
      sendMessage({
        event: 'group_collapse',
        data: { group_id: groupId, collapsed: newCollapsed },
      })
    },
    [collapsedGroups, sendMessage],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const now = Date.now()
      if (now - lastSentRef.current < 50) return
      lastSentRef.current = now
      wsMouseMove(e, boardRef.current)
    },
    [wsMouseMove],
  )

  const openAddCol = () => {
    setNewColTitle('')
    setNewColColor('#6750A4')
    setAddColOpen(true)
  }

  const confirmAddColumn = async () => {
    if (!newColTitle.trim() || colCreatingRef.current) return
    colCreatingRef.current = true
    setColCreating(true)
    setAddColOpen(false)
    const title = newColTitle.trim()
    const color = newColColor
    const tempId = `temp-col-${Date.now()}`
    const tempCol = { id: tempId, board_id: board.id, title, color, position: columns.length, cards: [], groups: [] }
    setColumns((prev) => [...prev, tempCol])
    try {
      const col = await createColumn({ board_id: board.id, title, color })
      setColumns((prev) => {
        if (prev.find((c) => c.id === col.id)) {
          return prev.filter((c) => c.id !== tempId)
        }
        return prev.map((c) =>
          c.id === tempId ? { ...col, cards: [], groups: [] } : c,
        )
      })
    } catch {
      setColumns((prev) => prev.filter((c) => c.id !== tempId))
    } finally {
      colCreatingRef.current = false
      setColCreating(false)
    }
  }

  return (
    <DndContext
      sensors={boardLocked ? [] : sensors}
      collisionDetection={collisionDetection}
      onDragStart={boardLocked ? undefined : onDragStart}
      onDragOver={boardLocked ? undefined : onDragOver}
      onDragEnd={boardLocked ? undefined : handleDragEnd}
    >
      <div
        ref={boardRef}
        className={styles.board}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {columns.map((col) => (
          <Column
            key={col.id}
            column={col}
            canVote={canVote}
            readOnly={readOnly}
            cardCreationDisabled={cardCreationDisabled}
            brainstormHidden={isBrainstorm}
            currentUser={username}
            isFacilitator={facilitator === username}
            groupTargetId={groupTargetId}
            collapsedGroups={collapsedGroups}
            onToggleCollapse={handleToggleCollapse}
            onUpdate={handleColumnUpdate}
            onDelete={handleColumnDelete}
            onCardCreated={handleCardCreated}
            onCardUpdated={handleCardUpdated}
            onCardDeleted={handleCardDeleted}
            onGroupCreated={handleGroupCreated}
            onGroupUpdated={handleGroupUpdated}
            onGroupDeleted={handleGroupDeleted}
            usedCardIds={usedCardIds}
          />
        ))}

        {masterOpen && (
          <div
            className={styles.masterOverlay}
            onClick={() => setMasterOpen(false)}
          />
        )}

        <div className={`${styles.masterWrapper} ${masterOpen ? styles.masterWrapperOpen : ''}`}>
          <MasterColumn
            actionItems={actionItems}
            dropDisabled={!!facilitator && facilitator !== username}
            onUpdated={(item) =>
              setActionItems((prev) =>
                prev.map((i) => (i.id === item.id ? item : i)),
              )
            }
            onDeleted={(id) =>
              setActionItems((prev) => prev.filter((i) => i.id !== id))
            }
          />
        </div>

        <button
          className={styles.masterToggle}
          onClick={() => setMasterOpen((v) => !v)}
          title="Итоги"
        >
          <span className="material-symbols-rounded" style={{ fontSize: 24 }}>
            {masterOpen ? 'close' : 'assignment'}
          </span>
          {!masterOpen && actionItems.length > 0 && (
            <span className={styles.masterBadge}>{actionItems.length}</span>
          )}
        </button>

        <button className={styles.addColBtn} onClick={openAddCol}>
          <span className="material-symbols-rounded">add</span>
          Новая колонка
        </button>

        {cursorUsers.map((u) => (
          <CursorMarker key={u} username={u} posRef={cursorsRef} />
        ))}
      </div>

      <Dialog
        open={addColOpen}
        title="Новая колонка"
        icon="view_column"
        onClose={() => setAddColOpen(false)}
        onConfirm={confirmAddColumn}
        confirmLabel="Создать"
        confirmDisabled={colCreatingRef.current}
      >
        <div className={styles.field}>
          <label className={styles.label}>Название</label>
          <input
            className={styles.input}
            value={newColTitle}
            onChange={(e) => setNewColTitle(e.target.value)}
            placeholder="Например: Что прошло хорошо?"
            maxLength={80}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                confirmAddColumn()
              }
            }}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Цвет метки</label>
          <div className={styles.colorGrid}>
            {COLUMN_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColColor(c)}
                className={styles.colorSwatch}
                style={{
                  background: c,
                  outline:
                    c === newColColor ? `3px solid ${c}` : '3px solid transparent',
                  outlineOffset: 2,
                  transform: c === newColColor ? 'scale(1.18)' : 'scale(1)',
                }}
              />
            ))}
          </div>
        </div>
        <div className={styles.preview} style={{ borderLeftColor: newColColor }}>
          <div className={styles.previewDot} style={{ background: newColColor }} />
          <span className={styles.previewTitle}>
            {newColTitle.trim() || 'Название колонки'}
          </span>
          <span className={styles.previewCount}>0</span>
        </div>
      </Dialog>

      <DragOverlay>
        {activeCard && (
          <div style={{ transform: 'rotate(3deg)', opacity: 0.9 }}>
            <CardWidget
              card={activeCard}
              onUpdate={() => {}}
              onDelete={() => {}}
              dragOverlay
            />
          </div>
        )}
        {activeGroup && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderRadius: 10,
              background:
                'color-mix(in srgb, var(--md-primary) 8%, var(--md-surface-variant))',
              border: '1.5px solid var(--md-outline-variant)',
              boxShadow: 'var(--elevation-2)',
              opacity: 0.9,
              transform: 'rotate(2deg)',
              cursor: 'grabbing',
            }}
          >
            <span
              className="material-symbols-rounded"
              style={{ fontSize: 14, color: 'var(--md-primary)' }}
            >
              folder
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--md-primary)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {activeGroup.title}
            </span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
