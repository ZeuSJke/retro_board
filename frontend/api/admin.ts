import axios, { type AxiosError } from 'axios'
import type { AgentToken, AgentTokenCreated, AgentTokenScope } from '../types'
import { showToast } from '../store/toastStore'
import { isApiErrorReported, markApiErrorReported } from '../utils/apiError'
import { getCsrfToken, handleCommonHttpError } from './index'

const adminApi = axios.create({
  baseURL: '/api/admin',
  withCredentials: true,
  timeout: 15000,
})

// ── Состояние сессии администратора ─────────────────────────────────────────
//
// Сессия администратора — httpOnly-cookie `admin_token`: из JS её не видно.
// Признак входа спрашиваем у сервера эндпоинтом `GET /api/admin/session`:
// он отвечает 200 и `{authenticated}`, поэтому в консоли нет ответа 401.
// Пока ответа нет — `null` (страница показывает «Проверка доступа...»).
// `setAdminSessionHint` меняет состояние после входа, выхода и ответа 401.

export type AdminSessionHint = boolean | null

export interface AdminSessionInfo {
  authenticated: boolean
}

const sessionListeners = new Set<() => void>()
let sessionHint: AdminSessionHint = null
let checkPromise: Promise<boolean> | null = null

function publishSessionHint(active: AdminSessionHint): void {
  sessionHint = active
  sessionListeners.forEach((listener) => listener())
}

/** Текущее знание о сессии: `null` — ещё не проверяли. */
export function getAdminSessionHint(): AdminSessionHint {
  return sessionHint
}

/** Поставить или снять состояние: после входа, выхода и ответа 401. */
export function setAdminSessionHint(active: AdminSessionHint): void {
  publishSessionHint(active)
}

/** Подписка на состояние (для `useSyncExternalStore`). */
export function subscribeAdminSessionHint(listener: () => void): () => void {
  sessionListeners.add(listener)
  return () => {
    sessionListeners.delete(listener)
  }
}

/** Спросить сервер, действует ли cookie администратора. Ответ всегда 200. */
export const getAdminSession = (): Promise<AdminSessionInfo> =>
  adminApi.get<AdminSessionInfo>('/session').then((r) => r.data)

/**
 * Проверить сессию один раз и записать результат в состояние.
 * Пока запрос в пути, повторные вызовы ждут его же.
 */
export function checkAdminSession(): Promise<AdminSessionHint> {
  if (checkPromise) return checkPromise.then(() => sessionHint)
  checkPromise = getAdminSession()
    .then(({ authenticated }) => {
      publishSessionHint(authenticated)
      return authenticated
    })
    .catch((error: unknown) => {
      // Сеть или 5xx — это не «сессия закончилась». Если состояние уже
      // известно, не трогаем его; иначе показываем форму входа с пояснением.
      markApiErrorReported(error)
      if (sessionHint === null) publishSessionHint(false)
      showToast('Не удалось проверить сессию администратора', 'error', {
        description: 'Сервер не ответил. Проверьте соединение и откройте страницу снова.',
      })
      return sessionHint ?? false
    })
    .finally(() => {
      checkPromise = null
    })
  return checkPromise.then(() => sessionHint)
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
  active_agent_tokens_count?: number
}

/** Ответ создания команды: та же строка списка, `boards_count` у новой команды — 0. */
export type AdminWorkspaceResponse = WorkspaceListItem

/** Ответ изменения команды: счётчиков досок и токенов в нём нет. */
export type AdminWorkspaceUpdated = Omit<
  WorkspaceListItem,
  'boards_count' | 'active_agent_tokens_count'
>

interface InviteResponse {
  invite_token: string
}

/** Вход: после успешного ответа страница переключается на список команд. */
export const adminLogin = (data: { login: string; password: string }): Promise<void> =>
  adminApi.post('/login', data).then(() => setAdminSessionHint(true))

/** Выход: состояние снимается, даже если запрос не дошёл до сервера. */
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
 * и перевыпускает ссылку-приглашение; токены MCP-агентов отзываются только при `revoke_agent_tokens: true`.
 */
