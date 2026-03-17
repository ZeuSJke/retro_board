import axios from 'axios'
import type { Board, BoardListItem, Column, Card, CardGroup } from '../types'

const api = axios.create({ baseURL: '/api' })

// ── Boards ──────────────────────────────────────────────────────────────────
export const getBoards = (): Promise<BoardListItem[]> => api.get('/boards/').then((r) => r.data)
export const createBoard = (name: string): Promise<Board> => api.post('/boards/', { name }).then((r) => r.data)
export const getBoard = (id: string): Promise<Board> => api.get(`/boards/${id}`).then((r) => r.data)
export const getBoardBySlug = (slug: string): Promise<Board> => api.get(`/boards/by-slug/${slug}`).then((r) => r.data)
export const updateBoard = (id: string, data: { name?: string }): Promise<Board> => api.patch(`/boards/${id}`, data).then((r) => r.data)
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
