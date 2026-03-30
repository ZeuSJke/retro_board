import { test, expect } from '@playwright/test'
import { cleanupBoards, setUsername, createBoardViaAPI, createActionItemViaAPI, getCsrfHeaders, ensureE2EWorkspace, loginWorkspace } from './helpers'

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

test.describe('Dashboard', () => {
  test('отображает секции и пустое состояние', async ({ page }) => {
    await page.goto('/dashboard')

    await expect(page.locator('h1')).toContainText('История ретро')
    await expect(page.locator('body')).toContainText('Прошлые ретро')
    await expect(page.locator('body')).toContainText('Все задачи')
    await expect(page.locator('body')).toContainText('Нет досок')
  })

  test('отображает доски в секции "Прошлые ретро"', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    await createBoardViaAPI(request, 'Спринт 10', wsData.token)
    await createBoardViaAPI(request, 'Спринт 11', wsData.token)

    await page.goto('/dashboard')

    await expect(page.locator('body')).toContainText('Спринт 10')
    await expect(page.locator('body')).toContainText('Спринт 11')
  })

  test('отображает задачи и сворачивает выполненные', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Тестовый спринт', wsData.token)
    await createActionItemViaAPI(request, board.id, 'Открытая задача', wsData.token, { title: 'Задача А' })
    const doneItem = await createActionItemViaAPI(request, board.id, 'Готовая задача', wsData.token, { title: 'Задача Б' })
    const csrf = await getCsrfHeaders(request)
    await request.patch(`http://localhost:8000/api/action-items/${doneItem.id}`, {
      data: { status: 'done' },
      headers: { ...csrf, 'X-Workspace-Token': wsData.token },
    })

    await page.goto('/dashboard')

    await expect(page.locator('body')).toContainText('Задача А')
    // Done collapsed
    await expect(page.locator('body')).not.toContainText('Задача Б')

    // Expand
    await page.getByText(/Выполненные/).click()
    await expect(page.locator('body')).toContainText('Задача Б')
  })

  test('фильтр по доске', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board1 = await createBoardViaAPI(request, 'Доска Один', wsData.token)
    const board2 = await createBoardViaAPI(request, 'Доска Два', wsData.token)
    await createActionItemViaAPI(request, board1.id, 'Задача из первой', wsData.token, { title: 'Первая' })
    await createActionItemViaAPI(request, board2.id, 'Задача из второй', wsData.token, { title: 'Вторая' })

    await page.goto('/dashboard')
    await expect(page.locator('body')).toContainText('Первая')
    await expect(page.locator('body')).toContainText('Вторая')

    const boardSelect = page.locator('select').nth(1)
    await boardSelect.selectOption({ label: 'Доска Один' })

    await expect(page.locator('body')).toContainText('Первая')
    await expect(page.locator('body')).not.toContainText('Вторая')
  })

  test('отображает график трендов', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Спринт с задачами', wsData.token)
    await createActionItemViaAPI(request, board.id, 'Задача 1', wsData.token)
    await createActionItemViaAPI(request, board.id, 'Задача 2', wsData.token)

    await page.goto('/dashboard')

    await expect(page.locator('body')).toContainText('Тренды задач по ретро')
    // Recharts renders SVG
    await expect(page.locator('.recharts-responsive-container')).toBeVisible()
  })

  test('навигация на доску по клику', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    await createBoardViaAPI(request, 'Кликни меня', wsData.token)

    await page.goto('/dashboard')
    // Board name appears in both board card and select — click the card name specifically
    await page.locator('[class*="boardCardName"]').filter({ hasText: 'Кликни меня' }).click()

    await expect(page).toHaveURL(/\/board\//)
  })
})
