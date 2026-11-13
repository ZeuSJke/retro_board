'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { getBoards, getAllActionItems, updateActionItem, deleteActionItem } from '../api'
import { useAppStore } from '../store'
import { showToast } from '../store/toastStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { getApiErrorMessage } from '../utils/apiError'
import { userColor, initials } from '../utils/theme'
import type { BoardListItem, DashboardActionItem, ActionItemStatus, WsBoardUpdatedData, WsDeletedData, WsMessage } from '../types'
import Dialog from './Dialog'
import SummaryModal from './SummaryModal'
import WelcomeDialog from './WelcomeDialog'
import s from './Dashboard.module.css'

const TrendChart = dynamic(() => import('./TrendChart'), {
  loading: () => <div style={{ height: 280 }} />,
  ssr: false,
})

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
  const setUsername = useAppStore((s) => s.setUsername)
  const workspace = useAppStore((s) => s.workspace)

  const [boards, setBoards] = useState<BoardListItem[]>([])
  const [items, setItems] = useState<DashboardActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [authRequired, setAuthRequired] = useState(false)

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [boardFilter, setBoardFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('')

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [boardsData, itemsData] = await Promise.all([
        getBoards(),
        getAllActionItems(),
      ])
      setBoards(boardsData)
      setItems(itemsData)
      setAuthRequired(false)
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 401 || !useAppStore.getState().workspace) {
        setAuthRequired(true)
      } else if (!silent) {
        showToast(getApiErrorMessage(e, 'Не удалось загрузить данные'), 'error')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const hadWorkspaceRef = useRef(Boolean(workspace))

  useEffect(() => {
    if (workspace) {
      hadWorkspaceRef.current = true
    } else if (hadWorkspaceRef.current) {
      setAuthRequired(true)
    }
  }, [workspace])

  useEffect(() => {
    const onFocus = () => {
      if (useAppStore.getState().workspace) {
        void loadData(true)
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadData])

  const handleWorkspaceWsMessage = useCallback((msg: WsMessage) => {
    try {
      if (msg.event === 'board_created') {
        const board = msg.data as unknown as BoardListItem
        if (board?.id) {
          setBoards((prev) => (prev.some((b) => b.id === board.id) ? prev : [board, ...prev]))
        }
      } else if (msg.event === 'board_updated') {
        const upd = msg.data as unknown as WsBoardUpdatedData
        if (upd?.id) {
          setBoards((prev) => prev.map((b) => (b.id === upd.id ? { ...b, ...upd } : b)))
          if (upd.name) {
            setItems((prev) =>
              prev.map((i) => (i.board_id === upd.id ? { ...i, board_name: upd.name! } : i)),
            )
          }
        }
      } else if (msg.event === 'board_deleted') {
        const { id } = msg.data as unknown as WsDeletedData
        if (id) {
          setBoards((prev) => prev.filter((b) => b.id !== id))
          setItems((prev) => prev.filter((i) => i.board_id !== id))
        }
      }
    } catch {
      /* ignore malformed workspace ws message */
    }
  }, [])

  useWebSocket('workspace', handleWorkspaceWsMessage)

  // Compute trend data from local items + boards (updates in real-time)
  const trends = useMemo(() => {
    const grouped = new Map<string, { open: number; in_progress: number; done: number }>()
    for (const item of items) {
      let counts = grouped.get(item.board_id)
      if (!counts) {
        counts = { open: 0, in_progress: 0, done: 0 }
        grouped.set(item.board_id, counts)
      }
      if (item.status in counts) counts[item.status as keyof typeof counts]++
    }
    return boards
      .filter((b) => grouped.has(b.id))
      .map((b) => {
        const c = grouped.get(b.id)!
        return {
          board_id: b.id,
          board_name: b.name,
          created_at: b.created_at,
          open: c.open,
          in_progress: c.in_progress,
          done: c.done,
          total: c.open + c.in_progress + c.done,
        }
      })
  }, [items, boards])

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
  const [summaryBoard, setSummaryBoard] = useState<BoardListItem | null>(null)


  async function toggleStatus(item: DashboardActionItem) {
    try {
      const next = NEXT_STATUS[item.status]
      const updated = await updateActionItem(item.id, { status: next })
      setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)))
    } catch (e) {
      showToast(getApiErrorMessage(e, 'Не удалось обновить статус'), 'error')
    }
  }

  async function saveTitle(id: string) {
    setEditingTitleId(null)
    if (editTitle.trim()) {
      try {
        const updated = await updateActionItem(id, { title: editTitle.trim() })
        setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)))
      } catch (e) {
        showToast(getApiErrorMessage(e, 'Не удалось сохранить название'), 'error')
      }
    }
  }

  async function saveDesc(id: string) {
    setEditingDescId(null)
    if (editDesc.trim()) {
      try {
        const updated = await updateActionItem(id, { text: editDesc.trim() })
        setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)))
      } catch (e) {
        showToast(getApiErrorMessage(e, 'Не удалось сохранить описание'), 'error')
      }
    }
  }

  async function saveAssignee(id: string) {
    setEditAssigneeId(null)
    try {
      const updated = await updateActionItem(id, { assignee: editAssignee.trim() || null })
      setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)))
    } catch (e) {
      showToast(getApiErrorMessage(e, 'Не удалось сохранить ответственного'), 'error')
    }
  }

  async function confirmDeleteItem() {
    if (!deleteTarget) return
    try {
      await deleteActionItem(deleteTarget.id)
      setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (e) {
      showToast(getApiErrorMessage(e, 'Не удалось удалить задачу'), 'error')
    }
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
        </div>
      </div>
    )
  }

  if (authRequired) {
    return (
      <WelcomeDialog
        onConfirm={(name) => {
          setUsername(name)
          setAuthRequired(false)
          void loadData()
        }}
      />
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
        <button className={s.backBtn} onClick={() => router.push('/')} title="Назад">
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
              <div key={b.id} className={s.boardCard}>
                <div className={s.boardCardContent} onClick={() => navigateToBoard(b)}>
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
                <button
                  className={`${s.summaryBtn} ${b.has_summary ? s.summaryBtnActive : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSummaryBoard(b)
                  }}
                  title={b.has_summary ? 'Просмотреть резюме' : 'Резюме недоступно'}
                >
                  <span
                    className="material-symbols-rounded"
                    style={{ fontVariationSettings: b.has_summary ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    summarize
                  </span>
                </button>
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

      {/* Summary modal */}
      {summaryBoard && (
        <SummaryModal
          boardId={summaryBoard.id}
          hasSummary={summaryBoard.has_summary}
          onClose={() => setSummaryBoard(null)}
        />
      )}

    </div>
  )
}
