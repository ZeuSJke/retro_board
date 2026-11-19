'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { motion } from 'motion/react'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Circle,
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
} from 'lucide-react'
import {
  createActionItem,
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
import { useWebSocket, type WsOpenInfo } from '../hooks/useWebSocket'
import {
  ACTION_ITEM_NEXT_STATUS,
  restoreDeletedActionItem,
  withoutCarriedOriginals,
} from '@/lib/action-items'
import { queryKeys } from '../lib/query-client'
import { parseSafeExternalUrl } from '@/lib/urls'
import { useOpeningCount } from '@/lib/use-opening-count'
import { showToast } from '../store/toastStore'
import { getApiErrorMessage, getApiErrorStatus, markApiErrorReported, quietQuery } from '../utils/apiError'
import { boardToBoardListItem } from '../utils/boardMapper'
import { isBoardListItem, isBoardUpdatedData, isDeletedData } from '../utils/wsData'
import { getUserAvatarGradient, getUserInitials } from '@/lib/board-themes'
import { avatarSeed } from '@/lib/participants'
import type {
  ActionItem,
  ActionItemStatus,
  Board,
  BoardListItem,
  BoardSummary,
  DashboardActionItem,
  MoodTrendPoint,
  TrendPoint,
  WorkspaceInsights,
  WsMessage,
} from '../types'
import type { HealthTrendPoint } from '../types/health'
import ActionItemCard from './action-items/ActionItemCard'
import ActionItemsKanban from './action-items/ActionItemsKanban'
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
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { BrandMark } from '@/components/BrandLogo'

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

interface CreateTaskFormProps {
  boards: BoardListItem[]
  defaultBoardId: string
  onCancel: () => void
  onCreated: (item: DashboardActionItem) => void
}

function CreateTaskForm({ boards, defaultBoardId, onCancel, onCreated }: CreateTaskFormProps) {
  const [boardId, setBoardId] = useState(defaultBoardId)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [assignee, setAssignee] = useState('')
  const [status, setStatus] = useState<ActionItemStatus>('open')
  const [externalUrl, setExternalUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedText = text.trim()
    const trimmedUrl = externalUrl.trim()
    if (!trimmedText || !boardId || saving) return
    if (trimmedUrl && !parseSafeExternalUrl(trimmedUrl)) {
      setUrlError('Укажите корректную ссылку http:// или https://')
      return
    }
    setSaving(true)
    setUrlError(null)
    try {
      const created = await createActionItem({
        board_id: boardId,
        title: title.trim() || undefined,
        text: trimmedText,
        assignee: assignee.trim() || undefined,
        status,
        external_url: trimmedUrl || undefined,
      })
      const boardName = boards.find((b) => b.id === boardId)?.name ?? ''
      onCreated({ ...created, board_name: boardName })
      showToast('Задача создана', 'success')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось создать задачу'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-primary" />
          Новая задача
        </DialogTitle>
        <DialogDescription>
          Создайте задачу команды и привяжите её к доске ретроспективы.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-task-board">Доска</Label>
            <Select value={boardId} onValueChange={setBoardId}>
              <SelectTrigger id="new-task-board">
                <SelectValue placeholder="Выберите доску" />
              </SelectTrigger>
              <SelectContent>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-task-status">Статус</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ActionItemStatus)}>
              <SelectTrigger id="new-task-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Открыто</SelectItem>
                <SelectItem value="in_progress">В работе</SelectItem>
                <SelectItem value="done">Выполнено</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-task-title">Заголовок</Label>
          <Input
            id="new-task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Краткое название (необязательно)"
            maxLength={200}
            autoFocus
            data-testid="new-task-title-input"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-task-text">Описание</Label>
          <Textarea
            id="new-task-text"
            autoResize
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Что именно нужно сделать и какой ожидаемый результат..."
            maxLength={1000}
            className="min-h-[84px]"
            data-testid="new-task-text-input"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-task-assignee">Ответственный</Label>
            <Input
              id="new-task-assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Имя участника"
              maxLength={80}
              data-testid="new-task-assignee-input"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-task-url">Внешняя ссылка</Label>
            <Input
              id="new-task-url"
              value={externalUrl}
              onChange={(e) => {
                setExternalUrl(e.target.value)
                if (urlError) setUrlError(null)
              }}
              placeholder="https://tracker.company.ru/TASK-1"
              data-testid="new-task-url-input"
            />
            {urlError && <p className="text-[11px] text-destructive">{urlError}</p>}
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Отмена
        </Button>
        <Button
          type="submit"
          disabled={!text.trim() || !boardId || saving}
          data-testid="new-task-submit-btn"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Создаём...
            </>
          ) : (
            'Создать задачу'
          )}
        </Button>
      </DialogFooter>
    </form>
  )
}

