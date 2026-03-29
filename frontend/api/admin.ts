import axios from 'axios'

const adminApi = axios.create({
  baseURL: '/api/admin',
  withCredentials: true,
})

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
