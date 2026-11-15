import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import {
  API,
  BASE_URL,
  DEFAULT_USER_NAME,
  type E2ESession,
  cleanupBoards,
  ensureE2EWorkspace,
  getCsrfHeaders,
  loginViaAPI,
  loginWorkspace,
  setUsername,
} from './helpers'

/**
 * Синхронизация доски с сервером: один сокет на доску, сверка после обрыва связи,
 * одинаковый порядок карточек у всех участников, таймер от серверного времени.
 * Доски создаёт общий участник спеков; второй участник входит под своим именем.
 */

interface BoardData {
  id: string
  slug: string
  columns: { id: string; title: string; cards: { id: string; text: string }[] }[]
}

async function apiHeaders(request: APIRequestContext, token: string) {
  const csrf = await getCsrfHeaders(request)
  return { ...csrf, 'X-Workspace-Token': token }
}

async function createBoard(request: APIRequestContext, owner: E2ESession, name: string): Promise<BoardData> {
  const res = await request.post(`${API}/boards/`, {
    headers: await apiHeaders(request, owner.token),
    data: { name },
  })
  expect(res.ok(), `создание доски: ${res.status()}`).toBeTruthy()
  return (await res.json()) as BoardData
}

async function createCard(request: APIRequestContext, session: E2ESession, columnId: string, text: string) {
  const res = await request.post(`${API}/cards/`, {
    headers: await apiHeaders(request, session.token),
    data: { column_id: columnId, text },
  })
  expect(res.ok(), `создание карточки: ${res.status()}`).toBeTruthy()
  return (await res.json()) as { id: string }
}

async function readBoard(request: APIRequestContext, session: E2ESession, boardId: string): Promise<BoardData> {
  const res = await request.get(`${API}/boards/${boardId}`, {
    headers: { 'X-Workspace-Token': session.token },
  })
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as BoardData
}

async function openBoardAs(browser: Browser, request: APIRequestContext, board: BoardData, name = DEFAULT_USER_NAME) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await setUsername(page, name)
  const session = await loginWorkspace(page, request)
  await page.goto(`/board/${board.slug}`)
  await expect(page.getByTestId('user-settings-btn')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 10000 })
  return { ctx, page, session }
}

/** Тексты карточек колонки сверху вниз — как их видит участник. */
const cardTexts = (page: Page, columnIndex: number) =>
  page
    .getByTestId('board-column')
    .nth(columnIndex)
    .getByTestId('card-widget')
    .evaluateAll((els) => els.map((el) => el.querySelector('p')?.textContent?.trim() ?? ''))

/** Считать сокеты доски, открытые страницей. */
function trackBoardSockets(page: Page) {
  const sockets: { url: string; closed: boolean }[] = []
  page.on('websocket', (ws) => {
    if (!/\/ws\/[0-9a-f-]{36}$/.test(ws.url())) return
    const entry = { url: ws.url(), closed: false }
    sockets.push(entry)
    ws.on('close', () => {
      entry.closed = true
    })
  })
  return sockets
}

const timerSeconds = async (page: Page) => {
  const text = (await page.getByTestId('timer-display').first().textContent()) ?? ''
  const [minutes, seconds] = text.split(':').map(Number)
  return minutes * 60 + seconds
}

