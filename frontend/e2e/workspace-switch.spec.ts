import { test, expect } from '@playwright/test'
import {
  cleanupBoards,
  createBoardViaAPI,
  getAdminCookie,
} from './helpers'

const SECOND_WORKSPACE_SLUG = 'e2e-team-2'
const SECOND_WORKSPACE_KEY = 'e2e-test-key-2'
const SECOND_WORKSPACE_NAME = 'E2E Team 2'

async function createWorkspace(
  request: import('@playwright/test').APIRequestContext,
  slug: string,
  name: string,
  accessKey: string,
) {
  const cookie = await getAdminCookie(request)
  const res = await request.post(`http://localhost:8000/api/admin/workspaces`, {
    data: { slug, name, access_key: accessKey },
    headers: { Cookie: cookie },
  })
  return res.ok() || res.status() === 409
}

async function loginToWorkspace(
  request: import('@playwright/test').APIRequestContext,
  slug: string,
  accessKey: string,
) {
  const res = await request.post(`http://localhost:8000/api/workspaces/login`, {
    data: { workspace_slug: slug, access_key: accessKey },
  })
  if (!res.ok()) throw new Error(`Failed to login to workspace: ${res.status()}`)
  return res.json()
}

test.describe('Workspace switch — переключение между workspace', () => {
  test.beforeAll(async ({ request }) => {
    await createWorkspace(request, SECOND_WORKSPACE_SLUG, SECOND_WORKSPACE_NAME, SECOND_WORKSPACE_KEY)
  })

  test.beforeEach(async ({ request }) => {
    const ws1Session = await loginToWorkspace(request, 'e2e-team', 'e2e-test-key')
    await cleanupBoards(request, ws1Session.token)
    await createBoardViaAPI(request, 'Ретро Q1', ws1Session.token)

    const ws2Session = await loginToWorkspace(request, SECOND_WORKSPACE_SLUG, SECOND_WORKSPACE_KEY)
    await cleanupBoards(request, ws2Session.token)
    await createBoardViaAPI(request, 'Ретро Q1', ws2Session.token)
  })

  test('два workspace могут создавать доски с одинаковым названием', async ({ request }) => {
    const ws1Session = await loginToWorkspace(request, 'e2e-team', 'e2e-test-key')
    const ws2Session = await loginToWorkspace(request, SECOND_WORKSPACE_SLUG, SECOND_WORKSPACE_KEY)

    const board1 = await createBoardViaAPI(request, 'Общая ретро', ws1Session.token)
    expect(board1.id).toBeDefined()

    const board2 = await createBoardViaAPI(request, 'Общая ретро', ws2Session.token)
    expect(board2.id).toBeDefined()

    expect(board1.id).not.toEqual(board2.id)
  })

  test('смена workspace через Topbar работает без ошибок', async ({ page, request }) => {
    await page.goto('/')

    await page.getByPlaceholder(/ваше имя/i).fill('Тестер WS1')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByRole('button', { name: /войти на доску/i }).click()

    await expect(page.getByRole('button', { name: 'Ретро Q1' })).toBeVisible({ timeout: 15000 })

    await page.locator('button').filter({ hasText: /тестер ws1/i }).click()
    await page.waitForTimeout(500)

    const dialog = page.locator('div').filter({ hasText: /настройки пользователя/i }).first()
    await expect(dialog).toBeVisible()

    const changeBtn = dialog.getByRole('button', { name: 'Сменить' })
    if (await changeBtn.isVisible()) {
      await changeBtn.click()
      await page.waitForTimeout(500)
    }

    await dialog.locator('input').first().fill(SECOND_WORKSPACE_SLUG)
    await dialog.locator('input[type="password"]').fill(SECOND_WORKSPACE_KEY)

    const confirmBtn = dialog.getByRole('button', { name: 'Сохранить' })
    await expect(confirmBtn).toBeVisible({ timeout: 5000 })
    await confirmBtn.click()

    await page.waitForURL(/\/board\//, { timeout: 10000 })
    await page.waitForTimeout(1000)

    const errorVisible = await page.getByText(/не удалось загрузить/i).isVisible().catch(() => false)
    expect(errorVisible).toBe(false)

    const hasBoardContent = await page.locator('main').isVisible()
    expect(hasBoardContent).toBe(true)
  })
})
