'use client'

import { useState, useRef, memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppStore } from '../store'
import { toggleLike, deleteCard, removeCardFromGroup, updateCard } from '../api'
import { userColor, initials } from '../utils/theme'
import type { Card, CardGroup } from '../types'
import Dialog from './Dialog'
import s from './CardWidget.module.css'

interface CardWidgetProps {
  card: Card
  canVote?: boolean
  hidden?: boolean
  onUpdate: (card: Card) => void
  onDelete: (id: string) => void
  groups?: CardGroup[]
  onAssignGroup?: (cardId: string) => void
  groupId?: string
  isGroupTarget?: boolean
  dragOverlay?: boolean
  usedInAction?: boolean
  onGroupDeleted?: (columnId: string, groupId: string) => void
}

export default memo(function CardWidget({
  card,
  canVote = true,
  hidden = false,
  onUpdate,
  onDelete,
  groups = [],
  onAssignGroup,
  groupId,
  isGroupTarget = false,
  dragOverlay = false,
  usedInAction = false,
  onGroupDeleted,
}: CardWidgetProps) {
  const { username } = useAppStore()
  const liked = (card.likes || []).includes(username)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(card.text)
  const [colorOpen, setColorOpen] = useState(false)
  const [colorPos, setColorPos] = useState<{ top: number; left: number } | null>(null)
  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const inGroup = !!groupId

  const CARD_COLORS = [
    '#FFFFFF', '#FFF3E0', '#FFF9C4', '#E8F5E9',
    '#E3F2FD', '#F3E5F5', '#FCE4EC', '#E0F7FA',
  ]

  const handleColorChange = async (color: string) => {
    setColorOpen(false)
    if (color === card.color) return
    const prev = card
    onUpdate({ ...card, color })
    try {
      await updateCard(card.id, { color })
    } catch {
      onUpdate(prev)
    }
  }

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: card.id,
      data: { type: 'card', card },
      disabled: dragOverlay,
    })

  const style = {
    transform: dragOverlay ? undefined : CSS.Transform.toString(transform),
    transition: dragOverlay ? undefined : transition,
    opacity: isDragging && !dragOverlay ? 0.4 : 1,
  }

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const prev = card
    const newLikes = liked
      ? (card.likes || []).filter((u) => u !== username)
      : [...(card.likes || []), username]
    onUpdate({ ...card, likes: newLikes })
    try {
      await toggleLike(card.id, username)
    } catch {
      onUpdate(prev)
    }
  }

  const likeDisabled = !canVote && !liked

  const handleRemoveFromGroup = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!groupId) return
    const prev = card
    onUpdate({ ...card, group_id: null })
    try {
      const updated = await removeCardFromGroup(groupId, card.id)
      if (updated.group_id === null && onGroupDeleted) {
        onGroupDeleted(updated.column_id, groupId)
      }
    } catch {
      onUpdate(prev)
    }
  }

  const handleEditSave = async () => {
    setEditing(false)
    const trimmed = editText.trim()
    if (!trimmed || trimmed === card.text) {
      setEditText(card.text)
      return
    }
    const prev = card
    onUpdate({ ...card, text: trimmed })
    try {
      await updateCard(card.id, { text: trimmed })
    } catch {
      onUpdate(prev)
      setEditText(prev.text)
    }
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) handleEditSave()
    if (e.key === 'Escape') {
      setEditing(false)
      setEditText(card.text)
    }
  }

  const confirmDelete = async () => {
    setDeleteOpen(false)
    onDelete(card.id)
    try {
      await deleteCard(card.id)
    } catch {
      // WS broadcast will restore if needed
    }
  }

  const isLight = (hex: string): boolean => {
    if (!hex || hex === '#FFFFFF') return true
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return 0.299 * r + 0.587 * g + 0.114 * b > 180
  }

  const cardBg = card.color || '#FFFFFF'
  const textColor = isLight(cardBg) ? '#1C1B1F' : '#FFFFFF'
  const subtleColor = isLight(cardBg) ? '#49454F' : 'rgba(255,255,255,0.7)'
  const btnBg = isLight(cardBg) ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.15)'
  const showGroupBtn = !inGroup && !!onAssignGroup

  if (isDragging && !dragOverlay) {
    return <div ref={setNodeRef} style={style} className={s.dragPlaceholder} />
  }

  if (hidden) {
    return (
      <div ref={setNodeRef} className={s.hiddenCard} style={style}>
        <span className="material-symbols-rounded" style={{ fontSize: 18, color: 'var(--md-outline)' }}>
          visibility_off
        </span>
        <span className={s.hiddenText}>Карточка скрыта</span>
      </div>
    )
  }

  return (
    <>
      <div
        ref={setNodeRef}
        className={`${s.card} card-widget`}
        style={{
          ...style,
          background: cardBg,
          color: textColor,
          borderLeftColor:
            card.color && card.color !== '#FFFFFF' ? card.color : 'transparent',
          cursor: inGroup ? 'default' : undefined,
          ...(isGroupTarget
            ? { boxShadow: '0 0 0 3px var(--md-primary), var(--elevation-1)', outline: 'none' }
            : {}),
          ...(usedInAction
            ? { boxShadow: '0 0 0 2px var(--md-primary), var(--elevation-1)' }
            : {}),
        }}
      >
        <div
          {...(dragOverlay ? {} : { ...attributes, ...listeners })}
          style={{
            cursor: dragOverlay ? 'grabbing' : isDragging ? 'grabbing' : 'grab',
            marginBottom: 8,
            touchAction: dragOverlay ? 'auto' : 'none',
          }}
        >
          <div className={s.author} style={{ color: subtleColor }}>
            <div className={s.avatar} style={{ background: userColor(card.author) }}>
              {initials(card.author)}
            </div>
            {card.author}
          </div>
          {editing ? (
            <textarea
              className={s.editTextarea}
              style={{ color: textColor, background: cardBg }}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={handleEditSave}
              onKeyDown={handleEditKeyDown}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div
              className={s.text}
              style={{ color: textColor, cursor: 'text' }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditText(card.text)
                setEditing(true)
              }}
              title="Двойной клик чтобы редактировать"
            >
              {card.text}
            </div>
          )}
        </div>

        <div className={s.actions}>
          <button
            className={s.likeBtn}
            style={{
              background: btnBg,
              color: textColor,
              ...(liked
                ? {
                    background: 'var(--md-primary-container)',
                    color: 'var(--md-on-primary-container)',
                  }
                : {}),
              ...(likeDisabled ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
            }}
            onClick={handleLike}
            disabled={likeDisabled}
            title={likeDisabled ? 'Лимит голосов исчерпан' : liked ? 'Убрать лайк' : 'Лайк'}
          >
            <span
              className={`material-symbols-rounded${liked ? ' filled' : ''}`}
              style={{ fontSize: 14 }}
            >
              thumb_up
            </span>
            <span className={s.likeCount}>{(card.likes || []).length}</span>
          </button>

          {showGroupBtn && (
            <button
              className={s.iconBtn}
              style={{ background: btnBg, color: textColor }}
              onClick={() => onAssignGroup!(card.id)}
              title="Добавить в группу"
            >
              <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                folder
              </span>
            </button>
          )}

          {inGroup && (
            <button
              className={s.iconBtn}
              style={{ background: btnBg, color: textColor }}
              onClick={handleRemoveFromGroup}
              title="Убрать из группы"
            >
              <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                folder_off
              </span>
            </button>
          )}

          <button
            ref={colorBtnRef}
            className={s.iconBtn}
            style={{ background: btnBg, color: textColor }}
            onClick={() => {
              if (colorOpen) { setColorOpen(false); return }
              const rect = colorBtnRef.current?.getBoundingClientRect()
              if (rect) setColorPos({ top: rect.top - 8, left: rect.right + 8 })
              setColorOpen(true)
            }}
            title="Цвет карточки"
          >
            <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
              palette
            </span>
          </button>

          <button
            className={s.iconBtn}
            style={{ background: btnBg, color: textColor }}
            onClick={() => setDeleteOpen(true)}
            title="Удалить карточку"
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
              delete
            </span>
          </button>
        </div>
      </div>

      <Dialog
        open={deleteOpen}
        title="Удалить карточку?"
        icon="delete"
        danger
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        confirmLabel="Удалить"
      >
        <p className={s.confirmText}>
          Карточка от{' '}
          <strong style={{ color: 'var(--md-on-surface)' }}>«{card.author}»</strong>{' '}
          будет удалена без возможности восстановления.
        </p>
        {card.text && (
          <div className={s.cardPreview}>
            <span className={s.cardPreviewText}>{card.text}</span>
          </div>
        )}
      </Dialog>

      {colorOpen && colorPos && (
        <div className={s.colorOverlay} onClick={() => setColorOpen(false)}>
          <div
            className={s.colorPicker}
            style={{ top: colorPos.top, left: colorPos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {CARD_COLORS.map((c) => (
              <button
                key={c}
                className={s.colorSwatch}
                style={{
                  background: c,
                  outline: c === (card.color || '#FFFFFF') ? '2px solid var(--md-primary)' : 'none',
                  outlineOffset: 1,
                }}
                onClick={() => handleColorChange(c)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
})
