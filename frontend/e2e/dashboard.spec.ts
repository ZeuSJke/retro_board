import { test, expect, type APIRequestContext } from '@playwright/test'
import { cleanupBoards, setUsername, createBoardViaAPI, createActionItemViaAPI, getCsrfHeaders, ensureE2EWorkspace, loginWorkspace, API } from './helpers'

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
    await expect(page.getByRole('tab', { name: /Задачи/i })).toBeVisible()
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
    await request.patch(`${API}/action-items/${doneItem.id}`, {
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

    await expect(page.locator('body')).toContainText('Динамика задач')
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

  test('открытие Select и Dialog не вызывает горизонтальный сдвиг макета', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Scroll Stability Sprint', wsData.token)
    for (let i = 1; i <= 2; i++) {
      await createActionItemViaAPI(request, board.id, `Длинное описание задачи ${i}`, wsData.token, {
        title: `Задача ${i}`,
      })
    }

    await page.setViewportSize({ width: 1440, height: 550 })
    await page.goto('/dashboard')
    await expect(page.locator('body')).toContainText('Задача 2', { timeout: 15000 })

    // DocumentElement owns document vertical scroll; body itself is not an inner scroll box
    const scrollMetrics = await page.evaluate(() => ({
      htmlOverflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      bodyOwnScroll: document.body.scrollHeight > document.body.clientHeight,
      headerX: document.querySelector('header > div')!.getBoundingClientRect().x,
      mainX: document.querySelector('main')!.getBoundingClientRect().x,
    }))
    expect(scrollMetrics.htmlOverflowY).toBe(true)
    expect(scrollMetrics.bodyOwnScroll).toBe(false)

    // Scroll down slightly so sticky header is active when overlays open
    await page.evaluate(() => window.scrollTo(0, 120))

    // 1. Open status Select filter
    const statusTrigger = page.getByRole('combobox').first()
    const triggerXBefore = (await statusTrigger.boundingBox())!.x
    await statusTrigger.click()
    await expect(page.getByRole('listbox')).toBeVisible()

    // Measure via DOM querySelector because modal Radix Select temporarily marks background aria-hidden="true"
    const afterSelect = await page.evaluate(() => ({
      headerTop: document.querySelector('header')!.getBoundingClientRect().top,
      headerX: document.querySelector('header > div')!.getBoundingClientRect().x,
      mainX: document.querySelector('main')!.getBoundingClientRect().x,
      triggerX: document.querySelector('button[role="combobox"]')!.getBoundingClientRect().x,
    }))
    expect(afterSelect.headerTop).toBe(0)
    expect(Math.abs(afterSelect.headerX - scrollMetrics.headerX)).toBeLessThan(0.5)
    expect(Math.abs(afterSelect.mainX - scrollMetrics.mainX)).toBeLessThan(0.5)
    expect(Math.abs(afterSelect.triggerX - triggerXBefore)).toBeLessThan(0.5)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).not.toBeVisible()

    // 2. Open "Новая доска" modal Dialog
    await page.getByRole('button', { name: /Новая доска/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const afterDialog = await page.evaluate(() => ({
      headerTop: document.querySelector('header')!.getBoundingClientRect().top,
      headerX: document.querySelector('header > div')!.getBoundingClientRect().x,
      mainX: document.querySelector('main')!.getBoundingClientRect().x,
    }))
    expect(afterDialog.headerTop).toBe(0)
    expect(Math.abs(afterDialog.headerX - scrollMetrics.headerX)).toBeLessThan(0.5)
    expect(Math.abs(afterDialog.mainX - scrollMetrics.mainX)).toBeLessThan(0.5)
  })
})

/** Заголовки запроса от имени участника: токен сессии и пара CSRF. */
async function authHeaders(request: APIRequestContext, token: string) {
  return { ...(await getCsrfHeaders(request)), 'X-Workspace-Token': token }
}

/** Ответить на вопросы health check от имени участника с токеном `token`. */
async function answerHealth(
  request: APIRequestContext,
  boardId: string,
  token: string,
  answers: Record<string, 1 | 2 | 3>,
) {
  const res = await request.post(`${API}/boards/${boardId}/health`, {
    data: { answers },
    headers: await authHeaders(request, token),
  })
  expect(res.ok(), `health answers: ${res.status()}`).toBeTruthy()
}

