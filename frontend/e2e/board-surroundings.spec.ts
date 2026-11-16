import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
  type WebSocketRoute,
} from '@playwright/test'
import {
  API,
  DEFAULT_USER_NAME,
  type E2ESession,
  cleanupBoards,
  createActionItemViaAPI,
  createBoardViaAPI,
  ensureE2EWorkspace,
  getCsrfHeaders,
  loginWorkspace,
  setUsername,
} from './helpers'

/**
 * Окружение доски: окно фокуса, панель сессии, шапка, итоги без AI, задачи между досками,
 * удаление последней доски. Доски создаёт общий участник спеков (он же «ведущий»),
 * второй участник входит под своим именем в отдельном контексте браузера.
 */

interface BoardData {
  id: string
  slug: string
  columns: { id: string; title: string }[]
}

async function apiHeaders(request: APIRequestContext, token: string) {
  const csrf = await getCsrfHeaders(request)
  return { ...csrf, 'X-Workspace-Token': token }
}

async function createCard(request: APIRequestContext, token: string, columnId: string, text: string) {
  const res = await request.post(`${API}/cards/`, {
    headers: await apiHeaders(request, token),
    data: { column_id: columnId, text },
  })
  expect(res.ok(), `создание карточки: ${res.status()}`).toBeTruthy()
}

async function patchBoard(
  request: APIRequestContext,
  token: string,
  boardId: string,
  data: Record<string, unknown>,
) {
  const res = await request.patch(`${API}/boards/${boardId}`, {
    headers: await apiHeaders(request, token),
    data,
  })
  expect(res.ok(), `обновление доски: ${res.status()}`).toBeTruthy()
}

/** Открыть доску в отдельном контексте браузера под участником с именем `name`. */
async function openBoardAs(
  browser: Browser,
  request: APIRequestContext,
  board: BoardData,
  name = DEFAULT_USER_NAME,
  viewport = { width: 1440, height: 900 },
) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await setUsername(page, name)
  await loginWorkspace(page, request)
  await page.goto(`/board/${board.slug}`)
  await expect(page.getByTestId('user-settings-btn')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 10000 })
  return { ctx, page }
}

