import { type APIRequestContext, type APIResponse, type Page } from '@playwright/test'

/**
 * Адреса стенда. По умолчанию — как в CI (nginx на 3080, бэкенд на 8000);
 * для локального стенда на других портах задайте E2E_BASE_URL и E2E_API_URL.
 */
export const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:3080').replace(/\/$/, '')
export const API_ORIGIN = (process.env.E2E_API_URL || 'http://localhost:8000').replace(/\/$/, '')
export const API = `${API_ORIGIN}/api`
const ADMIN_API = `${API}/admin`

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme'

/** Имя участника по умолчанию: под ним же работают API-вызовы спеков. */
export const DEFAULT_USER_NAME = 'E2E Тестер'

/** Версия сохранённого состояния стора (см. APP_STORE_VERSION в store/index.ts). */
const STORE_VERSION = 1

/**
 * Сессия участника для тестов. Сервер отдаёт токен только в httpOnly-cookie
 * `workspace_token`; здесь он вынут из ответа входа, чтобы спеки могли слать его
 * в заголовке `X-Workspace-Token` (сервер принимает его от неинтерактивных клиентов).
 */
export interface E2ESession {
  token: string
  workspace_id: string
  workspace_slug: string
  workspace_name: string
  participant: { id: string; name: string }
}

/** Cache CSRF token per request context. */
let csrfToken: string | null = null

/** Cache workspace session to avoid rate-limited login calls. */
let cachedWorkspaceSession: E2ESession | null = null

/** Имя, заданное странице через setUsername: под ним loginWorkspace выполнит вход. */
const pageNames = new WeakMap<Page, string>()

/** Значение cookie из заголовков Set-Cookie ответа. */
function cookieFromResponse(res: APIResponse, name: string): string | null {
  for (const header of res.headersArray()) {
    if (header.name.toLowerCase() !== 'set-cookie') continue
    const match = header.value.match(new RegExp(`(?:^|\\n)${name}=([^;\\n]+)`))
    if (match) return match[1]
  }
  return null
}

/** Сессия общего участника из global-setup (переменная окружения E2E_SHARED_SESSION). */
function sharedSessionFromEnv(workspaceSlug: string): E2ESession | null {
  const raw = process.env.E2E_SHARED_SESSION
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as E2ESession
    return session.token && session.participant?.id && session.workspace_slug === workspaceSlug
      ? session
      : null
  } catch {
    return null
  }
}

/** Разобрать ответ входа: тело плюс токен из cookie `workspace_token`. */
async function sessionFromLoginResponse(res: APIResponse): Promise<E2ESession> {
  const token = cookieFromResponse(res, 'workspace_token')
  if (!token) throw new Error('Login response has no workspace_token cookie')
  const body = (await res.json()) as Omit<E2ESession, 'token'>
  return { ...body, token }
}

/**
 * Войти в команду через API новым участником с именем `name`.
 * Каждый вызов создаёт нового участника — тёзки на сервере различаются.
 */
export async function loginViaAPI(
  request: APIRequestContext,
  name = DEFAULT_USER_NAME,
  workspaceSlug = 'e2e-team',
  accessKey = 'e2e-test-key',
): Promise<E2ESession> {
  const session = await loginWithRetry(request, workspaceSlug, accessKey, name)
  if (!session) throw new Error(`Failed to login to workspace ${workspaceSlug} as "${name}"`)
  return session
}

/** Cache admin cookie for admin API calls. */
let cachedAdminCookie: string | null = null

/** Obtain a CSRF token via GET, then return headers for mutating requests. */
export async function getCsrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  if (!csrfToken) {
    // GET /workspaces/me выставляет cookie csrf_token всегда — и без сессии, и когда
    // cookie уже есть (другие GET повторно её не присылают)
    const res = await request.get(`${API}/workspaces/me`)
    csrfToken = cookieFromResponse(res, 'csrf_token')
  }
  return csrfToken ? { 'X-CSRF-Token': csrfToken, Cookie: `csrf_token=${csrfToken}` } : {}
}