/** Оценить встречу от имени участника с токеном `token`. */
async function rateMeeting(request: APIRequestContext, boardId: string, token: string, value: number) {
  const res = await request.post(`${API}/boards/${boardId}/roti`, {
    data: { value },
    headers: await authHeaders(request, token),
  })
  expect(res.ok(), `roti: ${res.status()}`).toBeTruthy()
}

test.describe('Dashboard: шапка', () => {
  test('список досок, профиль и выход доступны из шапки', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    await createBoardViaAPI(request, 'Доска из шапки', wsData.token)

    await page.goto('/dashboard')

    await page.getByTestId('boards-drawer-btn').click()
    const panel = page.getByRole('dialog', { name: 'Доски команды' })
    await expect(panel).toContainText('Доска из шапки')
    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()

    await page.getByTestId('user-settings-btn').click()
    await expect(page.getByText('Профиль и оформление')).toBeVisible()
    await expect(page.getByLabel('Имя участника')).toHaveValue(wsData.participant.name)

    await page.getByTestId('logout-btn').click()
    await expect(page.getByText('Войти на доску')).toBeVisible()

    // Сессия завершена на сервере: cookie сброшена, API отвечает 401
    const me = await page.request.get('/api/workspaces/me')
    expect(me.status()).toBe(401)
  })

  test('телефон 390 px: шапка в одну строку, «Новая доска» не обрезана', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Спринт для телефона', wsData.token)
    await createActionItemViaAPI(request, board.id, 'Задача для графика', wsData.token)
    await answerHealth(request, board.id, wsData.token, { pace: 2, quality: 3 })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dashboard')
    await expect(page.getByTestId('health-trend-row-pace')).toBeVisible({ timeout: 15000 })

    for (const testId of ['boards-drawer-btn', 'dashboard-new-board-btn', 'user-settings-btn']) {
      const box = await page.getByTestId(testId).boundingBox()
      expect(box, testId).not.toBeNull()
      expect(box!.x, `${testId}: левый край`).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width, `${testId}: правый край`).toBeLessThanOrEqual(390)
    }

    // Ни шапка, ни новые блоки не растягивают страницу по горизонтали
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    await page.getByRole('button', { name: 'Новая доска' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})

test.describe('Dashboard: графики, темы и health check', () => {
  test('подписи графика — названия досок: две доски за один день различаются', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const morning = await createBoardViaAPI(request, 'Утреннее ретро', wsData.token)
    const evening = await createBoardViaAPI(request, 'Вечернее ретро', wsData.token)
    await createActionItemViaAPI(request, morning.id, 'Задача утра', wsData.token)
    await createActionItemViaAPI(request, evening.id, 'Задача вечера', wsData.token)

    await page.goto('/dashboard')

    const chart = page.locator('.recharts-responsive-container').first()
    await expect(chart).toBeVisible()
    await expect(chart).toContainText('Утреннее ретро')
    await expect(chart).toContainText('Вечернее ретро')
  })

  test('health check: динамика по вопросам и оценка встречи между досками', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const first = await createBoardViaAPI(request, 'Health спринт 1', wsData.token)
    const second = await createBoardViaAPI(request, 'Health спринт 2', wsData.token)
    await answerHealth(request, first.id, wsData.token, { pace: 1, quality: 3 })
    await answerHealth(request, second.id, wsData.token, { pace: 3, quality: 3 })
    await rateMeeting(request, second.id, wsData.token, 4)

    await page.goto('/dashboard')

    const card = page.getByTestId('health-trends-card')
    // Пять вопросов и оценка встречи
    await expect(card.locator('[data-testid^="health-trend-row-"]')).toHaveCount(6, { timeout: 15000 })

    const pace = card.getByTestId('health-trend-row-pace')
    await expect(pace).toContainText('Темп')
    await expect(card.getByTestId('health-trend-value-pace')).toHaveText('3.0')
    await expect(pace).toContainText('Хорошо')
    await expect(pace).toContainText('+2.0')
    await expect(pace.locator('svg.recharts-surface')).toBeVisible()

    await expect(card.getByTestId('health-trend-row-quality')).toContainText('без изменений')
    await expect(card.getByTestId('health-trend-row-clarity')).toContainText('Ответов пока нет')
    await expect(card.getByTestId('health-trend-value-roti')).toHaveText('4.0')
    await expect(card).toContainText('от «Health спринт 1» до «Health спринт 2»')

    // Прежний график настроения остаётся рядом
    await request.post(`${API}/boards/${second.id}/mood`, {
      data: { score: 4, note: null },
      headers: await authHeaders(request, wsData.token),
    })
    await page.reload()
    await expect(page.locator('body')).toContainText('Настроение команды')
    await expect(page.getByTestId('health-trends-card')).toContainText('Темп')
  })

  test('темы команды: пустое состояние объясняет, откуда берутся темы', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const me = await request.get(`${API}/workspaces/me`, {
      headers: { 'X-Workspace-Token': wsData.token },
    })
    const aiEnabled = Boolean(((await me.json()) as { ai_enabled?: boolean }).ai_enabled)

    await page.goto('/dashboard')

    const card = page.getByTestId('team-themes-card')
    await expect(card).toContainText('Повторяющиеся темы')
    await expect(card).toContainText('Тем пока нет')
    await expect(card).toContainText('Темы берутся из итогов досок')

    if (aiEnabled) {
      await expect(page.getByTestId('workspace-insights-card')).toContainText('Кросс-спринт AI-аналитика')
    } else {
      // Без AI блоки не обещают того, чего сервер не умеет
      await expect(page.getByTestId('team-themes-ai-off')).toBeVisible()
      await expect(page.getByTestId('workspace-insights-card')).toContainText('Сводка по спринтам')
      await expect(page.getByTestId('workspace-insights-card')).toContainText('AI на сервере не настроен')
    }
  })

  test('сводка без AI — посчитанная статистика без сырой разметки и «тем» из карточек', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const me = await request.get(`${API}/workspaces/me`, {
      headers: { 'X-Workspace-Token': wsData.token },
    })
    test.skip(
      Boolean(((await me.json()) as { ai_enabled?: boolean }).ai_enabled),
      'На стенде настроен AI: проверяется запасной вариант без модели',
    )
    const board = await createBoardViaAPI(request, 'Спринт со сводкой', wsData.token)
    const columnId = board.columns[0].id
    const card = await request.post(`${API}/cards/`, {
      data: { column_id: columnId, text: '**Очень важная** карточка про `деплой`' },
      headers: await authHeaders(request, wsData.token),
    })
    expect(card.ok()).toBeTruthy()

    await page.goto('/dashboard')
    const insights = page.getByTestId('workspace-insights-card')
    await insights.getByRole('button', { name: /Собрать (сводку|инсайты)/ }).click()
    await expect(insights.getByRole('button', { name: /Обновить (сводку|анализ)/ })).toBeVisible({
      timeout: 15000,
    })

    // Текст карточки не выдаётся за тему, разметка не показывается сырой
    await expect(insights).not.toContainText('**')
    await expect(insights).not.toContainText('Очень важная')
    await expect(page.getByTestId('team-themes-card')).not.toContainText('Очень важная')
  })

  test('темы команды: счётчик повторов, серия и ссылка на последнюю доску', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Спринт с темой', wsData.token)

    // Темы создаёт генерация итогов (AI); в тестовом окружении AI нет, поэтому
    // ответ списка тем подставляется — в форме контракта GET /api/boards/themes
    await page.route('**/api/boards/themes', (route) =>
      route.fulfill({
        json: [
          {
            id: 'theme-1',
            name: 'Долгое ревью',
            description: '**Пул-реквесты** ждут ревью по несколько дней',
            boards_count: 3,
            streak: 3,
            last_board: { id: board.id, name: board.name, slug: board.slug, created_at: board.created_at },
          },
          {
            id: 'theme-2',
            name: 'Разовая тема',
            description: '',
            boards_count: 1,
            streak: 1,
            last_board: { id: board.id, name: board.name, slug: board.slug, created_at: board.created_at },
          },
        ],
      }),
    )

    await page.goto('/dashboard')

    const card = page.getByTestId('team-themes-card')
    const theme = card.getByTestId('team-theme').first()
    await expect(theme).toContainText('Долгое ревью')
    await expect(theme).toContainText('Пул-реквесты ждут ревью по несколько дней')
    await expect(theme).toContainText('на 3 досках')
    await expect(theme).toContainText('3-й спринт подряд')
    await expect(card).not.toContainText('**')

    // Тема, названная один раз, убрана под кнопку
    await expect(card.getByTestId('team-theme')).toHaveCount(1)
    await card.getByRole('button', { name: /Показать ещё 1 тему/ }).click()
    await expect(card).toContainText('Разовая тема')

    await theme.getByRole('link', { name: /Спринт с темой/ }).click()
    await expect(page).toHaveURL(new RegExp(`/board/${board.slug}`))
  })

  test('значок «AI-итоги» не молчит, если доска не загрузилась', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const board = await createBoardViaAPI(request, 'Доска с итогами', wsData.token)

    // Итоги создаёт AI, которого в тестовом окружении нет: помечаем доски в ответе списка
    await page.route('**/api/boards/', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const response = await route.fetch()
      const list = (await response.json()) as Array<Record<string, unknown>>
      await route.fulfill({ response, json: list.map((b) => ({ ...b, has_summary: true })) })
    })
    let boardFails = true
    await page.route(`**/api/boards/${board.id}`, (route) =>
      boardFails
        ? route.fulfill({ status: 404, json: { detail: 'Доска не найдена' } })
        : route.fallback(),
    )

    await page.goto('/dashboard')
    await page.getByRole('tab', { name: /Доски/i }).click()

    const summaryButton = page.getByRole('button', { name: 'AI-итоги доски «Доска с итогами»' })
    await summaryButton.click()
    await expect(
      page.getByText('Не удалось открыть итоги доски «Доска с итогами». Доска не найдена'),
    ).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Доска загрузилась, но итогов у неё нет: открывается окно итогов, а не тишина
    boardFails = false
    await summaryButton.click()
    const dialog = page.getByRole('dialog', { name: /Итоги ретроспективы/ })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Доска с итогами')
  })
})

