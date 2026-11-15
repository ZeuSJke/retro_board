'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { motion } from 'motion/react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { BrandMark } from '@/components/BrandLogo'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  ExternalLink,
  GripVertical,
  HeartPulse,
  Kanban,
  Layers,
  List,
  ListTodo,
  Loader2,
  Lock,
  Moon,
  PanelLeft,
  Plus,
  Repeat,
  Search,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react'
import {
  deleteActionItem,
  getActionItemTrends,
  getAllActionItems,
  getBoard,
  getBoardSummary,
  getBoards,
  getMoodTrends,
  getWorkspaceInsights,
  refreshWorkspaceSession,
  updateActionItem,
} from '../api'
import { createAgentToken, getAgentTokens, revokeAgentToken } from '../api/agentTokens'
import { getHealthQuestions, getHealthTrends } from '../api/health'
import { getTeamThemes } from '../api/themes'
import { useAppStore } from '../store'
import { useWebSocket } from '../hooks/useWebSocket'
import { showToast } from '../store/toastStore'
import { getApiErrorMessage, markApiErrorReported } from '../utils/apiError'
import { boardToBoardListItem } from '../utils/boardMapper'
import { getUserAvatarGradient, getUserInitials } from '@/lib/board-themes'
import { avatarSeed } from '@/lib/participants'
import type {
  ActionItemStatus,
  Board,
  BoardListItem,
  BoardSummary,
  DashboardActionItem,
  MoodTrendPoint,
  TrendPoint,
  WorkspaceInsights,
  WsBoardUpdatedData,
  WsMessage,
} from '../types'
import type { HealthQuestion, HealthTrendPoint } from '../types/health'
import type { TeamTheme } from '../types/themes'
import ActionItemExternalLink from './ActionItemExternalLink'
import AgentTokensDialog, { type AgentTokensAdapter } from './AgentTokensDialog'
import BoardsPanel from './BoardsPanel'
import CarryForwardDialog from './CarryForwardDialog'
import CreateBoardDialog from './CreateBoardDialog'
import SummaryModal from './SummaryModal'
import UserSettingsDialog from './UserSettingsDialog'
import WelcomeDialog from './WelcomeDialog'
import WorkspaceInsightsCard from './WorkspaceInsightsCard'
import TeamThemesCard from './dashboard/TeamThemesCard'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { RichCardText } from './RichCardText'

// Графики тянут recharts — самую тяжёлую зависимость дашборда. Грузим их отдельным чанком
// и только когда есть что рисовать; заглушка держит высоту, чтобы карточка не прыгала.
function ChartPlaceholder() {
  return <div className="h-[260px] w-full" aria-hidden="true" />
}
const TrendChart = dynamic(() => import('./TrendChart'), { ssr: false, loading: ChartPlaceholder })
const MoodTrendChart = dynamic(() => import('./MoodTrendChart'), {
  ssr: false,
  loading: ChartPlaceholder,
})
function HealthPlaceholder() {
  return <div className="h-[220px] w-full" aria-hidden="true" />
}
const HealthTrendsChart = dynamic(() => import('./dashboard/HealthTrendsChart'), {
  ssr: false,
  loading: HealthPlaceholder,
})

/** Задача с признаком переноса: оригинал, перенесённый на другую доску, открытым не считается. */
type CarriedAwareItem = DashboardActionItem & { superseded_by_id?: string | null }

/** Одна реальная задача — одна запись: перенесённые оригиналы представлены своими копиями. */
function withoutCarriedOriginals(list: CarriedAwareItem[]): DashboardActionItem[] {
  return list.filter((item) => !item.superseded_by_id)
}

const KANBAN_VISIBLE_LIMIT = 6

const NEXT_STATUS: Record<ActionItemStatus, ActionItemStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
}

const STATUS_META: Record<
  ActionItemStatus,
  { label: string; colorClass: string; badgeVariant: 'warning' | 'secondary' | 'success'; Icon: typeof Circle }
> = {
  open: {
    label: 'Открыто',
    colorClass: 'text-amber-600 dark:text-amber-400',
    badgeVariant: 'warning',
    Icon: Circle,
  },
  in_progress: {
    label: 'В работе',
    colorClass: 'text-sky-600 dark:text-sky-400',
    badgeVariant: 'secondary',
    Icon: Clock,
  },
  done: {
    label: 'Выполнено',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    badgeVariant: 'success',
    Icon: CheckCircle2,
  },
}

interface DragBindings {
  setNodeRef: (el: HTMLElement | null) => void
  attributes: ReturnType<typeof useDraggable>['attributes']
  listeners: ReturnType<typeof useDraggable>['listeners']
  isDragging: boolean
}

