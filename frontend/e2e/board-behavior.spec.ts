import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import {
  API,
  DEFAULT_USER_NAME,
  type E2ESession,
  cleanupBoards,
  ensureE2EWorkspace,
  getCsrfHeaders,
  loginWorkspace,
  setUsername,
} from './helpers'

/**
 * Поведение доски: меню колонки, перенос карточек с клавиатуры, откаты при отказе сервера,
 * фокус обсуждения, health check. Создатель доски — общий участник спеков, он же модератор.
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
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await setUsername(page, name)
  const session = await loginWorkspace(page, request)
  await page.goto(`/board/${board.slug}`)
  await expect(page.getByTestId('user-settings-btn')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 10000 })
  return { ctx, page, session, errors }
}

const cardByText = (page: Page, text: string) =>
  page.getByTestId('card-widget').filter({ hasText: text })

const cardTexts = (page: Page, columnIndex: number) =>
  page
    .getByTestId('board-column')
    .nth(columnIndex)
    .getByTestId('card-widget')
    .evaluateAll((els) => els.map((el) => el.querySelector('p')?.textContent?.trim() ?? ''))

const columnTitles = (page: Page) =>
  page
    .getByTestId('board-column')
    .evaluateAll((els) => els.map((el) => el.querySelector('h3')?.textContent?.trim() ?? ''))

const serverCards = async (request: APIRequestContext, session: E2ESession, boardId: string) =>
  (await readBoard(request, session, boardId)).columns.map((c) => c.cards.map((card) => card.text))

/**
 * Перенести карточку с клавиатуры: фокус на ручке, пробел — взять, стрелки, затем `finish`
 * (пробел — отпустить, Escape — отменить). Между нажатиями — паузы, как у человека:
 * слушатель стрелок появляется сразу после того, как карточка взята, а не в тот же миг.
 */
async function keyboardDrag(page: Page, text: string, arrows: string[], finish: 'Space' | 'Escape' = 'Space') {
  const nextFrame = () =>
    page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  await cardByText(page, text).getByTestId('card-drag-handle').focus()
  await page.keyboard.press('Space')
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('Взято:')
  for (const arrow of arrows) {
    await page.keyboard.press(arrow)
    await nextFrame()
  }
  await page.keyboard.press(finish)
}

