import { test, expect } from '@playwright/test'
import {
  cleanupBoards,
  createBoardViaAPI,
  ensureE2EWorkspace,
  getCsrfHeaders,
  loginWorkspace,
  setUsername,
  API,
} from './helpers'

test.describe('Ключевые исправления (сессия, live-доски, штурм)', () => {
  test.beforeEach(async ({ request }) => {
    const wsData = await ensureE2EWorkspace(request)
    await cleanupBoards(request, wsData.token)
  })

  test.afterAll(async ({ request }) => {
    const wsData = await ensureE2EWorkspace(request)
    await cleanupBoards(request, wsData.token)
  })

  test('прямая ссылка /board/[slug] с протухшим токеном открывает логин и сохраняет целевую доску', async ({
    page,
    request,
  }) => {
    const wsData = await ensureE2EWorkspace(request)
    const csrf = await getCsrfHeaders(request)
    const headers = { ...csrf, 'X-Workspace-Token': wsData.token }

    await createBoardViaAPI(request, 'Первая доска', wsData.token)
    const targetBoard = await createBoardViaAPI(request, 'Целевая доска', wsData.token)

    await request.post(`${API}/columns/`, {
      data: { board_id: targetBoard.id, title: 'Целевая колонка' },
      headers,
    })

    // Кладём в localStorage невалидный/протухший токен один раз до первого захода
    await page.addInitScript(() => {
      if (sessionStorage.getItem('stale_seeded')) return
      sessionStorage.setItem('stale_seeded', '1')
      localStorage.setItem(
        'retroboard-app',
        JSON.stringify({
          state: {
            username: 'Возвращенец',
            currentBoardId: null,
            theme: { primary: '#6750A4', dark: false },
            workspace: {
              token: 'expired.invalid.token',
              workspaceId: 'stale-id',
              workspaceSlug: 'e2e-team',
              workspaceName: 'Stale Team',
            },
          },
          version: 0,
        }),
      )
    })

    await page.goto(`/board/${targetBoard.slug}`)

    // Должен появиться WelcomeDialog без экрана ошибки, URL остаётся целевым
    await expect(page.getByRole('button', { name: /войти на доску/i })).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(new RegExp(`/board/${targetBoard.slug}`))
    await expect(page.getByText(/не удалось загрузить/i)).toHaveCount(0)

    // Логинимся заново — после входа должна открыться именно целевая доска
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByRole('button', { name: /войти на доску/i }).click()

    await expect(page.getByText('Целевая колонка')).toBeVisible({ timeout: 15000 })
    await expect(page).toHaveURL(new RegExp(`/board/${targetBoard.slug}`))
  })

  test('новая доска появляется в открытой вкладке без F5 по /ws/workspace', async ({
    browser,
    request,
  }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board1 = await createBoardViaAPI(request, 'Стартовая доска', wsData.token)

    const ctx1 = await browser.newContext()
    try {
      const page1 = await ctx1.newPage()
      await setUsername(page1, 'Наблюдатель')
      await loginWorkspace(page1, request)

      await page1.goto(`/board/${board1.slug}`)
      await expect(page1.getByRole('button', { name: 'Колонка' })).toBeVisible({ timeout: 15000 })
      // Ждём завершения WS-подключения (Live + presence с именем наблюдателя) перед созданием второй доски
      await expect(page1.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 10000 })
      await expect(page1.locator('[title="Наблюдатель"]')).toBeVisible({ timeout: 10000 })

      // Открываем панель досок на первой вкладке
      await page1.locator('header button').first().click()
      await expect(page1.getByText('Стартовая доска').first()).toBeVisible({ timeout: 5000 })

      // В другой сессии создаём новую доску
      await createBoardViaAPI(request, 'Живая доска без F5', wsData.token)

      // Первая вкладка должна получить board_created по /ws/workspace без перезагрузки
      await expect(page1.getByText('Живая доска без F5')).toBeVisible({ timeout: 10000 })
    } finally {
      await ctx1.close()
    }
  })

  test('быстрый F5 в режиме штурма не показывает чужие карточки и сохраняет ведущего', async ({
    browser,
    request,
  }) => {
    const wsData = await ensureE2EWorkspace(request)
    const csrf = await getCsrfHeaders(request)
    const headers = { ...csrf, 'X-Workspace-Token': wsData.token }

    const board = await createBoardViaAPI(request, 'Штурм Доска', wsData.token)
    const colRes = await request.post(`${API}/columns/`, {
      data: { board_id: board.id, title: 'Идеи' },
      headers,
    })
    const col = await colRes.json()

    await request.post(`${API}/cards/`, {
      data: { column_id: col.id, text: 'Секрет ведущего', author: 'Ведущий' },
      headers,
    })

    const ctxFac = await browser.newContext()
    const ctxViewer = await browser.newContext()

    try {
      const facPage = await ctxFac.newPage()
      await setUsername(facPage, 'Ведущий')
      await loginWorkspace(facPage, request)

      await facPage.goto(`/board/${board.slug}`)
      await expect(facPage.getByText('Секрет ведущего')).toBeVisible({ timeout: 15000 })
      // Ждём завершения WS-подключения и identify (Live + presence с именем ведущего)
      await expect(facPage.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 10000 })
      await expect(facPage.locator('[title="Ведущий"]')).toBeVisible({ timeout: 10000 })

      // Включаем режим ведущего (стартовая фаза — brainstorm)
      const facBtn = facPage.getByTitle('Стать ведущим')
      await expect(facBtn).toBeVisible({ timeout: 10000 })
      await facBtn.click()
      await expect(facPage.getByTitle('Завершить режим ведущего')).toBeVisible({ timeout: 10000 })

      const viewerPage = await ctxViewer.newPage()
      await setUsername(viewerPage, 'Участник')
      await loginWorkspace(viewerPage, request)

      await viewerPage.goto(`/board/${board.slug}`)
      await expect(viewerPage.getByText('Карточка скрыта')).toBeVisible({ timeout: 15000 })
      await expect(viewerPage.getByText('Секрет ведущего')).toHaveCount(0)

      // Делаем перезагрузку участника — чужая карточка не должна мелькнуть даже в момент загрузки
      await viewerPage.reload({ waitUntil: 'domcontentloaded' })
      await expect(viewerPage.getByText('Секрет ведущего')).toHaveCount(0)
      await expect(viewerPage.getByText('Карточка скрыта')).toBeVisible({ timeout: 15000 })
      await expect(viewerPage.getByText('Секрет ведущего')).toHaveCount(0)

      // Ведущий делает F5 — grace period должен сохранить роль ведущего и фазу штурма
      await facPage.reload()
      await expect(facPage.getByTitle('Завершить режим ведущего')).toBeVisible({ timeout: 15000 })
      await expect(viewerPage.getByText('Карточка скрыта')).toBeVisible({ timeout: 5000 })
    } finally {
      await ctxFac.close()
      await ctxViewer.close()
    }
  })
})
