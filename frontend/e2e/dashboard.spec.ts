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

    await expect(page.locator('header')).toContainText('Панель управления')
    await expect(page.getByRole('tab', { name: /Action Items/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Доски/i })).toBeVisible()

    await page.getByRole('tab', { name: /Доски/i }).click()
    await expect(page.locator('body')).toContainText('Пока нет досок')
  })

  test('отображает доски во вкладке "Доски"', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    await createBoardViaAPI(request, 'Спринт 10', wsData.token)
    await createBoardViaAPI(request, 'Спринт 11', wsData.token)

    await page.goto('/dashboard')
    await page.getByRole('tab', { name: /Доски/i }).click()

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
    await page.getByText(/Завершённые/).click()
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

    const boardSelectTrigger = page.getByRole('combobox').nth(1)
    await boardSelectTrigger.click()
    await page.getByRole('option', { name: 'Доска Один' }).click()

    await expect(page.locator('body')).toContainText('Первая')
    await expect(page.locator('body')).not.toContainText('Вторая')
  })

  test('отображает график трендов', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Спринт с задачами', wsData.token)
    await createActionItemViaAPI(request, board.id, 'Задача 1', wsData.token)
    await createActionItemViaAPI(request, board.id, 'Задача 2', wsData.token)

    await page.goto('/dashboard')

    await expect(page.locator('body')).toContainText('Динамика Action Items')
    // Recharts renders SVG
    await expect(page.locator('.recharts-responsive-container').first()).toBeVisible()
  })

  test('навигация на доску по клику', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    await createBoardViaAPI(request, 'Кликни меня', wsData.token)

    await page.goto('/dashboard')
    await page.getByRole('tab', { name: /Доски/i }).click()
    await page.getByRole('button', { name: /Открыть доску/i }).first().click()

    await expect(page).toHaveURL(/\/board\//)
  })
})
