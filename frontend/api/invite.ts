import type { SessionInfo } from '../types'
import { api, toSessionInfo, type SessionResponse } from './index'

/**
 * Ссылки-приглашения: вход по ссылке и токен приглашения текущей команды.
 *
 * Запросы идут через общий клиент: `/workspaces/join` входит в число запросов, которые сами
 * начинают сессию (их 401 сессию не сбрасывает), а просмотр приглашения сессии не требует.
 */

/** Что видно по ссылке без входа: только название команды. */
export interface InviteInfo {
  workspaceName: string
}

/** Название команды по токену из ссылки. Недействительная ссылка — ответ 404. */
export const getInviteInfo = (token: string): Promise<InviteInfo> =>
  api
    .get<{ workspace_name: string }>(`/workspaces/invite/${encodeURIComponent(token)}`)
    .then((r) => ({ workspaceName: r.data.workspace_name }))

/**
 * Вход по ссылке-приглашению: токен из ссылки и имя. Сервер создаёт участника и кладёт
 * токен сессии в httpOnly-cookie (прежняя сессия, если была, заменяется). Имя необязательно —
 * без него сервер назовёт участника «Участник». Недействительная ссылка — ответ 404.
 */
export const joinByInvite = (data: { invite_token: string; name?: string }): Promise<SessionInfo> =>
  api.post<SessionResponse>('/workspaces/join', data).then((r) => toSessionInfo(r.data))

/** Токен ссылки-приглашения команды текущей сессии (сервер создаёт его при первом обращении). */
export const getWorkspaceInviteToken = (): Promise<string> =>
  api.get<{ invite_token: string }>('/workspaces/invite').then((r) => r.data.invite_token)