/** Высота полосы под шапкой (панель сессии) и верх рабочей области доски. */
async function measureBars(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('header')
    const session = header?.nextElementSibling ?? null
    const main = document.querySelector('main')
    const height = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().height) : 0)
    return {
      header: height(header),
      session: height(session),
      mainTop: main ? Math.round(main.getBoundingClientRect().top) : 0,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

let shared: E2ESession

test.beforeEach(async ({ request }) => {
  shared = await ensureE2EWorkspace(request)
  await cleanupBoards(request, shared.token)
})

test.afterAll(async ({ request }) => {
  const ws = await ensureE2EWorkspace(request)
  await cleanupBoards(request, ws.token)
})

test.describe('Сессия ведущего: окно фокуса и заблокированная доска', () => {
  test('участник закрывает окно фокуса у себя, фокус ведущего при этом остаётся', async ({
    browser,
    request,
  }) => {
    const board = (await createBoardViaAPI(request, 'Фокус обсуждения', shared.token)) as BoardData
    await createCard(request, shared.token, board.columns[0].id, 'Первая тема')
    await createCard(request, shared.token, board.columns[0].id, 'Вторая тема')

    const fac = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      await fac.page.getByTestId('become-facilitator-btn').click()
      await fac.page.getByTestId('phase-step-discuss').click()
      await expect(guest.page.getByText('Первая тема')).toBeVisible({ timeout: 10000 })

      const card = fac.page.getByTestId('card-widget').filter({ hasText: 'Первая тема' })
      await card.hover()
      await card.getByTitle('В фокус обсуждения').click()

      const guestDialog = guest.page.getByRole('dialog')
      await expect(guestDialog).toContainText('Первая тема', { timeout: 10000 })
      // Раньше окно нельзя было закрыть: ни крестика, ни Esc, ни клика по фону
      await expect(guestDialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeVisible()
      await guest.page.keyboard.press('Escape')

      await expect(guestDialog).toBeHidden()
      const minimized = guest.page.getByTestId('spotlight-minimized')
      await expect(minimized).toContainText('Первая тема')
      // У ведущего фокус на месте
      await expect(fac.page.getByRole('dialog')).toContainText('Первая тема')

      // Доска у участника снова доступна: голос ставится
      const guestCard = guest.page.getByTestId('card-widget').filter({ hasText: 'Вторая тема' })
      await guestCard.locator('button[title="Лайк"]').click()
      await expect(guestCard.locator('button[title="Убрать лайк"]')).toContainText('1', { timeout: 10000 })

      // Ведущий листает карточки — закрытое окно не всплывает заново
      await fac.page.getByRole('dialog').getByRole('button', { name: /Следующая/ }).click()
      await expect(minimized).toContainText('Вторая тема', { timeout: 10000 })
      await expect(guest.page.getByRole('dialog')).toHaveCount(0)

      // Вернуться к окну можно в любой момент, закрыть — и кнопкой
      await minimized.getByRole('button', { name: 'Открыть' }).click()
      await expect(guest.page.getByRole('dialog')).toContainText('Вторая тема')
      await guest.page.getByTestId('spotlight-close-local-btn').click()
      await expect(guest.page.getByRole('dialog')).toHaveCount(0)

      // Ведущий закрывает окно — фокус снят у всех
      await fac.page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
      await expect(fac.page.getByRole('dialog')).toHaveCount(0)
      await expect(minimized).toHaveCount(0, { timeout: 10000 })

      // Новый фокус снова открывает окно у участника
      await card.hover()
      await card.getByTitle('В фокус обсуждения').click()
      await expect(guest.page.getByRole('dialog')).toContainText('Первая тема', { timeout: 10000 })
    } finally {
      await fac.ctx.close()
      await guest.ctx.close()
    }
  })

  test('на заблокированной доске «Стать ведущим» отключена: архив не прячется одним нажатием', async ({
    browser,
    request,
  }) => {
    const board = (await createBoardViaAPI(request, 'Архив спринта', shared.token)) as BoardData
    await createCard(request, shared.token, board.columns[0].id, 'Архивная карточка')
    await patchBoard(request, shared.token, board.id, { is_locked: true })

    const owner = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      const become = guest.page.getByTestId('become-facilitator-btn')
      await expect(become).toBeDisabled()
      await expect(become).toHaveAttribute('title', /Доска заблокирована/)
      await expect(guest.page.getByTestId('locked-session-hint')).toBeVisible()

      // Карточки архива по-прежнему видны обоим
      await expect(owner.page.getByText('Архивная карточка')).toBeVisible()
      await expect(guest.page.getByText('Архивная карточка')).toBeVisible()

      // После разблокировки сессию можно начать
      await patchBoard(request, shared.token, board.id, { is_locked: false })
      await expect(become).toBeEnabled({ timeout: 10000 })
    } finally {
      await owner.ctx.close()
      await guest.ctx.close()
    }
  })

  test('диалог завершения сессии описывает то, что сделает сервер', async ({ browser, request }) => {
    const board = (await createBoardViaAPI(request, 'Завершение сессии', shared.token)) as BoardData
    const fac = await openBoardAs(browser, request, board)
    try {
      await fac.page.getByTestId('become-facilitator-btn').click()
      await fac.page.getByTestId('stop-facilitator-btn').click()
      const dialog = fac.page.getByRole('alertdialog')
      await expect(dialog).toContainText('Сейчас идёт «Штурм»')
      await expect(dialog).toContainText('откроются всей команде')
      await dialog.getByRole('button', { name: 'Отмена' }).click()

      await fac.page.getByTestId('phase-step-reveal').click()
      await fac.page.getByTestId('stop-facilitator-btn').click()
      await expect(dialog).toContainText('Карточки уже раскрыты')
      await expect(dialog).not.toContainText('Сейчас идёт «Штурм»')
    } finally {
      await fac.ctx.close()
    }
  })
})

