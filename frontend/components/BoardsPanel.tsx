'use client'

import { useState, useCallback, useMemo } from 'react'
import { createBoard, deleteBoard } from '../api'
import { boardToBoardListItem } from '../utils/boardMapper'
import { getApiErrorMessage } from '../utils/apiError'
import type { BoardListItem } from '../types'
import Dialog from './Dialog'
import styles from './BoardsPanel.module.css'

interface BoardsPanelProps {
  open: boolean
  boards: BoardListItem[]
  currentId: string | undefined
  onSelect: (id: string) => void
  onCreated: (board: BoardListItem) => void
  onDeleted: (id: string) => void
}

export default function BoardsPanel({
  open,
  boards,
  currentId,
  onSelect,
  onCreated,
  onDeleted,
}: BoardsPanelProps) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  // Adaptive limit: fit items into available panel height
  // Panel = 100vh - 64px(topbar). Subtract header(56), footer(68), dashboardLink(48), toggle btn(36), padding(16)
  const ITEM_HEIGHT = 44
  const PANEL_OVERHEAD = 224
  const visibleLimit = useMemo(() => {
    const available = (typeof window !== 'undefined' ? window.innerHeight : 800) - 64 - PANEL_OVERHEAD
    return Math.max(3, Math.floor(available / ITEM_HEIGHT))
  }, [])
  const hasHidden = boards.length > visibleLimit
  const visibleBoards = showAll ? boards : boards.slice(0, visibleLimit)

  const showToast = useCallback((message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const handleCreate = async () => {
    const name = newName.trim() || `Ретро — Спринт ${boards.length + 1}`
    try {
      const board = await createBoard(name)
      setNewName('')
      setCreating(false)
      setCreateError(null)
      onCreated(boardToBoardListItem(board))
    } catch (e: unknown) {
      setCreateError(getApiErrorMessage(e, 'Ошибка создания доски'))
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    await deleteBoard(deleteTarget.id)
    onDeleted(deleteTarget.id)
    setDeleteTarget(null)
  }

  return (
    <>
      <aside className={styles.panel} style={{ left: open ? 0 : -320 }}>
        <div className={styles.header}>
          <span className="material-symbols-rounded">dashboard</span>
          Мои доски
        </div>

        <div className={styles.list}>
          <div
            className={styles.dashboardLink}
            onClick={() => window.location.href = '/dashboard'}
          >
            <span className="material-symbols-rounded">analytics</span>
            История ретро
          </div>
          {visibleBoards.map((b) => (
            <div
              key={b.id}
              className={`${styles.item} board-item`}
              style={{
                background:
                  b.id === currentId ? 'var(--md-secondary-container)' : 'transparent',
                color:
                  b.id === currentId
                    ? 'var(--md-on-secondary-container)'
                    : 'var(--md-on-surface-variant)',
              }}
              onClick={() => onSelect(b.id)}
            >
              <span className="material-symbols-rounded">grid_view</span>
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {b.name}
              </span>
              {b.action_items_open > 0 && (
                <span className={styles.actionBadge}>
                  {b.action_items_open} откр.
                </span>
              )}
              <button
                className={styles.delBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  if (boards.length <= 1) return showToast('Нельзя удалить последнюю доску')
                  setDeleteTarget({ id: b.id, name: b.name })
                }}
                title="Удалить"
              >
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                  delete
                </span>
              </button>
            </div>
          ))}
          {hasHidden && (
            <button
              className={styles.showMoreBtn}
              onClick={() => setShowAll((v) => !v)}
            >
              <span
                className="material-symbols-rounded"
                style={{
                  fontSize: 16,
                  transform: showAll ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }}
              >
                expand_more
              </span>
              {showAll ? 'Скрыть' : `Ещё ${boards.length - visibleLimit}`}
            </button>
          )}
        </div>

        <div className={styles.footer}>
          {creating ? (
            <div>
              <div className={styles.createRow}>
                <input
                  className={styles.input}
                  style={{
                    borderColor: createError ? 'var(--md-error)' : 'var(--md-outline-variant)',
                  }}
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setCreateError(null) }}
                  placeholder="Название доски"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') { setCreating(false); setCreateError(null) }
                  }}
                />
                <button
                  className={styles.compactBtn}
                  style={{
                    background: 'var(--md-primary)',
                    color: 'var(--md-on-primary)',
                  }}
                  onClick={handleCreate}
                  title="Создать"
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
                    check
                  </span>
                </button>
                <button
                  className={styles.compactBtn}
                  onClick={() => {
                    setCreating(false)
                    setNewName('')
                    setCreateError(null)
                  }}
                  title="Отмена"
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
                    close
                  </span>
                </button>
              </div>
              {createError && (
                <p className={styles.errorText}>{createError}</p>
              )}
            </div>
          ) : (
            <button className={styles.addBtn} onClick={() => setCreating(true)}>
              <span className="material-symbols-rounded">add</span>
              Новая доска
            </button>
          )}
        </div>
      </aside>

      <Dialog
        open={!!deleteTarget}
        title="Удалить доску?"
        icon="delete"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        confirmLabel="Удалить"
      >
        <p className={styles.confirmText}>
          Доска{' '}
          <strong style={{ color: 'var(--md-on-surface)' }}>
            «{deleteTarget?.name}»
          </strong>{' '}
          и все её колонки будут удалены без возможности восстановления.
        </p>
      </Dialog>

      {toast && (
        <div className={styles.toast}>
          <span className="material-symbols-rounded" style={{ fontSize: 20, flexShrink: 0 }}>
            info
          </span>
          {toast}
        </div>
      )}
    </>
  )
}
