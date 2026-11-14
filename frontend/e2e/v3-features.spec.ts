import { test, expect } from '@playwright/test'
import {
  cleanupBoards,
  createActionItemViaAPI,
  createBoardViaAPI,
  dismissWelcome,
  ensureE2EWorkspace,
  getCsrfHeaders,
  loginWorkspace,
  setUsername,
  API,
} from './helpers'

test.describe('v3 фичи — шаблоны, настроение, фокус, блокировка, канбан и тема', () => {
  test.beforeEach(async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    await cleanupBoards(request, wsData.token)
    await setUsername(page, 'E2E Тестер')
    await loginWorkspace(page, request)
  })

  test('создание доски по шаблону 4Ls из панели досок', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Базовая доска', wsData.token)

    await page.goto(`/board/${board.slug}`)
    await page.getByTestId('boards-drawer-btn').click()
    await page.getByRole('button', { name: /Новая доска/i }).click()

    await page.getByTestId('create-board-name-input').fill('Ретро 4Ls')
    await page.getByRole('button', { name: /4Ls/i }).click()
    await page.getByTestId('create-board-submit-btn').click()

    await expect(page.locator('body')).toContainText('Liked (Понравилось)')
    await expect(page.locator('body')).toContainText('Learned (Узнали)')
    await expect(page.locator('body')).toContainText('Lacked (Не хватило)')
    await expect(page.locator('body')).toContainText('Longed for (Хочется)')
  })

  test('чек-ин настроения команды и переключение темы (Light/Dark)', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Доска настроения', wsData.token)

    await page.goto(`/board/${board.slug}`)
    await dismissWelcome(page)

    // Theme toggle
    const toggleBtn = page.getByTestId('theme-toggle-btn')
    await toggleBtn.click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await toggleBtn.click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)

    // Mood check-in
    await page.getByTestId('mood-checkin-btn').click()
    await expect(page.getByRole('heading', { name: /Чек-ин настроения/i })).toBeVisible()
    await page.getByTestId('mood-option-5').click()
    await page.getByLabel(/Короткий комментарий/i).fill('Отличный спринт!')
    await page.getByRole('button', { name: 'Сохранить оценку' }).click()

    await expect(page.getByTestId('mood-checkin-btn')).toContainText('5.0')
  })

  test('блокировка доски запрещает редактирование в UI и API (423)', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Блокируемая доска', wsData.token)
    const csrf = await getCsrfHeaders(request)
    const colRes = await request.post(`${API}/columns/`, {
      data: { board_id: board.id, title: 'Заметки' },
      headers: { ...csrf, 'X-Workspace-Token': wsData.token },
    })
    const col = await colRes.json()

    await page.goto(`/board/${board.slug}`)
    await dismissWelcome(page)

    await page.getByTestId('board-settings-btn').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('switch').first().click()
    await dialog.getByRole('button', { name: 'Сохранить' }).click()

    await expect(page.getByText('Доска заблокирована для правок')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Добавить карточку' }).first()).toBeDisabled()

    // Backend 423 check
    const apiRes = await request.post(`${API}/cards/`, {
      data: { column_id: col.id, text: 'Попытка в архив', author: 'Тестер' },
      headers: { ...csrf, 'X-Workspace-Token': wsData.token },
    })
    expect(apiRes.status()).toBe(423)
  })

  test('режим ведущего: Spotlight и готовность участника синхронизируются между вкладками', async ({
    browser,
    request,
  }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Сессия с фокусом', wsData.token)
    const csrf = await getCsrfHeaders(request)
    const colRes = await request.post(`${API}/columns/`, {
      data: { board_id: board.id, title: 'Обсуждаем' },
      headers: { ...csrf, 'X-Workspace-Token': wsData.token },
    })
    const col = await colRes.json()
    await request.post(`${API}/cards/`, {
      data: { column_id: col.id, text: 'Важная карточка для обсуждения', author: 'Ведущий' },
      headers: { ...csrf, 'X-Workspace-Token': wsData.token },
    })

    const ctxFac = await browser.newContext()
    const ctxPart = await browser.newContext()
    try {
      const facPage = await ctxFac.newPage()
      await setUsername(facPage, 'Ведущий')
      await loginWorkspace(facPage, request)
      await facPage.goto(`/board/${board.slug}`)
      await expect(facPage.getByTestId('become-facilitator-btn')).toBeVisible({ timeout: 15000 })

      const partPage = await ctxPart.newPage()
      await setUsername(partPage, 'Участник')
      await loginWorkspace(partPage, request)
      await partPage.goto(`/board/${board.slug}`)
      await expect(partPage.locator('[title="Ведущий"]')).toBeVisible({ timeout: 15000 })

      await facPage.getByTestId('become-facilitator-btn').click()
      await expect(facPage.getByTestId('stop-facilitator-btn')).toBeVisible({ timeout: 10000 })

      // Move to discuss phase so hidden cards reveal and spotlight works
      await facPage.getByRole('button', { name: 'Обсуждение' }).click()
      await expect(partPage.getByText('Важная карточка для обсуждения')).toBeVisible({ timeout: 10000 })

      // Participant toggles ready
      await partPage.getByTestId('ready-toggle-btn').click()
      await expect(partPage.getByTestId('ready-toggle-btn')).toContainText('Готов(а)')

      // Facilitator activates Spotlight on the card
      const card = facPage.getByTestId('card-widget').filter({ hasText: 'Важная карточка для обсуждения' })
      await card.hover()
      await card.getByTitle('В фокус обсуждения').click()

      await expect(partPage.getByRole('dialog')).toContainText('Важная карточка для обсуждения', {
        timeout: 10000,
      })
    } finally {
      await ctxFac.close()
      await ctxPart.close()
    }
  })

  test('канбан Action Items и перенос незакрытых задач на новую доску', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const oldBoard = await createBoardViaAPI(request, 'Прошлый спринт', wsData.token)
    await createBoardViaAPI(request, 'Новый спринт', wsData.token)
    await createActionItemViaAPI(request, oldBoard.id, 'Доработать CI', wsData.token, {
      title: 'Ускорить тесты',
    })

    await page.goto('/dashboard')
    await expect(page.getByText('Ускорить тесты')).toBeVisible({ timeout: 10000 })

    // Kanban view toggle
    await page.getByRole('button', { name: 'Канбан' }).click()
    const actionPanel = page.getByRole('tabpanel')
    await expect(actionPanel.getByText('В работе')).toBeVisible()
    await expect(actionPanel.getByText('Выполнено')).toBeVisible()

    // Carry-forward modal
    await page.getByRole('button', { name: /Перенести незакрытые/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Перенести', exact: true }).click()

    await expect(dialog).toBeHidden({ timeout: 10000 })
  })
})
