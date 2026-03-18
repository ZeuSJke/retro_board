'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import Column from './Column'
import CardWidget from './CardWidget'
import CursorMarker from './CursorMarker'
import Dialog from './Dialog'
import { createColumn } from '../api'
import { useAppStore } from '../store'
import { useBoardWebSocket } from '../hooks/useBoardWebSocket'
import { useBoardDragDrop } from '../hooks/useBoardDragDrop'
import { exportBoardToPDF } from '../utils/exportPDF'
import type { Board, Card, CardGroup, Column as ColumnType } from '../types'
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
}

export default function BoardPage({
  board,
  onBoardUpdate,
  exportRef,
  onTimerWsEvent,
  sendTimerRef,
  onVotesChanged,
}: BoardPageProps) {
  const [addColOpen, setAddColOpen] = useState(false)
  const [newColTitle, setNewColTitle] = useState('')
  const [newColColor, setNewColColor] = useState('#6750A4')
  const boardRef = useRef<HTMLDivElement>(null)
  const lastSentRef = useRef(0)

  const {
    columns,
    setColumns,
    cursors,
    collapsedGroups,
    sendMessage,
    handleMouseMove: wsMouseMove,
    handleMouseLeave,
  } = useBoardWebSocket({ boardId: board.id, onTimerWsEvent })

  const { username } = useAppStore()

  // Initialize columns from board prop
  useEffect(() => {
    setColumns(board.columns || [])
  }, [board.columns, setColumns])

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

  const canVote = votesUsed < (board.max_votes ?? 5)

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

  // Expose export function via ref
  useEffect(() => {
    if (exportRef) {
      exportRef.current = () => exportBoardToPDF(board, columns)
    }
  }, [exportRef, board, columns])

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
  })

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
    if (!newColTitle.trim()) return
    setAddColOpen(false)
    const col = await createColumn({
      board_id: board.id,
      title: newColTitle.trim(),
      color: newColColor,
    })
    setColumns((prev) =>
      prev.find((c) => c.id === col.id) ? prev : [...prev, { ...col, cards: [], groups: [] }],
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
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
            groupTargetId={groupTargetId}
            collapsedGroups={collapsedGroups}
            onToggleCollapse={(groupId: string) => {
              const newCollapsed = !collapsedGroups[groupId]
              sendMessage({
                event: 'group_collapse',
                data: { group_id: groupId, collapsed: newCollapsed },
              })
            }}
            onUpdate={(updated: ColumnType) =>
              setColumns((prev) =>
                prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
              )
            }
            onDelete={(id: string) => setColumns((prev) => prev.filter((c) => c.id !== id))}
            onCardCreated={(colId: string, card: Card) =>
              setColumns((prev) =>
                prev.map((c) =>
                  c.id === colId && !c.cards.find((x) => x.id === card.id)
                    ? { ...c, cards: [...c.cards, card] }
                    : c,
                ),
              )
            }
            onCardUpdated={(colId: string, card: Card) =>
              setColumns((prev) =>
                prev.map((c) =>
                  c.id === colId
                    ? { ...c, cards: c.cards.map((x) => (x.id === card.id ? card : x)) }
                    : c,
                ),
              )
            }
            onCardDeleted={(colId: string, cardId: string) =>
              setColumns((prev) =>
                prev.map((c) =>
                  c.id === colId
                    ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) }
                    : c,
                ),
              )
            }
            onGroupCreated={(colId: string, group: CardGroup) =>
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
              )
            }
            onGroupUpdated={(colId: string, group: CardGroup) =>
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
              )
            }
            onGroupDeleted={(colId: string, groupId: string) =>
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
              )
            }
          />
        ))}

        <button className={styles.addColBtn} onClick={openAddCol}>
          <span className="material-symbols-rounded">add</span>
          Новая колонка
        </button>

        {Object.entries(cursors).map(([u, pos]) => (
          <CursorMarker key={u} username={u} x={pos.x} y={pos.y} />
        ))}
      </div>

      <Dialog
        open={addColOpen}
        title="Новая колонка"
        icon="view_column"
        onClose={() => setAddColOpen(false)}
        onConfirm={confirmAddColumn}
        confirmLabel="Создать"
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
            onKeyDown={(e) => e.key === 'Enter' && confirmAddColumn()}
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
