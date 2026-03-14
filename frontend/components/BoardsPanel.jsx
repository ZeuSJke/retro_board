'use client'

import { useState, useCallback } from 'react'
import { createBoard, deleteBoard } from '../api'
import Dialog from './Dialog'

export default function BoardsPanel({
  open,
  boards,
  currentId,
  onSelect,
  onCreated,
  onDeleted,
}) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = useCallback((message) => {
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
      onCreated(board)
    } catch (e) {
      setCreateError(e?.response?.data?.detail || 'Ошибка создания доски')
    }
  }

  const confirmDelete = async () => {
    await deleteBoard(deleteTarget.id)
    onDeleted(deleteTarget.id)
    setDeleteTarget(null)
  }

  return (
    <>
      <aside style={{ ...styles.panel, left: open ? 0 : -320 }}>
        <div style={styles.header}>
          <span className="material-symbols-rounded">dashboard</span>
          Мои доски
        </div>

        <div style={styles.list}>
          {boards.map((b) => (
            <div
              key={b.id}
              style={{
                ...styles.item,
                background:
                  b.id === currentId ? 'var(--md-secondary-container)' : 'transparent',
                color:
                  b.id === currentId
                    ? 'var(--md-on-secondary-container)'
                    : 'var(--md-on-surface-variant)',
              }}
              onClick={() => onSelect(b.id)}
              className="board-item"
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
              <button
                style={styles.delBtn}
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
        </div>

        <div style={styles.footer}>
          {creating ? (
            <div>
              <div style={styles.createRow}>
                <input
                  style={{
                    ...styles.input,
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
                  style={{
                    ...styles.compactBtn,
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
                  style={styles.compactBtn}
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
                <p style={styles.errorText}>{createError}</p>
              )}
            </div>
          ) : (
            <button style={styles.addBtn} onClick={() => setCreating(true)}>
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
        <p style={styles.confirmText}>
          Доска{' '}
          <strong style={{ color: 'var(--md-on-surface)' }}>
            «{deleteTarget?.name}»
          </strong>{' '}
          и все её колонки будут удалены без возможности восстановления.
        </p>
      </Dialog>

      {toast && (
        <div style={styles.toast}>
          <span className="material-symbols-rounded" style={{ fontSize: 20, flexShrink: 0 }}>
            info
          </span>
          {toast}
        </div>
      )}
    </>
  )
}

const styles = {
  panel: {
    position: 'fixed',
    top: 64,
    bottom: 0,
    width: 300,
    background: 'var(--md-surface-1)',
    zIndex: 90,
    transition: 'left 0.2s cubic-bezier(0.2,0,0,1)',
    boxShadow: 'var(--elevation-3)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '16px 20px',
    fontSize: 18,
    fontWeight: 700,
    borderBottom: '1px solid var(--md-outline-variant)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  list: { flex: 1, overflowY: 'auto', padding: 8 },
  item: {
    padding: '10px 14px',
    borderRadius: 12,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontWeight: 500,
    fontSize: 14,
    transition: 'var(--transition)',
  },
  delBtn: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--md-on-surface-variant)',
    flexShrink: 0,
  },
  footer: {
    padding: 12,
    borderTop: '1px solid var(--md-outline-variant)',
    flexShrink: 0,
  },
  createRow: { display: 'flex', gap: 6, alignItems: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    border: '1.5px solid var(--md-outline-variant)',
    borderRadius: 10,
    padding: '10px 12px',
    fontFamily: "'Roboto', sans-serif",
    fontSize: 13,
    background: 'var(--md-surface-variant)',
    color: 'var(--md-on-surface)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  compactBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    border: 'none',
    background: 'var(--md-surface-variant)',
    color: 'var(--md-on-surface-variant)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'background 0.15s',
  },
  addBtn: {
    width: '100%',
    height: 44,
    borderRadius: 12,
    border: 'none',
    background: 'var(--md-primary)',
    color: 'var(--md-on-primary)',
    fontFamily: "'Roboto', sans-serif",
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    transition: 'opacity 0.15s',
  },
  confirmText: {
    fontSize: 14,
    lineHeight: 1.6,
    color: 'var(--md-on-surface-variant)',
  },
  errorText: {
    margin: '6px 0 0',
    fontSize: 12,
    color: 'var(--md-error)',
  },
  toast: {
    position: 'fixed',
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'var(--md-inverse-surface, #313033)',
    color: 'var(--md-inverse-on-surface, #F4EFF4)',
    padding: '12px 20px',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    boxShadow: 'var(--elevation-3)',
    zIndex: 200,
    whiteSpace: 'nowrap',
    animation: 'fadeInUp 0.2s ease',
  },
}