test.describe('Синхронизация доски', () => {
  let owner: E2ESession

  test.beforeEach(async ({ request }) => {
    owner = await ensureE2EWorkspace(request)
    await cleanupBoards(request, owner.token)
  })

  test.afterAll(async ({ request }) => {
    await cleanupBoards(request, (await ensureE2EWorkspace(request)).token)
  })

  test('доска открывает сокет один раз: по адресу доски, через /board/start и после входа с главной', async ({
    page,
    request,
    browser,
  }) => {
    const board = await createBoard(request, owner, 'Один сокет')
    await setUsername(page)
    await loginWorkspace(page, request)
    const sockets = trackBoardSockets(page)

    // По адресу доски
    await page.goto(`/board/${board.slug}`)
    await expect(page.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(1500)
    expect(sockets, 'по адресу доски').toHaveLength(1)
    expect(sockets[0].closed).toBe(false)

    // Через /board/start: адрес меняется на адрес первой доски, доска монтируется один раз
    sockets.length = 0
    await page.goto('/board/start')
    await expect(page).toHaveURL(new RegExp(`/board/${board.slug}$`), { timeout: 15000 })
    await expect(page.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(1500)
    expect(sockets, 'через /board/start').toHaveLength(1)
    expect(sockets[0].closed).toBe(false)

    // Вход по коду и ключу на главной: чистый контекст, без сессии
    const ctx = await browser.newContext()
    try {
      const fresh = await ctx.newPage()
      const freshSockets = trackBoardSockets(fresh)
      await fresh.goto('/')
      await expect(fresh.getByRole('button', { name: /войти на доску/i })).toBeVisible({ timeout: 15000 })
      await fresh.locator('#welcome-name').fill('Вход с главной')
      await fresh.locator('#welcome-slug').fill('e2e-team')
      await fresh.locator('#welcome-key').fill('e2e-test-key')
      await fresh.getByRole('button', { name: /войти на доску/i }).click()
      await expect(fresh.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 15000 })
      await fresh.waitForTimeout(1500)
      expect(freshSockets, 'после входа с главной').toHaveLength(1)
      expect(freshSockets[0].closed).toBe(false)
    } finally {
      await ctx.close()
    }
  })

  test('после обрыва связи виден баннер, а доска догоняет сервер без перезагрузки', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Обрыв связи')
    const first = await createCard(request, owner, board.columns[0].id, 'Была до обрыва')
    await createCard(request, owner, board.columns[0].id, 'Останется')

    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      const page = guest.page
      await expect(page.getByText('Останется')).toBeVisible()
      await expect(page.getByTestId('connection-banner')).toHaveCount(0)

      // Связь пропала. Возврат на вкладку заставляет клиент проверить соединение сразу,
      // не дожидаясь очередного ping
      await guest.ctx.setOffline(true)
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      const banner = page.getByTestId('connection-banner')
      await expect(banner).toBeVisible({ timeout: 15000 })
      await expect(banner).toContainText(/Переподключаемся|Нет подключения к интернету/)

      // Пока гостя нет на связи, доска меняется: карточка удалена, карточка и задача добавлены
      const headers = await apiHeaders(request, owner.token)
      await request.delete(`${API}/cards/${first.id}`, { headers })
      await createCard(request, owner, board.columns[1].id, 'Появилась без гостя')
      await request.post(`${API}/action-items/`, {
        headers,
        data: { board_id: board.id, title: 'Задача без гостя', text: 'Задача без гостя' },
      })
      await expect(page.getByText('Появилась без гостя')).toHaveCount(0)

      // Связь вернулась: доска совпадает с сервером без F5, баннер исчезает
      await guest.ctx.setOffline(false)
      await expect(page.getByText('Появилась без гостя')).toBeVisible({ timeout: 20000 })
      await expect(page.getByText('Была до обрыва')).toHaveCount(0)
      await expect(page.getByText('Задача без гостя').first()).toBeVisible()
      await expect(banner).toHaveCount(0)

      // События снова приходят вживую
      await createCard(request, owner, board.columns[0].id, 'После восстановления')
      await expect(page.getByText('После восстановления')).toBeVisible({ timeout: 10000 })
      const server = await readBoard(request, owner, board.id)
      expect(await cardTexts(page, 0)).toEqual(server.columns[0].cards.map((c) => c.text))
    } finally {
      await guest.ctx.close()
    }
  })

  test('порядок карточек после переноса одинаков у всех участников и совпадает с сервером', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Порядок карточек')
    const ids: Record<string, string> = {}
    for (const text of ['Альфа', 'Бета', 'Гамма', 'Дельта']) {
      ids[text] = (await createCard(request, owner, board.columns[0].id, text)).id
    }

    const creator = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      await expect(guest.page.getByText('Дельта')).toBeVisible()
      const headers = await apiHeaders(request, owner.token)

      // Сервер перенумеровывает соседей, а в событии присылает одну карточку и итоговый порядок
      await request.post(`${API}/cards/${ids['Дельта']}/move`, {
        headers,
        data: { column_id: board.columns[0].id, position: 1 },
      })
      await expect.poll(() => cardTexts(guest.page, 0)).toEqual(['Альфа', 'Дельта', 'Бета', 'Гамма'])
      await expect.poll(() => cardTexts(creator.page, 0)).toEqual(['Альфа', 'Дельта', 'Бета', 'Гамма'])

      // Перенос в другую колонку и обратно в начало
      await request.post(`${API}/cards/${ids['Альфа']}/move`, {
        headers,
        data: { column_id: board.columns[1].id, position: 0 },
      })
      await request.post(`${API}/cards/${ids['Гамма']}/move`, {
        headers,
        data: { column_id: board.columns[0].id, position: 0 },
      })
      const server = await readBoard(request, owner, board.id)
      const expected = server.columns.slice(0, 2).map((c) => c.cards.map((card) => card.text))
      expect(expected).toEqual([['Гамма', 'Дельта', 'Бета'], ['Альфа']])
      for (const page of [guest.page, creator.page]) {
        await expect.poll(() => cardTexts(page, 0)).toEqual(expected[0])
        await expect.poll(() => cardTexts(page, 1)).toEqual(expected[1])
      }
    } finally {
      await creator.ctx.close()
      await guest.ctx.close()
    }
  })

  test('таймер идёт от серверного времени: одинаков у участников, у вошедшего позже и после перезагрузки', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Таймер')
    const creator = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      await creator.page.getByLabel('Запустить таймер').click()
      await expect(guest.page.getByTestId('timer-display').first()).not.toHaveText('05:00', { timeout: 5000 })

      // Таймер идёт у обоих и показывает одно и то же время
      const before = await timerSeconds(guest.page)
      await guest.page.waitForTimeout(2100)
      const after = await timerSeconds(guest.page)
      expect(before - after).toBeGreaterThanOrEqual(2)
      expect(before - after).toBeLessThanOrEqual(3)
      expect(Math.abs((await timerSeconds(creator.page)) - (await timerSeconds(guest.page)))).toBeLessThanOrEqual(1)

      // Участник, вошедший позже, получает таймер от сервера
      const late = await openBoardAs(browser, request, board, 'Опоздавший')
      try {
        await expect(late.page.getByTestId('timer-display').first()).not.toHaveText('05:00', { timeout: 5000 })
        expect(Math.abs((await timerSeconds(late.page)) - (await timerSeconds(creator.page)))).toBeLessThanOrEqual(1)
      } finally {
        await late.ctx.close()
      }

      // Перезагрузка: время приходит с сервера, а не из localStorage
      await guest.page.reload()
      await expect(guest.page.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 15000 })
      await expect(guest.page.getByTestId('timer-display').first()).not.toHaveText('05:00', { timeout: 5000 })
      expect(Math.abs((await timerSeconds(guest.page)) - (await timerSeconds(creator.page)))).toBeLessThanOrEqual(1)
      const stored = await guest.page.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.startsWith('retro_timer_') && key !== 'retro_timer_muted'),
      )
      expect(stored).toEqual([])

      // Пауза останавливает таймер у всех на одном значении
      await creator.page.getByLabel('Пауза таймера').click()
      await guest.page.waitForTimeout(700)
      const paused = await timerSeconds(guest.page)
      await guest.page.waitForTimeout(1500)
      expect(await timerSeconds(guest.page)).toBe(paused)
      expect(await timerSeconds(creator.page)).toBe(paused)
    } finally {
      await creator.ctx.close()
      await guest.ctx.close()
    }
  })

  test('выход в другой вкладке закрывает сокет: доска возвращает ко входу, а не переподключается по кругу', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Выход')
    // Свой участник: выход завершает сессию на сервере
    const session = await loginViaAPI(request, 'Уходящий')
    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      await setUsername(page, 'Уходящий')
      await ctx.addCookies([
        {
          name: 'workspace_token',
          value: session.token,
          domain: new URL(BASE_URL).hostname,
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ])
      await page.addInitScript(
        ({ workspace, participant }) => {
          const stored = JSON.parse(localStorage.getItem('retroboard-app') || '{"state":{},"version":1}') as {
            state: Record<string, unknown>
            version: number
          }
          stored.state.workspace = workspace
          stored.state.participant = participant
          localStorage.setItem('retroboard-app', JSON.stringify(stored))
        },
        {
          workspace: {
            workspaceId: session.workspace_id,
            workspaceSlug: session.workspace_slug,
            workspaceName: session.workspace_name,
          },
          participant: session.participant,
        },
      )
      const sockets = trackBoardSockets(page)
      await page.goto(`/board/${board.slug}`)
      await expect(page.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 15000 })

      // Сессию завершают в другом месте: сервер закрывает сокеты участника с кодом 1008
      const res = await request.post(`${API}/workspaces/logout`, {
        headers: await apiHeaders(request, session.token),
      })
      expect(res.status()).toBe(204)

      await expect(page.getByRole('button', { name: /войти на доску/i })).toBeVisible({ timeout: 15000 })
      // Новых попыток подключения нет
      const opened = sockets.length
      await page.waitForTimeout(4000)
      expect(sockets.length).toBe(opened)
    } finally {
      await ctx.close()
    }
  })
})
