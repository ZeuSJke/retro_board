import axios, { type AxiosError } from 'axios'
import type {
  ActionItem,
  ActionItemStatus,
  ActionItemSuggestion,
  AutoClusterPreviewResult,
  Board,
  BoardCreatePayload,
  BoardListItem,
  BoardSummary,
  BoardTemplateInfo,
  BoardUpdatePayload,
  Card,
  CardGroup,
  CarryForwardRequest,
  Column,
  ColumnInfo,
  DashboardActionItem,
  MoodTrendPoint,
  Participant,
  SessionInfo,
  TrendPoint,
  WorkspaceInsights,
  WorkspaceMe,
} from '../types'
import { showToast } from '../store/toastStore'
import { useAppStore } from '../store'
import { isApiErrorReported, RATE_LIMIT_MESSAGE } from '../utils/apiError'

export const DEFAULT_API_TIMEOUT_MS = 15_000
// Верхний предел ожидания на сервере: очередь к модели (15 с) + 2 попытки по 90 с + пауза (0.5 с) = 195.5 с.
export const AI_API_TIMEOUT_MS = 210_000

/** Общий HTTP-клиент команды: CSRF-заголовок, сброс сессии по 401, запасной тост об ошибке. */
export const api = axios.create({ baseURL: '/api', timeout: DEFAULT_API_TIMEOUT_MS })

export function getCsrfToken(): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)
  return match ? match[1] : ''
}

export function handleCommonHttpError(status?: number, detail = ''): void {
  if (status === 429) {
    showToast(RATE_LIMIT_MESSAGE, 'error')
  } else if (status === 423) {
    showToast(detail || 'Доска заблокирована для изменений', 'error')
  } else if (status === 403) {
    showToast(detail || 'Доступ запрещён', 'error')
  } else if (status && status >= 500) {
    showToast('Что-то пошло не так', 'error')
  }
}

// Сессия — в httpOnly-cookie `workspace_token`: браузер сам прикладывает её к запросам
// того же origin, поэтому токена нет ни в сторе, ни в заголовках.
api.interceptors.request.use((config) => {
  if (config.method && !['get', 'head', 'options'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = getCsrfToken()
  }
  return config
})

/** Запросы, которые сами начинают сессию: их 401 — «неверный ключ», а не «сессия истекла». */
const SESSION_ENTRY_URLS = ['/workspaces/login', '/workspaces/join']

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ detail?: string }>) => {
    const status = error.response?.status
    const detail = error.response?.data?.detail || ''
    const reqUrl = String(error.config?.url || '')

    if (status === 401) {
      // Сессии нет или она отозвана (в том числе выданная до появления участников):
      // забываем её — приложение покажет экран входа. Тостов здесь нет.
      if (!SESSION_ENTRY_URLS.some((url) => reqUrl.includes(url))) {
        useAppStore.getState().clearSession()
      }
      return Promise.reject(error)
    }

    // Общий тост — запасной вариант. Обработчик вызывающего кода выполнится раньше этого
    // таймера; если он сам показал сообщение (getApiErrorMessage помечает ошибку),
    // второго тоста не будет.
    setTimeout(() => {
      if (!isApiErrorReported(error)) handleCommonHttpError(status, detail)
    }, 0)
    return Promise.reject(error)
  },
)

// ── Boards ──────────────────────────────────────────────────────────────────
export const getBoards = (): Promise<BoardListItem[]> => api.get<BoardListItem[]>('/boards/').then((r) => r.data)
export const getBoardTemplates = (): Promise<BoardTemplateInfo[]> =>
  api.get<BoardTemplateInfo[]>('/boards/templates').then((r) => r.data)
export const createBoard = (payload: string | BoardCreatePayload): Promise<Board> => {
  const body = typeof payload === 'string' ? { name: payload } : payload
  return api.post<Board>('/boards/', body).then((r) => r.data)
}
export const getBoard = (id: string): Promise<Board> => api.get<Board>(`/boards/${id}`).then((r) => r.data)
export const getBoardBySlug = (slug: string): Promise<Board> =>
  api.get<Board>(`/boards/by-slug/${slug}`).then((r) => r.data)
export const updateBoard = (id: string, data: BoardUpdatePayload): Promise<Board> =>
  api.patch<Board>(`/boards/${id}`, data).then((r) => r.data)
export const deleteBoard = (id: string): Promise<void> => api.delete(`/boards/${id}`)
/** Раскрыть карточки скрытого сбора вне сессии ведущего (модератор доски). */
export const revealBoardCards = (id: string): Promise<Board> =>
  api.post<Board>(`/boards/${id}/reveal`).then((r) => r.data)
/** Снять все голоса текущего участника на доске. */
export const resetBoardVotes = (
  boardId: string,
): Promise<{ board_id: string; username: string; updated_cards: number }> =>
  api
    .post<{ board_id: string; username: string; updated_cards: number }>(`/boards/${boardId}/reset-votes`)
    .then((r) => r.data)

