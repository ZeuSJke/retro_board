import { test, expect } from '@playwright/test'
import {
  API,
  DEFAULT_USER_NAME,
  cleanupBoards,
  createBoardViaAPI,
  ensureE2EWorkspace,
  getAdminMutHeaders,
  loginViaAPI,
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
  const headers = await getAdminMutHeaders(request)
  const res = await request.post(`${API}/admin/workspaces`, {
    data: { slug, name, access_key: accessKey },
    headers,
  })
  return res.ok() || res.status() === 409
}

/** Сессия в команде: токен берётся из cookie ответа входа (в теле его нет). */
function loginToWorkspace(
  request: import('@playwright/test').APIRequestContext,
  slug: string,
  accessKey: string,
) {
  return loginViaAPI(request, DEFAULT_USER_NAME, slug, accessKey)
}

test.describe('Workspace switch — переключение между workspace', () => {
  test.beforeAll(async ({ request }) => {
    await createWorkspace(request, SECOND_WORKSPACE_SLUG, SECOND_WORKSPACE_NAME, SECOND_WORKSPACE_KEY)
  })

  test.beforeEach(async ({ request }) => {
    // Первая команда — общий участник спеков: он создатель досок и может их удалять
    const ws1Session = await ensureE2EWorkspace(request)
    await cleanupBoards(request, ws1Session.token)
    await createBoardViaAPI(request, 'Ретро Q1', ws1Session.token)

    // Во второй команде каждый вход — новый участник, чужие доски он удалить не может:
    // достаточно, чтобы доска там была
    const ws2Session = await loginToWorkspace(request, SECOND_WORKSPACE_SLUG, SECOND_WORKSPACE_KEY)
    const ws2Boards = await request.get(`${API}/boards/`, {
      headers: { 'X-Workspace-Token': ws2Session.token },
    })
    if (((await ws2Boards.json()) as unknown[]).length === 0) {
      await createBoardViaAPI(request, 'Ретро Q1', ws2Session.token)
    }
  })

  test('два workspace могут создавать доски с одинаковым названием', async ({ request }) => {
    const ws1Session = await ensureE2EWorkspace(request)
    const ws2Session = await loginToWorkspace(request, SECOND_WORKSPACE_SLUG, SECOND_WORKSPACE_KEY)

    const boardName = `Общая ретро ${Date.now()}`
    const board1 = await createBoardViaAPI(request, boardName, ws1Session.token)
    expect(board1.id).toBeDefined()

    const board2 = await createBoardViaAPI(request, boardName, ws2Session.token)
    expect(board2.id).toBeDefined()

    expect(board1.id).not.toEqual(board2.id)
  })

  test('смена workspace через Topbar работает без ошибок', async ({ page }) => {
    await page.goto('/')

    await page.getByPlaceholder(/ваше имя/i).fill('Тестер WS1')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByRole('button', { name: /войти на доску/i }).click()

    await expect(page.getByRole('button', { name: 'Ретро Q1' })).toBeVisible({ timeout: 15000 })

    await page.getByTestId('user-settings-btn').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: 'Выйти' }).click()

    await expect(page.getByPlaceholder(/код команды|fmrm/i)).toBeVisible({ timeout: 5000 })
    await page.getByPlaceholder(/код команды|fmrm/i).fill(SECOND_WORKSPACE_SLUG)
    await page.getByPlaceholder(/ключ доступа/i).fill(SECOND_WORKSPACE_KEY)

    const confirmBtn = page.getByRole('button', { name: /войти на доску/i })
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
