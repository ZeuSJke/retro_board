import { request } from '@playwright/test'
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

export default async function globalSetup() {
  const context = await request.newContext({ baseURL: 'http://localhost:8000' })

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
    // Wait for backend to be healthy
    await new Promise((r) => setTimeout(r, 10000)) // 10 second delay for testing
    console.log('[setup] Waiting for backend to be ready...')
    const healthRes = await withRetry(() => context.get('/health'), 10, 2000)
    if (!healthRes?.ok()) {
      console.error('[setup] Backend not ready after retries')
      return
    }
    console.log('[setup] Backend is ready')

    // Try to login to e2e-team workspace
    const loginRes = await context.post('/api/workspaces/login', {
      data: { workspace_slug: 'e2e-team', access_key: 'e2e-test-key' },
    })

    if (loginRes.ok()) {
      console.log('[setup] e2e-team workspace already exists and login works')
      return
    }

    // Login failed — need admin to create/recreate workspace
    console.log('[setup] Admin login...')
    const adminLoginRes = await withRetry(() =>
      context.post('/api/admin/login', {
        data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD },
      }),
    )

    if (!adminLoginRes?.ok()) {
      console.error(`[setup] Admin login failed after retries`)
      return
    }

    const setCookies = adminLoginRes.headers()['set-cookie'] || ''
    const adminCookie = setCookies

    // List workspaces to check if e2e-team exists with wrong key
    const listRes = await context.get('/api/admin/workspaces', {
      headers: { Cookie: adminCookie },
    })

    if (listRes.ok()) {
      const workspaces = await listRes.json()
      const existing = workspaces.find((w: { slug: string; id: string }) => w.slug === 'e2e-team')
      if (existing) {
        // Workspace exists but login failed — delete and recreate with correct key
        console.log('[setup] e2e-team exists with wrong key — deleting and recreating')
        await context.delete(`/api/admin/workspaces/${existing.id}`, {
          headers: { Cookie: adminCookie },
        })
      }
    }

    // Create workspace with retry
    console.log('[setup] Creating workspace...')
    const createRes = await withRetry(() =>
      context.post('/api/admin/workspaces', {
        data: { slug: 'e2e-team', name: 'E2E Team', access_key: 'e2e-test-key' },
        headers: { Cookie: adminCookie },
      }),
    )

    if (createRes?.ok()) {
      console.log('[setup] Created e2e-team workspace')
    } else {
      console.error(`[setup] Failed to create workspace after retries`)
    }
  } finally {
    await context.dispose()
  }
}
