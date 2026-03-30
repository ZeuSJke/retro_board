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

  try {
    // Try to login to e2e-team workspace
    const loginRes = await context.post('/api/workspaces/login', {
      data: { workspace_slug: 'e2e-team', access_key: 'e2e-test-key' },
    })

    if (loginRes.ok()) {
      console.log('[setup] e2e-team workspace already exists and login works')
      return
    }

    // Login failed — need admin to create/recreate workspace
    const adminLoginRes = await context.post('/api/admin/login', {
      data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD },
    })

    if (!adminLoginRes.ok()) {
      console.error(`[setup] Admin login failed: ${adminLoginRes.status()}`)
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

    const createRes = await context.post('/api/admin/workspaces', {
      data: { slug: 'e2e-team', name: 'E2E Team', access_key: 'e2e-test-key' },
      headers: { Cookie: adminCookie },
    })

    if (createRes.ok()) {
      console.log('[setup] Created e2e-team workspace')
    } else {
      console.error(`[setup] Failed to create workspace: ${createRes.status()}`)
    }
  } finally {
    await context.dispose()
  }
}
