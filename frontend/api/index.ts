import axios, { type AxiosError } from 'axios'
import type {
  ActionItem,
  ActionItemStatus,
  ActionItemSuggestion,
  AutoClusterPreviewResult,
  Board,
  BoardCreatePayload,
  BoardListItem,
  BoardMood,
  BoardSummary,
  BoardTemplateInfo,
  BoardUpdatePayload,
  Card,
  CardGroup,
  CarryForwardRequest,
  Column,
  DashboardActionItem,
  MoodTrendPoint,
  TrendPoint,
  WorkspaceInsights,
  WorkspaceSession,
} from '../types'
import { showToast } from '../store/toastStore'
import { useAppStore } from '../store'

const api = axios.create({ baseURL: '/api' })

export function getCsrfToken(): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)
  return match ? match[1] : ''
}

export function handleCommonHttpError(status?: number, detail = ''): void {
  if (status === 429) {
    showToast('Слишком много запросов. Подождите немного.', 'error')
  } else if (status === 423) {
    showToast(detail || 'Доска заблокирована для изменений', 'error')
  } else if (status === 403) {
    showToast(detail || 'Доступ запрещён', 'error')
  } else if (status && status >= 500) {
    showToast('Что-то пошло не так', 'error')
  }
}

api.interceptors.request.use((config) => {
  if (config.method && !['get', 'head', 'options'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = getCsrfToken()
  }

  const workspace = useAppStore.getState().workspace
  if (workspace?.token) {
    config.headers['X-Workspace-Token'] = workspace.token
  }

  return config
})

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ detail?: string }>) => {
    const status = error.response?.status
    const detail = error.response?.data?.detail || ''
    const reqUrl = String(error.config?.url || '')

    if (status === 401 && !reqUrl.includes('/workspaces/login')) {
      useAppStore.setState({ workspace: null })
      return Promise.reject(error)
    }

    handleCommonHttpError(status, detail)
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
export const submitBoardMood = (
  boardId: string,
  data: { author: string; score: number; note?: string | null },
): Promise<BoardMood> => api.post<BoardMood>(`/boards/${boardId}/mood`, data).then((r) => r.data)
export const resetBoardVotes = (
  boardId: string,
  username: string,
): Promise<{ board_id: string; username: string; updated_cards: number }> =>
  api.post<{ board_id: string; username: string; updated_cards: number }>(`/boards/${boardId}/reset-votes`, null, { params: { username } }).then((r) => r.data)

// ── Columns ─────────────────────────────────────────────────────────────────
export const createColumn = (data: { board_id: string; title: string; color?: string }): Promise<Column> =>
  api.post<Column>('/columns/', data).then((r) => r.data)
export const updateColumn = (
  id: string,
  data: { title?: string; color?: string; position?: number },
): Promise<Column> => api.patch<Column>(`/columns/${id}`, data).then((r) => r.data)
export const deleteColumn = (id: string): Promise<void> => api.delete(`/columns/${id}`)

// ── Cards ────────────────────────────────────────────────────────────────────
export const createCard = (data: {
  column_id: string
  text: string
  author?: string
  color?: string
}): Promise<Card> => api.post<Card>('/cards/', data).then((r) => r.data)
export const updateCard = (id: string, data: { text?: string; color?: string }): Promise<Card> =>
  api.patch<Card>(`/cards/${id}`, data).then((r) => r.data)
export const moveCard = (id: string, data: { column_id: string; position: number }): Promise<Card> =>
  api.post<Card>(`/cards/${id}/move`, data).then((r) => r.data)
export const toggleLike = (
  id: string,
  username: string,
  action?: 'toggle' | 'add' | 'remove',
): Promise<Card> =>
  api
    .post<Card>(`/cards/${id}/like`, null, {
      params: action ? { username, action } : { username },
    })
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
export const autoClusterColumn = (columnId: string, username: string): Promise<AppliedClusters> =>
  api.post<AppliedClusters>('/groups/auto-cluster', { column_id: columnId, username }).then((r) => r.data)
export const autoClusterPreview = (
  columnId: string,
  username?: string,
): Promise<AutoClusterPreviewResult> =>
  api
    .post<AutoClusterPreviewResult>('/groups/auto-cluster-preview', { column_id: columnId, username })
    .then((r) => r.data)
export const applyAutoClusters = (data: {
  column_id: string
  groups: { title: string; card_ids: string[] }[]
  username?: string
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
  source_card_ids?: string[]
  status?: ActionItemStatus
}): Promise<ActionItem> => api.post<ActionItem>('/action-items/', data).then((r) => r.data)
export const updateActionItem = (
  id: string,
  data: { title?: string; text?: string; assignee?: string | null; status?: ActionItemStatus },
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
  api.post<WorkspaceInsights>('/boards/workspace-insights').then((r) => r.data)
export const carryForward = (data: CarryForwardRequest): Promise<ActionItem[]> =>
  api.post<ActionItem[]>('/action-items/carry-forward', data).then((r) => r.data)
export const generateActionItemTitle = (text: string): Promise<string> =>
  api.post<{ title: string }>('/action-items/generate-title', { text }).then((r) => r.data.title)
export const suggestActionItems = (
  boardId: string,
): Promise<{ board_id: string; suggestions: ActionItemSuggestion[] }> =>
  api.post<{ board_id: string; suggestions: ActionItemSuggestion[] }>('/action-items/suggest', { board_id: boardId }).then((r) => r.data)

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
  api.post<BoardSummary>(`/boards/${boardId}/summary/regenerate`).then((r) => r.data)

// ── Workspace ───────────────────────────────────────────────────────────────
interface WorkspaceLoginResponse {
  token: string
  workspace_id: string
  workspace_slug: string
  workspace_name: string
}

export const loginToWorkspace = (data: {
  workspace_slug: string
  access_key: string
}): Promise<WorkspaceSession> =>
  api.post<WorkspaceLoginResponse>('/workspaces/login', data).then((r) => ({
    token: r.data.token,
    workspaceId: r.data.workspace_id,
    workspaceSlug: r.data.workspace_slug,
    workspaceName: r.data.workspace_name,
  }))

export const checkWorkspaceSession = (): Promise<{ id: string; slug: string; name: string }> =>
  api.get<{ id: string; slug: string; name: string }>('/workspaces/me').then((r) => r.data)