export const updateAdminWorkspace = (
  id: string,
  data: { name?: string; access_key?: string; revoke_agent_tokens?: boolean },
): Promise<AdminWorkspaceUpdated> =>
  adminApi.patch<AdminWorkspaceUpdated>(`/workspaces/${id}`, data).then((r) => r.data)

export const deleteAdminWorkspace = (id: string) =>
  adminApi.delete(`/workspaces/${id}`)

/** Токен ссылки-приглашения команды (сервер создаёт его при первом обращении). */
export const getAdminWorkspaceInvite = (id: string): Promise<string> =>
  adminApi.get<InviteResponse>(`/workspaces/${id}/invite`).then((r) => r.data.invite_token)

/** Перевыпустить приглашение: прежняя ссылка перестаёт работать, вошедшие участники остаются. */
export const rotateAdminWorkspaceInvite = (id: string): Promise<string> =>
  adminApi.post<InviteResponse>(`/workspaces/${id}/invite/rotate`).then((r) => r.data.invite_token)

/** Список токенов MCP-агентов команды (для администратора). */
export const getAdminAgentTokens = (workspaceId: string): Promise<AgentToken[]> =>
  adminApi.get<AgentToken[]>(`/workspaces/${workspaceId}/agent-tokens`).then((r) => r.data)

/** Выпустить токен MCP-агента команды (от имени администратора). */
export const createAdminAgentToken = (
  workspaceId: string,
  data: { name: string; scope: AgentTokenScope },
): Promise<AgentTokenCreated> =>
  adminApi
    .post<AgentTokenCreated>(`/workspaces/${workspaceId}/agent-tokens`, data)
    .then((r) => r.data)

/** Отозвать токен MCP-агента команды (от имени администратора). */
export const revokeAdminAgentToken = (workspaceId: string, tokenId: string): Promise<AgentToken> =>
  adminApi
    .delete<AgentToken>(`/workspaces/${workspaceId}/agent-tokens/${tokenId}`)
    .then((r) => r.data)

export type AIReasoningEffort = 'default' | 'none' | 'low' | 'medium' | 'high' | 'max'

export interface AdminAiSettings {
  enabled: boolean
  base_url: string
  model: string
  reasoning_effort: AIReasoningEffort
  has_api_key: boolean
  api_key_masked: string | null
  key_decrypt_error: boolean
  updated_at: string | null
}

export interface AdminAiSettingsUpdate {
  enabled: boolean
  base_url: string
  model: string
  reasoning_effort: AIReasoningEffort
  api_key?: string | null
  clear_api_key?: boolean
}

export interface AdminAiTestRequest {
  base_url: string
  model: string
  reasoning_effort: AIReasoningEffort
  api_key?: string | null
  clear_api_key?: boolean
}

export interface AdminAiTestResponse {
  ok: boolean
  latency_ms: number
  reply_preview: string | null
  error: string | null
  reasoning_used: boolean
}

export interface AdminAiModelsRequest {
  base_url: string
  api_key?: string | null
  clear_api_key?: boolean
}

export interface AdminAiModelsResponse {
  models: string[]
}

/** Получить текущие настройки OpenAI-совместимого ИИ. */
export const getAdminAiSettings = (): Promise<AdminAiSettings> =>
  adminApi.get<AdminAiSettings>('/ai-settings').then((r) => r.data)

/** Сохранить настройки ИИ в БД без рестарта сервера. */
export const updateAdminAiSettings = (data: AdminAiSettingsUpdate): Promise<AdminAiSettings> =>
  adminApi.put<AdminAiSettings>('/ai-settings', data).then((r) => r.data)

/** Выполнить пробный запрос /chat/completions с указанными в форме настройками. */
export const testAdminAiSettings = (data: AdminAiTestRequest): Promise<AdminAiTestResponse> =>
  adminApi
    .post<AdminAiTestResponse>('/ai-settings/test', data, { timeout: 45000 })
    .then((r) => r.data)

/** Загрузить список доступных моделей через GET {base_url}/models. */
export const fetchAdminAiModels = (data: AdminAiModelsRequest): Promise<string[]> =>
  adminApi
    .post<AdminAiModelsResponse>('/ai-settings/models', data, { timeout: 15000 })
    .then((r) => r.data.models)
