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

  test('при повторном открытии с валидной сессией пропускает welcome диалог и сохраняет workspace', async ({ page }) => {
    // Первый вход
    await page.goto('/')
    await page.getByPlaceholder(/ваше имя/i).fill('Тест 1')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByRole('button', { name: /войти на доску/i }).click()

    // Дождаться загрузки
    await expect(page.getByText(/Новая колонка/i)).toBeVisible({ timeout: 15000 })

    // Перезагрузить страницу — WelcomeDialog не должен появляться
    await page.reload()
    await expect(page.getByText(/Новая колонка/i)).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /войти на доску/i })).toBeHidden()

    // Информация о текущем workspace доступна в настройках пользователя в Topbar
    await page.locator('button').filter({ hasText: /тест 1/i }).click()
    await expect(page.getByText(/E2E Team/i)).toBeVisible({ timeout: 5000 })
  })

  test('кнопка "Сменить" в настройках пользователя открывает поля смены workspace', async ({ page }) => {
    // Первый вход
    await page.goto('/')
    await page.getByPlaceholder(/ваше имя/i).fill('Тест 1')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByRole('button', { name: /войти на доску/i }).click()

    // Дождаться загрузки
    await expect(page.getByText(/Новая колонка/i)).toBeVisible({ timeout: 15000 })

    // Перезагрузить и убедиться, что доска загрузилась напрямую
    await page.reload()
    await expect(page.getByText(/Новая колонка/i)).toBeVisible({ timeout: 15000 })

    // Открыть настройки пользователя через Topbar и нажать "Сменить"
    await page.locator('button').filter({ hasText: /тест 1/i }).click()
    const dialog = page.locator('div').filter({ hasText: /настройки пользователя/i }).first()
    await expect(dialog).toBeVisible({ timeout: 5000 })

    const changeBtn = dialog.getByRole('button', { name: 'Сменить' })
    await changeBtn.click()

    // Теперь должны видеть поля смены команды (код команды и ключ доступа)
    await expect(dialog.locator('input').first()).toBeVisible()
    await expect(dialog.locator('input[type="password"]')).toBeVisible()
  })

  test('workspace аутентификация в WebSocket работает через httpOnly cookie без токена в URL', async ({ page }) => {
    const wsUrls: string[] = []
    page.on('websocket', (ws) => {
      wsUrls.push(ws.url())
    })
    const wsPromise = page.waitForEvent('websocket')

    await page.goto('/')
    await page.getByPlaceholder(/ваше имя/i).fill('WS Token Тест')
    await page.getByPlaceholder(/код команды|fmrm/i).fill('e2e-team')
    await page.getByPlaceholder(/ключ доступа/i).fill('e2e-test-key')
    await page.getByRole('button', { name: /войти на доску/i }).click()

    // Дождаться загрузки доски, открытия WebSocket и presence-синхронизации сессии
    await expect(page.getByText(/Новая колонка/i)).toBeVisible({ timeout: 15000 })
    const ws = await wsPromise
    await expect(page.locator('[title="WS Token Тест"]')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('main')).toBeVisible()

    // Проверить, что WebSocket подключился без утечки workspace_token в URL
    expect(ws.url()).toContain('/ws/')
    expect(wsUrls.length).toBeGreaterThan(0)
    for (const url of wsUrls) {
      expect(url).not.toContain('workspace_token')
    }
  })
})
