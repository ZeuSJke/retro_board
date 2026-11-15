import { test, expect } from '@playwright/test'
import {
  cleanupBoards,
  createBoardViaAPI,
  dismissWelcome,
  ensureE2EWorkspace,
  getCsrfHeaders,
  loginWorkspace,
  setUsername,
  API,
} from './helpers'

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

async function openBoard(page: import('@playwright/test').Page, slug: string, becomeFacilitator = false) {
  await page.goto(`/board/${slug}`)
  await dismissWelcome(page)
  await page.waitForLoadState('networkidle')
  await expect(page.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 15000 })

  if (!becomeFacilitator) return
  await expect(async () => {
    const doneBtn = page.getByTitle('Завершить режим ведущего')
    if (await doneBtn.isVisible()) return
    const facBtn = page.getByTitle('Стать ведущим')
    if (await facBtn.isVisible()) {
      await facBtn.click()
    }
    await expect(doneBtn).toBeVisible({ timeout: 3000 })
  }).toPass({ timeout: 15000, intervals: [200, 500, 1000] })
}

test.describe('Курсор, автоссылки и улучшения доски', () => {
  test('видимая drag-ручка (cursor-default на карточке), автоссылки и перенос через меню', async ({
    page,
    request,
  }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'E2E Cursor Move', wsData.token)
    const csrf = await getCsrfHeaders(request)
    const headers = { ...csrf, 'X-Workspace-Token': wsData.token }

    const col0 = board.columns[0]
    const col1 = board.columns[1]

    await request.post(`${API}/cards/`, {
      data: {
        column_id: col0.id,
        text: 'Починить **пайплайн** https://example.com/ci-42',
        author: 'E2E Тестер',
      },
      headers,
    })

    await openBoard(page, board.slug)

    const card = page.getByTestId('card-widget').filter({ hasText: 'пайплайн' })
    await expect(card).toBeVisible()
    await expect(card).toHaveCSS('cursor', 'default')

    const dragHandle = card.getByTestId('card-drag-handle')
    await expect(dragHandle).toBeVisible()
    await expect(dragHandle).toHaveCSS('cursor', 'grab')

    const autoLink = card.locator('a[href="https://example.com/ci-42"]')
    await expect(autoLink).toBeVisible()
    await expect(autoLink).toHaveAttribute('target', '_blank')

    await card.hover()
    await card.getByLabel('Действия с карточкой').click()
    const moveTrigger = page.getByText('Переместить в колонку')
    await expect(moveTrigger).toBeVisible()
    await moveTrigger.hover()
    const targetItem = page.getByRole('menuitem', { name: col1.title })
    await expect(targetItem).toBeVisible()
    await targetItem.click()

    const secondColumn = page.getByTestId('board-column').nth(1)
    await expect(secondColumn.getByTestId('card-widget').filter({ hasText: 'пайплайн' })).toBeVisible()
  })

  test('фильтр по цвету стикеров и навигация Prev/Next в Spotlight', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'E2E Spotlight Filter', wsData.token)
    const csrf = await getCsrfHeaders(request)
    const headers = { ...csrf, 'X-Workspace-Token': wsData.token }
    const col0 = board.columns[0]

    await request.post(`${API}/cards/`, {
      data: { column_id: col0.id, text: 'Первая жёлтая карточка', author: 'E2E Тестер', color: '#FFF8E1' },
      headers,
    })
    await request.post(`${API}/cards/`, {
      data: { column_id: col0.id, text: 'Вторая зелёная карточка', author: 'E2E Тестер', color: '#E8F5E9' },
      headers,
    })

    await openBoard(page, board.slug, true)
    await page.getByTestId('phase-step-discuss').click()

    await expect(page.getByText('Первая жёлтая карточка')).toBeVisible()
    await expect(page.getByText('Вторая зелёная карточка')).toBeVisible()

    // Filter by amber color
    await page.getByTitle('Фильтр по цвету стикеров').click()
    await page.getByLabel('Фильтр по цвету: Тёплый песок').click()
    await expect(page.getByText('Первая жёлтая карточка')).toBeVisible()
    await expect(page.getByText('Вторая зелёная карточка')).toHaveCount(0)

    // Reset filter
    await page.getByRole('button', { name: 'Все' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Вторая зелёная карточка')).toBeVisible()

    // Open Spotlight on first card and navigate to next
    const firstCard = page.getByTestId('card-widget').filter({ hasText: 'Первая жёлтая карточка' })
    await firstCard.hover()
    await firstCard.getByTitle('В фокус обсуждения').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('1 / 2')
    await expect(dialog).toContainText('Первая жёлтая карточка')

    await dialog.getByRole('button', { name: /Следующая/i }).click()
    await expect(dialog).toContainText('2 / 2')
    await expect(dialog).toContainText('Вторая зелёная карточка')
  })

  test('Dot Voting на одной карточке, счётчик проголосовавших и сброс голосов', async ({
    page,
    request,
  }) => {
    const wsData = await ensureE2EWorkspace(request)
    const csrf = await getCsrfHeaders(request)
    const headers = { ...csrf, 'X-Workspace-Token': wsData.token }

    const createRes = await request.post(`${API}/boards/`, {
      data: {
        name: 'E2E Dot Voting',
        max_votes: 5,
        allow_multiple_votes_per_card: true,
      },
      headers,
    })
    expect(createRes.ok()).toBeTruthy()
    const board = await createRes.json()

    await request.post(`${API}/cards/`, {
      data: { column_id: board.columns[0].id, text: 'Карточка для нескольких голосов', author: 'E2E Тестер' },
      headers,
    })

    await openBoard(page, board.slug, true)
    await page.getByTestId('phase-step-vote').click()

    await expect(page.locator('body')).toContainText('Проголосовали 0/')
    await expect(page.locator('body')).toContainText('5/5')

    const card = page.getByTestId('card-widget').filter({ hasText: 'Карточка для нескольких голосов' })
    await card.getByTitle('Лайк').click()
    await expect(card).toContainText('×1')

    await card.getByTitle('Лайк').click()
    await expect(card).toContainText('×2')
    await expect(page.locator('body')).toContainText('3/5')
    await expect(page.locator('body')).toContainText('Проголосовали 1/')

    await page.getByTestId('reset-votes-btn').click()
    await expect(card).not.toContainText('×2')
    await expect(page.locator('body')).toContainText('5/5')
    await expect(page.locator('body')).toContainText('Проголосовали 0/')
  })

  test('мультивыбор карточек в группу и диалог горячих клавиш (?)', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'E2E Bulk Select', wsData.token)
    const csrf = await getCsrfHeaders(request)
    const headers = { ...csrf, 'X-Workspace-Token': wsData.token }
    const col0 = board.columns[0]

    await request.post(`${API}/cards/`, {
      data: { column_id: col0.id, text: 'Падает билд фронта', author: 'E2E Тестер' },
      headers,
    })
    await request.post(`${API}/cards/`, {
      data: { column_id: col0.id, text: 'Медленный прогон e2e', author: 'E2E Тестер' },
      headers,
    })

    await openBoard(page, board.slug)

    const card1 = page.getByTestId('card-widget').filter({ hasText: 'Падает билд фронта' })
    const card2 = page.getByTestId('card-widget').filter({ hasText: 'Медленный прогон e2e' })

    await card1.hover()
    await card1.locator('[data-testid^="card-select-"]').click()
    await card2.hover()
    await card2.locator('[data-testid^="card-select-"]').click()

    const bulkBar = page.getByTestId('bulk-actions-bar')
    await expect(bulkBar).toBeVisible()
    await expect(bulkBar).toContainText('Выбрано: 2')

    await bulkBar.getByRole('button', { name: 'Сгруппировать' }).click()
    await page.getByPlaceholder('Например: CI/CD').fill('Инфра')
    await page.getByRole('button', { name: 'Создать группу' }).click()

    await expect(page.locator('body')).toContainText('Инфра')
    await expect(bulkBar).toBeHidden()

    await page.keyboard.press('?')
    const shortcutsDialog = page.getByRole('dialog')
    await expect(shortcutsDialog).toBeVisible()
    await expect(shortcutsDialog).toContainText('Горячие клавиши')
    await page.keyboard.press('Escape')
    await expect(shortcutsDialog).toBeHidden()
  })
})