// ── Columns ─────────────────────────────────────────────────────────────────
export const createColumn = (data: { board_id: string; title: string; color?: string }): Promise<Column> =>
  api.post<Column>('/columns/', data).then((r) => r.data)
/** Ответ — только свойства колонки, без карточек и групп. */
export const updateColumn = (
  id: string,
  data: { title?: string; color?: string; position?: number },
): Promise<ColumnInfo> => api.patch<ColumnInfo>(`/columns/${id}`, data).then((r) => r.data)
export const deleteColumn = (id: string): Promise<void> => api.delete(`/columns/${id}`)

// ── Cards ────────────────────────────────────────────────────────────────────
/** Автор карточки — участник сессии: из запроса сервер его не принимает. */
export const createCard = (data: {
  column_id: string
  text: string
  color?: string
}): Promise<Card> => api.post<Card>('/cards/', data).then((r) => r.data)
export const updateCard = (id: string, data: { text?: string; color?: string }): Promise<Card> =>
  api.patch<Card>(`/cards/${id}`, data).then((r) => r.data)
export const moveCard = (id: string, data: { column_id: string; position: number }): Promise<Card> =>
  api.post<Card>(`/cards/${id}/move`, data).then((r) => r.data)
/** Голос текущего участника: поставить, снять или переключить. */
export const toggleLike = (id: string, action?: 'toggle' | 'add' | 'remove'): Promise<Card> =>
  api
    .post<Card>(`/cards/${id}/like`, null, action ? { params: { action } } : undefined)
    .then((r) => r.data)
export const deleteCard = (id: string): Promise<void> => api.delete(`/cards/${id}`)
export const bulkUpdateCards = (data: {
  card_ids: string[]
  column_id?: string
  group_id?: string | null
  group_title?: string
  color?: string
}): Promise<Card[]> => api.post<Card[]>('/cards/bulk-update', data).then((r) => r.data)
export const bulkDeleteCards = (cardIds: string[]): Promise<{ deleted: number }> =>
  api.post<{ deleted: number }>('/cards/bulk-delete', { card_ids: cardIds }).then((r) => r.data)
export const mergeCards = (cardIds: string[], targetText?: string): Promise<Card> =>
  api
    .post<Card>('/cards/merge', {
      card_ids: cardIds,
      ...(targetText !== undefined ? { target_text: targetText } : {}),
    })
    .then((r) => r.data)

// ── Groups ───────────────────────────────────────────────────────────────────
interface AppliedClusters {
  created_groups: { group: CardGroup; card_ids: string[] }[]
  ungrouped_card_ids: string[]
}

export const createGroup = (data: { column_id: string; title?: string }): Promise<CardGroup> =>
  api.post<CardGroup>('/groups/', data).then((r) => r.data)
export const updateGroup = (id: string, data: { title?: string }): Promise<CardGroup> =>
  api.patch<CardGroup>(`/groups/${id}`, data).then((r) => r.data)
export const deleteGroup = (id: string): Promise<void> => api.delete(`/groups/${id}`)
export const addCardToGroup = (groupId: string, cardId: string): Promise<Card> =>
  api.post<Card>(`/groups/${groupId}/set_card/${cardId}`).then((r) => r.data)
export const removeCardFromGroup = (groupId: string, cardId: string): Promise<Card> =>
  api.delete<Card>(`/groups/${groupId}/remove_card/${cardId}`).then((r) => r.data)
export const moveGroup = (id: string, data: { column_id: string }): Promise<CardGroup> =>
  api.patch<CardGroup>(`/groups/${id}/move`, data).then((r) => r.data)
export const autoClusterColumn = (columnId: string): Promise<AppliedClusters> =>
  api
    .post<AppliedClusters>('/groups/auto-cluster', { column_id: columnId }, { timeout: AI_API_TIMEOUT_MS })
    .then((r) => r.data)
export const autoClusterPreview = (columnId: string): Promise<AutoClusterPreviewResult> =>
  api
    .post<AutoClusterPreviewResult>(
      '/groups/auto-cluster-preview',
      { column_id: columnId },
      { timeout: AI_API_TIMEOUT_MS },
    )
    .then((r) => r.data)
export const applyAutoClusters = (data: {
  column_id: string
  groups: { title: string; card_ids: string[] }[]
}): Promise<AppliedClusters> =>
  api.post<AppliedClusters>('/groups/apply-clusters', data).then((r) => r.data)

// ── Action Items & Dashboard Analytics ──────────────────────────────────────
export const getActionItems = (boardId: string): Promise<ActionItem[]> =>
  api.get<ActionItem[]>('/action-items/', { params: { board_id: boardId } }).then((r) => r.data)
