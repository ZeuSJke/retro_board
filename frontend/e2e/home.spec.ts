import { test, expect } from '@playwright/test'
import { cleanupBoards, setUsername, dismissWelcome, createBoardViaAPI, ensureE2EWorkspace, loginWorkspace } from './helpers'

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
    await page.locator('header button').first().click()

    // Click "Новая доска" in sidebar
    await page.getByText('Новая доска').click()

    const input = page.getByPlaceholder('Название доски')
    await input.fill('Вторая доска')
    await input.press('Enter')

    await expect(page).toHaveURL(/\/board\//)
    await dismissWelcome(page)
    await expect(page.locator('body')).toContainText('Вторая доска')
  })

  test('автоматическое создание доски если нет досок', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await expect(page).toHaveURL(/\/board\//)
  })
})
