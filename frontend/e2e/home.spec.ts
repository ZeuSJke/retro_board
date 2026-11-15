import { test, expect } from '@playwright/test'
import {
  API,
  cleanupBoards,
  setUsername,
  dismissWelcome,
  createBoardViaAPI,
  ensureE2EWorkspace,
  loginWorkspace,
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

test.describe('Главная страница', () => {
  test('welcome dialog при первом входе', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    await createBoardViaAPI(request, 'Тест доска', wsData.token)

    await page.addInitScript(() => {
      localStorage.removeItem('retroboard-app')
    })
    await page.goto('/')

    await expect(page.locator('body')).toContainText('Добро пожаловать!')
    await expect(page.getByPlaceholder('Ваше имя')).toBeVisible()

    await page.getByPlaceholder('Ваше имя').fill('Иван')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByText('Войти на доску').click()

    await expect(page.locator('body')).toContainText('Добавить карточку')
  })

  test('/ редиректит на доску', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    await createBoardViaAPI(request, 'Мой спринт', wsData.token)

    await page.goto('/')
    await dismissWelcome(page)
    await expect(page).toHaveURL(/\/board\//)
  })

  test('создание новой доски через сайдбар', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)
    await createBoardViaAPI(request, 'Первая доска', wsData.token)

    await page.goto('/')
    await dismissWelcome(page)
    await expect(page).toHaveURL(/\/board\//)

    // Open sidebar via hamburger menu
    await page.getByTestId('boards-drawer-btn').click()

    // Click "Новая доска" in sidebar
    await page.getByText('Новая доска').click()

    const input = page.getByTestId('create-board-name-input')
    await input.fill('Вторая доска')
    await input.press('Enter')

    await expect(page).toHaveURL(/\/board\//)
    await dismissWelcome(page)
    await expect(page.locator('body')).toContainText('Вторая доска')
  })

  test('команда без досок: пустое состояние вместо доски, созданной молча', async ({ page, request }) => {
    const wsData = await ensureE2EWorkspace(request)

    await page.goto('/')
    await expect(page.getByTestId('no-boards-screen')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('heading', { name: /пока нет досок/ })).toBeVisible()

    // Сервер подтверждает: доску никто не создал
    const list = await request.get(`${API}/boards/`, { headers: { 'X-Workspace-Token': wsData.token } })
    expect(await list.json()).toHaveLength(0)

    // Действие из пустого состояния: создать доску и попасть на неё
    await page.getByTestId('empty-create-board-btn').click()
    await page.getByTestId('create-board-name-input').fill('Первая доска команды')
    await page.getByTestId('create-board-submit-btn').click()

    await expect(page.getByTestId('topbar-board-name')).toHaveText('Первая доска команды', { timeout: 15000 })
    await expect(page).toHaveURL(/\/board\/pervaia-doska-komandy$/)
  })

  test('/ при ошибке сервера показывает сообщение с «Повторить», а не вечную загрузку', async ({
    page,
    request,
  }) => {
    const wsData = await ensureE2EWorkspace(request)
    await createBoardViaAPI(request, 'Доска после сбоя', wsData.token)

    await page.route('**/api/boards/', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Внутренняя ошибка сервера' }),
      }),
    )
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Не удалось загрузить доски команды' })).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByText('Внутренняя ошибка сервера')).toBeVisible()

    // Сервер ожил — «Повторить» доводит до доски без перезагрузки страницы
    await page.unroute('**/api/boards/')
    await page.getByRole('button', { name: 'Повторить' }).click()

    await expect(page).toHaveURL(/\/board\/doska-posle-sboia$/, { timeout: 15000 })
    await expect(page.getByTestId('topbar-board-name')).toHaveText('Доска после сбоя')
  })

  test('доска с названием «Start» открывается, а /board/start ведёт к первой доске', async ({
    page,
    request,
  }) => {
    const wsData = await ensureE2EWorkspace(request)
    const start = await createBoardViaAPI(request, 'Start', wsData.token)
    // Служебный адрес /board/start сервер доске не выдаёт
    expect(start.slug).toMatch(/^start-[0-9a-f]+$/)
    await createBoardViaAPI(request, 'Свежий спринт', wsData.token)

    await page.goto(`/board/${start.slug}`)
    await expect(page.getByTestId('topbar-board-name')).toHaveText('Start', { timeout: 15000 })

    // Из панели досок она открывается по тому же адресу
    await page.goto('/board/start')
    await expect(page.getByTestId('topbar-board-name')).toHaveText('Свежий спринт', { timeout: 15000 })
    await page.getByTestId('boards-drawer-btn').click()
    await page.getByRole('dialog').getByRole('button', { name: /Start/ }).click()

    await expect(page).toHaveURL(new RegExp(`/board/${start.slug}$`))
    await expect(page.getByTestId('topbar-board-name')).toHaveText('Start')
  })
})