function KanbanColumnDropzone({
  status,
  count,
  meta,
  collapsed,
  onToggleCollapse,
  children,
}: {
  status: ActionItemStatus
  count: number
  meta: (typeof STATUS_META)[ActionItemStatus]
  collapsed: boolean
  onToggleCollapse: () => void
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const Icon = meta.Icon

  return (
    <div
      ref={setNodeRef}
      data-testid={`kanban-column-${status}`}
      className={cn(
        'flex flex-col rounded-2xl border bg-muted/30 p-3 transition-colors',
        isOver && 'border-primary/70 bg-primary/5 ring-2 ring-primary/15',
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Развернуть колонку ${meta.label}` : `Свернуть колонку ${meta.label}`}
          className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-primary"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <Icon className={cn('h-4 w-4 shrink-0', meta.colorClass)} />
          <span className="truncate">{meta.label}</span>
        </button>
        <Badge variant="secondary" className="tabular-nums">
          {count}
        </Badge>
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-xl border border-dashed border-border/80 bg-background/50 px-3 py-4 text-center text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          Колонка свёрнута ({count}) — нажмите, чтобы развернуть
        </button>
      ) : (
        children
      )}
    </div>
  )
}

function KanbanDraggableCard({
  item,
  dragDisabled,
  renderCard,
}: {
  item: DashboardActionItem
  dragDisabled: boolean
  renderCard: (item: DashboardActionItem, kanbanMode: boolean, drag?: DragBindings) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { status: item.status },
    disabled: dragDisabled,
  })

  return <>{renderCard(item, true, { setNodeRef, attributes, listeners, isDragging })}</>
}

export default function Dashboard() {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const workspace = useAppStore((s) => s.workspace)
  const participant = useAppStore((s) => s.participant)
  const savedName = useAppStore((s) => s.username)
  const currentBoardId = useAppStore((s) => s.currentBoardId)
  // Настроен ли AI на сервере: приходит из /workspaces/me (см. loadData); null — ещё не знаем
  const aiEnabled = useAppStore((s) => s.aiEnabled)
  const setUsername = useAppStore((s) => s.setUsername)
  const hasHydrated = useAppStore((s) => s._hasHydrated ?? true)
  const username = participant?.name ?? savedName

  const [boards, setBoards] = useState<BoardListItem[]>([])
  const [items, setItems] = useState<DashboardActionItem[]>([])
  const [trends, setTrends] = useState<TrendPoint[]>([])
  const [moodTrends, setMoodTrends] = useState<MoodTrendPoint[]>([])
  const [healthTrends, setHealthTrends] = useState<HealthTrendPoint[]>([])
  const [healthQuestions, setHealthQuestions] = useState<HealthQuestion[]>([])
  const [themes, setThemes] = useState<TeamTheme[]>([])
  const [themesError, setThemesError] = useState(false)
  const [insights, setInsights] = useState<WorkspaceInsights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  // Была ли на этой странице сессия: если она пропала (выход, ответ 401) — показываем вход.
  // Значение выводится из стора прямо при рендере, без эффекта.
  const [hadWorkspace, setHadWorkspace] = useState(Boolean(workspace))
  if (workspace && !hadWorkspace) setHadWorkspace(true)

  const [activeTab, setActiveTab] = useState<'tasks' | 'boards'>('tasks')
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list')
  const [statusFilter, setStatusFilter] = useState<'all' | ActionItemStatus>('all')
  const [boardFilter, setBoardFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('')
  const [doneCollapsed, setDoneCollapsed] = useState(true)
  const [collapsedKanbanCols, setCollapsedKanbanCols] = useState<Record<ActionItemStatus, boolean>>({
    open: false,
    in_progress: false,
    done: false,
  })
  const [expandedKanbanCols, setExpandedKanbanCols] = useState<Record<ActionItemStatus, boolean>>({
    open: false,
    in_progress: false,
    done: false,
  })
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  const kanbanSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editingDescId, setEditingDescId] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [editAssigneeId, setEditAssigneeId] = useState<string | null>(null)
  const [editAssignee, setEditAssignee] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DashboardActionItem | null>(null)

  const [createBoardOpen, setCreateBoardOpen] = useState(false)
  const [carryOpen, setCarryOpen] = useState(false)
  const [boardsPanelOpen, setBoardsPanelOpen] = useState(false)
  const [userSettingsOpen, setUserSettingsOpen] = useState(false)
  const [teamSettingsOpen, setTeamSettingsOpen] = useState(false)

  const agentTokensAdapter = useMemo<AgentTokensAdapter>(
    () => ({
      list: getAgentTokens,
      create: createAgentToken,
      revoke: revokeAgentToken,
    }),
    [],
  )

  // Summary modal state
  const [summaryOpeningId, setSummaryOpeningId] = useState<string | null>(null)
  const [summaryModalBoard, setSummaryModalBoard] = useState<Board | null>(null)
  const [summaryData, setSummaryData] = useState<BoardSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  // Запросы дашборда: только сеть, состояние не трогают
  const requestDashboard = useCallback(async () => {
    // Сверка сессии с сервером: участник, команда и признак ai_enabled попадают в стор.
    // Данные дашборда её не ждут; при 401 перехватчик сам сбросит сессию.
    void refreshWorkspaceSession().catch(markApiErrorReported)
    const [boardsRes, itemsRes, trendsRes, moodRes, themesRes, healthRes, questionsRes] =
      await Promise.all([
        getBoards(),
        getAllActionItems(),
        getActionItemTrends().catch(() => [] as TrendPoint[]),
        getMoodTrends().catch(() => [] as MoodTrendPoint[]),
        // Блок тем сам показывает ошибку и «Повторить» — общий тост не нужен
        getTeamThemes().catch((err: unknown) => {
          markApiErrorReported(err)
          return null
        }),
        getHealthTrends().catch(() => [] as HealthTrendPoint[]),
        getHealthQuestions().catch(() => [] as HealthQuestion[]),
      ])
    return { boardsRes, itemsRes, trendsRes, moodRes, themesRes, healthRes, questionsRes }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNeedsAuth(false)
    try {
      const data = await requestDashboard()
      setBoards(data.boardsRes)
      setItems(withoutCarriedOriginals(data.itemsRes))
      setTrends(data.trendsRes)
      setMoodTrends(data.moodRes)
      setThemes(data.themesRes ?? [])
      setThemesError(data.themesRes === null)
      setHealthTrends(data.healthRes)
      setHealthQuestions(data.questionsRes)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401 || !useAppStore.getState().workspace) {
        setNeedsAuth(true)
      } else {
        setError(getApiErrorMessage(err, 'Не удалось загрузить аналитику'))
      }
    } finally {
      setLoading(false)
    }
  }, [requestDashboard])

  useEffect(() => {
    if (!hasHydrated) return
    void loadData()
  }, [hasHydrated, loadData])

  const handleWorkspaceWs = useCallback((msg: WsMessage) => {
    if (msg.event === 'board_created') {
      const created = msg.data as unknown as BoardListItem
      setBoards((prev) => (prev.some((b) => b.id === created.id) ? prev : [created, ...prev]))
    } else if (msg.event === 'board_updated') {
      const updated = msg.data as unknown as WsBoardUpdatedData
      setBoards((prev) =>
        prev.map((b) =>
          b.id === updated.id
            ? {
                ...b,
                name: updated.name ?? b.name,
                max_votes: updated.max_votes ?? b.max_votes,
                is_locked: updated.is_locked ?? b.is_locked,
              }
            : b,
        ),
      )
      const renamed = updated.name
      if (renamed) {
        setItems((prev) =>
          prev.map((i) => (i.board_id === updated.id ? { ...i, board_name: renamed } : i)),
        )
      }
    } else if (msg.event === 'board_deleted') {
      const deleted = msg.data as unknown as { id: string }
      // Вместе с доской уходят её задачи и точки на графиках
      setBoards((prev) => prev.filter((b) => b.id !== deleted.id))
      setItems((prev) => prev.filter((i) => i.board_id !== deleted.id))
      setTrends((prev) => prev.filter((t) => t.board_id !== deleted.id))
      setMoodTrends((prev) => prev.filter((m) => m.board_id !== deleted.id))
      setHealthTrends((prev) => prev.filter((h) => h.board_id !== deleted.id))
    }
  }, [])

  useWebSocket('workspace', handleWorkspaceWs)

  const openBoardSummary = async (item: BoardListItem) => {
    if (summaryOpeningId) return
    setSummaryOpeningId(item.id)
    let full: Board
    try {
      full = await getBoard(item.id)
    } catch (err) {
      // Без доски окно итогов открыть нечем — говорим об этом, а не молчим
      showToast(
        `Не удалось открыть итоги доски «${item.name}». ${getApiErrorMessage(
          err,
          'Проверьте соединение и попробуйте ещё раз.',
        )}`,
        'error',
      )
      setSummaryOpeningId(null)
      return
    }
    setSummaryData(null)
    setSummaryError(null)
    setSummaryLoading(true)
    setSummaryModalBoard(full)
    try {
      const s = await getBoardSummary(item.id)
      setSummaryData(s)
      if (!s) {
        // Итогов уже нет (окно это объяснит) — значок у доски больше не нужен
        setBoards((prev) => prev.map((b) => (b.id === item.id ? { ...b, has_summary: false } : b)))
      }
    } catch (err) {
      setSummaryError(getApiErrorMessage(err, 'Не удалось загрузить итоги доски'))
    } finally {
      setSummaryLoading(false)
      setSummaryOpeningId(null)
    }
  }

  const handleFetchInsights = async () => {
    setInsightsLoading(true)
    try {
      const res = await getWorkspaceInsights()
      setInsights(res)
    } catch (err) {
      showToast(
        getApiErrorMessage(
          err,
          aiEnabled === false ? 'Не удалось собрать сводку' : 'Не удалось получить инсайты',
        ),
        'error',
      )
    } finally {
      setInsightsLoading(false)
    }
  }

  const computedTrends = useMemo(() => {
    if (trends.length > 0) return trends
    const byBoard: Record<string, { open: number; in_progress: number; done: number }> = {}
    items.forEach((it) => {
      if (!byBoard[it.board_id]) byBoard[it.board_id] = { open: 0, in_progress: 0, done: 0 }
      byBoard[it.board_id][it.status]++
    })
    return boards
      .filter((b) => byBoard[b.id])
      .map((b) => {
        const c = byBoard[b.id]
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
  }, [trends, items, boards])

  // Счётчики задач по доскам считаются из того же списка, что и вкладка «Задачи»:
  // смена статуса здесь же сразу видна на карточке доски, а перенесённые оригиналы
  // (их в списке нет) не дают второй «открытой» записи.
  const boardTaskStats = useMemo(() => {
    const stats = new Map<string, { total: number; open: number }>()
    for (const item of items) {
      const entry = stats.get(item.board_id) ?? { total: 0, open: 0 }
      entry.total += 1
      if (item.status !== 'done') entry.open += 1
      stats.set(item.board_id, entry)
    }
    return stats
  }, [items])

  const boardsWithLiveCounts = useMemo(
    () =>
      boards.map((b) => {
        const open = boardTaskStats.get(b.id)?.open ?? 0
        return b.action_items_open === open ? b : { ...b, action_items_open: open }
      }),
    [boards, boardTaskStats],
  )

  const hasMoodChart = moodTrends.some((m) => m.mood_avg !== null || m.cards_count > 0)

  const kpi = useMemo(() => {
    const open = items.filter((i) => i.status === 'open').length
    const inProgress = items.filter((i) => i.status === 'in_progress').length
    const done = items.filter((i) => i.status === 'done').length
    const moodRated = boards.filter((b) => typeof b.mood_avg === 'number')
    const moodAvg =
      moodRated.length > 0
        ? moodRated.reduce((s, b) => s + (b.mood_avg || 0), 0) / moodRated.length
        : null
    return {
      boardsCount: boards.length,
      // «Открытая» задача — любая незакрытая, как на карточках досок («N открыт.»):
      // вместе с выполненными счётчики дают общее число задач
      active: open + inProgress,
      inProgress,
      done,
      moodAvg,
    }
  }, [boards, items])

  const filteredItems = useMemo(() => {
    const q = assigneeFilter.trim().toLowerCase()
    return items.filter((it) => {
      if (statusFilter !== 'all' && it.status !== statusFilter) return false
      if (boardFilter !== 'all' && it.board_id !== boardFilter) return false
      if (
        q &&
        !(it.assignee || '').toLowerCase().includes(q) &&
        !(it.title || '').toLowerCase().includes(q) &&
        !it.text.toLowerCase().includes(q)
      ) {
        return false
      }
      return true
    })
  }, [items, statusFilter, boardFilter, assigneeFilter])

  const activeItems = useMemo(
    () => (statusFilter === 'all' ? filteredItems.filter((i) => i.status !== 'done') : filteredItems),
    [filteredItems, statusFilter],
  )
  const doneItems = useMemo(
    () => (statusFilter === 'all' ? filteredItems.filter((i) => i.status === 'done') : []),
    [filteredItems, statusFilter],
  )

  const toggleStatus = async (item: DashboardActionItem, explicitStatus?: ActionItemStatus) => {
    const next = explicitStatus ?? NEXT_STATUS[item.status]
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)))
    try {
      const updated = await updateActionItem(item.id, { status: next })
      setItems((prev) =>
        prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)),
      )
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))
      showToast(getApiErrorMessage(err, 'Не удалось обновить статус'), 'error')
    }
  }

  const saveTitle = async (id: string) => {
    setEditingTitleId(null)
    if (!editTitle.trim()) return
    try {
      const updated = await updateActionItem(id, { title: editTitle.trim() })
      setItems((prev) =>
        prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)),
      )
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось обновить название'), 'error')
    }
  }

  const saveDesc = async (id: string) => {
    setEditingDescId(null)
    if (!editDesc.trim()) return
    try {
      const updated = await updateActionItem(id, { text: editDesc.trim() })
      setItems((prev) =>
        prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)),
      )
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось обновить описание'), 'error')
    }
  }

  const saveAssignee = async (id: string) => {
    setEditAssigneeId(null)
    try {
      const updated = await updateActionItem(id, { assignee: editAssignee.trim() || null })
      setItems((prev) =>
        prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)),
      )
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось сохранить ответственного'), 'error')
    }
  }

  const confirmDeleteItem = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      await deleteActionItem(target.id)
      setItems((prev) => prev.filter((i) => i.id !== target.id))
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось удалить задачу'), 'error')
    }
  }

  const navigateToBoard = (b: { id: string; slug?: string | null }) => {
    router.push(`/board/${b.slug || b.id}`)
  }

  const renderBoardTasksBadge = (b: BoardListItem) => {
    const stats = boardTaskStats.get(b.id)
    if (!stats) {
      // Живых задач нет: либо их не заводили, либо все перенесены на другую доску
      return (
        <Badge variant="outline" className="text-xs text-muted-foreground">
          {b.action_items_total > 0 ? 'Задачи перенесены' : 'Нет задач'}
        </Badge>
      )
    }
    return (
      <Badge variant={stats.open > 0 ? 'warning' : 'success'} className="text-xs">
        {stats.open > 0 ? `${stats.open} открыт.` : 'Все задачи закрыты'}
      </Badge>
    )
  }

  const activeDragItem = useMemo(
    () => (activeDragId ? items.find((i) => i.id === activeDragId) ?? null : null),
    [activeDragId, items],
  )

  const handleKanbanDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
  }

  const handleKanbanDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null)
    if (!event.over) return
    const targetStatus = String(event.over.id) as ActionItemStatus
    if (targetStatus !== 'open' && targetStatus !== 'in_progress' && targetStatus !== 'done') {
      return
    }
    const dragged = items.find((i) => i.id === String(event.active.id))
    if (dragged && dragged.status !== targetStatus) {
      void toggleStatus(dragged, targetStatus)
    }
  }

  const renderTaskCard = (
    item: DashboardActionItem,
    kanbanMode = false,
    drag?: DragBindings,
    isOverlay = false,
  ) => {
    const meta = STATUS_META[item.status]
    const StatusIcon = meta.Icon
    const isDone = item.status === 'done'
    const isEditing =
      editingTitleId === item.id || editingDescId === item.id || editAssigneeId === item.id
    return (
      <div
        key={item.id}
        ref={drag?.setNodeRef}
        {...(drag && !isEditing ? drag.attributes : {})}
        {...(drag && !isEditing ? drag.listeners : {})}
        className={cn(
          'group rounded-xl border bg-card p-3.5 shadow-xs transition-all hover:shadow-md',
          isDone && 'opacity-75',
          drag?.isDragging && 'opacity-35 ring-1 ring-primary/40',
          isOverlay && 'rotate-1 scale-[1.02] shadow-2xl opacity-95 border-primary/40',
        )}
      >
        <div className="flex items-start gap-2">
          {kanbanMode && (
            <span
              data-testid={`kanban-drag-handle-${item.id}`}
              title="Перетащить задачу в другую колонку"
              aria-hidden="true"
              className="mt-0.5 flex h-4 w-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/55 transition-colors hover:bg-foreground/10 hover:text-foreground group-hover:text-muted-foreground active:cursor-grabbing dark:hover:bg-white/15"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          )}

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => toggleStatus(item)}
            title={`${meta.label} → ${STATUS_META[NEXT_STATUS[item.status]].label}`}
            className={cn('mt-0.5 shrink-0 transition-transform hover:scale-110', meta.colorClass)}
          >
            <StatusIcon className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1 space-y-1">
            {editingTitleId === item.id ? (
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => saveTitle(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle(item.id)
                  if (e.key === 'Escape') setEditingTitleId(null)
                }}
                autoFocus
                className="h-7 text-xs font-semibold"
              />
            ) : (
              <div
                onDoubleClick={() => {
                  setEditingTitleId(item.id)
                  setEditTitle(item.title || item.text)
                }}
                title="Двойной клик — редактировать"
                className={cn('cursor-text text-sm font-semibold leading-snug', isDone && 'line-through')}
              >
                <RichCardText text={item.title || item.text} />
              </div>
            )}

            {editingDescId === item.id ? (
              <Textarea
                autoResize
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onBlur={() => saveDesc(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) void saveDesc(item.id)
                  if (e.key === 'Escape') setEditingDescId(null)
                }}
                autoFocus
                className="min-h-[54px] text-xs"
              />
            ) : (
              <p
                onDoubleClick={() => {
                  setEditingDescId(item.id)
                  setEditDesc(item.text)
                }}
                title="Двойной клик — редактировать описание"
                className="cursor-text whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground"
              >
                <RichCardText text={item.text} />
              </p>
            )}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onPointerDown={(e) => e.stopPropagation()}
            className="h-7 w-7 opacity-80 sm:opacity-0 transition-opacity sm:group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteTarget(item)}
            title="Удалить"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {editAssigneeId === item.id ? (
              <Input
                value={editAssignee}
                onChange={(e) => setEditAssignee(e.target.value)}
                onBlur={() => saveAssignee(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveAssignee(item.id)
                  if (e.key === 'Escape') setEditAssigneeId(null)
                }}
                placeholder="Ответственный"
                autoFocus
                className="h-6 w-36 text-xs"
              />
            ) : (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setEditAssigneeId(item.id)
                  setEditAssignee(item.assignee || '')
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] hover:bg-accent"
              >
                {item.assignee ? (
                  <>
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full bg-linear-to-br/srgb text-[8px] font-bold text-white ${getUserAvatarGradient(item.assignee)}`}
                    >
                      {getUserInitials(item.assignee)}
                    </span>
                    <span>{item.assignee}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">+ Назначить</span>
                )}
              </button>
            )}

            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                const boardObj = boards.find((b) => b.id === item.board_id)
                navigateToBoard({ id: item.board_id, slug: boardObj?.slug })
              }}
              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              <span className="max-w-[140px] truncate">{item.board_name}</span>
            </button>

            <ActionItemExternalLink
              item={item}
              editDisabled={Boolean(item.superseded_by_id)}
              stopPointerDown
              onUpdated={(updated) =>
                setItems((prev) =>
                  prev.map((i) =>
                    i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i,
                  ),
                )
              }
            />
          </div>

          {kanbanMode && (
            <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
              {item.status !== 'open' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => toggleStatus(item, 'open')}
                >
                  Открыть
                </Button>
              )}
              {item.status !== 'in_progress' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => toggleStatus(item, 'in_progress')}
                >
                  В работу
                </Button>
              )}
              {item.status !== 'done' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] text-emerald-600 dark:text-emerald-400"
                  onClick={() => toggleStatus(item, 'done')}
                >
                  Готово
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (needsAuth || (hadWorkspace && !workspace)) {
    return (
      <WelcomeDialog
        onConfirm={(name) => {
          setUsername(name)
          void loadData()
        }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header: на телефоне подписи кнопок прячутся, чтобы всё уместилось в одну строку */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setBoardsPanelOpen(true)}
                  aria-label="Список досок"
                  data-testid="boards-drawer-btn"
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Список досок</TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5 px-2 sm:px-3"
              onClick={() => router.push('/')}
              aria-label="К доске"
              title="К доске"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">К доске</span>
            </Button>
            <div className="hidden h-4 w-px bg-border sm:block" />
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="hidden shrink-0 sm:inline-flex">
                <BrandMark size={28} />
              </span>
              <span className="truncate font-semibold tracking-tight">Панель управления</span>
            </div>
            {workspace && (
              <Badge variant="outline" className="hidden max-w-[220px] truncate md:inline-flex">
                {workspace.workspaceName}
              </Badge>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="relative"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Переключить тему"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 px-2.5 sm:px-3"
              onClick={() => setCreateBoardOpen(true)}
              aria-label="Новая доска"
              title="Новая доска"
              data-testid="dashboard-new-board-btn"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Новая доска</span>
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 px-2.5"
                  onClick={() => setTeamSettingsOpen(true)}
                  aria-label="Настройки команды: токены агентов"
                  data-testid="team-settings-btn"
                >
                  <Bot className="h-4 w-4 text-primary" />
                  <span className="hidden md:inline">Токены агентов</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Настройки команды · Токены агентов (MCP)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setUserSettingsOpen(true)}
                  aria-label="Профиль и настройки"
                  data-testid="user-settings-btn"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br/srgb text-xs font-bold text-white shadow-xs ring-offset-background transition-transform hover:scale-105 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${getUserAvatarGradient(
                    avatarSeed(participant?.id, username),
                  )}`}
                >
                  {getUserInitials(username)}
                </button>
              </TooltipTrigger>
              <TooltipContent>{username}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Загружаем отчёты...</p>
          </div>
        ) : error ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button onClick={loadData}>Повторить</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* KPI Summary Grid */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0 }}
              >
                <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-2 p-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Доски команды</p>
                      <p className="mt-1 font-mono text-2xl font-bold">{kpi.boardsCount}</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Layers className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.05 }}
              >
                <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-2 p-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Открытых задач</p>
                      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                        <span
                          className="font-mono text-2xl font-bold text-amber-600 dark:text-amber-400"
                          data-testid="kpi-open-tasks"
                        >
                          {kpi.active}
                        </span>
                        {kpi.inProgress > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            в работе: {kpi.inProgress}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <Circle className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.1 }}
              >
                <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-2 p-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Выполнено задач</p>
                      <p className="mt-1 font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                        {kpi.done}
                      </p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.15 }}
              >
                <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-2 p-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Индекс настроения</p>
                      <p className="mt-1 font-mono text-2xl font-bold">
                        {kpi.moodAvg !== null ? `${kpi.moodAvg.toFixed(1)}/5` : '—'}
                      </p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
                      <HeartPulse className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            {/* Анализ между спринтами: вывод по доскам и темы команды */}
            <WorkspaceInsightsCard
              insights={insights}
              loading={insightsLoading}
              onRefresh={handleFetchInsights}
              aiEnabled={aiEnabled}
            />
            <TeamThemesCard
              themes={themes}
              error={themesError}
              onRetry={loadData}
              aiEnabled={aiEnabled}
            />

            {/* Charts */}
            {(computedTrends.length > 0 || hasMoodChart || boards.length > 0) && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {computedTrends.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">Динамика задач</CardTitle>
                      <CardDescription className="text-xs">
                        Соотношение открытых, активных и завершённых задач по спринтам
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <TrendChart data={computedTrends} />
                    </CardContent>
                  </Card>
                )}

                {hasMoodChart && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">Настроение команды</CardTitle>
                      <CardDescription className="text-xs">
                        Средняя оценка чек-ина настроения по ретроспективам (от 1 до 5)
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <MoodTrendChart data={moodTrends} />
                    </CardContent>
                  </Card>
                )}

                {boards.length > 0 && (
                  <Card className="lg:col-span-2" data-testid="health-trends-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                        <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
                        Health check команды
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Средний ответ по каждому вопросу от 1 (плохо) до 3 (хорошо) и средняя оценка
                        встречи от 1 до 5
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {healthTrends.length > 0 ? (
                        <HealthTrendsChart questions={healthQuestions} points={healthTrends} />
                      ) : (
                        <p className="rounded-xl border border-dashed p-3.5 text-sm text-muted-foreground">
                          Ответов пока нет. Когда команда пройдёт health check на доске — пять
                          вопросов со светофором и оценка встречи, — здесь появится динамика от
                          спринта к спринту.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Tabs: Задачи vs Доски */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'tasks' | 'boards')}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList>
                  <TabsTrigger value="tasks" className="gap-1.5">
                    <ListTodo className="h-4 w-4" />
                    Задачи ({items.length})
                  </TabsTrigger>
                  <TabsTrigger value="boards" className="gap-1.5">
                    <Layers className="h-4 w-4" />
                    Доски ({boards.length})
                  </TabsTrigger>
                </TabsList>

                {boards.length >= 2 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setCarryOpen(true)}
                  >
                    <Repeat className="h-4 w-4" />
                    Перенести незакрытые
                  </Button>
                )}
              </div>

              <TabsContent value="tasks" className="space-y-4">
                {/* Filter & View Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-52">
                      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={assigneeFilter}
                        onChange={(e) => setAssigneeFilter(e.target.value)}
                        placeholder="Поиск по задаче или имени..."
                        className="h-8 pl-8 text-xs"
                      />
                    </div>

                    {viewMode === 'list' && (
                      <Select
                        value={statusFilter}
                        onValueChange={(v) => setStatusFilter(v as 'all' | ActionItemStatus)}
                      >
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Все статусы</SelectItem>
                          <SelectItem value="open">Открыто</SelectItem>
                          <SelectItem value="in_progress">В работе</SelectItem>
                          <SelectItem value="done">Выполнено</SelectItem>
                        </SelectContent>
                      </Select>
                    )}

                    <Select value={boardFilter} onValueChange={setBoardFilter}>
                      <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue placeholder="Все доски" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все доски</SelectItem>
                        {boards.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="relative isolate flex items-center rounded-lg border bg-muted/50 p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      className={cn(
                        'relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        viewMode === 'list'
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {viewMode === 'list' && (
                        <motion.span
                          layoutId="dashboard-view-pill"
                          transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                          className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-background shadow-xs"
                          aria-hidden="true"
                        />
                      )}
                      <List className="h-3.5 w-3.5" />
                      Список
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('kanban')}
                      className={cn(
                        'relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        viewMode === 'kanban'
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {viewMode === 'kanban' && (
                        <motion.span
                          layoutId="dashboard-view-pill"
                          transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                          className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-background shadow-xs"
                          aria-hidden="true"
                        />
                      )}
                      <Kanban className="h-3.5 w-3.5" />
                      Канбан
                    </button>
                  </div>
                </div>

                {viewMode === 'kanban' ? (
                  <DndContext
                    sensors={kanbanSensors}
                    onDragStart={handleKanbanDragStart}
                    onDragEnd={handleKanbanDragEnd}
                  >
                    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
                      {(['open', 'in_progress', 'done'] as ActionItemStatus[]).map((st) => {
                        const colItems = filteredItems.filter((i) => i.status === st)
                        const meta = STATUS_META[st]
                        const isCollapsed = collapsedKanbanCols[st]
                        const isExpanded = expandedKanbanCols[st]
                        const visibleItems = isExpanded
                          ? colItems
                          : colItems.slice(0, KANBAN_VISIBLE_LIMIT)
                        const hiddenCount = colItems.length - visibleItems.length

                        return (
                          <KanbanColumnDropzone
                            key={st}
                            status={st}
                            count={colItems.length}
                            meta={meta}
                            collapsed={isCollapsed}
                            onToggleCollapse={() =>
                              setCollapsedKanbanCols((prev) => ({ ...prev, [st]: !prev[st] }))
                            }
                          >
                            <div className="space-y-2.5">
                              {colItems.length === 0 ? (
                                <div className="rounded-xl border border-dashed py-8 text-center text-xs text-muted-foreground">
                                  Перетащите задачу сюда
                                </div>
                              ) : (
                                <>
                                  {visibleItems.map((it) => (
                                    <KanbanDraggableCard
                                      key={it.id}
                                      item={it}
                                      dragDisabled={
                                        editingTitleId === it.id ||
                                        editingDescId === it.id ||
                                        editAssigneeId === it.id
                                      }
                                      renderCard={renderTaskCard}
                                    />
                                  ))}
                                  {(hiddenCount > 0 ||
                                    (isExpanded && colItems.length > KANBAN_VISIBLE_LIMIT)) && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 w-full text-xs text-muted-foreground hover:text-foreground"
                                      onClick={() =>
                                        setExpandedKanbanCols((prev) => ({
                                          ...prev,
                                          [st]: !prev[st],
                                        }))
                                      }
                                    >
                                      {isExpanded
                                        ? 'Свернуть список'
                                        : `Показать ещё ${hiddenCount}`}
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </KanbanColumnDropzone>
                        )
                      })}
                    </div>

                    <DragOverlay>
                      {activeDragItem ? renderTaskCard(activeDragItem, true, undefined, true) : null}
                    </DragOverlay>
                  </DndContext>
                ) : (
                  <div className="space-y-4">
                    {activeItems.length === 0 && doneItems.length === 0 ? (
                      <Card>
                        <CardContent className="py-12 text-center text-sm text-muted-foreground">
                          Задач по выбранным фильтрам не найдено
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {activeItems.map((it) => renderTaskCard(it))}
                      </div>
                    )}

                    {doneItems.length > 0 && (
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => setDoneCollapsed((prev) => !prev)}
                          className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                        >
                          <span>
                            {doneCollapsed ? '▶' : '▼'} Завершённые ({doneItems.length})
                          </span>
                        </button>
                        {!doneCollapsed && (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {doneItems.map((it) => renderTaskCard(it))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="boards">
                {boards.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                      <Layers className="h-9 w-9 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground">Пока нет досок</p>
                      <Button size="sm" onClick={() => setCreateBoardOpen(true)}>
                        <Plus className="h-4 w-4" />
                        Создать первую доску
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {boards.map((b) => (
                    <Card
                      key={b.id}
                      data-testid={`board-card-${b.id}`}
                      className="group flex flex-col justify-between transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="flex items-center gap-1.5 text-base leading-snug">
                            {b.is_locked && (
                              <Lock className="h-4 w-4 shrink-0 text-amber-500" />
                            )}
                            <span>{b.name}</span>
                          </CardTitle>
                          {b.has_summary && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="h-7 w-7 shrink-0 text-primary"
                              title="AI-итоги"
                              aria-label={`AI-итоги доски «${b.name}»`}
                              disabled={summaryOpeningId !== null}
                              onClick={() => openBoardSummary(b)}
                              data-testid={`board-summary-btn-${b.id}`}
                            >
                              {summaryOpeningId === b.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Sparkles className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                        <CardDescription className="text-xs">
                          {new Date(b.created_at).toLocaleDateString('ru-RU', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </CardDescription>
                      </CardHeader>

                      <CardContent className="space-y-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {typeof b.cards_count === 'number' && (
                            <Badge variant="outline" className="text-xs">
                              {b.cards_count} карт.
                            </Badge>
                          )}
                          {renderBoardTasksBadge(b)}
                          {b.mood_avg != null && (
                            <Badge variant="secondary" className="font-mono text-xs">
                              😊 {b.mood_avg.toFixed(1)}/5
                            </Badge>
                          )}
                        </div>

                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full justify-between"
                          onClick={() => navigateToBoard(b)}
                        >
                          <span>Открыть доску</span>
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>

      <CreateBoardDialog
        open={createBoardOpen}
        onOpenChange={setCreateBoardOpen}
        existingBoards={boards}
        onCreated={(created) => {
          setBoards((prev) => [boardToBoardListItem(created), ...prev])
          navigateToBoard(created)
        }}
      />

      <CarryForwardDialog
        open={carryOpen}
        onOpenChange={setCarryOpen}
        boards={boardsWithLiveCounts}
        onCarried={() => loadData()}
      />

      <BoardsPanel
        open={boardsPanelOpen}
        onOpenChange={setBoardsPanelOpen}
        boards={boardsWithLiveCounts}
        currentBoardId={currentBoardId}
        onSelectBoard={navigateToBoard}
        onOpenCreateBoard={() => setCreateBoardOpen(true)}
        onNavigateDashboard={() => setBoardsPanelOpen(false)}
      />

      <UserSettingsDialog open={userSettingsOpen} onOpenChange={setUserSettingsOpen} />

      <AgentTokensDialog
        open={teamSettingsOpen}
        onOpenChange={setTeamSettingsOpen}
        teamLabel={workspace?.workspaceName}
        subtitle="Настройки команды"
        adapter={agentTokensAdapter}
      />

      {summaryModalBoard && (
        <SummaryModal
          open={Boolean(summaryModalBoard)}
          onOpenChange={(open) => !open && setSummaryModalBoard(null)}
          board={summaryModalBoard}
          actionItems={items.filter((i) => i.board_id === summaryModalBoard.id)}
          summary={summaryData}
          loading={summaryLoading}
          error={summaryError}
          onSummaryUpdated={(s) => {
            setSummaryData(s)
            setBoards((prev) =>
              prev.map((b) => (b.id === s.board_id ? { ...b, has_summary: true } : b)),
            )
          }}
        />
      )}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить задачу?</AlertDialogTitle>
            <AlertDialogDescription>
              Задача «{deleteTarget?.title || deleteTarget?.text}» будет удалена безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteItem}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