test.describe('Панель сессии и шапка: вёрстка', () => {
  test('1440 px, фаза «Голосование» у ведущего: панель сессии в одну строку', async ({
    browser,
    request,
  }) => {
    const board = (await createBoardViaAPI(request, 'Голосование на 1440', shared.token)) as BoardData
    await createCard(request, shared.token, board.columns[0].id, 'Карточка для голоса')

    const fac = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      const freeMode = await measureBars(fac.page)

      await fac.page.getByTestId('become-facilitator-btn').click()
      for (const step of ['reveal', 'discuss', 'vote'] as const) {
        await fac.page.getByTestId(`phase-step-${step}`).click()
      }
      await expect(fac.page.getByTestId('my-votes')).toBeVisible({ timeout: 10000 })
      // Самое широкое состояние: голос отдан (появляется «Сброс»), участник отметил готовность
      const card = fac.page.getByTestId('card-widget').filter({ hasText: 'Карточка для голоса' })
      await card.locator('button[title="Лайк"]').click()
      await expect(fac.page.getByTestId('reset-votes-btn')).toBeVisible({ timeout: 10000 })
      await guest.page.getByTestId('ready-toggle-btn').click()
      await expect(fac.page.getByTestId('ready-toggle-btn')).toContainText('1/2', { timeout: 10000 })

      const voting = await measureBars(fac.page)
      // Панель не выросла во вторую строку, и доска не прыгнула вниз
      expect(voting.session).toBe(freeMode.session)
      expect(voting.mainTop).toBe(freeMode.mainTop)
      expect(voting.overflowX).toBeLessThanOrEqual(0)

      // Всё управление ведущего на месте и не обрезано краем экрана
      for (const testId of ['facilitator-badge', 'voted-count', 'next-phase-btn', 'stop-facilitator-btn']) {
        const box = await fac.page.getByTestId(testId).boundingBox()
        expect(box, testId).not.toBeNull()
        expect(box!.x, `${testId}: левый край`).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width, `${testId}: правый край`).toBeLessThanOrEqual(1440)
      }
      // Текущий этап подписан всегда; остальные при нехватке места сжимаются до значков
      await expect(fac.page.getByTestId('phase-step-vote')).toContainText('Голосование')
    } finally {
      await fac.ctx.close()
      await guest.ctx.close()
    }
  })

  test('телефон 390 px: название доски видно, логотип не мешает, панели не съедают экран', async ({
    browser,
    request,
  }) => {
    const board = (await createBoardViaAPI(request, 'Ретро на телефоне', shared.token)) as BoardData
    const phone = await openBoardAs(browser, request, board, DEFAULT_USER_NAME, { width: 390, height: 844 })
    try {
      const drawer = await phone.page.getByTestId('boards-drawer-btn').boundingBox()
      const name = await phone.page.getByTestId('topbar-board-name').boundingBox()
      expect(drawer).not.toBeNull()
      expect(name).not.toBeNull()
      // Название не наезжает на кнопку списка досок и занимает заметную часть шапки
      expect(name!.x).toBeGreaterThanOrEqual(drawer!.x + drawer!.width)
      expect(name!.width).toBeGreaterThan(120)
      await expect(phone.page.getByTestId('topbar-board-name')).toContainText('Ретро на телефоне')

      const bars = await measureBars(phone.page)
      expect(bars.session).toBeLessThanOrEqual(56)
      // Шапка, панель сессии и панель инструментов вместе — меньше четверти экрана (было ~270 px)
      expect(bars.mainTop).toBeLessThanOrEqual(210)
      expect(bars.overflowX).toBeLessThanOrEqual(0)

      // Всё, что не поместилось в шапку, доступно из меню
      await phone.page.getByTestId('export-menu-btn').click()
      await expect(phone.page.getByTestId('menu-health-check-item')).toBeVisible()
      await expect(phone.page.getByTestId('menu-dashboard-item')).toBeVisible()
      await phone.page.getByTestId('menu-board-settings-item').click()
      await expect(phone.page.getByRole('dialog')).toContainText('Настройки доски')
    } finally {
      await phone.ctx.close()
    }
  })

  test('диалог «Новая доска» на экране 900 px: «Создать» видна, форма не сбрасывается чужими правками', async ({
    browser,
    request,
  }) => {
    const board = (await createBoardViaAPI(request, 'Доска для диалога', shared.token)) as BoardData
    const owner = await openBoardAs(browser, request, board)
    try {
      await owner.page.getByTestId('boards-drawer-btn').click()
      await owner.page.getByTestId('sidebar-new-board-btn').click()
      const nameInput = owner.page.getByTestId('create-board-name-input')
      await nameInput.fill('Черновик названия')
      await owner.page.getByRole('button', { name: /4Ls/ }).click()

      const submit = owner.page.getByTestId('create-board-submit-btn')
      const box = await submit.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.y + box!.height).toBeLessThanOrEqual(900)
      await expect(submit).toBeInViewport({ ratio: 1 })

      // Коллега переименовал доску: список досок обновился, форма осталась как была
      await patchBoard(request, shared.token, board.id, { name: 'Доска для диалога (переименована)' })
      // Событие дошло до страницы: название в шапке (под диалогом) уже новое
      await expect(owner.page.getByTestId('topbar-board-name')).toContainText('переименована', {
        timeout: 10000,
      })
      await expect(nameInput).toHaveValue('Черновик названия')
      await expect(owner.page.getByRole('button', { name: /4Ls/ })).toHaveClass(/border-primary/)

      await submit.click()
      await expect(owner.page.getByTestId('topbar-board-name')).toHaveText('Черновик названия', {
        timeout: 15000,
      })
      await expect(owner.page.locator('body')).toContainText('Liked (Понравилось)')
    } finally {
      await owner.ctx.close()
    }
  })

  test('счётчик своих голосов и «Сброс» видны вне фазы голосования', async ({ browser, request }) => {
    const board = (await createBoardViaAPI(request, 'Голоса вне сессии', shared.token)) as BoardData
    await createCard(request, shared.token, board.columns[0].id, 'Голосуем без ведущего')
    const owner = await openBoardAs(browser, request, board)
    try {
      await expect(owner.page.getByTestId('my-votes')).toHaveCount(0)

      const card = owner.page.getByTestId('card-widget').filter({ hasText: 'Голосуем без ведущего' })
      await card.locator('button[title="Лайк"]').click()

      await expect(owner.page.getByTestId('my-votes')).toContainText('4/5', { timeout: 10000 })
      await owner.page.getByTestId('reset-votes-btn').click()
      await expect(owner.page.getByTestId('my-votes')).toHaveCount(0, { timeout: 10000 })
      await expect(card.locator('button[title="Лайк"]')).toContainText('0')
    } finally {
      await owner.ctx.close()
    }
  })

  test('панель досок показывает актуальное число карточек', async ({ browser, request }) => {
    const board = (await createBoardViaAPI(request, 'Счётчик карточек', shared.token)) as BoardData
    const owner = await openBoardAs(browser, request, board)
    try {
      // Карточки появились после загрузки страницы
      for (const text of ['раз', 'два', 'три']) {
        await createCard(request, shared.token, board.columns[0].id, text)
      }
      await expect(owner.page.getByTestId('card-widget')).toHaveCount(3, { timeout: 10000 })

      await owner.page.getByTestId('boards-drawer-btn').click()
      await expect(owner.page.getByRole('dialog').getByTestId('board-cards-count')).toHaveText('• 3 карт.', {
        timeout: 10000,
      })
    } finally {
      await owner.ctx.close()
    }
  })
})

