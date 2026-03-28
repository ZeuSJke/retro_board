'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getBoards, getAllActionItems, updateActionItem, deleteActionItem, getJiraStatus, getTrends } from '../api'
import { userColor, initials } from '../utils/theme'
import type { BoardListItem, DashboardActionItem, ActionItemStatus, TrendPoint } from '../types'
import Dialog from './Dialog'
import JiraDialog from './JiraDialog'
import TrendChart from './TrendChart'
import s from './Dashboard.module.css'

type StatusFilter = 'all' | 'open' | 'in_progress' | 'done'

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Все',
  open: 'Открыто',
  in_progress: 'В работе',
  done: 'Выполнено',
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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function Dashboard() {
  const router = useRouter()

  const [boards, setBoards] = useState<BoardListItem[]>([])
  const [items, setItems] = useState<DashboardActionItem[]>([])
  const [trends, setTrends] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [boardFilter, setBoardFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('')


  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const [boardsData, itemsData] = await Promise.all([
          getBoards(),
          getAllActionItems(),
        ])
        if (!cancelled) {
          setBoards(boardsData)
          setItems(itemsData)
        }
        // Non-critical: trends and Jira status load independently
        getTrends()
          .then((d) => { if (!cancelled) setTrends(d) })
          .catch(() => {})
        getJiraStatus()
          .then((s) => { if (!cancelled) setJiraConfigured(s.configured) })
          .catch(() => {})
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (boardFilter !== 'all' && item.board_id !== boardFilter) return false
      if (
        assigneeFilter.trim() &&
        !(item.assignee ?? '').toLowerCase().includes(assigneeFilter.trim().toLowerCase())
      ) {
        return false
      }
      return true
    })
  }, [items, statusFilter, boardFilter, assigneeFilter])

  const showDoneSeparately = statusFilter === 'all'
  const activeItems = useMemo(
    () => (showDoneSeparately ? filteredItems.filter((i) => i.status !== 'done') : filteredItems),
    [filteredItems, showDoneSeparately],
  )
  const doneItems = useMemo(
    () => (showDoneSeparately ? filteredItems.filter((i) => i.status === 'done') : []),
    [filteredItems, showDoneSeparately],
  )

  const [doneCollapsed, setDoneCollapsed] = useState(true)
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editingDescId, setEditingDescId] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [editAssigneeId, setEditAssigneeId] = useState<string | null>(null)
  const [editAssignee, setEditAssignee] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DashboardActionItem | null>(null)
  const [jiraConfigured, setJiraConfigured] = useState(false)
  const [jiraTarget, setJiraTarget] = useState<DashboardActionItem | null>(null)


  async function toggleStatus(item: DashboardActionItem) {
    const next = NEXT_STATUS[item.status]
    const updated = await updateActionItem(item.id, { status: next })
    setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)))
  }

  async function saveTitle(id: string) {
    setEditingTitleId(null)
    if (editTitle.trim()) {
      const updated = await updateActionItem(id, { title: editTitle.trim() })
      setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)))
    }
  }

  async function saveDesc(id: string) {
    setEditingDescId(null)
    if (editDesc.trim()) {
      const updated = await updateActionItem(id, { text: editDesc.trim() })
      setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)))
    }
  }

  async function saveAssignee(id: string) {
    setEditAssigneeId(null)
    const updated = await updateActionItem(id, { assignee: editAssignee.trim() || null })
    setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)))
  }

  async function confirmDeleteItem() {
    if (!deleteTarget) return
    await deleteActionItem(deleteTarget.id)
    setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id))
    setDeleteTarget(null)
  }


  function navigateToBoard(board: BoardListItem) {
    const path = board.slug ? `/board/${board.slug}` : `/board/${board.id}`
    router.push(path)
  }

  function renderTaskCard(item: DashboardActionItem) {
    return (
      <div
        key={item.id}
        className={`${s.taskCard} ${
          item.status === 'done' ? s.taskDone : item.status === 'in_progress' ? s.taskProgress : s.taskOpen
        }`}
      >
        <div className={s.taskHeader}>
          <button
            className={`${s.statusBtn} ${
              item.status === 'done' ? s.statusBtnDone : item.status === 'in_progress' ? s.statusBtnProgress : ''
            }`}
            onClick={() => toggleStatus(item)}
            title={`${STATUS_LABELS[item.status]} → ${STATUS_LABELS[NEXT_STATUS[item.status]]}`}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
              {STATUS_ICON[item.status]}
            </span>
          </button>

          {editingTitleId === item.id ? (
            <input
              className={s.taskTitleInput}
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
              title="Двойной клик — редактировать"
            >
              {item.title || item.text}
            </span>
          )}

          <button
            className={s.taskDelBtn}
            onClick={() => setDeleteTarget(item)}
            title="Удалить"
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
              delete
            </span>
          </button>
        </div>

        {editingDescId === item.id ? (
          <textarea
            className={s.taskDescInput}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onBlur={() => saveDesc(item.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) saveDesc(item.id)
              if (e.key === 'Escape') setEditingDescId(null)
            }}
            autoFocus
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

        <div className={s.taskMetaRow}>
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
            <span
              className={s.assigneeTag}
              onClick={() => {
                setEditAssigneeId(item.id)
                setEditAssignee(item.assignee || '')
              }}
              title="Нажмите чтобы изменить"
            >
              <span
                className={s.avatar}
                style={{ background: userColor(item.assignee || '?') }}
              >
                {initials(item.assignee || '?')}
              </span>
              {item.assignee || 'Не назначен'}
            </span>
          )}

          <span className={s.metaTag}>
            <span className="material-symbols-rounded" style={{ fontSize: 12 }}>
              dashboard
            </span>
            {item.board_name}
          </span>

          <span className={s.metaTag}>
            {formatDate(item.created_at)}
          </span>

          {jiraConfigured && (
            <>
              {item.jira_issue_key ? (
                <span className={s.jiraBadge}>
                  <span className="material-symbols-rounded" style={{ fontSize: 12 }}>
                    link
                  </span>
                  {item.jira_issue_key}
                </span>
              ) : (
                <button
                  className={s.jiraBtn}
                  onClick={() => setJiraTarget(item)}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 12 }}>
                    add_link
                  </span>
                  Jira
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={s.container}>
        <div className={s.loading}>
          <span className="material-symbols-rounded" style={{ fontSize: 24, marginRight: 8 }}>
            hourglass_empty
          </span>
          Загрузка...
        </div>
      </div>
    )
  }

  return (
    <div className={s.container}>
      {/* Header */}
      <div className={s.header}>
        <button className={s.backBtn} onClick={() => router.back()} title="Назад">
          <span className="material-symbols-rounded">arrow_back</span>
        </button>
        <h1 className={s.pageTitle}>История ретро</h1>
      </div>

      {/* Boards section */}
      <section className={s.section}>
        <div className={s.sectionTitle}>
          <span className="material-symbols-rounded" style={{ fontSize: 20 }}>grid_view</span>
          Прошлые ретро
        </div>
        {boards.length === 0 ? (
          <p className={s.emptyText}>Нет досок</p>
        ) : (
          <div className={s.boardGrid}>
            {boards.map((b) => (
              <div key={b.id} className={s.boardCard} onClick={() => navigateToBoard(b)}>
                <div className={s.boardCardName}>{b.name}</div>
                <div className={s.boardCardMeta}>
                  <span>{formatDate(b.created_at)}</span>
                  {b.action_items_total > 0 && (
                    <span className={s.badge}>
                      <span className="material-symbols-rounded" style={{ fontSize: 12 }}>
                        task_alt
                      </span>
                      {b.action_items_open}/{b.action_items_total}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Trends chart */}
      {trends.length > 0 && (
        <section className={s.section}>
          <div className={s.sectionTitle}>
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>trending_up</span>
            Тренды задач по ретро
          </div>
          <TrendChart data={trends} />
        </section>
      )}

      {/* Action items section */}
      <section className={s.section}>
        <div className={s.sectionTitle}>
          <span className="material-symbols-rounded" style={{ fontSize: 20 }}>checklist</span>
          Все задачи
        </div>

        <div className={s.filters}>
          <select
            className={s.filterSelect}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_LABELS[k]}
              </option>
            ))}
          </select>

          <select
            className={s.filterSelect}
            value={boardFilter}
            onChange={(e) => setBoardFilter(e.target.value)}
          >
            <option value="all">Все доски</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <input
            className={s.filterInput}
            placeholder="Ответственный"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
          />
        </div>

        {activeItems.length === 0 && doneItems.length === 0 ? (
          <p className={s.emptyText}>Задачи не найдены</p>
        ) : (
          <>
            <div className={s.taskList}>
              {activeItems.map((item) => renderTaskCard(item))}
            </div>

            {doneItems.length > 0 && (
              <div className={s.doneSection}>
                <button
                  className={s.doneToggle}
                  onClick={() => setDoneCollapsed((v) => !v)}
                >
                  <span
                    className="material-symbols-rounded"
                    style={{
                      fontSize: 18,
                      transform: doneCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s',
                    }}
                  >
                    expand_more
                  </span>
                  <span className="material-symbols-rounded" style={{ fontSize: 16, color: '#006E1C' }}>
                    check_circle
                  </span>
                  Выполненные ({doneItems.length})
                </button>

                {!doneCollapsed && (
                  <div className={s.taskList}>
                    {doneItems.map((item) => renderTaskCard(item))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Delete action item dialog */}
      <Dialog
        open={!!deleteTarget}
        title="Удалить задачу?"
        icon="delete"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteItem}
        confirmLabel="Удалить"
      >
        <p className={s.emptyText} style={{ textAlign: 'left', padding: 0 }}>
          Задача{' '}
          <strong style={{ color: 'var(--md-on-surface)' }}>
            «{deleteTarget?.title || deleteTarget?.text}»
          </strong>{' '}
          будет удалена без возможности восстановления.
        </p>
      </Dialog>

      {/* Jira dialog */}
      {jiraTarget && (
        <JiraDialog
          item={jiraTarget}
          onClose={() => setJiraTarget(null)}
          onCreated={(updated) => {
            setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)))
            setJiraTarget(null)
          }}
        />
      )}

    </div>
  )
}