test.describe('Поведение доски', () => {
  let owner: E2ESession

  test.beforeEach(async ({ request }) => {
    owner = await ensureE2EWorkspace(request)
    await cleanupBoards(request, owner.token)
  })

  test.afterAll(async ({ request }) => {
    await cleanupBoards(request, (await ensureE2EWorkspace(request)).token)
  })

  test('меню колонки: переименование и перестановка — у модератора; у участника перестановки нет', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Колонки')
    const original = board.columns.map((c) => c.title)
    const creator = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      const firstColumn = creator.page.getByTestId('board-column').first()

      // Переименование из меню: фокус сразу в поле названия
      await firstColumn.getByTestId('column-menu-btn').click()
      await creator.page.getByTestId('column-rename-item').click()
      const input = firstColumn.getByRole('textbox', { name: 'Название колонки' })
      await expect(input).toBeFocused()
      await creator.page.keyboard.press('ControlOrMeta+a')
      await creator.page.keyboard.type('Радует')
      await creator.page.keyboard.press('Enter')
      await expect(guest.page.getByRole('heading', { name: 'Радует' })).toBeVisible({ timeout: 10000 })

      // Сдвиг вправо: порядок меняется у всех и на сервере
      await firstColumn.getByTestId('column-menu-btn').click()
      await expect(creator.page.getByTestId('column-move-left-item')).toHaveAttribute('data-disabled', '')
      await creator.page.getByTestId('column-move-right-item').click()
      const moved = [original[1], 'Радует', original[2]]
      await expect.poll(() => columnTitles(creator.page)).toEqual(moved)
      await expect.poll(() => columnTitles(guest.page)).toEqual(moved)
      expect((await readBoard(request, owner, board.id)).columns.map((c) => c.title)).toEqual(moved)

      // Порядок сохраняется после перезагрузки
      await guest.page.reload()
      await expect(guest.page.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 15000 })
      expect(await columnTitles(guest.page)).toEqual(moved)

      // У участника без прав модератора в меню только переименование
      await guest.page.getByTestId('board-column').first().getByTestId('column-menu-btn').click()
      await expect(guest.page.getByTestId('column-rename-item')).toBeVisible()
      await expect(guest.page.getByTestId('column-move-left-item')).toHaveCount(0)
      await expect(guest.page.getByTestId('column-move-right-item')).toHaveCount(0)
      await guest.page.keyboard.press('Escape')

      // И обратно влево
      const renamed = creator.page.getByTestId('board-column').filter({ hasText: 'Радует' })
      await renamed.getByTestId('column-menu-btn').click()
      await creator.page.getByTestId('column-move-left-item').click()
      await expect.poll(() => columnTitles(guest.page)).toEqual(['Радует', original[1], original[2]])
    } finally {
      await creator.ctx.close()
      await guest.ctx.close()
    }
  })

  test('карточку можно перенести с клавиатуры: место в колонке, соседняя колонка, отмена', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Клавиатура')
    for (const text of ['Один', 'Два', 'Три']) {
      await createCard(request, owner, board.columns[0].id, text)
    }
    await createCard(request, owner, board.columns[1].id, 'Икс')
    const creator = await openBoardAs(browser, request, board)
    try {
      const page = creator.page
      await expect(cardByText(page, 'Три')).toBeVisible()

      // У карточки нет роли кнопки, ручка — кнопка с подписью
      await expect(cardByText(page, 'Один')).not.toHaveAttribute('role', 'button')
      const handle = cardByText(page, 'Один').getByRole('button', { name: 'Перетащить карточку' })
      await expect(handle).toBeVisible()

      // Вниз на одно место
      await keyboardDrag(page, 'Один', ['ArrowDown'])
      await expect.poll(() => serverCards(request, owner, board.id).then((c) => c[0])).toEqual(['Два', 'Один', 'Три'])
      expect(await cardTexts(page, 0)).toEqual(['Два', 'Один', 'Три'])

      // В соседнюю колонку
      await keyboardDrag(page, 'Два', ['ArrowRight'])
      await expect
        .poll(() => serverCards(request, owner, board.id).then((c) => c[1].includes('Два') && !c[0].includes('Два')))
        .toBe(true)
      const afterMove = await serverCards(request, owner, board.id)
      expect(await cardTexts(page, 0)).toEqual(afterMove[0])
      expect(await cardTexts(page, 1)).toEqual(afterMove[1])

      // Отмена клавишей Escape: карточка возвращается, на сервере ничего не меняется
      await keyboardDrag(page, 'Один', ['ArrowRight'], 'Escape')
      await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('Перенос отменён')
      await page.waitForLoadState('networkidle')
      expect(await serverCards(request, owner, board.id)).toEqual(afterMove)
      expect(await cardTexts(page, 0)).toEqual(afterMove[0])
      expect(await cardTexts(page, 1)).toEqual(afterMove[1])
    } finally {
      await creator.ctx.close()
    }
  })

  test('сортировка по голосам и поиск отключают перетаскивание с понятной подсказкой', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Сортировка')
    for (const text of ['Один', 'Два']) await createCard(request, owner, board.columns[0].id, text)
    const creator = await openBoardAs(browser, request, board)
    try {
      const page = creator.page
      await expect(cardByText(page, 'Два')).toBeVisible()
      await expect(page.getByTestId('drag-disabled-hint')).toHaveCount(0)

      await page.getByRole('button', { name: 'По порядку', exact: true }).click()
      await expect(page.getByTestId('drag-disabled-hint')).toContainText('отсортированы по голосам')
      const handle = cardByText(page, 'Один').getByTestId('card-drag-handle')
      await expect(handle).toHaveAttribute('aria-disabled', 'true')
      await expect(handle).toHaveAttribute('title', /отсортированы по голосам/)

      // Попытка перетащить ничего не меняет ни на экране, ни на сервере
      await cardByText(page, 'Один').dragTo(page.getByTestId('board-column').nth(1), { force: true })
      await page.waitForLoadState('networkidle')
      expect(await serverCards(request, owner, board.id).then((c) => c[0])).toEqual(['Один', 'Два'])

      await page.getByRole('button', { name: 'По голосам', exact: true }).click()
      await expect(page.getByTestId('drag-disabled-hint')).toHaveCount(0)

      await page.getByPlaceholder('Поиск карточек...').fill('Од')
      await expect(page.getByTestId('drag-disabled-hint')).toContainText('поиск или фильтр')
    } finally {
      await creator.ctx.close()
    }
  })

  test('сервер отказал: карточка возвращается после неудачного переноса и удаления, чужой лайк не теряется', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Откаты')
    const target = await createCard(request, owner, board.columns[0].id, 'Один')
    await createCard(request, owner, board.columns[0].id, 'Два')
    const creator = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      const page = creator.page
      await expect(cardByText(page, 'Два')).toBeVisible()

      // Перенос: сервер отвечает 403 — карточка возвращается на место
      await page.route('**/api/cards/*/move', (route) =>
        route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'Перенос запрещён' }) }),
      )
      await keyboardDrag(page, 'Один', ['ArrowRight'])
      await expect(page.getByText('Перенос запрещён')).toBeVisible({ timeout: 5000 })
      await expect.poll(() => cardTexts(page, 0)).toEqual(['Один', 'Два'])
      expect(await cardTexts(page, 1)).toEqual([])
      await page.unroute('**/api/cards/*/move')

      // Лайк: запрос создателя «висит», за это время голосует гость; сервер создателю отказывает
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route('**/api/cards/*/like*', async (route) => {
        await gate
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'Лимит голосов исчерпан' }) })
      })
      const likes = cardByText(page, 'Один').locator('.tabular-nums').first()
      await cardByText(page, 'Один').getByTitle('Лайк').click()
      // Оптимистично: голос создателя виден сразу
      await expect(cardByText(page, 'Один').getByTitle('Убрать лайк')).toBeVisible()
      await expect(likes).toHaveText('1')
      const guestLike = await request.post(`${API}/cards/${target.id}/like`, {
        headers: await apiHeaders(request, guest.session.token),
      })
      expect(guestLike.ok()).toBeTruthy()
      // Событие о голосе гостя принесло карточку с сервера: на ней один голос — гостя
      await expect(cardByText(page, 'Один').getByTitle('Лайк')).toBeVisible({ timeout: 5000 })
      await expect(likes).toHaveText('1')
      release()
      // Сервер создателю отказал. Откат снимает только его голос: голос гостя, пришедший
      // за время запроса, остаётся (откат снимком карточки обнулил бы счётчик)
      await expect(page.getByText('Лимит голосов исчерпан').first()).toBeVisible({ timeout: 5000 })
      await expect(likes).toHaveText('1')
      await expect(guest.page.getByTestId('card-widget').filter({ hasText: 'Один' }).locator('.tabular-nums').first()).toHaveText('1')
      await page.unroute('**/api/cards/*/like*')

      // Удаление: сервер отвечает 500 — карточка возвращается на своё место
      await page.route('**/api/cards/*', (route) =>
        route.request().method() === 'DELETE'
          ? route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ detail: 'Сбой удаления' }),
            })
          : route.continue(),
      )
      await cardByText(page, 'Один').hover()
      await cardByText(page, 'Один').getByLabel('Действия с карточкой').click()
      await page.getByTestId('card-delete-item').click()
      await page.getByRole('button', { name: 'Удалить', exact: true }).click()
      await expect(page.getByText('Сбой удаления').first()).toBeVisible({ timeout: 5000 })
      await expect.poll(() => cardTexts(page, 0)).toEqual(['Один', 'Два'])
    } finally {
      await creator.ctx.close()
      await guest.ctx.close()
    }
  })

  test('фокус обсуждения включает только ведущий; поиск карточки в палитре — личное действие', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Фокус')
    await createCard(request, owner, board.columns[0].id, 'Обсудим это')
    await createCard(request, owner, board.columns[0].id, 'И это тоже')
    const creator = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      // Вне сессии кнопки нет ни у кого
      await cardByText(creator.page, 'Обсудим это').hover()
      await expect(cardByText(creator.page, 'Обсудим это').getByTitle('В фокус обсуждения')).toHaveCount(0)

      await creator.page.getByTestId('become-facilitator-btn').click()
      await expect(creator.page.getByTestId('stop-facilitator-btn')).toBeVisible({ timeout: 10000 })
      await creator.page.getByTestId('phase-step-discuss').click()
      await expect(cardByText(guest.page, 'Обсудим это')).toBeVisible({ timeout: 10000 })

      // У ведущего кнопка есть, у участника — нет
      await cardByText(creator.page, 'Обсудим это').hover()
      await expect(cardByText(creator.page, 'Обсудим это').getByTitle('В фокус обсуждения')).toBeVisible()
      await cardByText(guest.page, 'Обсудим это').hover()
      await expect(cardByText(guest.page, 'Обсудим это').getByTitle('В фокус обсуждения')).toHaveCount(0)

      // Участник находит карточку в палитре команд: она подсвечивается у него, окно фокуса
      // ни у кого не открывается
      await guest.page.keyboard.press('ControlOrMeta+k')
      await guest.page.getByPlaceholder('Найти доску или команду...').fill('И это тоже')
      await guest.page.getByRole('option', { name: /И это тоже/ }).first().click()
      await expect(cardByText(guest.page, 'И это тоже')).toHaveAttribute('data-flash', 'true')
      await expect(cardByText(guest.page, 'И это тоже')).not.toHaveAttribute('data-flash', 'true', {
        timeout: 4000,
      })
      await expect(guest.page.getByRole('dialog')).toHaveCount(0)
      await expect(creator.page.getByRole('dialog')).toHaveCount(0)

      // Ведущий включает фокус — окно открывается у участника
      await cardByText(creator.page, 'Обсудим это').hover()
      await cardByText(creator.page, 'Обсудим это').getByTitle('В фокус обсуждения').click()
      await expect(guest.page.getByRole('dialog')).toContainText('Обсудим это', { timeout: 10000 })
    } finally {
      await creator.ctx.close()
      await guest.ctx.close()
    }
  })

  test('health check: ведущий запускает опрос у всех, участники отвечают, после сессии — оценка встречи', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Health check')
    const creator = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      await creator.page.getByTestId('become-facilitator-btn').click()
      await expect(creator.page.getByTestId('stop-facilitator-btn')).toBeVisible({ timeout: 10000 })

      // В сессии запустить опрос у всех может только ведущий
      await guest.page.getByTestId('health-check-btn').click()
      await expect(guest.page.getByTestId('health-check-dialog')).toBeVisible()
      await expect(guest.page.getByTestId('health-start-for-team')).toHaveCount(0)
      await guest.page.keyboard.press('Escape')
      await expect(guest.page.getByTestId('health-check-dialog')).toHaveCount(0)

      // Ведущий открывает опрос кнопкой в шапке и запускает его у всех
      await creator.page.getByTestId('health-check-btn').click()
      await expect(creator.page.getByTestId('health-check-dialog')).toBeVisible()
      await creator.page.getByTestId('health-start-for-team').click()
      const guestDialog = guest.page.getByTestId('health-check-dialog')
      await expect(guestDialog).toBeVisible({ timeout: 10000 })
      await expect(guestDialog).toContainText(`${DEFAULT_USER_NAME} приглашает пройти опрос`)

      // Участник отвечает на все вопросы и видит сводку
      const answers = guestDialog.locator('[data-testid^="health-answer-"][data-testid$="-3"]')
      const questions = await answers.count()
      expect(questions).toBeGreaterThan(0)
      for (let i = 0; i < questions; i += 1) await answers.nth(i).click()
      await guest.page.getByTestId('health-submit').click()
      await expect(guest.page.getByTestId('health-summary')).toBeVisible({ timeout: 10000 })

      // Ведущий отвечает: сводка учитывает обоих (обновляется событием health_updated)
      const creatorDialog = creator.page.getByTestId('health-check-dialog')
      await creatorDialog.locator('[data-testid^="health-answer-"][data-testid$="-2"]').first().click()
      await creator.page.getByTestId('health-submit').click()
      await expect(creator.page.getByTestId('health-participants')).toContainText('2', { timeout: 10000 })
      await expect(guest.page.getByTestId('health-participants')).toContainText('2', { timeout: 10000 })
      await creator.page.keyboard.press('Escape')
      await guest.page.keyboard.press('Escape')

      // Сессия завершена — участникам предложено оценить встречу
      await creator.page.getByTestId('stop-facilitator-btn').click()
      await creator.page.getByRole('button', { name: 'Завершить', exact: true }).click()
      await expect(guest.page.getByTestId('roti-prompt')).toBeVisible({ timeout: 10000 })
      await guest.page.getByTestId('roti-option-4').click()
      await expect(guest.page.getByTestId('roti-prompt')).toHaveCount(0, { timeout: 10000 })

      // Вне сессии запустить опрос у всех может любой участник
      await expect(creator.page.getByTestId('roti-prompt')).toBeVisible({ timeout: 10000 })
      await creator.page.keyboard.press('Escape')
      await guest.page.getByTestId('health-check-btn').click()
      await expect(guest.page.getByTestId('health-check-dialog')).toBeVisible()
      // Гость уже отвечал: окно открывается на сводке, кнопка запуска — там же
      await expect(guest.page.getByTestId('health-start-for-team')).toBeVisible()
    } finally {
      await creator.ctx.close()
      await guest.ctx.close()
    }
  })

  test('доска без итогов не запрашивает итоги вслепую: в консоли нет ошибок 404', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Без итогов')
    await createCard(request, owner, board.columns[0].id, 'Карточка')
    const creator = await openBoardAs(browser, request, board)
    try {
      const page = creator.page
      const summaryRequests: string[] = []
      page.on('request', (req) => {
        if (/\/api\/boards\/[^/]+\/summary$/.test(req.url())) summaryRequests.push(req.url())
      })

      await page.getByTestId('export-menu-btn').click()
      await page.getByText('Итоги ретроспективы').click()
      await expect(page.getByRole('dialog').getByText('Итоги ретроспективы')).toBeVisible({ timeout: 10000 })
      await page.waitForLoadState('networkidle')

      expect(summaryRequests).toEqual([])
      expect(creator.errors.filter((text) => text.includes('404'))).toEqual([])
    } finally {
      await creator.ctx.close()
    }
  })

  test('телефон: карточка выбирается касанием, меню колонки и health check доступны', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, 'Телефон')
    await createCard(request, owner, board.columns[0].id, 'Карточка на телефоне')
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    })
    try {
      const page = await ctx.newPage()
      await setUsername(page)
      await loginWorkspace(page, request)
      await page.goto(`/board/${board.slug}`)
      await expect(cardByText(page, 'Карточка на телефоне')).toBeVisible({ timeout: 15000 })

      // Кружок выбора виден без наведения — на сенсорном экране его просто нет
      const checkbox = cardByText(page, 'Карточка на телефоне').getByLabel('Выбрать карточку')
      await expect(checkbox).toHaveCSS('opacity', '1')
      await checkbox.tap()
      await expect(page.getByTestId('bulk-actions-bar')).toBeVisible()
      await expect(page.getByTestId('bulk-actions-bar')).toContainText('Выбрано: 1')

      // Меню колонки открывается касанием
      await page.getByTestId('column-menu-btn').first().tap()
      await expect(page.getByTestId('column-rename-item')).toBeVisible()
      await expect(page.getByTestId('column-move-right-item')).toBeVisible()
      await page.keyboard.press('Escape')
      // Меню закрылось и вернуло фокус своей кнопке — только после этого открываем следующее
      await expect(page.getByTestId('column-rename-item')).toHaveCount(0)

      // Health check на телефоне открывается из меню шапки: кнопка там не помещается
      await expect(page.getByTestId('health-check-btn')).toBeHidden()
      await page.getByTestId('export-menu-btn').tap()
      await page.getByTestId('menu-health-check-item').tap()
      await expect(page.getByTestId('health-check-dialog')).toBeVisible()
    } finally {
      await ctx.close()
    }
  })
})