test.describe('Итоги без AI', () => {
  test('фаза «Итоги»: окно объясняет, почему итогов нет, и ведёт в экспорт; запросов вслепую нет', async ({
    browser,
    request,
  }) => {
    const board = (await createBoardViaAPI(request, 'Итоги без AI', shared.token)) as BoardData
    await createCard(request, shared.token, board.columns[0].id, 'Карточка для экспорта')

    const fac = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    const summaryRequests: string[] = []
    const consoleErrors: string[] = []
    for (const page of [fac.page, guest.page]) {
      page.on('request', (r) => {
        if (/\/api\/boards\/[^/]+\/summary/.test(r.url())) summaryRequests.push(`${r.method()} ${r.url()}`)
      })
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text())
      })
    }
    try {
      // Окно итогов у доски без итогов: ни запроса, ни 404 в консоли
      await fac.page.getByTestId('export-menu-btn').click()
      await fac.page.getByRole('menuitem', { name: 'Итоги ретроспективы' }).click()
      await expect(fac.page.getByRole('dialog').getByTestId('ai-unavailable-note')).toBeVisible()
      await fac.page.getByRole('dialog').getByRole('button', { name: 'Готово' }).click()

      await fac.page.getByTestId('become-facilitator-btn').click()
      for (const step of ['reveal', 'discuss', 'vote', 'summary'] as const) {
        await fac.page.getByTestId(`phase-step-${step}`).click()
      }

      // Не одинокий тост: окно с объяснением и действием — у ведущего и у участника
      for (const page of [fac.page, guest.page]) {
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByTestId('ai-unavailable-note')).toContainText('AI на этом сервере не настроен', {
          timeout: 15000,
        })
        await expect(dialog.getByTestId('generate-summary-btn')).toHaveCount(0)
        await expect(dialog.getByTestId('regenerate-summary-btn')).toHaveCount(0)
      }
      await guest.page.getByTestId('summary-open-export-btn').click()
      await expect(guest.page.getByRole('dialog').locator('pre')).toContainText('Карточка для экспорта')

      expect(summaryRequests).toEqual([])
      expect(consoleErrors).toEqual([])
    } finally {
      await fac.ctx.close()
      await guest.ctx.close()
    }
  })
})

