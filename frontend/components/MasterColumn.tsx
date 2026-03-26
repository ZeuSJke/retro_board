'use client'

import { useState, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import Dialog from './Dialog'
import JiraDialog from './JiraDialog'
import { getJiraStatus, updateActionItem, deleteActionItem } from '../api'
import { userColor, initials } from '../utils/theme'
import type { ActionItem } from '../types'
import s from './MasterColumn.module.css'

interface MasterColumnProps {
  actionItems: ActionItem[]
  onUpdated: (item: ActionItem) => void
  onDeleted: (id: string) => void
  dropDisabled?: boolean
}

export default function MasterColumn({
  actionItems,
  onUpdated,
  onDeleted,
  dropDisabled = false,
}: MasterColumnProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editAssigneeId, setEditAssigneeId] = useState<string | null>(null)
  const [editAssignee, setEditAssignee] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ActionItem | null>(null)
  const [jiraConfigured, setJiraConfigured] = useState(false)
  const [jiraTarget, setJiraTarget] = useState<ActionItem | null>(null)

  const { setNodeRef, isOver } = useDroppable({
    id: 'master-col',
    data: { type: 'master' },
    disabled: dropDisabled,
  })

  useEffect(() => {
    getJiraStatus()
      .then((s) => setJiraConfigured(s.configured))
      .catch(() => setJiraConfigured(false))
  }, [])

  const saveEdit = async (id: string) => {
    setEditingId(null)
    if (editText.trim()) {
      const updated = await updateActionItem(id, { text: editText.trim() })
      onUpdated(updated)
    }
  }

  const saveAssignee = async (id: string) => {
    setEditAssigneeId(null)
    const updated = await updateActionItem(id, { assignee: editAssignee.trim() || null })
    onUpdated(updated)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    await deleteActionItem(deleteTarget.id)
    onDeleted(deleteTarget.id)
    setDeleteTarget(null)
  }

  return (
    <>
      <div
        className={s.column}
        style={{
          background: isOver
            ? 'color-mix(in srgb, var(--md-primary) 12%, var(--md-surface-variant))'
            : undefined,
        }}
      >
        <div className={s.header}>
          <div className={s.dot} />
          <span className={s.title}>Итоги</span>
          <span className={s.count}>{actionItems.length}</span>
        </div>

        <div ref={setNodeRef} className={s.cards}>
          {actionItems.map((item) => (
            <div
              key={item.id}
              className={s.card}
            >
              <div className={s.cardDrag}>
                <div className={s.author}>
                  {editAssigneeId === item.id ? (
                    <input
                      className={s.assigneeInput}
                      value={editAssignee}
                      onChange={(e) => setEditAssignee(e.target.value)}
                      onBlur={() => saveAssignee(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveAssignee(item.id)
                        if (e.key === 'Escape') setEditAssigneeId(null)
                      }}
                      placeholder="Ответственный"
                      autoFocus
                    />
                  ) : (
                    <div
                      className={s.authorRow}
                      onClick={() => {
                        setEditAssigneeId(item.id)
                        setEditAssignee(item.assignee || '')
                      }}
                      title="Нажмите чтобы изменить ответственного"
                    >
                      <div
                        className={s.avatar}
                        style={{ background: userColor(item.assignee || '?') }}
                      >
                        {initials(item.assignee || '?')}
                      </div>
                      {item.assignee || 'Не назначен'}
                    </div>
                  )}
                </div>

                {editingId === item.id ? (
                  <textarea
                    className={s.editTextarea}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => saveEdit(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.ctrlKey) saveEdit(item.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div
                    className={s.text}
                    onDoubleClick={() => {
                      setEditingId(item.id)
                      setEditText(item.text)
                    }}
                    title="Двойной клик чтобы редактировать"
                  >
                    {item.text}
                  </div>
                )}
              </div>

              <div className={s.actions}>
                {jiraConfigured && item.jira_issue_key && (
                  <span className={s.jiraBadge} title={item.jira_issue_key}>
                    {item.jira_issue_key}
                  </span>
                )}

                {jiraConfigured && !item.jira_issue_key && (
                  <button
                    className={s.iconBtn}
                    onClick={() => setJiraTarget(item)}
                    title="Создать задачу в Jira"
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                      link
                    </span>
                  </button>
                )}

                <button
                  className={s.iconBtn}
                  onClick={() => setDeleteTarget(item)}
                  title="Удалить"
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                    delete
                  </span>
                </button>
              </div>
            </div>
          ))}

          {actionItems.length === 0 && (
            <div className={s.emptyDrop}>Перетащи карточку сюда</div>
          )}
        </div>

      </div>

      <Dialog
        open={!!deleteTarget}
        title="Удалить пункт?"
        icon="delete"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        confirmLabel="Удалить"
      >
        <p className={s.confirmText}>
          Пункт будет удалён без возможности восстановления.
        </p>
      </Dialog>

      {jiraTarget && (
        <JiraDialog
          item={jiraTarget}
          onClose={() => setJiraTarget(null)}
          onCreated={(updated) => {
            onUpdated(updated)
            setJiraTarget(null)
          }}
        />
      )}
    </>
  )
}
