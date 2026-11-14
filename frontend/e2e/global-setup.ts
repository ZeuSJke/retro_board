import { request, type APIRequestContext } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// Load root .env for admin credentials
const envPath = path.resolve(__dirname, '../../.env')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    if (key && !process.env[key]) process.env[key] = val
  }
}

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme'

const E2E_WORKSPACE = { slug: 'e2e-team', name: 'E2E Team', access_key: 'e2e-test-key' }
// Команды, которые спеки создают сами: удаляем остатки прошлых прогонов
const SCRATCH_WORKSPACE_SLUGS = ['e2e-team-2']
// Общий участник спеков (см. DEFAULT_USER_NAME и ensureE2EWorkspace в helpers.ts)
const SHARED_USER_NAME = 'E2E Тестер'

/**
 * Войти общим участником и передать его сессию воркерам через переменную окружения.
 *
 * Удалять доску может только её создатель, поэтому все воркеры (в том числе
 * перезапущенные после упавшего теста) должны работать от имени одного участника —
 * иначе очистка между тестами перестаёт удалять доски, созданные до перезапуска.
 */
async function exportSharedSession(context: APIRequestContext): Promise<boolean> {
  const res = await context.post('/api/workspaces/login', {
    data: {
      workspace_slug: E2E_WORKSPACE.slug,
      access_key: E2E_WORKSPACE.access_key,
      name: SHARED_USER_NAME,
    },
  })
  if (!res.ok()) {
    console.log(`[setup] Workspace login failed: ${res.status()}`)
    return false
  }
  // Токен сессии сервер отдаёт только в httpOnly-cookie
  const cookie = res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value.match(/(?:^|\n)workspace_token=([^;\n]+)/)?.[1])
    .find(Boolean)
  if (!cookie) {
    console.error('[setup] Login response has no workspace_token cookie')
    return false
  }
  const body = (await res.json()) as Record<string, unknown>
  process.env.E2E_SHARED_SESSION = JSON.stringify({ ...body, token: cookie })
  console.log('[setup] Shared participant session is ready')
  return true
}

export default async function globalSetup() {
  const context = await request.newContext({
    baseURL: process.env.E2E_API_URL || 'http://localhost:8000',
  })

  // Helper: retry with delays
  async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 5,
    delayMs = 3000,
  ): Promise<T | null> {
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn()
      } catch {
        if (i < maxRetries) {
          console.log(`[setup] Retry ${i + 1}/${maxRetries}...`)
          await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
        }
      }
    }
    return null
  }

  try {
    console.log('[setup] Waiting for backend to be ready...')

    // Wait for health endpoint
    const healthRes = await withRetry(() => context.get('/health'), 10, 2000)
    if (!healthRes?.ok()) {
      console.error('[setup] Backend not ready after retries')
      return
    }
    console.log('[setup] Health check passed')

    // /api/ready проверяет соединение с БД: ждём, пока миграции отработают
    const readyRes = await withRetry(async () => {
      const res = await context.get('/api/ready')
      if (!res.ok()) throw new Error(`not ready: ${res.status()}`)
      return res
    }, 10, 2000)
    if (!readyRes?.ok()) {
      console.error('[setup] DB is not ready after retries')
    } else {
      console.log('[setup] DB is ready')
    }

    // Чистый лист на каждый прогон: команда e2e-team создаётся заново через админку.
    // Доски прошлых прогонов создавали другие участники, и удалить их через API нельзя.
    console.log('[setup] Admin login...')
    const adminLoginRes = await withRetry(async () => {
      const res = await context.post('/api/admin/login', {
        data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD },
      })
      // 429/5xx — повод подождать и повторить; неверный пароль повторять бессмысленно
      if (res.status() === 429 || res.status() >= 500) throw new Error(`admin login: ${res.status()}`)
      return res
    })

    if (!adminLoginRes?.ok()) {
      console.error(
        `[setup] Admin login failed (${adminLoginRes?.status() ?? 'no response'}): ` +
          'workspace is not recreated, trying to reuse the existing one',
      )
      await exportSharedSession(context)
      return
    }

    const setCookies = adminLoginRes.headers()['set-cookie'] || ''
    const adminCookie = setCookies.match(/admin_token=[^;]+/)?.[0] || setCookies

    // CSRF is enforced on /api/admin/* (except login): read csrf cookie from jar or refresh via /api/workspaces/me
    const jarCookies = (await context.storageState()).cookies
    let csrfToken = jarCookies.find((c) => c.name === 'csrf_token')?.value ?? null
    if (!csrfToken) {
      const csrfRes = await context.get('/api/workspaces/me')
      const csrfMatch = (csrfRes.headers()['set-cookie'] || '').match(/csrf_token=([^;]+)/)
      csrfToken = csrfMatch ? csrfMatch[1] : null
    }
    const mutHeaders = (base: string) => ({
      Cookie: csrfToken ? `${base}; csrf_token=${csrfToken}` : base,
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    })

    const listRes = await context.get('/api/admin/workspaces', {
      headers: { Cookie: adminCookie },
    })
    if (listRes.ok()) {
      const workspaces = (await listRes.json()) as Array<{ slug: string; id: string }>
      const stale = workspaces.filter(
        (w) => w.slug === E2E_WORKSPACE.slug || SCRATCH_WORKSPACE_SLUGS.includes(w.slug),
      )
      for (const ws of stale) {
        console.log(`[setup] Deleting ${ws.slug} left from a previous run`)
        await context.delete(`/api/admin/workspaces/${ws.id}`, {
          headers: mutHeaders(adminCookie),
        })
      }
    }

    // Create workspace with retry
    console.log('[setup] Creating workspace...')
    let lastError = 'unknown'
    for (let i = 0; i <= 3; i++) {
      try {
        const createRes = await context.post('/api/admin/workspaces', {
          data: E2E_WORKSPACE,
          headers: mutHeaders(adminCookie),
        })
        if (createRes.ok() || createRes.status() === 409) {
          console.log('[setup] Created e2e-team workspace')
          lastError = 'success'
          break
        }
        const body = await createRes.text()
        lastError = `${createRes.status()}: ${body}`
        console.log(`[setup] Create attempt ${i + 1} failed: ${lastError}`)
        if (i < 3) {
          await new Promise((r) => setTimeout(r, 3000 * (i + 1)))
        }
      } catch (e) {
        lastError = String(e)
        console.log(`[setup] Create attempt ${i + 1} exception: ${lastError}`)
        if (i < 3) {
          await new Promise((r) => setTimeout(r, 3000 * (i + 1)))
        }
      }
    }
    if (lastError !== 'success') {
      console.error(`[setup] Failed to create workspace: ${lastError}`)
    }

    await exportSharedSession(context)
  } finally {
    await context.dispose()
  }
}