test.describe('Итоги: событие summary_generated', () => {
  test('перегенерация другим участником не открывает окно итогов, итоги фазы — открывают', async ({
    browser,
    request,
  }) => {
    const board = (await createBoardViaAPI(request, 'Итоги по событию', shared.token)) as BoardData
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await setUsername(page)
    await loginWorkspace(page, request)
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    // Сокет доски работает с сервером как обычно; тест может дослать странице событие от его имени.
    // Итоги создаёт AI, которого в тестовом окружении нет, поэтому событие и сами итоги — подменные.
    let boardSocket: WebSocketRoute | null = null
    await page.routeWebSocket(
      (url) => url.pathname === `/ws/${board.id}`,
      (ws) => {
        ws.connectToServer()
        boardSocket = ws
      },
    )
    let summaryNumber = 0
    await page.route(`**/api/boards/${board.id}/summary`, async (route) => {
      summaryNumber += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'sum-1',
          board_id: board.id,
          session_id: null,
          summary_text: `Подменные итоги №${summaryNumber}`,
          key_themes: [],
          recommendations: [],
          created_at: new Date().toISOString(),
        }),
      })
    })
    const fromServer = (data: Record<string, unknown>) => {
      expect(boardSocket, 'сокет доски перехвачен').not.toBeNull()
      boardSocket!.send(JSON.stringify({ event: 'summary_generated', data }))
    }

    try {
      await page.goto(`/board/${board.slug}`)
      await expect(page.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 15000 })

      // Кто-то перегенерировал итоги кнопкой: окно не всплывает, содержимое обновляется в фоне
      const refreshed = page.waitForResponse((r) => r.url().endsWith(`/boards/${board.id}/summary`))
      fromServer({ summary: { id: 'sum-1' }, board_id: board.id, regenerated: true })
      await refreshed
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      )
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('body > canvas')).toHaveCount(0)

      await page.getByTestId('export-menu-btn').click()
      await page.getByRole('menuitem', { name: 'Итоги ретроспективы' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('Подменные итоги №')
      await dialog.getByRole('button', { name: 'Готово' }).click()
      await expect(dialog).toHaveCount(0)

      // Итоги фазы «Итоги» (без признака перегенерации): окно открывается у всех
      fromServer({ id: 'sum-1', board_id: board.id, summary_text: 'Подменные итоги' })
      await expect(dialog).toContainText('Подменные итоги №', { timeout: 10000 })

      // Салют не нарушает CSP: в консоли нет ошибок (раньше — запрет воркера из blob:)
      await page.waitForLoadState('networkidle')
      expect(consoleErrors).toEqual([])
    } finally {
      await ctx.close()
    }
  })
})

