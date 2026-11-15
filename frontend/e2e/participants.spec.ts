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
 * Сценарии с двумя участниками: серверная личность, скрытый сбор, права, роль ведущего.
 * «Создатель» — общий участник спеков (страница с именем по умолчанию), он же создаёт доски
 * через API; второй участник входит под своим именем и получает собственную сессию.
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

async function createBoard(
  request: APIRequestContext,
  owner: E2ESession,
  data: Record<string, unknown>,
): Promise<BoardData> {
  const res = await request.post(`${API}/boards/`, {
    headers: await apiHeaders(request, owner.token),
    data,
  })
  expect(res.ok(), `создание доски: ${res.status()}`).toBeTruthy()
  return (await res.json()) as BoardData
}

async function createCard(
  request: APIRequestContext,
  session: E2ESession,
  columnId: string,
  text: string,
): Promise<{ id: string }> {
  const res = await request.post(`${API}/cards/`, {
    headers: await apiHeaders(request, session.token),
    data: { column_id: columnId, text },
  })
  expect(res.ok(), `создание карточки: ${res.status()}`).toBeTruthy()
  return (await res.json()) as { id: string }
}

/** Открыть доску в отдельном контексте браузера под участником с именем `name`. */
async function openBoardAs(
  browser: Browser,
  request: APIRequestContext,
  board: BoardData,
  name = DEFAULT_USER_NAME,
) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await setUsername(page, name)
  const session = await loginWorkspace(page, request)
  await page.goto(`/board/${board.slug}`)
  await expect(page.getByTestId('user-settings-btn')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTitle('Подключено (Live)')).toBeVisible({ timeout: 10000 })
  return { ctx, page, session }
}

const cardByText = (page: Page, text: string) =>
  page.getByTestId('card-widget').filter({ hasText: text })

async function addCardViaUI(page: Page, text: string) {
  await page.getByRole('button', { name: 'Добавить карточку' }).first().click()
  const composer = page.getByPlaceholder(/Опишите мысль/)
  await composer.fill(text)
  await composer.press('Enter')
  await expect(cardByText(page, text)).toBeVisible({ timeout: 10000 })
}

async function openCardMenu(page: Page, text: string) {
  const card = cardByText(page, text)
  await card.hover()
  await card.getByLabel('Действия с карточкой').click()
  await expect(page.getByTestId('card-edit-item')).toBeVisible()
}

