import { test, expect } from '@playwright/test'
import { cleanupBoards, setUsername, dismissWelcome, createBoardViaAPI, getCsrfHeaders, ensureE2EWorkspace, loginWorkspace } from './helpers'

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

/** Navigate to board and dismiss welcome + become facilitator. */
async function openBoard(page: import('@playwright/test').Page, slug: string) {
  await page.goto(`/board/${slug}`)
  await dismissWelcome(page)
  // Become facilitator so card creation is enabled
  const facBtn = page.getByTitle('Стать ведущим')
  if (await facBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await facBtn.click()
  }
}

test.describe('Доска — колонки и карточки', () => {
  test('создание колонки', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'E2E Доска', wsData.token)
    await openBoard(page, board.slug)

    await page.getByText('Новая колонка').click()

    const input = page.getByPlaceholder('Например: Что прошло хорошо?')
    await input.fill('Хорошее')
    await page.getByRole('button', { name: 'Создать' }).click()

    await expect(page.locator('body')).toContainText('Хорошее')
  })

  test('создание карточки в колонке', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Доска с колонкой', wsData.token)
    const csrf = await getCsrfHeaders(request)
    await request.post('http://localhost:8000/api/columns/', {
      data: { board_id: board.id, title: 'Что хорошо' },
      headers: { ...csrf, 'X-Workspace-Token': wsData.token },
    })

    await openBoard(page, board.slug)
    await expect(page.locator('body')).toContainText('Что хорошо')

    await page.getByText('Добавить карточку').first().click()

    const textarea = page.getByPlaceholder('Что думаете?')
    await textarea.fill('Отличный спринт!')
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()

    await expect(page.locator('body')).toContainText('Отличный спринт!')
  })

  test('лайк карточки', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Доска лайки', wsData.token)
    const csrf = await getCsrfHeaders(request)
    const colRes = await request.post('http://localhost:8000/api/columns/', {
      data: { board_id: board.id, title: 'Колонка' },
      headers: { ...csrf, 'X-Workspace-Token': wsData.token },
    })
    const col = await colRes.json()
    await request.post('http://localhost:8000/api/cards/', {
      data: { column_id: col.id, text: 'Карточка для лайка' },
      headers: { ...csrf, 'X-Workspace-Token': wsData.token },
    })

    // Navigate WITHOUT becoming facilitator — voting is allowed when no facilitator is set
    await page.goto(`/board/${board.slug}`)
    await dismissWelcome(page)
    await expect(page.locator('body')).toContainText('Карточка для лайка')

    // Find like button inside the card context and click
    const card = page.locator('.card-widget').filter({ hasText: 'Карточка для лайка' })
    const likeBtn = card.locator('button').filter({ hasText: 'thumb_up' }).first()
    await likeBtn.click()
    await expect(page.getByTitle('Убрать лайк')).toBeVisible()
  })

  test('удаление карточки', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Доска удаление', wsData.token)
    const csrf = await getCsrfHeaders(request)
    const colRes = await request.post('http://localhost:8000/api/columns/', {
      data: { board_id: board.id, title: 'Колонка' },
      headers: { ...csrf, 'X-Workspace-Token': wsData.token },
    })
    const col = await colRes.json()
    await request.post('http://localhost:8000/api/cards/', {
      data: { column_id: col.id, text: 'Удали меня' },
      headers: { ...csrf, 'X-Workspace-Token': wsData.token },
    })

    await openBoard(page, board.slug)
    await expect(page.locator('body')).toContainText('Удали меня')

    await page.getByText('Удали меня').hover()
    await page.getByTitle('Удалить карточку').click()
    await page.getByRole('button', { name: 'Удалить' }).click()

    await expect(page.locator('body')).not.toContainText('Удали меня')
  })

  test('удаление колонки', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Доска удаление кол', wsData.token)
    const csrf = await getCsrfHeaders(request)
    await request.post('http://localhost:8000/api/columns/', {
      data: { board_id: board.id, title: 'Ненужная колонка' },
      headers: { ...csrf, 'X-Workspace-Token': wsData.token },
    })

    await openBoard(page, board.slug)
    await expect(page.locator('body')).toContainText('Ненужная колонка')

    // Find the specific column, then its delete button
    const colHeader = page.getByText('Ненужная колонка')
    const column = colHeader.locator('..').locator('..')
    await column.getByTitle('Удалить колонку').click()

    await page.getByRole('button', { name: 'Удалить' }).click()

    await expect(page.locator('body')).not.toContainText('Ненужная колонка')
  })
})
