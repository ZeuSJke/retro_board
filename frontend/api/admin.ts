import axios, { type AxiosError } from 'axios'
import { isApiErrorReported } from '../utils/apiError'
import { getCsrfToken, handleCommonHttpError } from './index'

const adminApi = axios.create({
  baseURL: '/api/admin',
  withCredentials: true,
  timeout: 15000,
})

// ── Признак входа администратора ────────────────────────────────────────────
//
// Сессия администратора — httpOnly-cookie `admin_token`: из JS её не видно, а спросить сервер
// «вошёл ли я» можно только запросом, который без входа отвечает 401 (и браузер пишет это в
// консоль как ошибку). Поэтому при входе запоминаем срок сессии в localStorage: нет отметки —
// страница сразу показывает форму входа и сервер не спрашивает. Отметка — подсказка, а не
// доступ: проверяет сессию по-прежнему сервер.

const ADMIN_SESSION_KEY = 'retroboard-admin-session'
/** Срок жизни cookie `admin_token` (`max_age=86400` в `backend/app/routers/admin.py`). */
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000

const hintListeners = new Set<() => void>()
// Запасное хранение на случай, когда localStorage недоступен (запрещён или переполнен)
let memoryExpiresAt = 0
let storageBroken = false

function readSessionExpiry(): number {
  if (storageBroken) return memoryExpiresAt
  try {
    return Number(window.localStorage.getItem(ADMIN_SESSION_KEY)) || 0
  } catch {
    return memoryExpiresAt
  }
}

/** Есть ли отметка о действующей сессии администратора в этом браузере. */
export function getAdminSessionHint(): boolean {
  return typeof window !== 'undefined' && readSessionExpiry() > Date.now()
}

/** Поставить или снять отметку: после входа, выхода и ответа 401. */
export function setAdminSessionHint(active: boolean): void {
  memoryExpiresAt = active ? Date.now() + ADMIN_SESSION_TTL_MS : 0
  try {
    if (active) {
      window.localStorage.setItem(ADMIN_SESSION_KEY, String(memoryExpiresAt))
    } else {
      window.localStorage.removeItem(ADMIN_SESSION_KEY)
    }
    storageBroken = false
  } catch {
    storageBroken = true
  }
  hintListeners.forEach((listener) => listener())
}

/** Подписка на отметку (для `useSyncExternalStore`), в том числе на вход и выход в другой вкладке. */
export function subscribeAdminSessionHint(listener: () => void): () => void {
  hintListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    hintListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

adminApi.interceptors.request.use((config) => {
  if (config.method && !['get', 'head', 'options'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = getCsrfToken()
  }

  return config
})

adminApi.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ detail?: unknown }>) => {
    const status = error.response?.status
    const detail = error.response?.data?.detail

    if (status === 401) {
      // Ответ 401 на вход — неверный пароль; на всё остальное — сессия закончилась
      if (!String(error.config?.url || '').includes('/login')) {
        setAdminSessionHint(false)
      }
      return Promise.reject(error)
    }

    // Общий тост — запасной вариант: если страница сама показала ошибку
    // (getApiErrorMessage помечает её), второго уведомления не будет
    setTimeout(() => {
      if (!isApiErrorReported(error)) {
        handleCommonHttpError(status, typeof detail === 'string' ? detail : '')
      }
    }, 0)
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

/** Ответ создания команды: та же строка списка, `boards_count` у новой команды — 0. */
export type AdminWorkspaceResponse = WorkspaceListItem

/** Ответ изменения команды: счётчика досок в нём нет. */
export type AdminWorkspaceUpdated = Omit<WorkspaceListItem, 'boards_count'>

interface InviteResponse {
  invite_token: string
}

export const adminLogin = (data: { login: string; password: string }): Promise<void> =>
  adminApi.post('/login', data).then(() => setAdminSessionHint(true))

/** Выход: отметка о сессии снимается, даже если запрос не дошёл до сервера. */
export const adminLogout = (): Promise<void> =>
  adminApi
    .post('/logout')
    .then(() => undefined)
    .finally(() => setAdminSessionHint(false))

export const getAdminWorkspaces = (): Promise<WorkspaceListItem[]> =>
  adminApi.get<WorkspaceListItem[]>('/workspaces').then((r) => r.data)

export const createAdminWorkspace = (data: { slug: string; name: string; access_key: string }): Promise<AdminWorkspaceResponse> =>
  adminApi.post<AdminWorkspaceResponse>('/workspaces', data).then((r) => r.data)

/**
 * Изменить команду. Смена `access_key` на сервере завершает сессии всех участников
 * и перевыпускает ссылку-приглашение.
 */
export const updateAdminWorkspace = (id: string, data: { name?: string; access_key?: string }): Promise<AdminWorkspaceUpdated> =>
  adminApi.patch<AdminWorkspaceUpdated>(`/workspaces/${id}`, data).then((r) => r.data)

export const deleteAdminWorkspace = (id: string) =>
  adminApi.delete(`/workspaces/${id}`)

/** Токен ссылки-приглашения команды (сервер создаёт его при первом обращении). */
export const getAdminWorkspaceInvite = (id: string): Promise<string> =>
  adminApi.get<InviteResponse>(`/workspaces/${id}/invite`).then((r) => r.data.invite_token)

/** Перевыпустить приглашение: прежняя ссылка перестаёт работать, вошедшие участники остаются. */
export const rotateAdminWorkspaceInvite = (id: string): Promise<string> =>
  adminApi.post<InviteResponse>(`/workspaces/${id}/invite/rotate`).then((r) => r.data.invite_token)
