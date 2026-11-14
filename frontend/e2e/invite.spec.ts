import { test, expect, type Browser, type Page } from '@playwright/test'
import {
  API,
  BASE_URL,
  cleanupBoards,
  createBoardViaAPI,
  ensureE2EWorkspace,
  loginWorkspace,
  setUsername,
} from './helpers'

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme'

interface BoardRef {
  id: string
  name: string
  slug: string
}

async function adminSignIn(page: Page) {
  await page.goto('/admin')
  await page.getByPlaceholder(/логин/i).fill(ADMIN_LOGIN)
  await page.getByPlaceholder(/пароль/i).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /войти/i }).click()
  await expect(page.getByRole('heading', { name: 'Команды' })).toBeVisible()
}

/** Открыть в админке приглашение команды e2e-team и вернуть ссылку из поля. */
async function openTeamInvite(page: Page): Promise<string> {
  const row = page.locator('tbody tr').filter({
    has: page.locator('code', { hasText: /^e2e-team$/ }),
  })
  await row.getByRole('button', { name: 'Приглашение' }).click()
  const field = page.getByTestId('admin-invite-link')
  await expect(field).toHaveValue(/\/join\/[\w-]+$/)
  return field.inputValue()
}

/** Новый человек: чистый контекст браузера — ни cookie, ни localStorage. */
async function openAsGuest(browser: Browser, url: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(url)
  return { context, page }
}

/** Кто вошёл в этом контексте браузера — по cookie сессии. */
async function currentSession(page: Page) {
  const res = await page.context().request.get(`${BASE_URL}/api/workspaces/me`)
  expect(res.ok()).toBe(true)
  return (await res.json()) as { slug: string; participant: { id: string; name: string } }
}

test.describe('Приглашения — вход по ссылке', () => {
  let targetBoard: BoardRef

  test.beforeEach(async ({ request }) => {
    const ws = await ensureE2EWorkspace(request)
    await cleanupBoards(request, ws.token)
    // Нужная доска — в середине списка: при любом порядке на неё нельзя попасть случайно
    await createBoardViaAPI(request, 'Доска до', ws.token)
    targetBoard = (await createBoardViaAPI(request, 'Ретро по приглашению', ws.token)) as BoardRef
    await createBoardViaAPI(request, 'Доска после', ws.token)
  })

  test.afterAll(async ({ request }) => {
    const ws = await ensureE2EWorkspace(request)
    await cleanupBoards(request, ws.token)
  })

  test('администратор берёт ссылку — новый участник вводит только имя и попадает на нужную доску', async ({
    page,
    browser,
  }) => {
    await adminSignIn(page)
    const teamLink = await openTeamInvite(page)

    const guest = await openAsGuest(browser, `${teamLink}?board=${targetBoard.slug}`)
    try {
      await expect(guest.page.getByTestId('join-team-name')).toHaveText('E2E Team')
      // Одно поле — имя; кода команды и ключа доступа на странице нет
      await expect(guest.page.getByRole('textbox')).toHaveCount(1)
      await guest.page.getByTestId('join-name-input').fill('Гость по ссылке')
      await guest.page.getByTestId('join-submit-btn').click()

      await expect(guest.page).toHaveURL(new RegExp(`/board/${targetBoard.slug}$`), { timeout: 15000 })
      await expect(guest.page.getByRole('button', { name: targetBoard.name })).toBeVisible({ timeout: 15000 })
      await expect(guest.page.getByText('Добавить карточку').first()).toBeVisible()

      const me = await currentSession(guest.page)
      expect(me.slug).toBe('e2e-team')
      expect(me.participant.name).toBe('Гость по ссылке')
    } finally {
      await guest.context.close()
    }
  })

  test('ссылка в команду без доски и без имени: участник «Участник» на доске команды', async ({
    browser,
    request,
  }) => {
    const ws = await ensureE2EWorkspace(request)
    const invite = await request.get(`${API}/workspaces/invite`, {
      headers: { 'X-Workspace-Token': ws.token },
    })
    const { invite_token: token } = (await invite.json()) as { invite_token: string }

    const guest = await openAsGuest(browser, `${BASE_URL}/join/${token}`)
    try {
      await expect(guest.page.getByTestId('join-team-name')).toHaveText('E2E Team')
      await guest.page.getByTestId('join-submit-btn').click()

      await expect(guest.page).toHaveURL(/\/board\//, { timeout: 15000 })
      await expect(guest.page.getByTestId('user-settings-btn')).toBeVisible({ timeout: 15000 })
      expect((await currentSession(guest.page)).participant.name).toBe('Участник')
    } finally {
      await guest.context.close()
    }
  })

  test('перевыпуск в админке делает старую ссылку недействительной', async ({ page, browser }) => {
    await adminSignIn(page)
    const oldLink = await openTeamInvite(page)

    await page.getByTestId('admin-invite-rotate-btn').click()
    await expect(page.getByTestId('admin-invite-rotate-confirm')).toContainText(
      'Прежняя ссылка перестанет работать',
    )
    await page.getByTestId('admin-invite-rotate-confirm-btn').click()
    await expect(page.getByTestId('admin-invite-link')).not.toHaveValue(oldLink)
    const newLink = await page.getByTestId('admin-invite-link').inputValue()
    expect(newLink).toMatch(/\/join\/[\w-]+$/)

    const guest = await openAsGuest(browser, `${oldLink}?board=${targetBoard.slug}`)
    try {
      await expect(
        guest.page.getByRole('heading', { name: 'Ссылка-приглашение не работает' }),
      ).toBeVisible()
      await expect(guest.page.getByTestId('join-name-input')).toHaveCount(0)

      // Запасной путь — обычный вход по коду команды и ключу
      await guest.page.getByRole('link', { name: 'Войти по коду и ключу' }).click()
      await expect(guest.page.getByPlaceholder(/код команды|fmrm/i)).toBeVisible({ timeout: 10000 })
      await expect(guest.page.getByPlaceholder(/ключ доступа/i)).toBeVisible()

      // Новая ссылка работает
      await guest.page.goto(newLink)
      await expect(guest.page.getByTestId('join-team-name')).toHaveText('E2E Team')
    } finally {
      await guest.context.close()
    }
  })

  test('участник этой же команды по ссылке сразу оказывается на доске, без формы', async ({
    page,
    request,
  }) => {
    const ws = await ensureE2EWorkspace(request)
    const invite = await request.get(`${API}/workspaces/invite`, {
      headers: { 'X-Workspace-Token': ws.token },
    })
    const { invite_token: token } = (await invite.json()) as { invite_token: string }

    await setUsername(page)
    await loginWorkspace(page, request)
    await page.goto(`/join/${token}?board=${targetBoard.slug}`)

    await expect(page).toHaveURL(new RegExp(`/board/${targetBoard.slug}$`), { timeout: 15000 })
    await expect(page.getByRole('button', { name: targetBoard.name })).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('join-name-input')).toHaveCount(0)
    // Участник остался прежним: новый вход не выполнялся
    expect((await currentSession(page)).participant.id).toBe(ws.participant.id)
  })
})

