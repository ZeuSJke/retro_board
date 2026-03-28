import axios from 'axios'
import type { Board, BoardListItem, Column, Card, CardGroup, ActionItem, DashboardActionItem, CarryForwardRequest, ActionItemStatus, TrendPoint } from '../types'
import { showToast } from '../store/toastStore'

const api = axios.create({ baseURL: '/api' })

api.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error.response?.status
    if (status === 429) {
      showToast('Слишком много запросов. Подождите немного.', 'error')
    } else if (status === 403) {
      const msg = error.response?.data?.detail || 'Доступ запрещён'
      showToast(msg, 'error')
    } else if (status && status >= 500) {
      showToast('Что-то пошло не так', 'error')
    }
    return Promise.reject(error)
  },
)

// ── Boards ──────────────────────────────────────────────────────────────────
export const getBoards = (): Promise<BoardListItem[]> => api.get('/boards/').then((r) => r.data)
export const createBoard = (name: string): Promise<Board> => api.post('/boards/', { name }).then((r) => r.data)
export const getBoard = (id: string): Promise<Board> => api.get(`/boards/${id}`).then((r) => r.data)
export const getBoardBySlug = (slug: string): Promise<Board> => api.get(`/boards/by-slug/${slug}`).then((r) => r.data)
export const updateBoard = (id: string, data: { name?: string; max_votes?: number }): Promise<Board> => api.patch(`/boards/${id}`, data).then((r) => r.data)
export const deleteBoard = (id: string): Promise<void> => api.delete(`/boards/${id}`)

// ── Columns ─────────────────────────────────────────────────────────────────
export const createColumn = (data: { board_id: string; title: string; color?: string }): Promise<Column> => api.post('/columns/', data).then((r) => r.data)
export const updateColumn = (id: string, data: { title?: string; color?: string; position?: number }): Promise<Column> => api.patch(`/columns/${id}`, data).then((r) => r.data)
export const deleteColumn = (id: string): Promise<void> => api.delete(`/columns/${id}`)

// ── Cards ────────────────────────────────────────────────────────────────────
export const createCard = (data: { column_id: string; text: string; author?: string; color?: string }): Promise<Card> => api.post('/cards/', data).then((r) => r.data)
export const updateCard = (id: string, data: { text?: string; color?: string }): Promise<Card> => api.patch(`/cards/${id}`, data).then((r) => r.data)
export const moveCard = (id: string, data: { column_id: string; position: number }): Promise<Card> => api.post(`/cards/${id}/move`, data).then((r) => r.data)
export const toggleLike = (id: string, username: string): Promise<Card> =>
  api.post(`/cards/${id}/like`, null, { params: { username } }).then((r) => r.data)
export const deleteCard = (id: string): Promise<void> => api.delete(`/cards/${id}`)

// ── Groups ───────────────────────────────────────────────────────────────────
export const createGroup = (data: { column_id: string; title?: string }): Promise<CardGroup> => api.post('/groups/', data).then((r) => r.data)
export const updateGroup = (id: string, data: { title?: string }): Promise<CardGroup> => api.patch(`/groups/${id}`, data).then((r) => r.data)
export const deleteGroup = (id: string): Promise<void> => api.delete(`/groups/${id}`)
export const addCardToGroup = (groupId: string, cardId: string): Promise<Card> =>
  api.post(`/groups/${groupId}/set_card/${cardId}`).then((r) => r.data)
export const removeCardFromGroup = (groupId: string, cardId: string): Promise<Card> =>
  api.delete(`/groups/${groupId}/remove_card/${cardId}`).then((r) => r.data)
export const moveGroup = (id: string, data: { column_id: string }): Promise<CardGroup> => api.patch(`/groups/${id}/move`, data).then((r) => r.data)

// ── Action Items ────────────────────────────────────────────────────────────
export const getActionItems = (boardId: string): Promise<ActionItem[]> =>
  api.get('/action-items/', { params: { board_id: boardId } }).then((r) => r.data)
export const createActionItem = (data: { board_id: string; title?: string; text: string; assignee?: string }): Promise<ActionItem> =>
  api.post('/action-items/', data).then((r) => r.data)
export const updateActionItem = (id: string, data: { title?: string; text?: string; assignee?: string | null; status?: ActionItemStatus }): Promise<ActionItem> =>
  api.patch(`/action-items/${id}`, data).then((r) => r.data)
export const deleteActionItem = (id: string): Promise<void> =>
  api.delete(`/action-items/${id}`)
export const getAllActionItems = (params?: { status?: string; board_id?: string; assignee?: string }): Promise<DashboardActionItem[]> =>
  api.get('/action-items/all', { params }).then((r) => r.data)
export const carryForward = (data: CarryForwardRequest): Promise<ActionItem[]> =>
  api.post('/action-items/carry-forward', data).then((r) => r.data)
export const getTrends = (): Promise<TrendPoint[]> =>
  api.get('/action-items/trends').then((r) => r.data)

// ── Jira Integration ────────────────────────────────────────────────────────
export const getJiraStatus = (): Promise<{ configured: boolean }> =>
  api.get('/jira/status').then((r) => r.data)
export const createJiraIssue = (data: {
  action_item_id: string; project_key: string; summary: string; description?: string; issue_type?: string
}): Promise<{ jira_issue_key: string; jira_url: string }> =>
  api.post('/jira/create-issue', data).then((r) => r.data)
