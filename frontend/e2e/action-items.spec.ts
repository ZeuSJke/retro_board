import { test, expect } from '@playwright/test'
import { cleanupBoards, setUsername, createBoardViaAPI, createActionItemViaAPI } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await cleanupBoards(request)
  await setUsername(page)
})

test.afterAll(async ({ request }) => {
  await cleanupBoards(request)
})

test.describe('Action items — CRUD и статусы', () => {
  test('смена статуса open -> in_progress -> done', async ({ page, request }) => {
    const board = await createBoardViaAPI(request, 'Статусы')
    await createActionItemViaAPI(request, board.id, 'Тестовая задача', { title: 'Сменить статус' })

    await page.goto('/dashboard')
    await expect(page.locator('body')).toContainText('Сменить статус')

    // open -> in_progress
    await page.getByTitle(/Открыто → В работе/).click()
    await expect(page.getByTitle(/В работе → Выполнено/)).toBeVisible()

    // in_progress -> done
    await page.getByTitle(/В работе → Выполнено/).click()

    // Should move to done section
    await expect(page.locator('body')).toContainText('Выполненные')
  })

  test('удаление задачи', async ({ page, request }) => {
    const board = await createBoardViaAPI(request, 'Удаление задач')
    await createActionItemViaAPI(request, board.id, 'Удаляемая задача', { title: 'Надо удалить' })

    await page.goto('/dashboard')
    await expect(page.locator('body')).toContainText('Надо удалить')

    // Hover to reveal delete
    const taskCard = page.getByText('Надо удалить').locator('..')
    await taskCard.hover()
    await page.getByTitle('Удалить').click()

    // Confirm
    await page.getByRole('button', { name: 'Удалить' }).click()

    await expect(page.locator('body')).not.toContainText('Надо удалить')
  })

  test('задача с ответственным', async ({ page, request }) => {
    const board = await createBoardViaAPI(request, 'API задачи')
    await createActionItemViaAPI(request, board.id, 'Задача через API', {
      title: 'API задача',
      assignee: 'Иванов',
    })

    await page.goto('/dashboard')

    await expect(page.locator('body')).toContainText('API задача')
    await expect(page.locator('body')).toContainText('Иванов')
  })

  test('фильтр по ответственному', async ({ page, request }) => {
    const board = await createBoardViaAPI(request, 'Фильтр')
    await createActionItemViaAPI(request, board.id, 'Задача Алисы', {
      title: 'Алиса работает',
      assignee: 'Алиса',
    })
    await createActionItemViaAPI(request, board.id, 'Задача Боба', {
      title: 'Боб работает',
      assignee: 'Боб',
    })

    await page.goto('/dashboard')
    await expect(page.locator('body')).toContainText('Алиса работает')
    await expect(page.locator('body')).toContainText('Боб работает')

    await page.getByPlaceholder('Ответственный').fill('Алиса')

    await expect(page.locator('body')).toContainText('Алиса работает')
    await expect(page.locator('body')).not.toContainText('Боб работает')
  })
})
