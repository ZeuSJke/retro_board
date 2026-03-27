'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getBoards, getAllActionItems, carryForward } from '../api'
import type { BoardListItem, DashboardActionItem } from '../types'
import Dialog from './Dialog'
import s from './Dashboard.module.css'

type StatusFilter = 'all' | 'open' | 'in_progress' | 'done'

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Все',
  open: 'Открыто',
  in_progress: 'В работе',
  done: 'Выполнено',
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'done') {
    return (
      <span className={`material-symbols-rounded ${s.statusIcon} ${s.statusDone}`}>
        check_circle
      </span>
    )
  }
  if (status === 'in_progress') {
    return (
      <span className={`material-symbols-rounded ${s.statusIcon} ${s.statusProgress}`}>
        pending
      </span>
    )
  }
  return (
    <span className={`material-symbols-rounded ${s.statusIcon} ${s.statusOpen}`}>
      radio_button_unchecked
    </span>
  )
}

export default function Dashboard() {
  const router = useRouter()

  const [boards, setBoards] = useState<BoardListItem[]>([])
  const [items, setItems] = useState<DashboardActionItem[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [boardFilter, setBoardFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('')

  // Carry forward dialog
  const [carryOpen, setCarryOpen] = useState(false)
  const [sourceBoard, setSourceBoard] = useState('')
  const [targetBoard, setTargetBoard] = useState('')
  const [carryLoading, setCarryLoading] = useState(false)

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

  async function loadItems() {
    const data = await getAllActionItems()
    setItems(data)
  }

  async function handleCarryForward() {
    if (!sourceBoard || !targetBoard || sourceBoard === targetBoard) return
    setCarryLoading(true)
    try {
      await carryForward({ source_board_id: sourceBoard, target_board_id: targetBoard })
      await loadItems()
      setCarryOpen(false)
      setSourceBoard('')
      setTargetBoard('')
    } finally {
      setCarryLoading(false)
    }
  }

  function navigateToBoard(board: BoardListItem) {
    const path = board.slug ? `/board/${board.slug}` : `/board/${board.id}`
    router.push(path)
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

        {filteredItems.length === 0 ? (
          <p className={s.emptyText}>Задачи не найдены</p>
        ) : (
          <div>
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className={`${s.itemRow} ${item.status === 'done' ? s.itemDone : ''}`}
              >
                <StatusIcon status={item.status} />
                <span className={s.itemText} title={item.text}>
                  {item.text}
                </span>
                {item.assignee && (
                  <span className={s.itemMeta}>{item.assignee}</span>
                )}
                <span className={s.itemMeta}>{item.board_name}</span>
                <span className={s.itemMeta}>{formatDate(item.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Carry forward section */}
      <section className={s.section}>
        <div className={s.sectionTitle}>
          <span className="material-symbols-rounded" style={{ fontSize: 20 }}>forward</span>
          Перенос задач
        </div>
        <button className={s.carryBtn} onClick={() => setCarryOpen(true)}>
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>forward</span>
          Перенести задачи
        </button>
      </section>

      {/* Carry forward dialog */}
      <Dialog
        open={carryOpen}
        title="Перенести задачи"
        icon="forward"
        onClose={() => {
          setCarryOpen(false)
          setSourceBoard('')
          setTargetBoard('')
        }}
        onConfirm={handleCarryForward}
        confirmLabel={carryLoading ? 'Перенос...' : 'Перенести'}
      >
        <div className={s.carryForm}>
          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--md-on-surface-variant)',
                display: 'block',
                marginBottom: 6,
              }}
            >
              Исходная доска (откуда)
            </label>
            <select
              className={s.carrySelect}
              value={sourceBoard}
              onChange={(e) => setSourceBoard(e.target.value)}
            >
              <option value="">Выберите доску...</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--md-on-surface-variant)',
                display: 'block',
                marginBottom: 6,
              }}
            >
              Целевая доска (куда)
            </label>
            <select
              className={s.carrySelect}
              value={targetBoard}
              onChange={(e) => setTargetBoard(e.target.value)}
            >
              <option value="">Выберите доску...</option>
              {boards
                .filter((b) => b.id !== sourceBoard)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </div>
          {sourceBoard && targetBoard && sourceBoard === targetBoard && (
            <p style={{ fontSize: 12, color: 'var(--md-error)', margin: 0 }}>
              Исходная и целевая доски должны быть разными
            </p>
          )}
        </div>
      </Dialog>
    </div>
  )
}
