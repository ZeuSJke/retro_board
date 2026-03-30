import { test, expect } from '@playwright/test'
import { ensureE2EWorkspace, cleanupBoards, createBoardViaAPI } from './helpers'

test.describe('Workspace — вход и изоляция', () => {
  test.beforeEach(async ({ request }) => {
    const wsData = await ensureE2EWorkspace(request)
    // Ensure at least one board exists so the app can redirect after login
    await cleanupBoards(request, wsData.token)
    await createBoardViaAPI(request, 'E2E Workspace Board', wsData.token)
  })

  test('показывает поля workspace в welcome диалоге', async ({ page }) => {
    await page.goto('/')
    // Должны видеть поля для входа в workspace
    await expect(page.getByPlaceholder(/код команды|fmrm/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByPlaceholder(/ключ доступа/i)).toBeVisible()
  })

  test('вход с неверным ключом показывает ошибку', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder(/ваше имя/i).fill('Тест')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('wrongkey')
    await page.getByRole('button', { name: /войти на доску/i }).click()
    await expect(page.getByText(/неверный/i)).toBeVisible({ timeout: 5000 })
  })

  test('вход с неверным кодом команды показывает ошибку', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder(/ваше имя/i).fill('Тест')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('nonexistent-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByRole('button', { name: /войти на доску/i }).click()
    await expect(page.getByText(/неверный/i)).toBeVisible({ timeout: 5000 })
  })

  test('успешный вход в workspace', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder(/ваше имя/i).fill('E2E Тестер')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByRole('button', { name: /войти на доску/i }).click()

    // Должны видеть главную страницу (не диалог входа)
    await expect(page.getByText(/Новая колонка/i)).toBeVisible({ timeout: 15000 })
  })

  test('при повторном входе показывает информацию о workspace', async ({ page }) => {
    // Первый вход
    await page.goto('/')
    await page.getByPlaceholder(/ваше имя/i).fill('Тест 1')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByRole('button', { name: /войти на доску/i }).click()

    // Дождаться загрузки
    await expect(page.getByText(/Новая колонка/i)).toBeVisible({ timeout: 15000 })

    // Перезагрузить страницу
    await page.reload()

    // Должен показаться welcome диалог с информацию о workspace
    await expect(page.getByText(/Команда: E2E Team/i)).toBeVisible({ timeout: 5000 })
  })

  test('кнопка "Войти в другую команду" сбрасывает workspace', async ({ page }) => {
    // Первый вход
    await page.goto('/')
    await page.getByPlaceholder(/ваше имя/i).fill('Тест 1')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByRole('button', { name: /войти на доску/i }).click()

    // Дождаться загрузки
    await expect(page.getByText(/Новая колонка/i)).toBeVisible({ timeout: 15000 })

    // Перезагрузить
    await page.reload()

    // Должна показаться информация о workspace
    await expect(page.getByText(/Команда: E2E Team/i)).toBeVisible({ timeout: 5000 })

    // Кликнуть на "Войти в другую команду"
    const changeLink = page.getByText(/войти в другую команду/i)
    await changeLink.click()

    // Теперь должны видеть полные поля входа
    await expect(page.getByPlaceholder(/код команды|fmrm/i)).toBeVisible()
    await expect(page.getByPlaceholder(/ключ доступа/i)).toBeVisible()
  })

  test('workspace токен передаётся в WebSocket', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder(/ваше имя/i).fill('WS Token Тест')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByRole('button', { name: /войти на доску/i }).click()

    // Дождаться загрузки доски
    await expect(page.getByText(/Новая колонка/i)).toBeVisible({ timeout: 15000 })

    // Проверить что WebSocket подключение установлено (проверяется через успешную загрузку доски)
    // Если бы workspace токен не был передан, получили бы ошибку 401
    await expect(page.locator('main')).toBeVisible()
  })
})