test.describe('Задачи между досками', () => {
  test('«На доску» переносит задачу без дубля; оригинал помечен перенесённым', async ({
    browser,
    request,
  }) => {
    const oldBoard = (await createBoardViaAPI(request, 'Прошлый спринт', shared.token)) as BoardData
    const newBoard = (await createBoardViaAPI(request, 'Новый спринт', shared.token)) as BoardData
    await createActionItemViaAPI(request, oldBoard.id, 'Починить деплой', shared.token, { title: 'Деплой' })

    const owner = await openBoardAs(browser, request, newBoard)
    try {
      const panel = owner.page.getByTestId('master-column').first()
      await panel.getByRole('button', { name: /Открытые с прошлых ретро/ }).click()
      await expect(panel.getByText('Деплой')).toBeVisible({ timeout: 10000 })

      await panel.getByRole('button', { name: 'На доску' }).click()

      // Задача одна на новой доске, а из блока прошлых ретро она ушла
      await expect(panel.getByTestId('action-item').filter({ hasText: 'Деплой' })).toHaveCount(1, {
        timeout: 10000,
      })
      await expect(panel.getByRole('button', { name: 'На доску' })).toHaveCount(0)

      // На сервере одна открытая запись: оригинал помечен перенесённым, второй копии нет
      const headers = await apiHeaders(request, shared.token)
      const all = (await (await request.get(`${API}/action-items/all`, { headers })).json()) as Array<{
        board_id: string
      }>
      expect(all).toHaveLength(1)
      expect(all[0].board_id).toBe(newBoard.id)

      // Блок открыт заново — оригинала рядом с копией нет
      await owner.page.reload()
      await expect(owner.page.getByTestId('user-settings-btn')).toBeVisible({ timeout: 15000 })
      await panel.getByRole('button', { name: /Открытые с прошлых ретро/ }).click()
      await expect(panel.getByText('Все задачи с прошлых ретро закрыты.')).toBeVisible({ timeout: 10000 })

      // На исходной доске задача осталась в истории с пометкой и без переключения статуса
      await owner.page.goto(`/board/${oldBoard.slug}`)
      const oldPanel = owner.page.getByTestId('master-column').first()
      await expect(oldPanel.getByTestId('action-item-carried')).toBeVisible({ timeout: 15000 })
      await expect(oldPanel.getByTestId('action-item-status')).toBeDisabled()
    } finally {
      await owner.ctx.close()
    }
  })

  test('ошибка загрузки блока — не «все задачи закрыты», а сообщение с «Повторить»', async ({
    browser,
    request,
  }) => {
    const oldBoard = (await createBoardViaAPI(request, 'Доска с задачей', shared.token)) as BoardData
    const newBoard = (await createBoardViaAPI(request, 'Доска с ошибкой', shared.token)) as BoardData
    await createActionItemViaAPI(request, oldBoard.id, 'Незакрытая задача', shared.token, { title: 'Не закрыта' })

    const owner = await openBoardAs(browser, request, newBoard)
    try {
      await owner.page.route('**/api/action-items/all**', (route) => route.abort())
      const panel = owner.page.getByTestId('master-column').first()
      await panel.getByRole('button', { name: /Открытые с прошлых ретро/ }).click()

      const error = panel.getByTestId('prev-items-error')
      await expect(error).toContainText('Не удалось загрузить задачи прошлых ретро', { timeout: 10000 })
      await expect(panel.getByText('Все задачи с прошлых ретро закрыты.')).toHaveCount(0)

      await owner.page.unroute('**/api/action-items/all**')
      await error.getByRole('button', { name: 'Повторить' }).click()
      await expect(panel.getByText('Не закрыта')).toBeVisible({ timeout: 10000 })
    } finally {
      await owner.ctx.close()
    }
  })

  test('на заблокированной доске статус задачи меняется, а добавить задачу нельзя', async ({
    browser,
    request,
  }) => {
    const board = (await createBoardViaAPI(request, 'Архив с задачами', shared.token)) as BoardData
    await createActionItemViaAPI(request, board.id, 'Довести до конца', shared.token, { title: 'Хвост спринта' })
    await patchBoard(request, shared.token, board.id, { is_locked: true })

    const owner = await openBoardAs(browser, request, board)
    try {
      const panel = owner.page.getByTestId('master-column').first()
      const status = panel.getByTestId('action-item-status')
      await expect(status).toHaveAttribute('title', 'Статус: Открыто — нажмите, чтобы сменить', {
        timeout: 10000,
      })
      await status.click()
      await expect(status).toHaveAttribute('title', 'Статус: В работе — нажмите, чтобы сменить', {
        timeout: 10000,
      })

      // Сервер сохранил статус (интерфейс меняет его сразу, не дожидаясь ответа)
      const headers = await apiHeaders(request, shared.token)
      await expect
        .poll(async () => {
          const res = await request.get(`${API}/action-items/?board_id=${board.id}`, { headers })
          return ((await res.json()) as Array<{ status: string }>)[0]?.status
        })
        .toBe('in_progress')

      await expect(panel.getByRole('button', { name: 'Добавить' })).toHaveCount(0)
    } finally {
      await owner.ctx.close()
    }
  })
})