/**
 * Delete all boards (and cascade-deletes columns, cards, action items).
 *
 * Удалить доску может только её создатель (или ведущий), поэтому доски в спеках
 * создаёт общий участник — через API его токеном или со страницы с именем по умолчанию.
 * Доска другого участника здесь не удалится: падаем сразу и с понятной причиной,
 * а не цепочкой 409 «такая доска уже есть» в следующих тестах.
 */
export async function cleanupBoards(request: APIRequestContext, workspaceToken?: string) {
  const csrfHeaders = await getCsrfHeaders(request)
  const headers = workspaceToken
    ? { ...csrfHeaders, 'X-Workspace-Token': workspaceToken }
    : csrfHeaders

  const res = await request.get(`${API}/boards/`, { headers })
  if (!res.ok()) throw new Error(`cleanupBoards: не удалось получить список досок (${res.status()})`)
  const boards = (await res.json()) as Array<{ id: string; name: string }>
  for (const b of boards) {
    const del = await request.delete(`${API}/boards/${b.id}`, { headers })
    if (!del.ok() && del.status() !== 404) {
      throw new Error(
        `cleanupBoards: доска «${b.name}» не удалена (${del.status()}): ` +
          'её создал другой участник? Доски в спеках создаёт общий участник',
      )
    }
  }
}

/**
 * Задать имя участника для страницы и сбросить устаревшее локальное состояние.
 * Сам вход выполняет loginWorkspace: имя по умолчанию — общий участник спеков
 * (создатель досок и автор карточек, созданных через API), другое имя — новый участник.
 */
export async function setUsername(page: Page, name = DEFAULT_USER_NAME) {
  pageNames.set(page, name)
  await page.addInitScript(
    ({ n, version }) => {
      // Clear stale board lock flags and timer state from previous tests
      const keysToRemove = Object.keys(localStorage).filter(
        (k) => k.startsWith('retro_locked_') || k.startsWith('retro_timer_'),
      )
      keysToRemove.forEach((k) => localStorage.removeItem(k))
      const store = {
        state: {
          username: n,
          currentBoardId: null,
          theme: { primary: '#6750A4', dark: false },
          workspace: null,
          participant: null,
        },
        version,
      }
      localStorage.setItem('retroboard-app', JSON.stringify(store))
    },
    { n: name, version: STORE_VERSION },
  )
}

/**
 * Открыть сессию для страницы без экрана входа: cookie `workspace_token` в контекст
 * браузера и сессия (команда + участник) в localStorage — как после входа через форму.
 *
 * Страница с именем по умолчанию работает от имени общего участника спеков
 * (см. ensureE2EWorkspace); страница с другим именем (setUsername) получает
 * собственного участника. Возвращает сессию страницы.
 *
 * Тест, который нажимает «Выйти», обязан работать от имени собственного участника
 * (setUsername с другим именем или вход через форму): выход завершает сессию на
 * сервере, и общий участник перестал бы пускать остальные спеки.
 */
export async function loginWorkspace(
  page: Page,
  request: APIRequestContext,
  workspaceSlug = 'e2e-team',
  accessKey = 'e2e-test-key',
): Promise<E2ESession> {
  const name = pageNames.get(page) ?? DEFAULT_USER_NAME
  const useShared =
    name === DEFAULT_USER_NAME && workspaceSlug === 'e2e-team' && accessKey === 'e2e-test-key'
  const session = useShared
    ? await ensureE2EWorkspace(request)
    : await loginViaAPI(request, name, workspaceSlug, accessKey)

  await page.context().addCookies([
    {
      name: 'workspace_token',
      value: session.token,
      domain: new URL(BASE_URL).hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])

  await page.addInitScript(
    ({ workspace, participant, version }) => {
      const stored = localStorage.getItem('retroboard-app')
      const state = stored ? JSON.parse(stored) : { state: {}, version }
      state.version = version
      state.state.workspace = workspace
      state.state.participant = participant
      state.state.username = participant.name
      localStorage.setItem('retroboard-app', JSON.stringify(state))
    },
    {
      workspace: {
        workspaceId: session.workspace_id,
        workspaceSlug: session.workspace_slug,
        workspaceName: session.workspace_name,
      },
      participant: session.participant,
      version: STORE_VERSION,
    },
  )
  return session
}

/** Helper: retry a login request with delays to handle rate limiting (429). */
async function loginWithRetry(
  request: APIRequestContext,
  workspaceSlug: string,
  accessKey: string,
  name = DEFAULT_USER_NAME,
  maxRetries = 3,
): Promise<E2ESession | null> {
  for (let i = 0; i <= maxRetries; i++) {
    const res = await request.post(`${API}/workspaces/login`, {
      data: { workspace_slug: workspaceSlug, access_key: accessKey, name },
    })
    if (res.ok()) return await sessionFromLoginResponse(res)
    if (res.status() === 429 && i < maxRetries) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
      continue
    }
    if (res.status() !== 429) return null // non-retryable failure
  }
  return null
}