export default function Dashboard() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const isDark = (resolvedTheme ?? theme) === 'dark'
  const workspace = useAppStore((s) => s.workspace)
  const participant = useAppStore((s) => s.participant)
  const savedName = useAppStore((s) => s.username)
  const currentBoardId = useAppStore((s) => s.currentBoardId)
  // Настроен ли AI на сервере: приходит из /workspaces/me (см. loadData); null — ещё не знаем
  const aiEnabled = useAppStore((s) => s.aiEnabled)
  const setUsername = useAppStore((s) => s.setUsername)
  const hasHydrated = useAppStore((s) => s._hasHydrated ?? true)
  const username = participant?.name ?? savedName

  const [insights, setInsights] = useState<WorkspaceInsights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)

  // Была ли на этой странице сессия: если она пропала (выход, ответ 401) — показываем вход.
  // Значение выводится из стора прямо при рендере, без эффекта.
  const [hadWorkspace, setHadWorkspace] = useState(Boolean(workspace))
  if (workspace && !hadWorkspace) setHadWorkspace(true)

  const workspaceId = workspace?.workspaceId ?? 'anonymous'
  const queriesEnabled = hasHydrated && Boolean(workspace && participant)
  const boardsKey = useMemo(() => queryKeys.boards(workspaceId), [workspaceId])
  const itemsKey = useMemo(
    () => queryKeys.dashboardActionItems(workspaceId, { status: 'all', boardId: 'all', assignee: '' }),
    [workspaceId],
  )
  const trendsKey = useMemo(() => queryKeys.dashboardTrends(workspaceId), [workspaceId])
  const moodTrendsKey = useMemo(() => queryKeys.dashboardMoodTrends(workspaceId), [workspaceId])
  const healthTrendsKey = useMemo(() => queryKeys.dashboardHealthTrends(workspaceId), [workspaceId])
  const themesKey = useMemo(() => queryKeys.dashboardThemes(workspaceId), [workspaceId])
  const healthQuestionsKey = useMemo(
    () => ['dashboard', workspaceId, 'health-questions'] as const,
    [workspaceId],
  )

  const [activeTab, setActiveTab] = useState<'tasks' | 'boards'>('tasks')
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list')
  const [statusFilter, setStatusFilter] = useState<'all' | ActionItemStatus>('all')
  const [boardFilter, setBoardFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('')
  const [doneCollapsed, setDoneCollapsed] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<DashboardActionItem | null>(null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const newTaskOpening = useOpeningCount(newTaskOpen)

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

  // Сверка сессии с сервером: участник, команда и признак ai_enabled попадают в стор.
  // Данные дашборда её не ждут; при 401 перехватчик сам сбросит сессию.
  useEffect(() => {
    if (!queriesEnabled) return
    void refreshWorkspaceSession().catch(markApiErrorReported)
  }, [queriesEnabled, workspaceId])

  const boardsQuery = useQuery({
    queryKey: boardsKey,
    queryFn: quietQuery(getBoards),
    enabled: queriesEnabled,
  })
  const itemsQuery = useQuery({
    queryKey: itemsKey,
    queryFn: quietQuery(async () => withoutCarriedOriginals(await getAllActionItems())),
    enabled: queriesEnabled,
  })
  const trendsQuery = useQuery({
    queryKey: trendsKey,
    queryFn: quietQuery(getActionItemTrends),
    enabled: queriesEnabled,
  })
  const moodTrendsQuery = useQuery({
    queryKey: moodTrendsKey,
    queryFn: quietQuery(getMoodTrends),
    enabled: queriesEnabled,
  })
  const healthTrendsQuery = useQuery({
    queryKey: healthTrendsKey,
    queryFn: quietQuery(getHealthTrends),
    enabled: queriesEnabled,
  })
  const healthQuestionsQuery = useQuery({
    queryKey: healthQuestionsKey,
    queryFn: quietQuery(getHealthQuestions),
    enabled: queriesEnabled,
  })
  const themesQuery = useQuery({
    queryKey: themesKey,
    queryFn: quietQuery(getTeamThemes),
    enabled: queriesEnabled,
  })

  const boards = useMemo(() => boardsQuery.data ?? [], [boardsQuery.data])
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data])
  const trends = useMemo(() => trendsQuery.data ?? [], [trendsQuery.data])
  const moodTrends = useMemo(() => moodTrendsQuery.data ?? [], [moodTrendsQuery.data])
  const healthTrends = useMemo(() => healthTrendsQuery.data ?? [], [healthTrendsQuery.data])
  const healthQuestions = useMemo(() => healthQuestionsQuery.data ?? [], [healthQuestionsQuery.data])
  const themes = useMemo(() => themesQuery.data ?? [], [themesQuery.data])
  const themesError = themesQuery.isError
  const { refetch: refetchThemes } = themesQuery

  const setBoards = useCallback(
    (updater: (prev: BoardListItem[]) => BoardListItem[]) => {
      queryClient.setQueryData<BoardListItem[]>(boardsKey, (prev = []) => updater(prev))
    },
    [queryClient, boardsKey],
  )
  const setItems = useCallback(
    (updater: (prev: DashboardActionItem[]) => DashboardActionItem[]) => {
      queryClient.setQueryData<DashboardActionItem[]>(itemsKey, (prev = []) => updater(prev))
    },
    [queryClient, itemsKey],
  )

  const primaryError = boardsQuery.error ?? itemsQuery.error
  const authError = primaryError !== null && getApiErrorStatus(primaryError) === 401
  const needsAuth =
    (hasHydrated && (!workspace || !participant)) ||
    (hadWorkspace && (!workspace || !participant)) ||
    authError
  // До гидрации стора и до первого ответа не показываем нулевые счётчики.
  const loading =
    !hasHydrated ||
    (queriesEnabled && (boardsQuery.isPending || itemsQuery.isPending))
  const error =
    primaryError && !authError
      ? getApiErrorMessage(primaryError, 'Не удалось загрузить аналитику')
      : null

  const loadData = useCallback(async () => {
    const wsId = useAppStore.getState().workspace?.workspaceId
    if (!wsId) return
    void refreshWorkspaceSession().catch(markApiErrorReported)
    await Promise.all([
      queryClient.refetchQueries({ queryKey: queryKeys.boards(wsId) }),
      queryClient.refetchQueries({ queryKey: ['dashboard', wsId] }),
    ])
  }, [queryClient])

  const handleWorkspaceWs = useCallback(
    (msg: WsMessage) => {
      if (msg.event === 'board_created') {
        if (!isBoardListItem(msg.data)) return
        const created = msg.data
        setBoards((prev) => (prev.some((b) => b.id === created.id) ? prev : [created, ...prev]))
      } else if (msg.event === 'board_updated') {
        if (!isBoardUpdatedData(msg.data)) return
        const updated = msg.data
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
        if (!isDeletedData(msg.data)) return
        const deletedId = msg.data.id
        // Вместе с доской уходят её задачи и точки на графиках
        setBoards((prev) => prev.filter((b) => b.id !== deletedId))
        setItems((prev) => prev.filter((i) => i.board_id !== deletedId))
        setSummaryModalBoard((prev) => (prev?.id === deletedId ? null : prev))
        queryClient.setQueryData<TrendPoint[]>(trendsKey, (prev = []) =>
          prev.filter((t) => t.board_id !== deletedId),
        )
        queryClient.setQueryData<MoodTrendPoint[]>(moodTrendsKey, (prev = []) =>
          prev.filter((m) => m.board_id !== deletedId),
        )
        queryClient.setQueryData<HealthTrendPoint[]>(healthTrendsKey, (prev = []) =>
          prev.filter((h) => h.board_id !== deletedId),
        )
        void queryClient.invalidateQueries({ queryKey: themesKey })
      }
    },
    [queryClient, setBoards, setItems, trendsKey, moodTrendsKey, healthTrendsKey, themesKey],
  )

  const handleWorkspaceOpen = useCallback(
    (info: WsOpenInfo) => {
      if (info.reconnected) void loadData()
    },
    [loadData],
  )

  useWebSocket('workspace', handleWorkspaceWs, handleWorkspaceOpen, { expectPong: true })

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

  // Настроение больше не собираем на доске: показываем только историю старых досок
  const hasMoodChart = moodTrends.some((m) => m.mood_avg !== null)

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
    const next = explicitStatus ?? ACTION_ITEM_NEXT_STATUS[item.status]
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)))
    try {
      const updated = await updateActionItem(item.id, { status: next })
      setItems((prev) =>
        prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)),
      )
      void queryClient.invalidateQueries({ queryKey: trendsKey })
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))
      showToast(getApiErrorMessage(err, 'Не удалось обновить статус'), 'error')
    }
  }

  const saveTitle = async (id: string, nextTitle: string) => {
    const trimmed = nextTitle.trim()
    if (!trimmed) return
    try {
      const updated = await updateActionItem(id, { title: trimmed })
      setItems((prev) =>
        prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)),
      )
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось обновить название'), 'error')
    }
  }

  const saveDesc = async (id: string, nextText: string) => {
    const trimmed = nextText.trim()
    if (!trimmed) return
    try {
      const updated = await updateActionItem(id, { text: trimmed })
      setItems((prev) =>
        prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)),
      )
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось обновить описание'), 'error')
    }
  }

  const saveAssignee = async (id: string, nextAssignee: string | null) => {
    try {
      const updated = await updateActionItem(id, { assignee: nextAssignee })
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
      void queryClient.invalidateQueries({ queryKey: trendsKey })
      void queryClient.invalidateQueries({ queryKey: boardsKey })
      showToast('Задача удалена', 'info', {
        duration: 5000,
        action: {
          label: 'Отменить',
          onClick: () => {
            void (async () => {
              try {
                const restored = await restoreDeletedActionItem(target)
                setItems((prev) => [
                  { ...restored, board_name: target.board_name },
                  ...prev.filter((i) => i.id !== restored.id),
                ])
                void queryClient.invalidateQueries({ queryKey: trendsKey })
                void queryClient.invalidateQueries({ queryKey: boardsKey })
              } catch (restoreErr) {
                showToast(
                  getApiErrorMessage(restoreErr, 'Не удалось восстановить задачу'),
                  'error',
                )
              }
            })()
          },
        },
      })
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

  const handleExternalLinkUpdated = (updated: ActionItem) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i,
      ),
    )
  }

  const handleNavigateBoardById = (targetBoardId: string) => {
    const boardObj = boards.find((b) => b.id === targetBoardId)
    navigateToBoard({ id: targetBoardId, slug: boardObj?.slug })
  }

  const renderListTaskCard = (item: DashboardActionItem) => (
    <ActionItemCard
      key={item.id}
      item={item}
      onStatusChange={toggleStatus}
      onSaveTitle={saveTitle}
      onSaveText={saveDesc}
      onSaveAssignee={saveAssignee}
      onDelete={setDeleteTarget}
      onExternalLinkUpdated={handleExternalLinkUpdated}
      onNavigateBoard={handleNavigateBoardById}
    />
  )

  if (needsAuth) {
    return (
      <WelcomeDialog
        onConfirm={(name) => {
          setUsername(name)
          const wsId = useAppStore.getState().workspace?.workspaceId
          if (wsId) {
            void queryClient.resetQueries({ queryKey: queryKeys.boards(wsId) })
            void queryClient.resetQueries({ queryKey: ['dashboard', wsId] })
          }
        }}
      />
    )
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
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
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
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
            {/* Compact KPI Summary Grid */}
            <div
              className={cn(
                'grid grid-cols-2 gap-3',
                kpi.moodAvg !== null ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
              )}
            >
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0 }}
              >
                <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-2 p-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Доски команды</p>
                      <p className="mt-0.5 font-mono text-2xl font-bold">{kpi.boardsCount}</p>
                    </div>
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Layers className="h-4.5 w-4.5" />
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
                  <CardContent className="flex items-center justify-between gap-2 p-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Открытых задач</p>
                      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
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
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <Circle className="h-4.5 w-4.5" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.1 }}
                className={cn(kpi.moodAvg === null && 'col-span-2 lg:col-span-1')}
              >
                <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-2 p-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Выполнено задач</p>
                      <p className="mt-0.5 font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                        {kpi.done}
                      </p>
                    </div>
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-4.5 w-4.5" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {kpi.moodAvg !== null && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: 0.15 }}
                >
                  <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
                    <CardContent className="flex items-center justify-between gap-2 p-3">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Индекс настроения
                        </p>
                        <p className="mt-0.5 font-mono text-2xl font-bold">
                          {kpi.moodAvg.toFixed(1)}/5
                        </p>
                      </div>
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
                        <HeartPulse className="h-4.5 w-4.5" />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </div>

            {/* Tabs: Задачи vs Доски — главный рабочий экран команды */}
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

                <div className="flex flex-wrap items-center gap-2">
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

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs"
                      disabled={boards.length === 0}
                      onClick={() => setNewTaskOpen(true)}
                      data-testid="dashboard-new-task-btn"
                    >
                      <Plus className="h-3.5 w-3.5 text-primary" />
                      Новая задача
                    </Button>

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
                </div>

                {viewMode === 'kanban' ? (
                  <ActionItemsKanban
                    items={filteredItems}
                    onStatusChange={toggleStatus}
                    onSaveTitle={saveTitle}
                    onSaveText={saveDesc}
                    onSaveAssignee={saveAssignee}
                    onDelete={setDeleteTarget}
                    onExternalLinkUpdated={handleExternalLinkUpdated}
                    onNavigateBoard={handleNavigateBoardById}
                  />
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
                        {activeItems.map((it) => renderListTaskCard(it))}
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
                            {doneItems.map((it) => renderListTaskCard(it))}
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

            {/* Компактная аналитика: вывод по спринтам, темы команды и графики динамики */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <WorkspaceInsightsCard
                  insights={insights}
                  loading={insightsLoading}
                  onRefresh={handleFetchInsights}
                  aiEnabled={aiEnabled}
                />
                <TeamThemesCard
                  themes={themes}
                  error={themesError}
                  onRetry={() => void refetchThemes()}
                  aiEnabled={aiEnabled}
                />
              </div>

              {(computedTrends.length > 0 || hasMoodChart || boards.length > 0) && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {boards.length > 0 && (
                    <Card
                      className={cn(computedTrends.length === 0 && !hasMoodChart && 'lg:col-span-2')}
                      data-testid="health-trends-card"
                    >
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                          <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
                          Здоровье команды
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Средний ответ по каждому вопросу от 1 (плохо) до 3 (хорошо) и средняя оценка
                          встречи от 1 до 5
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {healthTrends.length > 0 ? (
                          <HealthTrendsChart
                            questions={healthQuestions}
                            points={healthTrends}
                            wide={computedTrends.length === 0 && !hasMoodChart}
                          />
                        ) : (
                          <p className="rounded-xl border border-dashed p-3.5 text-sm text-muted-foreground">
                            Ответов пока нет. Когда команда пройдёт опрос «Здоровье команды» на
                            доске — пять вопросов со светофором и оценка встречи, — здесь появится
                            динамика от спринта к спринту.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}

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
                          Историческая средняя оценка настроения по ретроспективам (от 1 до 5)
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <MoodTrendChart data={moodTrends} />
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <Dialog open={newTaskOpen} onOpenChange={setNewTaskOpen}>
        <DialogContent layout="structured" className="max-w-lg" data-testid="new-task-dialog">
          {newTaskOpening > 0 && (
            <CreateTaskForm
              key={newTaskOpening}
              boards={boards}
              defaultBoardId={boardFilter !== 'all' ? boardFilter : boards[0]?.id ?? ''}
              onCancel={() => setNewTaskOpen(false)}
              onCreated={(created) => {
                setNewTaskOpen(false)
                setItems((prev) => [created, ...prev])
                void queryClient.invalidateQueries({ queryKey: trendsKey })
                void queryClient.invalidateQueries({ queryKey: boardsKey })
              }}
            />
          )}
        </DialogContent>
      </Dialog>

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
