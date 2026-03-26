'use client'

import { useState, memo } from 'react'
import { useDroppable, useDndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import CardWidget from './CardWidget'
import CardGroupWidget from './CardGroupWidget'
import Dialog from './Dialog'
import {
  updateColumn,
  deleteColumn,
  createCard,
  createGroup,
  addCardToGroup,
} from '../api'
import { showToast } from '../store/toastStore'
import { useAppStore } from '../store'
import { CARD_COLORS } from '../utils/theme'
import type { Column as ColumnType, Card, CardGroup } from '../types'
import s from './Column.module.css'

interface ColumnProps {
  column: ColumnType
  canVote?: boolean
  cardCreationDisabled?: boolean
  brainstormHidden?: boolean
  currentUser?: string
  isFacilitator?: boolean
  onUpdate: (column: ColumnType) => void
  onDelete: (id: string) => void
  onCardCreated: (colId: string, card: Card) => void
  onCardUpdated: (colId: string, card: Card) => void
  onCardDeleted: (colId: string, cardId: string) => void
  onGroupCreated: (colId: string, group: CardGroup) => void
  onGroupUpdated: (colId: string, group: CardGroup) => void
  onGroupDeleted: (colId: string, groupId: string) => void
  groupTargetId: string | null
  collapsedGroups: Record<string, boolean>
  onToggleCollapse: (groupId: string) => void
}

export default memo(function Column({
  column,
  canVote = true,
  cardCreationDisabled = false,
  brainstormHidden = false,
  currentUser,
  isFacilitator = false,
  onUpdate,
  onDelete,
  onCardCreated,
  onCardUpdated,
  onCardDeleted,
  onGroupCreated,
  onGroupUpdated,
  onGroupDeleted,
  groupTargetId,
  collapsedGroups,
  onToggleCollapse,
}: ColumnProps) {
  const { username } = useAppStore()
  const [addOpen, setAddOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [cardText, setCardText] = useState('')
  const [cardColor, setCardColor] = useState('#FFFFFF')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleVal, setTitleVal] = useState(column.title)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)

  const [groupAssignOpen, setGroupAssignOpen] = useState(false)
  const [assigningCardId, setAssigningCardId] = useState<string | null>(null)
  const [newGroupTitle, setNewGroupTitle] = useState('')

  const { setNodeRef, isOver } = useDroppable({
    id: `col-${column.id}`,
    data: { type: 'column', columnId: column.id },
  })

  const { active } = useDndContext()

  const saveTitle = async () => {
    setEditingTitle(false)
    if (titleVal.trim() && titleVal !== column.title) {
      try {
        const updated = await updateColumn(column.id, { title: titleVal.trim() })
        onUpdate(updated)
      } catch {
        setTitleVal(column.title)
        showToast('Не удалось обновить название', 'error')
      }
    }
  }

  const saveColor = async (color: string) => {
    setColorPickerOpen(false)
    try {
      const updated = await updateColumn(column.id, { color })
      onUpdate(updated)
    } catch {
      showToast('Не удалось обновить цвет', 'error')
    }
  }

  const confirmDelete = async () => {
    setDeleteOpen(false)
    try {
      await deleteColumn(column.id)
      onDelete(column.id)
    } catch {
      showToast('Не удалось удалить колонку', 'error')
    }
  }

  const handleAddCard = async () => {
    if (!cardText.trim()) return
    const card = await createCard({
      column_id: column.id,
      text: cardText.trim(),
      author: username,
      color: cardColor,
    })
    onCardCreated(column.id, card)
    setCardText('')
    setCardColor('#FFFFFF')
    setAddOpen(false)
  }

  const handleAssignToGroup = async (groupId: string) => {
    setGroupAssignOpen(false)
    if (!assigningCardId) return
    const updated = await addCardToGroup(groupId, assigningCardId)
    onCardUpdated(column.id, updated)
    setAssigningCardId(null)
    setNewGroupTitle('')
  }

  const handleCreateAndAssign = async () => {
    if (!assigningCardId) return
    const title = newGroupTitle.trim() || 'Новая группа'
    setGroupAssignOpen(false)
    const group = await createGroup({ column_id: column.id, title })
    const updated = await addCardToGroup(group.id, assigningCardId)
    onCardUpdated(column.id, updated)
    setAssigningCardId(null)
    setNewGroupTitle('')
  }

  const openGroupAssign = (cardId: string) => {
    setNewGroupTitle('')
    setAssigningCardId(cardId)
    setGroupAssignOpen(true)
  }

  const groups = column.groups || []
  const ungroupedCards = (column.cards || []).filter((c) => !c.group_id)
  const cardIds = ungroupedCards.map((c) => c.id)

  return (
    <>
      <div
        className={`${s.column} column`}
        style={{
          background: isOver
            ? 'color-mix(in srgb, var(--md-primary) 8%, var(--md-surface-variant))'
            : 'var(--md-surface-variant)',
          maxHeight: active ? '90vh' : 'calc(100vh - 120px)',
          transition: 'max-height 0.2s ease, background 0.15s',
        }}
      >
        <div className={s.header}>
          <div
            className={s.dot}
            style={{ background: column.color }}
            onClick={() => setColorPickerOpen(true)}
            title="Изменить цвет"
          />
          {editingTitle ? (
            <input
              className={s.titleInput}
              value={titleVal}
              onChange={(e) => setTitleVal(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
              autoFocus
            />
          ) : (
            <span
              className={s.title}
              onDoubleClick={() => {
                setTitleVal(column.title)
                setEditingTitle(true)
              }}
              title="Двойной клик чтобы редактировать"
            >
              {column.title}
            </span>
          )}
          <span className={s.count}>{(column.cards || []).length}</span>
          <button
            className={`${s.iconBtn} col-del-btn`}
            onClick={() => setDeleteOpen(true)}
            title="Удалить колонку"
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
              close
            </span>
          </button>
        </div>

        <div ref={setNodeRef} className={s.cards}>
          {groups.map((group) => (
            <CardGroupWidget
              key={group.id}
              group={group}
              columnId={column.id}
              canVote={canVote}
              brainstormHidden={brainstormHidden}
              currentUser={currentUser}
              isFacilitator={isFacilitator}
              cards={(column.cards || []).filter((c) => c.group_id === group.id)}
              collapsed={collapsedGroups?.[group.id] || false}
              onToggleCollapse={() => onToggleCollapse?.(group.id)}
              onGroupUpdated={(updated) => onGroupUpdated(column.id, updated)}
              onGroupDeleted={(_, id) => onGroupDeleted(column.id, id)}
              onCardUpdated={(updated) => onCardUpdated(column.id, updated)}
              onCardDeleted={(id) => onCardDeleted(column.id, id)}
            />
          ))}

          <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
            {ungroupedCards.map((card) => {
              const hidden = brainstormHidden && !isFacilitator && card.author !== currentUser
              return (
                <CardWidget
                  key={card.id}
                  card={card}
                  canVote={canVote}
                  hidden={hidden}
                  onUpdate={(updated) => onCardUpdated(column.id, updated)}
                  onDelete={(id) => onCardDeleted(column.id, id)}
                  groups={groups}
                  onAssignGroup={openGroupAssign}
                  isGroupTarget={card.id === groupTargetId}
                />
              )
            })}
          </SortableContext>

          {ungroupedCards.length === 0 && groups.length === 0 && (
            <div className={s.emptyDrop}>Перетащи карточку сюда</div>
          )}
        </div>

        <div className={s.footer}>
          <button
            className={s.addBtn}
            onClick={() => setAddOpen(true)}
            disabled={cardCreationDisabled}
            title={cardCreationDisabled ? 'Дождитесь начала сессии (фасилитатор ещё не назначен)' : undefined}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
              add
            </span>
            Добавить заметку
          </button>
        </div>
      </div>

      {colorPickerOpen && (
        <div className={s.colorOverlay} onClick={() => setColorPickerOpen(false)}>
          <div className={s.colorPopover} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--md-on-surface)' }}>
              Цвет колонки
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {[
                '#6750A4','#0061A4','#006E1C','#BA1A1A','#E8760A',
                '#006A60','#7D5260','#FF6D00','#43A047',
              ].map((c) => (
                <div
                  key={c}
                  className={s.swatchSmall}
                  style={{ background: c }}
                  onClick={() => saveColor(c)}
                />
              ))}
            </div>
            <input
              type="color"
              value={column.color}
              onChange={(e) => saveColor(e.target.value)}
              style={{ cursor: 'pointer' }}
            />
          </div>
        </div>
      )}

      <Dialog
        open={addOpen}
        title="Новая заметка"
        icon="edit_note"
        onClose={() => {
          setAddOpen(false)
          setCardText('')
          setCardColor('#FFFFFF')
        }}
        onConfirm={handleAddCard}
        confirmLabel="Добавить"
      >
        <textarea
          className={s.textarea}
          value={cardText}
          onChange={(e) => setCardText(e.target.value)}
          placeholder="Что думаете?"
          rows={4}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && handleAddCard()}
        />
        <div style={{ marginTop: 16 }}>
          <div className={s.sectionLabel}>Цвет заметки</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CARD_COLORS.map((c) => (
              <div
                key={c}
                onClick={() => setCardColor(c)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  cursor: 'pointer',
                  background: c,
                  border:
                    c === cardColor
                      ? '3px solid var(--md-primary)'
                      : '2px solid var(--md-outline-variant)',
                  transform: c === cardColor ? 'scale(1.18)' : 'scale(1)',
                  transition: 'all 0.15s',
                  boxShadow:
                    c === cardColor ? '0 0 0 2px var(--md-primary-container)' : 'none',
                }}
              />
            ))}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={deleteOpen}
        title="Удалить колонку?"
        icon="delete"
        danger
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        confirmLabel="Удалить"
      >
        <p className={s.confirmText}>
          Колонка{' '}
          <strong style={{ color: 'var(--md-on-surface)' }}>
            «{column.title}»
          </strong>{' '}
          и все её заметки ({(column.cards || []).length}) будут удалены без возможности
          восстановления.
        </p>
      </Dialog>

      <Dialog
        open={groupAssignOpen}
        title="Добавить в группу"
        icon="folder"
        onClose={() => {
          setGroupAssignOpen(false)
          setAssigningCardId(null)
          setNewGroupTitle('')
        }}
        onConfirm={null}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map((g) => (
            <button
              key={g.id}
              className={s.groupPickBtn}
              onClick={() => handleAssignToGroup(g.id)}
            >
              <span
                className="material-symbols-rounded"
                style={{ fontSize: 16, color: 'var(--md-primary)' }}
              >
                folder
              </span>
              {g.title}
            </button>
          ))}

          {groups.length > 0 && (
            <div style={{ height: 1, background: 'var(--md-outline-variant)', margin: '4px 0' }} />
          )}

          <div className={s.newGroupRow}>
            <input
              className={s.newGroupInput}
              value={newGroupTitle}
              onChange={(e) => setNewGroupTitle(e.target.value)}
              placeholder="Название новой группы"
              maxLength={120}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateAndAssign()}
            />
            <button className={s.newGroupBtn} onClick={handleCreateAndAssign}>
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                add
              </span>
              Создать
            </button>
          </div>
        </div>
      </Dialog>
    </>
  )
})
