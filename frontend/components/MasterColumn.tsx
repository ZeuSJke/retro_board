'use client'

import { useState, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import Dialog from './Dialog'
import JiraDialog from './JiraDialog'
import { getJiraStatus, updateActionItem, deleteActionItem } from '../api'
import { userColor, initials } from '../utils/theme'
import type { ActionItem, ActionItemStatus } from '../types'
import s from './MasterColumn.module.css'

interface MasterColumnProps {
  actionItems: ActionItem[]
  onUpdated: (item: ActionItem) => void
  onDeleted: (id: string) => void
  dropDisabled?: boolean
}

const NEXT_STATUS: Record<ActionItemStatus, ActionItemStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
}
const STATUS_ICON: Record<ActionItemStatus, string> = {
  open: 'radio_button_unchecked',
  in_progress: 'pending',
  done: 'check_circle',
}
const STATUS_CLASS: Record<ActionItemStatus, string> = {
  open: s.taskOpen,
  in_progress: s.taskProgress,
  done: s.taskDone,
}

export default function MasterColumn({
  actionItems,
  onUpdated,
  onDeleted,
  dropDisabled = false,
}: MasterColumnProps) {
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editingDescId, setEditingDescId] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState('')
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

  const saveTitle = async (id: string) => {
    setEditingTitleId(null)
    if (editTitle.trim()) {
      const updated = await updateActionItem(id, { title: editTitle.trim() })
      onUpdated(updated)
    }
  }

  const saveDesc = async (id: string) => {
    setEditingDescId(null)
    if (editDesc.trim()) {
      const updated = await updateActionItem(id, { text: editDesc.trim() })
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

  const toggleStatus = async (item: ActionItem) => {
    const next = NEXT_STATUS[item.status]
    const updated = await updateActionItem(item.id, { status: next })
    onUpdated(updated)
  }

  return (
    <>
      <div className={s.header}>
        <div className={s.dot} />
        <span className={s.title}>Итоги</span>
        <span className={s.count}>{actionItems.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={s.cards}
        style={{
          background: isOver
            ? 'color-mix(in srgb, var(--md-primary) 10%, transparent)'
            : undefined,
          borderRadius: isOver ? 12 : undefined,
        }}
      >
        {actionItems.map((item) => (
          <div
            key={item.id}
            className={`${s.task} ${STATUS_CLASS[item.status] || ''}`}
          >
            {/* Header: status + title + delete */}
            <div className={s.taskHeader}>
              <button
                className={`${s.statusBtn} ${item.status === 'done' ? s.statusDone : item.status === 'in_progress' ? s.statusProgress : ''}`}
                onClick={() => toggleStatus(item)}
                title={item.status === 'open' ? 'Открыто' : item.status === 'in_progress' ? 'В работе' : 'Выполнено'}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                  {STATUS_ICON[item.status]}
                </span>
              </button>

              {editingTitleId === item.id ? (
                <input
                  className={s.titleInput}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => saveTitle(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitle(item.id)
                    if (e.key === 'Escape') setEditingTitleId(null)
                  }}
                  autoFocus
                />
              ) : (
                <span
                  className={s.taskTitle}
                  onDoubleClick={() => {
                    setEditingTitleId(item.id)
                    setEditTitle(item.title || item.text)
                  }}
                  title="Двойной клик — редактировать заголовок"
                >
                  {item.title || item.text}
                </span>
              )}

              <button
                className={s.deleteBtn}
                onClick={() => setDeleteTarget(item)}
                title="Удалить"
              >
                <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                  close
                </span>
              </button>
            </div>

            {/* Description */}
            {editingDescId === item.id ? (
              <textarea
                className={s.editTextarea}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onBlur={() => saveDesc(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) saveDesc(item.id)
                  if (e.key === 'Escape') setEditingDescId(null)
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div
                className={s.taskDesc}
                onDoubleClick={() => {
                  setEditingDescId(item.id)
                  setEditDesc(item.text)
                }}
                title="Двойной клик — редактировать описание"
              >
                {item.text}
              </div>
            )}

            {/* Assignee */}
            <div className={s.taskMeta}>
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
                <>
                  <div
                    className={s.avatar}
                    style={{ background: userColor(item.assignee || '?') }}
                  >
                    {initials(item.assignee || '?')}
                  </div>
                  <span
                    className={s.assigneeName}
                    onClick={() => {
                      setEditAssigneeId(item.id)
                      setEditAssignee(item.assignee || '')
                    }}
                    title="Нажмите чтобы изменить ответственного"
                  >
                    {item.assignee || 'Не назначен'}
                  </span>
                </>
              )}
            </div>

            {jiraConfigured && (
              <div className={s.jiraRow}>
                {item.jira_issue_key ? (
                  <span className={s.jiraBadge}>
                    <span className="material-symbols-rounded" style={{ fontSize: 12 }}>
                      link
                    </span>
                    {item.jira_issue_key}
                  </span>
                ) : (
                  <button
                    className={s.jiraCreateBtn}
                    onClick={() => setJiraTarget(item)}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: 12 }}>
                      add_link
                    </span>
                    Jira
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {actionItems.length === 0 && (
          <div className={s.emptyDrop}>Перетащи карточку сюда</div>
        )}
      </div>

      <Dialog
        open={!!deleteTarget}
        title="Удалить задачу?"
        icon="delete"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        confirmLabel="Удалить"
      >
        <p className={s.confirmText}>
          Задача будет удалена без возможности восстановления.
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
