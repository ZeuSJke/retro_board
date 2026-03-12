import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// ── Boards ──────────────────────────────────────────────────────────────────
export const getBoards = () => api.get('/boards/').then(r => r.data)
export const createBoard = (name) => api.post('/boards/', { name }).then(r => r.data)
export const getBoard = (id) => api.get(`/boards/${id}`).then(r => r.data)
export const updateBoard = (id, data) => api.patch(`/boards/${id}`, data).then(r => r.data)
export const deleteBoard = (id) => api.delete(`/boards/${id}`)

// ── Columns ─────────────────────────────────────────────────────────────────
export const createColumn = (data) => api.post('/columns/', data).then(r => r.data)
export const updateColumn = (id, data) => api.patch(`/columns/${id}`, data).then(r => r.data)
export const deleteColumn = (id) => api.delete(`/columns/${id}`)

// ── Cards ────────────────────────────────────────────────────────────────────
export const createCard = (data) => api.post('/cards/', data).then(r => r.data)
export const updateCard = (id, data) => api.patch(`/cards/${id}`, data).then(r => r.data)
export const moveCard = (id, data) => api.post(`/cards/${id}/move`, data).then(r => r.data)
export const toggleLike = (id, username) =>
  api.post(`/cards/${id}/like`, null, { params: { username } }).then(r => r.data)
export const deleteCard = (id) => api.delete(`/cards/${id}`)

// ── Groups ───────────────────────────────────────────────────────────────────
export const createGroup = (data) => api.post('/groups/', data).then(r => r.data)
export const updateGroup = (id, data) => api.patch(`/groups/${id}`, data).then(r => r.data)
export const deleteGroup = (id) => api.delete(`/groups/${id}`)
export const addCardToGroup = (groupId, cardId) =>
  api.post(`/groups/${groupId}/set_card/${cardId}`).then(r => r.data)
export const removeCardFromGroup = (groupId, cardId) =>
  api.delete(`/groups/${groupId}/remove_card/${cardId}`).then(r => r.data)
export const moveGroup = (id, data) => api.patch(`/groups/${id}/move`, data).then(r => r.data)