/** Helper: retry admin login with delays to handle rate limiting (429) or backend not ready (500). */
async function adminLoginWithRetry(
  request: APIRequestContext,
  maxRetries = 5,
): Promise<string | null> {
  for (let i = 0; i <= maxRetries; i++) {
    const res = await request.post(`${ADMIN_API}/login`, {
      data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD },
    })
    if (res.ok()) {
      const setCookies = res.headers()['set-cookie'] || ''
      return setCookies
    }
    if ((res.status() === 429 || res.status() === 500) && i < maxRetries) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
      continue
    }
    return null
  }
  return null
}

/**
 * Ensure E2E workspace exists, create if needed. Returns the shared session:
 * общий участник спеков с именем DEFAULT_USER_NAME. Его токен спеки шлют в
 * `X-Workspace-Token`, и под ним же открывается страница с именем по умолчанию.
 */
export async function ensureE2EWorkspace(
  request: APIRequestContext,
  workspaceSlug = 'e2e-team',
  accessKey = 'e2e-test-key',
  workspaceName = 'E2E Team',
): Promise<E2ESession> {
  // Return cached session to avoid hitting rate limits
  if (cachedWorkspaceSession) return cachedWorkspaceSession

  // Сессию общего участника готовит global-setup и передаёт воркерам через окружение:
  // так участник один на весь прогон, даже если воркер перезапустился после упавшего теста
  const shared = sharedSessionFromEnv(workspaceSlug)
  if (shared) {
    const me = await request.get(`${API}/workspaces/me`, {
      headers: { 'X-Workspace-Token': shared.token },
    })
    if (me.ok()) {
      cachedWorkspaceSession = shared
      return shared
    }
  }

  // Try to login first (with retry for rate limiting)
  const loginResult = await loginWithRetry(request, workspaceSlug, accessKey)
  if (loginResult) {
    cachedWorkspaceSession = loginResult
    return loginResult
  }

  // Need to create via admin (with retry for rate limiting / backend not ready)
  const adminCookie = await adminLoginWithRetry(request)
  if (!adminCookie) {
    throw new Error(`Failed to login as admin after retries`)
  }

  // Create workspace (ignore 409 — already exists, retry on 500)
  let createRes: Awaited<ReturnType<typeof request.post>> | null = null
  for (let i = 0; i <= 3; i++) {
    createRes = await request.post(`${ADMIN_API}/workspaces`, {
      data: { slug: workspaceSlug, name: workspaceName, access_key: accessKey },
      headers: await getAdminMutHeaders(request),
    })
    if (createRes.ok() || createRes.status() === 409) break
    if (createRes.status() === 500 && i < 3) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
      continue
    }
  }

  if (!createRes?.ok() && createRes?.status() !== 409) {
    throw new Error(`Failed to create workspace: ${createRes?.status()}`)
  }

  // Login (with retry for rate limiting)
  const finalResult = await loginWithRetry(request, workspaceSlug, accessKey)
  if (!finalResult) {
    throw new Error('Failed to login to workspace after creation (rate limited or auth error)')
  }
  cachedWorkspaceSession = finalResult
  return finalResult
}

/** Get cached admin cookie, login if needed. */
export async function getAdminCookie(request: APIRequestContext): Promise<string> {
  if (cachedAdminCookie) return cachedAdminCookie

  const adminCookie = await adminLoginWithRetry(request)
  if (!adminCookie) throw new Error(`Failed to admin login after retries`)

  const match = adminCookie.match(/admin_token=([^;]+)/)
  if (!match) throw new Error('No admin_token in cookie')
  cachedAdminCookie = match[0]
  return cachedAdminCookie
}