test.describe('«Поделиться» на доске', () => {
  let targetBoard: BoardRef

  test.beforeEach(async ({ page, request }) => {
    const ws = await ensureE2EWorkspace(request)
    await cleanupBoards(request, ws.token)
    await createBoardViaAPI(request, 'Доска до', ws.token)
    targetBoard = (await createBoardViaAPI(request, 'Ретро для ссылки', ws.token)) as BoardRef
    await createBoardViaAPI(request, 'Доска после', ws.token)
    await setUsername(page)
    await loginWorkspace(page, request)
  })

  test.afterAll(async ({ request }) => {
    const ws = await ensureE2EWorkspace(request)
    await cleanupBoards(request, ws.token)
  })

  test('диалог даёт ссылку на доску, приглашение в команду и QR-код; по ссылке гость попадает на эту доску', async ({
    page,
    browser,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL })
    await page.goto(`/board/${targetBoard.slug}`)
    await expect(page.getByTestId('user-settings-btn')).toBeVisible({ timeout: 15000 })

    await page.getByTestId('share-board-btn').click()
    const dialog = page.getByTestId('share-board-dialog')
    await expect(dialog.getByRole('heading', { name: 'Поделиться доской' })).toBeVisible()

    const boardField = dialog.getByTestId('share-board-link')
    await expect(boardField).toHaveValue(new RegExp(`/join/[\\w-]+\\?board=${targetBoard.slug}$`))
    const boardLink = await boardField.inputValue()
    const teamLink = await dialog.getByTestId('share-team-link').inputValue()
    expect(boardLink).toBe(`${teamLink}?board=${targetBoard.slug}`)

    // QR-код нарисован на странице: встроенный SVG, без запросов за картинкой
    const qr = dialog.getByTestId('qr-code')
    await expect(qr).toBeVisible()
    expect(await qr.evaluate((el) => el.tagName.toLowerCase())).toBe('svg')

    await dialog.getByTestId('share-board-link-copy').click()
    await expect(dialog.getByTestId('share-board-link-copy')).toContainText('Скопировано')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(boardLink)

    // Крупный код — для общего экрана
    await dialog.getByTestId('share-qr-zoom').click()
    await expect(dialog.getByRole('heading', { name: targetBoard.name })).toBeVisible()
    const zoomed = await dialog.getByTestId('qr-code').boundingBox()
    expect(zoomed?.width ?? 0).toBeGreaterThan(350)

    const guest = await openAsGuest(browser, boardLink)
    try {
      await guest.page.getByTestId('join-name-input').fill('Гость с доски')
      await guest.page.getByTestId('join-submit-btn').click()
      await expect(guest.page).toHaveURL(new RegExp(`/board/${targetBoard.slug}$`), { timeout: 15000 })
      await expect(guest.page.getByRole('button', { name: targetBoard.name })).toBeVisible({ timeout: 15000 })
    } finally {
      await guest.context.close()
    }
  })

  test.describe('на телефоне', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('кнопки в шапке нет — «Поделиться» открывается из меню шапки', async ({ page }) => {
      await page.goto(`/board/${targetBoard.slug}`)
      await expect(page.getByTestId('user-settings-btn')).toBeVisible({ timeout: 15000 })
      await expect(page.getByTestId('share-board-btn')).toBeHidden()

      await page.getByTestId('export-menu-btn').click()
      await page.getByTestId('share-board-menu-item').click()

      const dialog = page.getByTestId('share-board-dialog')
      await expect(dialog.getByTestId('qr-code')).toBeVisible()
      await expect(dialog.getByTestId('share-board-link')).toHaveValue(
        new RegExp(`\\?board=${targetBoard.slug}$`),
      )
      // Диалог помещается в экран телефона по ширине
      const box = await dialog.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    })
  })
})
