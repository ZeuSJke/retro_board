import axios from 'axios'
import { showToast } from '../store/toastStore'
import { useAppStore } from '../store'

const adminApi = axios.create({
  baseURL: '/api/admin',
  withCredentials: true,
  timeout: 15000,
})

function getCsrfToken(): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(/csrf_token=([^;]+)/)
  return match ? match[1] : ''
}

// Интерцепторы — те же, что у общего REST-инстанса в api/index.ts
// (CSRF на мутациях, X-Workspace-Token, обработка 401/429/403/5xx).
// Дублируются здесь, т.к. общий инстанс не экспортируется.
adminApi.interceptors.request.use((config) => {
  if (config.method && !['get', 'head', 'options'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = getCsrfToken()
  }

  // Add workspace token if available
  const workspace = useAppStore.getState().workspace
  if (workspace?.token) {
    config.headers['X-Workspace-Token'] = workspace.token
  }

  return config
})

adminApi.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error.response?.status
    const detail = error.response?.data?.detail || ''

    if (status === 401 && detail.toLowerCase().includes('workspace')) {
      // Workspace session expired/invalid — clear state, App.tsx will show WelcomeDialog
      useAppStore.setState({ workspace: null })
      return Promise.reject(error)
    }

    if (status === 429) {
      showToast('Слишком много запросов. Подождите немного.', 'error')
    } else if (status === 403) {
      const msg = detail || 'Доступ запрещён'
      showToast(msg, 'error')
    } else if (status && status >= 500) {
      showToast('Что-то пошло не так', 'error')
    }
    return Promise.reject(error)
  },
)

export interface WorkspaceListItem {
  id: string
  slug: string
  name: string
  created_at: string
  boards_count: number
}

export interface AdminWorkspaceResponse {
  id: string
  slug: string
  name: string
  created_at: string
  boards_count: number
}

export const adminLogin = (data: { login: string; password: string }) =>
  adminApi.post('/login', data)

export const adminLogout = () =>
  adminApi.post('/logout')

export const getAdminWorkspaces = (): Promise<WorkspaceListItem[]> =>
  adminApi.get('/workspaces').then((r) => r.data)

export const createAdminWorkspace = (data: { slug: string; name: string; access_key: string }): Promise<AdminWorkspaceResponse> =>
  adminApi.post('/workspaces', data).then((r) => r.data)

export const updateAdminWorkspace = (id: string, data: { name?: string; access_key?: string }): Promise<AdminWorkspaceResponse> =>
  adminApi.patch(`/workspaces/${id}`, data).then((r) => r.data)

export const deleteAdminWorkspace = (id: string) =>
  adminApi.delete(`/workspaces/${id}`)
