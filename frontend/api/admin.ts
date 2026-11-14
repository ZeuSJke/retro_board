import axios, { type AxiosError } from 'axios'
import { getCsrfToken, handleCommonHttpError } from './index'

const adminApi = axios.create({
  baseURL: '/api/admin',
  withCredentials: true,
  timeout: 15000,
})

adminApi.interceptors.request.use((config) => {
  if (config.method && !['get', 'head', 'options'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = getCsrfToken()
  }

  return config
})

adminApi.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ detail?: string }>) => {
    const status = error.response?.status
    const detail = error.response?.data?.detail || ''

    if (status === 401) {
      return Promise.reject(error)
    }

    handleCommonHttpError(status, detail)
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
  adminApi.get<WorkspaceListItem[]>('/workspaces').then((r) => r.data)

export const createAdminWorkspace = (data: { slug: string; name: string; access_key: string }): Promise<AdminWorkspaceResponse> =>
  adminApi.post<AdminWorkspaceResponse>('/workspaces', data).then((r) => r.data)

export const updateAdminWorkspace = (id: string, data: { name?: string; access_key?: string }): Promise<AdminWorkspaceResponse> =>
  adminApi.patch<AdminWorkspaceResponse>(`/workspaces/${id}`, data).then((r) => r.data)

export const deleteAdminWorkspace = (id: string) =>
  adminApi.delete(`/workspaces/${id}`)
