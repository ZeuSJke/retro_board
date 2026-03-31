import { type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://localhost:8000/api'
const ADMIN_API = 'http://localhost:8000/api/admin'

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme'

/** Cache CSRF token per request context. */
let csrfToken: string | null = null

/** Cache workspace session to avoid rate-limited login calls. */
let cachedWorkspaceSession: Record<string, unknown> | null = null

/** Cache admin cookie for admin API calls. */
let cachedAdminCookie: string | null = null

/** Obtain a CSRF token via GET, then return headers for mutating requests. */
export async function getCsrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  if (!csrfToken) {
    const res = await request.get(`${API}/boards/`)
    const setCookie = res.headers()['set-cookie'] || ''
    const match = setCookie.match(/csrf_token=([^;]+)/)
    csrfToken = match ? match[1] : null
  }
  return csrfToken ? { 'X-CSRF-Token': csrfToken, Cookie: `csrf_token=${csrfToken}` } : {}
}

/** Delete all boards (and cascade-deletes columns, cards, action items). */
export async function cleanupBoards(request: APIRequestContext, workspaceToken?: string) {
  const csrfHeaders = await getCsrfHeaders(request)
  const headers = workspaceToken
    ? { ...csrfHeaders, 'X-Workspace-Token': workspaceToken }
    : csrfHeaders

  const res = await request.get(`${API}/boards/`, { headers })
  const boards = await res.json()
  for (const b of boards) {
    await request.delete(`${API}/boards/${b.id}`, { headers })
  }
}

/** Set username in localStorage to skip welcome dialog. Clears stale state. */
export async function setUsername(page: Page, name = 'E2E Тестер') {
  await page.addInitScript((n) => {
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
      },
      version: 0,
    }
    localStorage.setItem('retroboard-app', JSON.stringify(store))
  }, name)
}

/** Login to workspace and set token in localStorage. Uses cached session when available. */
export async function loginWorkspace(
  page: Page,
  request: APIRequestContext,
  workspaceSlug = 'e2e-team',
  accessKey = 'e2e-test-key',
) {
  // Reuse cached session from ensureE2EWorkspace to avoid rate limiting
  let data = cachedWorkspaceSession
  if (!data) {
    const res = await request.post(`${API}/workspaces/login`, {
      data: { workspace_slug: workspaceSlug, access_key: accessKey },
    })
    if (!res.ok()) {
      throw new Error(`Failed to login to workspace: ${res.status()}`)
    }
    data = await res.json()
    cachedWorkspaceSession = data
  }

  await page.addInitScript((session) => {
    const stored = localStorage.getItem('retroboard-app')
    const state = stored ? JSON.parse(stored) : { state: {}, version: 0 }
    state.state.workspace = session
    localStorage.setItem('retroboard-app', JSON.stringify(state))
  }, {
    token: (data as Record<string, unknown>).token,
    workspaceId: (data as Record<string, unknown>).workspace_id,
    workspaceSlug: (data as Record<string, unknown>).workspace_slug,
    workspaceName: (data as Record<string, unknown>).workspace_name,
  })
}

/** Helper: retry a login request with delays to handle rate limiting (429). */
async function loginWithRetry(
  request: APIRequestContext,
  workspaceSlug: string,
  accessKey: string,
  maxRetries = 3,
) {
  for (let i = 0; i <= maxRetries; i++) {
    const res = await request.post(`${API}/workspaces/login`, {
      data: { workspace_slug: workspaceSlug, access_key: accessKey },
    })
    if (res.ok()) return await res.json()
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

/** Ensure E2E workspace exists, create if needed. Returns workspace session. */
export async function ensureE2EWorkspace(
  request: APIRequestContext,
  workspaceSlug = 'e2e-team',
  accessKey = 'e2e-test-key',
  workspaceName = 'E2E Team',
) {
  // Return cached session to avoid hitting rate limits
  if (cachedWorkspaceSession) return cachedWorkspaceSession

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
      headers: { Cookie: adminCookie },
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
  await request.patch(`${ADMIN_API}/workspaces/${workspaceId}`, {
    data: { name: newName },
    headers: { Cookie: cookie },
  })
}

/** Delete workspace via admin API. */
export async function deleteWorkspace(
  request: APIRequestContext,
  workspaceId: string,
): Promise<void> {
  const cookie = await getAdminCookie(request)
  await request.delete(`${ADMIN_API}/workspaces/${workspaceId}`, {
    headers: { Cookie: cookie },
  })
}

/** Dismiss welcome dialog if it appears (Next.js hydration may show it). */
export async function dismissWelcome(page: Page) {
  // Wait until either the welcome dialog or the board toolbar appears (loading done)
  await Promise.race([
    page.getByText('Войти на доску').waitFor({ timeout: 15000 }),
    page.getByText('Новая колонка').waitFor({ timeout: 15000 }),
  ]).catch(() => {})

  const btn = page.getByText('Войти на доску')
  if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await btn.click()
  }
}

/** Create a board via API and return its data. */
export async function createBoardViaAPI(request: APIRequestContext, name: string, workspaceToken?: string) {
  const csrfHeaders = await getCsrfHeaders(request)
  const headers = workspaceToken
    ? { ...csrfHeaders, 'X-Workspace-Token': workspaceToken }
    : csrfHeaders
  const res = await request.post(`${API}/boards/`, { data: { name }, headers })
  return res.json()
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