test.describe('Удаление последней доски и экспорт', () => {
  test('удаление последней доски: один переход, одно уведомление, пустое состояние', async ({
    browser,
    request,
  }) => {
    const board = (await createBoardViaAPI(request, 'Единственная доска', shared.token)) as BoardData
    const owner = await openBoardAs(browser, request, board)
    try {
      const navigations: string[] = []
      owner.page.on('framenavigated', (frame) => {
        if (frame === owner.page.mainFrame()) navigations.push(frame.url())
      })

      await owner.page.getByTestId('board-settings-btn').click()
      await owner.page.getByTestId('delete-board-btn').click()
      await owner.page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click()

      await expect(owner.page.getByTestId('no-boards-screen')).toBeVisible({ timeout: 15000 })
      await expect(owner.page).toHaveURL(/\/board\/start$/)
      // Событие об удалении приходит и самому удаляющему: второго перехода и тоста от него нет
      await owner.page.waitForLoadState('networkidle')
      await owner.page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      )
      expect(navigations).toHaveLength(1)
      const toasts = owner.page.locator('[data-sonner-toast]')
      await expect(toasts).toHaveCount(1)
      await expect(toasts).toContainText('Доска удалена')

      // Доска не создана молча взамен удалённой
      const headers = await apiHeaders(request, shared.token)
      expect(await (await request.get(`${API}/boards/`, { headers })).json()).toHaveLength(0)
    } finally {
      await owner.ctx.close()
    }
  })

  test('«Печать / Сохранить PDF» при блокировке всплывающих окон объясняет, что произошло', async ({
    browser,
    request,
  }) => {
    const board = (await createBoardViaAPI(request, 'Отчёт для печати', shared.token)) as BoardData
    const owner = await openBoardAs(browser, request, board)
    try {
      // Так ведёт себя браузер с заблокированными всплывающими окнами
      await owner.page.evaluate(() => {
        window.open = () => null
      })
      const download = owner.page.waitForEvent('download', { timeout: 15000 })
      await owner.page.getByTestId('export-menu-btn').click()
      await owner.page.getByRole('menuitem', { name: 'Печать / Сохранить PDF' }).click()

      const file = await download
      expect(file.suggestedFilename()).toMatch(/\.html$/)
      const toast = owner.page.locator('[data-sonner-toast]').filter({
        hasText: 'Браузер не дал открыть окно печати',
      })
      await expect(toast).toBeVisible({ timeout: 10000 })
      await expect(toast).toContainText('Сохранить как PDF')
      await expect(toast).toContainText('всплывающие окна')
    } finally {
      await owner.ctx.close()
    }
  })
})