test.describe('Участники: личность, скрытый сбор, права и роль ведущего', () => {
  let owner: E2ESession

  test.beforeEach(async ({ request }) => {
    owner = await ensureE2EWorkspace(request)
    await cleanupBoards(request, owner.token)
  })

  test.afterAll(async ({ request }) => {
    await cleanupBoards(request, (await ensureE2EWorkspace(request)).token)
  })

  test('скрытый сбор: чужой текст не виден до раскрытия, создатель раскрывает одной кнопкой', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, {
      name: 'Скрытый сбор',
      hide_cards_until_reveal: true,
    })
    await createCard(request, owner, board.columns[0].id, 'Мысль создателя')

    const creator = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      // Гость видит заглушку вместо карточки создателя и состояние сбора на доске
      await expect(guest.page.getByText('Карточка скрыта')).toBeVisible({ timeout: 10000 })
      await expect(guest.page.getByText('Мысль создателя')).toHaveCount(0)
      const guestBanner = guest.page.getByTestId('hidden-collect-banner')
      await expect(guestBanner).toContainText('вы видите только свои карточки')
      await expect(guest.page.getByTestId('hidden-cards-count')).toHaveText('Скрыто чужих: 1')
      // Раскрыть может только создатель доски
      await expect(guest.page.getByTestId('reveal-cards-btn')).toHaveCount(0)
      await expect(guestBanner).toContainText('Раскрыть может создатель доски')

      await addCardViaUI(guest.page, 'Мысль гостя')

      // Создатель видит свою карточку, а карточку гостя — заглушкой (пришла по WebSocket)
      await expect(creator.page.getByText('Мысль создателя')).toBeVisible()
      await expect(creator.page.getByText('Карточка скрыта')).toBeVisible({ timeout: 10000 })
      await expect(creator.page.getByText('Мысль гостя')).toHaveCount(0)
      await expect(creator.page.getByTestId('hidden-cards-count')).toHaveText('Скрыто чужих: 1')
      // Задачи видны всем, поэтому превратить карточку в задачу до раскрытия нельзя
      await cardByText(creator.page, 'Мысль создателя').hover()
      await expect(cardByText(creator.page, 'Мысль создателя').getByTitle('В задачу')).toHaveCount(0)

      // Сервер не отдаёт чужой текст вовсе — ни в ответе доски, ни в экспорте
      const guestBoardJson = await guest.page.evaluate(
        async (id) => (await fetch(`/api/boards/${id}`)).text(),
        board.id,
      )
      expect(guestBoardJson).not.toContain('Мысль создателя')
      expect(guestBoardJson).toContain('Мысль гостя')

      await guest.page.getByTestId('export-menu-btn').click()
      await guest.page.getByRole('menuitem', { name: 'Итоги ретроспективы' }).click()
      const summaryDialog = guest.page.getByRole('dialog')
      // AI-резюме до раскрытия недоступно — с объяснением вместо кнопки
      await expect(summaryDialog.getByTestId('ai-unavailable-note')).toBeVisible()
      await expect(summaryDialog.getByTestId('generate-summary-btn')).toHaveCount(0)
      await summaryDialog.getByRole('tab', { name: 'Markdown и Slack' }).click()
      const markdown = summaryDialog.locator('pre')
      await expect(markdown).toContainText('Мысль гостя')
      await expect(markdown).toContainText('Скрыто до раскрытия карточек других участников: 1')
      await expect(markdown).not.toContainText('Мысль создателя')
      await summaryDialog.getByRole('button', { name: 'Готово' }).click()
      await expect(summaryDialog).toBeHidden()

      // Создатель раскрывает карточки одной кнопкой — у обоих всё открывается без перезагрузки
      await creator.page.getByTestId('reveal-cards-btn').click()
      await expect(cardByText(creator.page, 'Мысль гостя')).toBeVisible({ timeout: 10000 })
      await expect(cardByText(guest.page, 'Мысль создателя')).toBeVisible({ timeout: 10000 })
      await expect(guest.page.getByText('Карточка скрыта')).toHaveCount(0)
      await expect(guest.page.getByTestId('hidden-collect-banner')).toHaveCount(0)
      await expect(creator.page.getByTestId('hidden-collect-banner')).toHaveCount(0)
      await cardByText(creator.page, 'Мысль создателя').hover()
      await expect(cardByText(creator.page, 'Мысль создателя').getByTitle('В задачу')).toHaveCount(1)

      // После перезагрузки карточки остаются раскрытыми
      await guest.page.reload()
      await expect(cardByText(guest.page, 'Мысль создателя')).toBeVisible({ timeout: 15000 })
    } finally {
      await creator.ctx.close()
      await guest.ctx.close()
    }
  })

  test('права: чужую карточку участник не правит и не удаляет, создатель доски удаляет', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, { name: 'Права на карточки' })
    const ownerCard = await createCard(request, owner, board.columns[0].id, 'Карточка создателя')

    const creator = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      await addCardViaUI(guest.page, 'Карточка гостя')
      await expect(cardByText(creator.page, 'Карточка гостя')).toBeVisible({ timeout: 10000 })

      // Чужая карточка: править и удалять нельзя, причина написана в меню
      await openCardMenu(guest.page, 'Карточка создателя')
      await expect(guest.page.getByTestId('card-edit-item')).toHaveAttribute('data-disabled', '')
      await expect(guest.page.getByTestId('card-delete-item')).toHaveAttribute('data-disabled', '')
      await expect(guest.page.getByText('Текст может менять только автор карточки')).toBeVisible()
      await expect(
        guest.page.getByText('Удалить чужую карточку может создатель доски или ведущий'),
      ).toBeVisible()
      await guest.page.keyboard.press('Escape')

      // Сервер подтверждает то же самое: 403 на правку и удаление чужой карточки
      const guestHeaders = await apiHeaders(request, guest.session.token)
      const patchRes = await request.patch(`${API}/cards/${ownerCard.id}`, {
        headers: guestHeaders,
        data: { text: 'Подмена' },
      })
      expect(patchRes.status()).toBe(403)
      const deleteRes = await request.delete(`${API}/cards/${ownerCard.id}`, { headers: guestHeaders })
      expect(deleteRes.status()).toBe(403)

      // Свою карточку гость правит
      await openCardMenu(guest.page, 'Карточка гостя')
      await guest.page.getByTestId('card-edit-item').click()
      const editor = cardByText(guest.page, 'Карточка гостя').getByRole('textbox')
      await editor.fill('Карточка гостя (исправлено)')
      await guest.page.getByRole('button', { name: 'Сохранить' }).click()
      await expect(cardByText(creator.page, 'Карточка гостя (исправлено)')).toBeVisible({
        timeout: 10000,
      })

      // Колонку с карточками и доску гость удалить не может
      await expect(guest.page.getByTestId('delete-column-btn').first()).toBeDisabled()
      await guest.page.getByTestId('board-settings-btn').click()
      const settings = guest.page.getByRole('dialog')
      await expect(settings.getByTestId('delete-board-btn')).toBeDisabled()
      await expect(settings.getByText('Удалить доску может её создатель или ведущий')).toBeVisible()
      await settings.getByRole('button', { name: 'Отмена' }).click()

      // Создатель доски — модератор: удаляет карточку гостя, она исчезает у обоих
      await openCardMenu(creator.page, 'Карточка гостя (исправлено)')
      await expect(creator.page.getByTestId('card-edit-item')).toHaveAttribute('data-disabled', '')
      await creator.page.getByTestId('card-delete-item').click()
      await creator.page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click()
      await expect(cardByText(creator.page, 'Карточка гостя (исправлено)')).toHaveCount(0)
      await expect(cardByText(guest.page, 'Карточка гостя (исправлено)')).toHaveCount(0, {
        timeout: 10000,
      })
      // Отказов от сервера не было — уведомлений об ошибке нет
      await expect(guest.page.getByText(/Доступ запрещён|может только/)).toHaveCount(0)
    } finally {
      await creator.ctx.close()
      await guest.ctx.close()
    }
  })

  test('тёзки — разные участники: голоса и карточки не смешиваются, переименование ничего не отвязывает', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, { name: 'Тёзки' })
    await createCard(request, owner, board.columns[0].id, 'Общая карточка')

    const first = await openBoardAs(browser, request, board, 'Анна')
    const second = await openBoardAs(browser, request, board, 'Анна')
    try {
      expect(first.session.participant.id).not.toBe(second.session.participant.id)

      // В составе доски две Анны, «вы» — только одна из них
      await first.page.getByRole('button', { name: 'Онлайн участники' }).click()
      const rows = first.page.getByTestId('presence-row')
      await expect(rows).toHaveCount(2, { timeout: 10000 })
      await expect(rows.filter({ hasText: '(вы)' })).toHaveCount(1)
      await first.page.keyboard.press('Escape')

      // Голос первой Анны — не голос второй
      const sharedOnFirst = cardByText(first.page, 'Общая карточка')
      const sharedOnSecond = cardByText(second.page, 'Общая карточка')
      await sharedOnFirst.locator('button[title="Лайк"]').click()
      await expect(sharedOnFirst.locator('button[title="Убрать лайк"]')).toContainText('1')
      await expect(sharedOnSecond.locator('button[title="Лайк"]')).toContainText('1', { timeout: 10000 })
      await expect(sharedOnSecond.locator('button[title="Убрать лайк"]')).toHaveCount(0)

      await sharedOnSecond.locator('button[title="Лайк"]').click()
      await expect(sharedOnSecond.locator('button[title="Убрать лайк"]')).toContainText('2')
      await expect(sharedOnFirst.locator('button[title="Убрать лайк"]')).toContainText('2', {
        timeout: 10000,
      })

      // Карточка первой Анны для второй — чужая, хотя имя то же
      await addCardViaUI(first.page, 'Карточка первой Анны')
      await openCardMenu(second.page, 'Карточка первой Анны')
      await expect(second.page.getByTestId('card-edit-item')).toHaveAttribute('data-disabled', '')
      await second.page.keyboard.press('Escape')

      // Первая Анна меняет имя: карточка и голос остаются за ней, у второй имя прежнее
      await first.page.getByTestId('user-settings-btn').click()
      await first.page.locator('#profile-name').fill('Анна Первая')
      await first.page.getByTestId('profile-save-btn').click()
      await expect(first.page.getByText('Имя изменено на «Анна Первая»')).toBeVisible()

      await expect(cardByText(second.page, 'Карточка первой Анны')).toContainText('Анна Первая', {
        timeout: 10000,
      })
      await expect(sharedOnFirst.locator('button[title="Убрать лайк"]')).toContainText('2')
      await openCardMenu(first.page, 'Карточка первой Анны')
      await expect(first.page.getByTestId('card-edit-item')).not.toHaveAttribute('data-disabled', '')
      await first.page.keyboard.press('Escape')

      await second.page.getByRole('button', { name: 'Онлайн участники' }).click()
      await expect(second.page.getByTestId('presence-row').filter({ hasText: 'Анна Первая' })).toHaveCount(1)
      await expect(second.page.getByTestId('presence-row').filter({ hasText: 'Анна (вы)' })).toHaveCount(1)
    } finally {
      await first.ctx.close()
      await second.ctx.close()
    }
  })

  test('анонимный режим: имена авторов, голосовавших и оценок настроения скрыты', async ({
    browser,
    request,
  }) => {
    const board = await createBoard(request, owner, { name: 'Анонимная доска', anonymous_votes: true })
    const ownerCard = await createCard(request, owner, board.columns[0].id, 'Анонимная мысль')
    const ownerHeaders = await apiHeaders(request, owner.token)
    await request.post(`${API}/cards/${ownerCard.id}/like`, { headers: ownerHeaders })
    await request.post(`${API}/boards/${board.id}/mood`, {
      headers: ownerHeaders,
      data: { score: 2, note: 'Тяжёлый спринт' },
    })

    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      // Автор чужой карточки — «Участник», свою карточку гость видит как «Вы»
      await expect(cardByText(guest.page, 'Анонимная мысль')).toContainText('Участник')
      await addCardViaUI(guest.page, 'Мысль гостя')
      await expect(cardByText(guest.page, 'Мысль гостя')).toContainText('Вы')

      // Сервер не отдаёт гостю ни имени создателя, ни связи его карточек, голосов и оценок
      // с участником (идентификатор создателя доски остаётся только в created_by_id)
      const boardJson = await guest.page.evaluate(
        async (id) => (await fetch(`/api/boards/${id}`)).text(),
        board.id,
      )
      expect(boardJson).not.toContain(DEFAULT_USER_NAME)
      const boardState = JSON.parse(boardJson) as {
        columns: { cards: { text: string; author_id: string | null; likes: string[] }[] }[]
        moods: { participant_id: string | null; author: string }[]
      }
      const foreignCard = boardState.columns
        .flatMap((c) => c.cards)
        .find((c) => c.text === 'Анонимная мысль')
      expect(foreignCard?.author_id).toBeNull()
      expect(foreignCard?.likes).toEqual(['anon'])
      expect(boardState.moods).toHaveLength(1)
      expect(boardState.moods[0].participant_id).toBeNull()
      expect(boardState.moods[0].author).toBe('Участник')

      // В чек-ине настроения имён нет
      await guest.page.getByTestId('mood-checkin-btn').click()
      const moodDialog = guest.page.getByRole('dialog')
      const entry = moodDialog.getByTestId('mood-entry')
      await expect(entry).toHaveCount(1)
      await expect(entry).toContainText('Участник')
      await expect(entry).toContainText('Тяжёлый спринт')
      await expect(moodDialog).not.toContainText(DEFAULT_USER_NAME)
      await expect(moodDialog).toContainText('имена в откликах скрыты')
    } finally {
      await guest.ctx.close()
    }
  })

  test('роль ведущего: передача участнику и перехват, когда ведущий пропал', async ({
    browser,
    request,
  }) => {
    test.setTimeout(90_000)
    const board = await createBoard(request, owner, { name: 'Роль ведущего' })

    const creator = await openBoardAs(browser, request, board)
    const guest = await openBoardAs(browser, request, board, 'Гость')
    try {
      await creator.page.getByTestId('become-facilitator-btn').click()
      await expect(creator.page.getByTestId('stop-facilitator-btn')).toBeVisible({ timeout: 10000 })
      await creator.page.getByTestId('phase-step-discuss').click()
      await expect(guest.page.getByTestId('facilitator-badge')).toContainText(DEFAULT_USER_NAME, {
        timeout: 10000,
      })
      // Не ведущий сессией не управляет и роль передать не может
      await expect(guest.page.getByTestId('stop-facilitator-btn')).toHaveCount(0)

      // Передача роли гостю
      await creator.page.getByRole('button', { name: 'Онлайн участники' }).click()
      await creator.page
        .getByTestId('presence-row')
        .filter({ hasText: 'Гость' })
        .getByTestId('transfer-facilitator-btn')
        .click()
      await expect(guest.page.getByTestId('stop-facilitator-btn')).toBeVisible({ timeout: 10000 })
      await expect(guest.page.getByTestId('facilitator-badge')).toContainText('Гость (вы)')
      await expect(creator.page.getByTestId('stop-facilitator-btn')).toHaveCount(0)
      await expect(creator.page.getByTestId('facilitator-badge')).toContainText('Гость')
      await creator.page.keyboard.press('Escape')

      // Ведущий пропал: остальные видят это, роль можно забрать через 15 секунд
      await guest.ctx.close()
      await expect(creator.page.getByTestId('facilitator-offline-badge')).toBeVisible({ timeout: 10000 })
      const takeover = creator.page.getByTestId('takeover-facilitator-btn')
      await expect(takeover).toBeDisabled()
      await expect(takeover).toBeEnabled({ timeout: 25_000 })
      await takeover.click()

      await expect(creator.page.getByTestId('stop-facilitator-btn')).toBeVisible({ timeout: 10000 })
      await expect(creator.page.getByTestId('facilitator-badge')).toContainText('(вы)')
      await expect(creator.page.getByTestId('facilitator-offline-badge')).toHaveCount(0)

      // Сессия не сбросилась: фаза прежняя, ведущий — создатель
      const boardRes = await request.get(`${API}/boards/${board.id}`, {
        headers: { 'X-Workspace-Token': owner.token },
      })
      const state = (await boardRes.json()) as {
        active_phase: string | null
        active_facilitator_id: string | null
      }
      expect(state.active_phase).toBe('discuss')
      expect(state.active_facilitator_id).toBe(owner.participant.id)
    } finally {
      await creator.ctx.close()
      await guest.ctx.close().catch(() => {})
    }
  })

  test('выход завершает сессию на сервере: после него API отвечает 401', async ({ browser, request }) => {
    const board = await createBoard(request, owner, { name: 'Выход' })

    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await page.goto(`/board/${board.slug}`)
      await page.getByPlaceholder(/ваше имя/i).fill('Уходящий')
      await page.getByTestId('workspace-slug-input').fill('e2e-team')
      await page.getByTestId('workspace-key-input').fill('e2e-test-key')
      await page.getByRole('button', { name: /войти на доску/i }).click()
      await expect(page.getByTestId('user-settings-btn')).toBeVisible({ timeout: 15000 })

      // Токен — только в httpOnly-cookie: в localStorage его нет
      const stored = await page.evaluate(() => localStorage.getItem('retroboard-app') ?? '')
      expect(stored).not.toMatch(/token/i)
      expect(JSON.parse(stored).state.participant.name).toBe('Уходящий')
      const sessionCookie = (await ctx.cookies()).find((c) => c.name === 'workspace_token')
      expect(sessionCookie?.httpOnly).toBe(true)
      expect(await page.evaluate(async () => (await fetch('/api/boards/')).status)).toBe(200)

      await page.getByTestId('user-settings-btn').click()
      await page.getByTestId('logout-btn').click()

      // Экран входа — и сервер действительно больше не пускает
      await expect(page.getByTestId('workspace-key-input')).toBeVisible({ timeout: 10000 })
      expect(await page.evaluate(async () => (await fetch('/api/boards/')).status)).toBe(401)
      expect((await ctx.cookies()).find((c) => c.name === 'workspace_token')).toBeUndefined()

      // После перезагрузки сессия не восстанавливается
      await page.reload()
      await expect(page.getByTestId('workspace-key-input')).toBeVisible({ timeout: 15000 })
      await expect(page.getByTestId('user-settings-btn')).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})
