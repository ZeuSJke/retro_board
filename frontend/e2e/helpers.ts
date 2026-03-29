import { type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://localhost:8000/api'
const ADMIN_API = 'http://localhost:8000/api/admin'

/** Cache CSRF token per request context. */
let csrfToken: string | null = null

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

/** Login to workspace and set token in localStorage. */
export async function loginWorkspace(
  page: Page,
  request: APIRequestContext,
  workspaceSlug = 'e2e-team',
  accessKey = 'e2e-test-key',
) {
  const res = await request.post(`${API}/workspaces/login`, {
    data: { workspace_slug: workspaceSlug, access_key: accessKey },
  })

  if (!res.ok()) {
    throw new Error(`Failed to login to workspace: ${res.status()}`)
  }

  const data = await res.json()

  await page.addInitScript((session) => {
    const stored = localStorage.getItem('retroboard-app')
    const state = stored ? JSON.parse(stored) : { state: {}, version: 0 }
    state.state.workspace = session
    localStorage.setItem('retroboard-app', JSON.stringify(state))
  }, {
    token: data.token,
    workspaceId: data.workspace_id,
    workspaceSlug: data.workspace_slug,
    workspaceName: data.workspace_name,
  })
}

/** Ensure E2E workspace exists, create if needed. Returns workspace session. */
export async function ensureE2EWorkspace(
  request: APIRequestContext,
  workspaceSlug = 'e2e-team',
  accessKey = 'e2e-test-key',
  workspaceName = 'E2E Team',
) {
  // Try to login first
  const loginRes = await request.post(`${API}/workspaces/login`, {
    data: { workspace_slug: workspaceSlug, access_key: accessKey },
  })

  if (loginRes.ok()) {
    return await loginRes.json()
  }

  // Need to create via admin
  const adminLoginRes = await request.post(`${ADMIN_API}/login`, {
    data: { login: 'admin', password: 'changeme' },
  })

  if (!adminLoginRes.ok()) {
    throw new Error(`Failed to login as admin: ${adminLoginRes.status()}`)
  }

  // Extract admin token from cookies
  const setCookies = adminLoginRes.headers()['set-cookie'] || ''
  const adminCookie = setCookies

  // Create workspace
  const createRes = await request.post(`${ADMIN_API}/workspaces`, {
    data: { slug: workspaceSlug, name: workspaceName, access_key: accessKey },
    headers: { Cookie: adminCookie },
  })

  if (!createRes.ok()) {
    const status = createRes.status()
    if (status === 409) {
      // Already exists, try to login again
      const retryLoginRes = await request.post(`${API}/workspaces/login`, {
        data: { workspace_slug: workspaceSlug, access_key: accessKey },
      })
      if (retryLoginRes.ok()) {
        return await retryLoginRes.json()
      }
    }
    throw new Error(`Failed to create workspace: ${status}`)
  }

  // Now login
  const finalLoginRes = await request.post(`${API}/workspaces/login`, {
    data: { workspace_slug: workspaceSlug, access_key: accessKey },
  })

  if (!finalLoginRes.ok()) {
    throw new Error(`Failed to login after creating workspace: ${finalLoginRes.status()}`)
  }

  return await finalLoginRes.json()
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
