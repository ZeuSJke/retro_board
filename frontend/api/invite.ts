import axios, { type AxiosError } from 'axios'
import type { Participant, SessionInfo } from '../types'
import { useAppStore } from '../store'
import { isApiErrorReported } from '../utils/apiError'
import { getCsrfToken, handleCommonHttpError } from './index'

/**
 * Ссылки-приглашения: вход по ссылке и токен приглашения текущей команды.
 *
 * Клиент свой, а не общий из `api/index.ts`: там он не экспортируется. Поведение то же —
 * CSRF-заголовок, сброс сессии по 401 и запасной тост, если ошибку никто не показал сам.
 */
const inviteApi = axios.create({ baseURL: '/api/workspaces' })

inviteApi.interceptors.request.use((config) => {
  if (config.method && !['get', 'head', 'options'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = getCsrfToken()
  }
  return config
})

/** Единственный запрос этого модуля, которому нужна сессия: токен приглашения своей команды. */
const OWN_INVITE_URL = '/invite'

inviteApi.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ detail?: unknown }>) => {
    const status = error.response?.status
    const detail = error.response?.data?.detail

    if (status === 401) {
      // Сессии нет или она отозвана: забываем её, как это делает общий клиент
      if (String(error.config?.url || '') === OWN_INVITE_URL) {
        useAppStore.getState().clearSession()
      }
      return Promise.reject(error)
    }

    setTimeout(() => {
      if (!isApiErrorReported(error)) {
        handleCommonHttpError(status, typeof detail === 'string' ? detail : '')
      }
    }, 0)
    return Promise.reject(error)
  },
)

interface SessionResponse {
  workspace_id: string
  workspace_slug: string
  workspace_name: string
  participant: Participant
}

/** Что видно по ссылке без входа: только название команды. */
export interface InviteInfo {
  workspaceName: string
}

/** Название команды по токену из ссылки. Недействительная ссылка — ответ 404. */
export const getInviteInfo = (token: string): Promise<InviteInfo> =>
  inviteApi
    .get<{ workspace_name: string }>(`/invite/${encodeURIComponent(token)}`)
    .then((r) => ({ workspaceName: r.data.workspace_name }))

/**
 * Вход по ссылке-приглашению: токен из ссылки и имя. Сервер создаёт участника и кладёт
 * токен сессии в httpOnly-cookie (прежняя сессия, если была, заменяется). Имя необязательно —
 * без него сервер назовёт участника «Участник». Недействительная ссылка — ответ 404.
 */
export const joinByInvite = (data: { invite_token: string; name?: string }): Promise<SessionInfo> =>
  inviteApi.post<SessionResponse>('/join', data).then((r) => ({
    workspace: {
      workspaceId: r.data.workspace_id,
      workspaceSlug: r.data.workspace_slug,
      workspaceName: r.data.workspace_name,
    },
    participant: r.data.participant,
  }))

/** Токен ссылки-приглашения команды текущей сессии (сервер создаёт его при первом обращении). */
export const getWorkspaceInviteToken = (): Promise<string> =>
  inviteApi.get<{ invite_token: string }>(OWN_INVITE_URL).then((r) => r.data.invite_token)