test.describe('Dashboard: задачи между досками', () => {
  test('перенесённая задача — одна открытая запись', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    const from = await createBoardViaAPI(request, 'Откуда переносим', wsData.token)
    const to = await createBoardViaAPI(request, 'Куда переносим', wsData.token)
    await createActionItemViaAPI(request, from.id, 'Довести до конца', wsData.token, {
      title: 'Переносимая задача',
    })
    const carry = await request.post(`${API}/action-items/carry-forward`, {
      data: { source_board_id: from.id, target_board_id: to.id },
      headers: await authHeaders(request, wsData.token),
    })
    expect(carry.ok()).toBeTruthy()

    await page.goto('/dashboard')

    await expect(page.getByRole('tab', { name: 'Задачи (1)' })).toBeVisible()
    await expect(page.getByText('Переносимая задача')).toHaveCount(1)
    // Счётчик открытых задач — одна запись, а не оригинал плюс копия
    await expect(page.getByTestId('kpi-open-tasks')).toHaveText('1')

    await page.getByRole('tab', { name: /Доски/i }).click()
    await expect(page.getByTestId(`board-card-${from.id}`)).toContainText('Задачи перенесены')
    await expect(page.getByTestId(`board-card-${to.id}`)).toContainText('1 открыт.')

    // Закрываем задачу — карточка доски обновляется без перезагрузки
    await page.getByRole('tab', { name: /Задачи/i }).click()
    await page.getByTitle('Открыто → В работе').click()
    await page.getByTitle('В работе → Выполнено').click()
    await page.getByRole('tab', { name: /Доски/i }).click()
    await expect(page.getByTestId(`board-card-${to.id}`)).toContainText('Все задачи закрыты')
  })
})
