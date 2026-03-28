'use client'

import { useState, useMemo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import CardWidget from './CardWidget'
import Dialog from './Dialog'
import { updateGroup, deleteGroup } from '../api'
import { showToast } from '../store/toastStore'
import type { Card, CardGroup } from '../types'
import styles from './CardGroupWidget.module.css'

interface CardGroupWidgetProps {
  group: CardGroup
  cards: Card[]
  collapsed: boolean
  columnId: string
  canVote?: boolean
  brainstormHidden?: boolean
  currentUser?: string
  isFacilitator?: boolean
  onToggleCollapse?: () => void
  onGroupUpdated: (group: CardGroup) => void
  onGroupDeleted: (columnId: string, groupId: string) => void
  onCardUpdated: (card: Card) => void
  onCardDeleted: (id: string) => void
  usedCardIds?: Set<string>
}

export default function CardGroupWidget({
  group,
  cards,
  collapsed,
  columnId,
  canVote = true,
  brainstormHidden = false,
  currentUser,
  isFacilitator = false,
  onToggleCollapse,
  onGroupUpdated,
  onGroupDeleted,
  onCardUpdated,
  onCardDeleted,
  usedCardIds,
}: CardGroupWidgetProps) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleVal, setTitleVal] = useState(group.title)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const totalLikes = useMemo(
    () => cards.reduce((sum, c) => sum + (c.likes || []).length, 0),
    [cards],
  )

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `group-${group.id}`,
    data: { type: 'group', group },
  })

  const saveTitle = async () => {
    setEditingTitle(false)
    const trimmed = titleVal.trim()
    if (trimmed && trimmed !== group.title) {
      onGroupUpdated({ ...group, title: trimmed })
      try {
        await updateGroup(group.id, { title: trimmed })
      } catch {
        onGroupUpdated({ ...group })
        setTitleVal(group.title)
        showToast('Не удалось обновить название группы', 'error')
      }
    }
  }

  const confirmDelete = async () => {
    setDeleteOpen(false)
    onGroupDeleted(columnId, group.id)
    try {
      await deleteGroup(group.id)
    } catch {
      showToast('Не удалось удалить группу', 'error')
    }
  }

  return (
    <>
      <div className={styles.container} style={{ opacity: isDragging ? 0.4 : 1 }}>
        <div className={`${styles.header} ${collapsed ? styles.headerCollapsed : ''}`}>
          <button
            ref={setDragRef}
            {...attributes}
            {...listeners}
            className={styles.dragHandle}
            title="Перетащить группу в другую колонку"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
              drag_indicator
            </span>
          </button>

          <button
            className={styles.collapseBtn}
            onClick={() => onToggleCollapse?.()}
            title={collapsed ? 'Развернуть' : 'Свернуть'}
          >
            <span
              className="material-symbols-rounded"
              style={{
                fontSize: 16,
                transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
                display: 'block',
              }}
            >
              expand_more
            </span>
          </button>

          <span
            className="material-symbols-rounded"
            style={{ fontSize: 14, color: 'var(--md-primary)', flexShrink: 0 }}
          >
            folder
          </span>

          {editingTitle ? (
            <input
              className={styles.titleInput}
              value={titleVal}
              onChange={(e) => setTitleVal(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
              autoFocus
            />
          ) : (
            <span
              className={styles.title}
              onDoubleClick={() => {
                setTitleVal(group.title)
                setEditingTitle(true)
              }}
              title="Двойной клик — переименовать"
            >
              {group.title}
            </span>
          )}

          <span className={styles.count}>{cards.length}</span>

          {totalLikes > 0 && (
            <span className={styles.likesBadge}>
              <span className="material-symbols-rounded" style={{ fontSize: 12 }}>
                thumb_up
              </span>
              {totalLikes}
            </span>
          )}

          <button
            className={styles.delBtn}
            onClick={() => setDeleteOpen(true)}
            title="Удалить группу"
          >
            <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
              close
            </span>
          </button>
        </div>

        {!collapsed && (
          <div className={styles.cards}>
            {cards.length === 0 ? (
              <div className={styles.empty}>Нет карточек в группе</div>
            ) : (
              cards.map((card) => {
                const hidden = brainstormHidden && !isFacilitator && card.author !== currentUser
                return (
                  <CardWidget
                    key={card.id}
                    card={card}
                    canVote={canVote}
                    hidden={hidden}
                    usedInAction={usedCardIds?.has(card.id)}
                    onUpdate={onCardUpdated}
                    onDelete={onCardDeleted}
                    groupId={group.id}
                    onGroupDeleted={onGroupDeleted}
                  />
                )
              })
            )}
          </div>
        )}
      </div>

      <Dialog
        open={deleteOpen}
        title="Удалить группу?"
        icon="delete"
        danger
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        confirmLabel="Удалить"
      >
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--md-on-surface-variant)' }}>
          Группа{' '}
          <strong style={{ color: 'var(--md-on-surface)' }}>«{group.title}»</strong>{' '}
          будет удалена, карточки ({cards.length}) останутся в колонке без группы.
        </p>
      </Dialog>
    </>
  )
}