/** Headers for admin MUTATING requests: admin cookie + CSRF pair.
 * CSRF is enforced on /api/admin/* (except login) — plain `{ Cookie }`
 * gets 403. Safe-method GETs don't need it. */
export async function getAdminMutHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const cookie = await getAdminCookie(request)
  const csrf = await getCsrfHeaders(request)
  const csrfCookie = csrf['Cookie'] ? `; ${csrf['Cookie']}` : ''
  return { ...csrf, Cookie: `${cookie}${csrfCookie}` }
}

/** Get workspace by slug from admin API. */
export async function getWorkspaceBySlug(
  request: APIRequestContext,
  slug: string,
): Promise<{ id: string; name: string } | null> {
  const cookie = await getAdminCookie(request)
  const res = await request.get(`${ADMIN_API}/workspaces`, {
    headers: { Cookie: cookie },
  })
  if (!res.ok()) return null
  const workspaces: Array<{ id: string; slug: string; name: string }> = await res.json()
  return workspaces.find((ws) => ws.slug === slug) || null
}

/** Update workspace name via admin API. */
export async function updateWorkspaceName(
  request: APIRequestContext,
  workspaceId: string,
  newName: string,
): Promise<void> {
  const cookie = await getAdminCookie(request)
  const csrf = await getCsrfHeaders(request)
  const csrfCookie = csrf['Cookie'] ? `; ${csrf['Cookie']}` : ''
  const headers = { ...csrf, Cookie: `${cookie}${csrfCookie}` }
  await request.patch(`${ADMIN_API}/workspaces/${workspaceId}`, {
    data: { name: newName },
    headers,
  })
}

/** Delete workspace via admin API. */
export async function deleteWorkspace(
  request: APIRequestContext,
  workspaceId: string,
): Promise<void> {
  const headers = await getAdminMutHeaders(request)
  await request.delete(`${ADMIN_API}/workspaces/${workspaceId}`, {
    headers,
  })
}

/**
 * Дождаться, пока страница покажет доску (сессия открыта через loginWorkspace)
 * либо экран входа. Экран входа сам не закрывается: вход — это код команды и ключ.
 */
export async function dismissWelcome(page: Page) {
  await Promise.race([
    page.getByText('Войти на доску').waitFor({ timeout: 15000 }),
    page.getByTestId('user-settings-btn').waitFor({ timeout: 15000 }),
  ]).catch(() => {})
}

/** Create a board via API and return its data (retries briefly on 429 rate-limit). */
export async function createBoardViaAPI(request: APIRequestContext, name: string, workspaceToken?: string) {
  const csrfHeaders = await getCsrfHeaders(request)
  const headers = workspaceToken
    ? { ...csrfHeaders, 'X-Workspace-Token': workspaceToken }
    : csrfHeaders
  for (let i = 0; i <= 4; i++) {
    const res = await request.post(`${API}/boards/`, { data: { name }, headers })
    if (res.ok()) {
      return res.json()
    }
    if (res.status() === 429 && i < 4) {
      const retryAfter = Number(res.headers()['retry-after'] || 0)
      const waitMs = Math.min(12000, Math.max(4000, retryAfter * 1000 || 4000 * (i + 1)))
      await new Promise((r) => setTimeout(r, waitMs))
      continue
    }
    throw new Error(`Failed to create board "${name}": ${res.status()} ${await res.text()}`)
  }
  throw new Error(`Failed to create board "${name}" after retries`)
}

/** Create an action item via API. */
export async function createActionItemViaAPI(
  request: APIRequestContext,
  boardId: string,
  text: string,
  workspaceToken?: string,
  opts?: { title?: string; assignee?: string; status?: string },
) {
  const csrfHeaders = await getCsrfHeaders(request)
  const headers = workspaceToken
    ? { ...csrfHeaders, 'X-Workspace-Token': workspaceToken }
    : csrfHeaders
  const res = await request.post(`${API}/action-items/`, {
    data: { board_id: boardId, text, ...opts },
    headers,
  })
  return res.json()
}