export const createActionItem = (data: {
  board_id: string
  title?: string
  text: string
  assignee?: string
  external_url?: string | null
  source_card_ids?: string[]
  status?: ActionItemStatus
}): Promise<ActionItem> => api.post<ActionItem>('/action-items/', data).then((r) => r.data)
export const updateActionItem = (
  id: string,
  data: {
    title?: string
    text?: string
    assignee?: string | null
    external_url?: string | null
    status?: ActionItemStatus
  },
): Promise<ActionItem> => api.patch<ActionItem>(`/action-items/${id}`, data).then((r) => r.data)
export const deleteActionItem = (id: string): Promise<void> => api.delete(`/action-items/${id}`)
export const getAllActionItems = (params?: {
  status?: string
  board_id?: string
  assignee?: string
}): Promise<DashboardActionItem[]> => api.get<DashboardActionItem[]>('/action-items/all', { params }).then((r) => r.data)
export const getActionItemTrends = (): Promise<TrendPoint[]> =>
  api.get<TrendPoint[]>('/action-items/trends').then((r) => r.data)
export const getMoodTrends = (): Promise<MoodTrendPoint[]> =>
  api.get<MoodTrendPoint[]>('/boards/mood-trends').then((r) => r.data)
export const getWorkspaceInsights = (): Promise<WorkspaceInsights> =>
  api
    .post<WorkspaceInsights>('/boards/workspace-insights', undefined, { timeout: AI_API_TIMEOUT_MS })
    .then((r) => r.data)
export const carryForward = (data: CarryForwardRequest): Promise<ActionItem[]> =>
  api.post<ActionItem[]>('/action-items/carry-forward', data).then((r) => r.data)
export const generateActionItemTitle = (text: string): Promise<string> =>
  api
    .post<{ title: string }>('/action-items/generate-title', { text }, { timeout: AI_API_TIMEOUT_MS })
    .then((r) => r.data.title)
export const suggestActionItems = (
  boardId: string,
): Promise<{ board_id: string; suggestions: ActionItemSuggestion[] }> =>
  api
    .post<{ board_id: string; suggestions: ActionItemSuggestion[] }>(
      '/action-items/suggest',
      { board_id: boardId },
      { timeout: AI_API_TIMEOUT_MS },
    )
    .then((r) => r.data)

// ── Summary ─────────────────────────────────────────────────────────────────
export const getBoardSummary = (boardId: string): Promise<BoardSummary | null> =>
  api
    .get<BoardSummary>(`/boards/${boardId}/summary`)
    .then((r) => r.data)
    .catch((error: AxiosError) => {
      if (error?.response?.status === 404) return null
      throw error
    })

export const regenerateBoardSummary = (boardId: string): Promise<BoardSummary> =>
  api
    .post<BoardSummary>(`/boards/${boardId}/summary/regenerate`, undefined, { timeout: AI_API_TIMEOUT_MS })
    .then((r) => r.data)

// ── Сессия: команда и участник ──────────────────────────────────────────────
export interface SessionResponse {
  workspace_id: string
  workspace_slug: string
  workspace_name: string
  participant: Participant
}

export const toSessionInfo = (data: SessionResponse): SessionInfo => ({
  workspace: {
    workspaceId: data.workspace_id,
    workspaceSlug: data.workspace_slug,
    workspaceName: data.workspace_name,
  },
  participant: data.participant,
})

/**
 * Вход в команду по коду и ключу. Сервер создаёт участника и кладёт токен в httpOnly-cookie;
 * в ответе токена нет. Имя необязательно — без него сервер назовёт участника «Участник».
 */
export const loginToWorkspace = (data: {
  workspace_slug: string
  access_key: string
  name?: string
}): Promise<SessionInfo> =>
  api.post<SessionResponse>('/workspaces/login', data).then((r) => toSessionInfo(r.data))

/** Завершить сессию на сервере (сбрасывает cookie). Локальное состояние чистит вызывающий код. */
export const logoutWorkspace = (): Promise<void> =>
  api.post('/workspaces/logout').then(() => undefined)

/** Текущая сессия по cookie: команда, участник и возможности сервера. Заодно продлевает сессию. */
export const checkWorkspaceSession = (): Promise<WorkspaceMe> =>
  api.get<WorkspaceMe>('/workspaces/me').then((r) => r.data)

/** Сверить сессию с сервером и записать в стор участника, команду и признак `ai_enabled`. */
export const refreshWorkspaceSession = async (): Promise<WorkspaceMe> => {
  const me = await checkWorkspaceSession()
  const store = useAppStore.getState()
  store.setSession({
    workspace: { workspaceId: me.id, workspaceSlug: me.slug, workspaceName: me.name },
    participant: me.participant,
  })
  store.setAiEnabled(Boolean(me.ai_enabled))
  return me
}

/** Сменить имя участника. Карточки, голоса и роль ведущего остаются за ним. */
export const renameParticipant = (name: string): Promise<Participant> =>
  api.patch<Participant>('/workspaces/me/participant', { name }).then((r) => r.data)
