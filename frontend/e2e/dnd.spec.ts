import { test, expect } from '@playwright/test'
import { cleanupBoards, setUsername, dismissWelcome, createBoardViaAPI, getCsrfHeaders, ensureE2EWorkspace, loginWorkspace, API } from './helpers'

test.beforeEach(async ({ page, request }) => {
  const wsData = await ensureE2EWorkspace(request)
  await cleanupBoards(request, wsData.token)
  await setUsername(page)
  await loginWorkspace(page, request)
})

test.afterAll(async ({ request }) => {
  const wsData = await ensureE2EWorkspace(request)
  await cleanupBoards(request, wsData.token)
})

/** Navigate to board and become facilitator. */
async function openBoard(page: import('@playwright/test').Page, slug: string) {
  await page.goto(`/board/${slug}`)
  await dismissWelcome(page)
  const facBtn = page.getByTitle('Стать ведущим')
  if (await facBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await facBtn.click()
  }
}

test.describe('Drag and Drop', () => {
  test('перетаскивание карточки между колонками', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'DnD Доска', wsData.token)
    const csrf = await getCsrfHeaders(request)
    const headers = { ...csrf, 'X-Workspace-Token': wsData.token }

    // Create two columns
    const col1Res = await request.post(`${API}/columns/`, {
      data: { board_id: board.id, title: 'Колонка А' },
      headers,
    })
    const col1 = await col1Res.json()

    await request.post(`${API}/columns/`, {
      data: { board_id: board.id, title: 'Колонка Б' },
      headers,
    })

    // Create a card in column A (owned by current test user so it stays visible during brainstorm)
    await request.post(`${API}/cards/`, {
      data: { column_id: col1.id, text: 'Перетащи меня', author: 'E2E Тестер' },
      headers,
    })

    await openBoard(page, board.slug)

    // Wait for card to appear
    await expect(page.locator('body')).toContainText('Перетащи меня')
    await expect(page.locator('body')).toContainText('Колонка А')
    await expect(page.locator('body')).toContainText('Колонка Б')

    // Find the card and the target column drop zone
    const card = page.getByTestId('card-widget').filter({ hasText: 'Перетащи меня' })
    const targetCol = page.getByTestId('board-column').filter({ hasText: 'Колонка Б' })

    // Perform drag: steps > 1 required for dnd-kit MouseSensor activation + over update
    await card.dragTo(targetCol, { force: true, steps: 10 })

    // Wait for optimistic update + API roundtrip to settle on server
    await expect
      .poll(async () => {
        const res = await request.get(`${API}/boards/${board.id}`, {
          headers: { 'X-Workspace-Token': wsData.token },
        })
        const data = await res.json()
        const b = data.columns.find((c: { title: string }) => c.title === 'Колонка Б')
        return b?.cards?.length || 0
      })
      .toBe(1)

    // Verify the card moved to column B via API
    const boardRes = await request.get(`${API}/boards/${board.id}`, {
      headers: { 'X-Workspace-Token': wsData.token },
    })
    const boardData = await boardRes.json()
    const colB = boardData.columns.find((c: { title: string }) => c.title === 'Колонка Б')
    const colA = boardData.columns.find((c: { title: string }) => c.title === 'Колонка А')

    expect(colA?.cards?.length).toBe(0)
    expect(colB?.cards?.length).toBe(1)
  })
})
