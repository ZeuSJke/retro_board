import { test, expect } from '@playwright/test'
import { cleanupBoards, setUsername, createBoardViaAPI, createActionItemViaAPI, getCsrfHeaders } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await cleanupBoards(request)
  await setUsername(page)
})

test.afterAll(async ({ request }) => {
  await cleanupBoards(request)
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
    await createBoardViaAPI(request, 'Спринт 10')
    await createBoardViaAPI(request, 'Спринт 11')

    await page.goto('/dashboard')

    await expect(page.locator('body')).toContainText('Спринт 10')
    await expect(page.locator('body')).toContainText('Спринт 11')
  })

  test('отображает задачи и сворачивает выполненные', async ({ page, request }) => {
    const board = await createBoardViaAPI(request, 'Тестовый спринт')
    await createActionItemViaAPI(request, board.id, 'Открытая задача', { title: 'Задача А' })
    const doneItem = await createActionItemViaAPI(request, board.id, 'Готовая задача', { title: 'Задача Б' })
    const csrf = await getCsrfHeaders(request)
    await request.patch(`http://localhost:8000/api/action-items/${doneItem.id}`, {
      data: { status: 'done' },
      headers: csrf,
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
    const board1 = await createBoardViaAPI(request, 'Доска Один')
    const board2 = await createBoardViaAPI(request, 'Доска Два')
    await createActionItemViaAPI(request, board1.id, 'Задача из первой', { title: 'Первая' })
    await createActionItemViaAPI(request, board2.id, 'Задача из второй', { title: 'Вторая' })

    await page.goto('/dashboard')
    await expect(page.locator('body')).toContainText('Первая')
    await expect(page.locator('body')).toContainText('Вторая')

    const boardSelect = page.locator('select').nth(1)
    await boardSelect.selectOption({ label: 'Доска Один' })

    await expect(page.locator('body')).toContainText('Первая')
    await expect(page.locator('body')).not.toContainText('Вторая')
  })

  test('отображает график трендов', async ({ page, request }) => {
    const board = await createBoardViaAPI(request, 'Спринт с задачами')
    await createActionItemViaAPI(request, board.id, 'Задача 1')
    await createActionItemViaAPI(request, board.id, 'Задача 2')

    await page.goto('/dashboard')

    await expect(page.locator('body')).toContainText('Тренды задач по ретро')
    // Recharts renders SVG
    await expect(page.locator('.recharts-responsive-container')).toBeVisible()
  })

  test('навигация на доску по клику', async ({ page, request }) => {
    await createBoardViaAPI(request, 'Кликни меня')

    await page.goto('/dashboard')
    // Board name appears in both board card and select — click the card name specifically
    await page.locator('[class*="boardCardName"]').filter({ hasText: 'Кликни меня' }).click()

    await expect(page).toHaveURL(/\/board\//)
  })
})
