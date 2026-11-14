import { test, expect, type Page } from '@playwright/test'
import { getWorkspaceBySlug, updateWorkspaceName, deleteWorkspace } from './helpers'

const ADMIN_URL = '/admin'
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme'

async function signIn(page: Page) {
  await page.goto(ADMIN_URL)
  await page.getByPlaceholder(/логин/i).fill(ADMIN_LOGIN)
  await page.getByPlaceholder(/пароль/i).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /войти/i }).click()
  await expect(page.getByRole('heading', { name: 'Команды' })).toBeVisible({ timeout: 5000 })
}

test.describe('Admin — управление командами', () => {
  // Коды созданных тестами команд для последующей очистки
  const createdWorkspaceSlugs: string[] = []

  // Очистка: удалить все команды, созданные тестами
  test.afterAll(async ({ request }) => {
    for (const slug of createdWorkspaceSlugs) {
      const ws = await getWorkspaceBySlug(request, slug)
      if (ws) {
        await deleteWorkspace(request, ws.id)
      }
    }
  })

  test('показывает форму логина', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.getByText('Панель администратора')).toBeVisible()
    await expect(page.getByPlaceholder(/логин/i)).toBeVisible()
    await expect(page.getByPlaceholder(/пароль/i)).toBeVisible()
  })

  test('без входа страница не спрашивает сервер о сессии: в консоли нет ошибки 401', async ({ page }) => {
    const consoleErrors: string[] = []
    const unauthorized: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('response', (res) => {
      if (res.status() === 401) unauthorized.push(res.url())
    })

    await page.goto(ADMIN_URL)
    await expect(page.getByText('Панель администратора')).toBeVisible()
    await page.waitForLoadState('networkidle')

    expect(unauthorized).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('отклоняет неверный пароль', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.getByPlaceholder(/логин/i).fill(ADMIN_LOGIN)
    await page.getByPlaceholder(/пароль/i).fill('wrongpass')
    await page.getByRole('button', { name: /войти/i }).click()
    await expect(page.getByText(/неверный/i)).toBeVisible()
  })

  test('успешный вход и просмотр команд', async ({ page }) => {
    await signIn(page)
    await expect(page.getByRole('button', { name: 'Создать команду' })).toBeVisible()

    // После перезагрузки вход сохраняется: отметка о сессии — в этом браузере
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Команды' })).toBeVisible({ timeout: 5000 })
  })

  test('создание новой команды: счётчик досок заполнен сразу', async ({ page }) => {
    await signIn(page)

    const uniqueSuffix = Date.now()
    const workspaceSlug = `test-ws-${uniqueSuffix}`
    createdWorkspaceSlugs.push(workspaceSlug)

    await page.getByRole('button', { name: 'Создать команду' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder(/Платформа/i).fill(`Test WS ${uniqueSuffix}`)
    await dialog.getByPlaceholder('platform-team').fill(workspaceSlug)
    await dialog.getByTestId('access-key-input').fill('test-key-123')
    await dialog.getByRole('button', { name: 'Создать' }).click()

    const row = page.locator('tbody tr').filter({
      has: page.locator('code', { hasText: new RegExp(`^${workspaceSlug}$`) }),
    })
    await expect(row.getByText(`Test WS ${uniqueSuffix}`)).toBeVisible({ timeout: 5000 })
    await expect(row.getByTestId('team-boards-count')).toHaveText('0')
  })

  test('ошибки проверки при создании показаны по полям', async ({ page }) => {
    await signIn(page)
    await page.getByRole('button', { name: 'Создать команду' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder(/Платформа/i).fill('Команда с ошибками')
    await dialog.getByPlaceholder('platform-team').fill('Плохой Код')
    await dialog.getByTestId('access-key-input').fill('abc')
    await dialog.getByRole('button', { name: 'Создать' }).click()

    const alert = dialog.getByRole('alert')
    await expect(alert).toContainText('Код команды: только строчные латинские буквы, цифры и дефис')
    await expect(alert).toContainText('Ключ доступа: не короче 4 символов')
    // Диалог остаётся открытым: данные можно поправить
    await expect(dialog.getByRole('button', { name: 'Создать' })).toBeVisible()
  })

  test('ключ доступа: показать, сгенерировать и предупреждение при смене', async ({ page }) => {
    await signIn(page)

    const row = page.locator('tbody tr').filter({
      has: page.locator('code', { hasText: /^e2e-team$/ }),
    })
    await row.getByRole('button', { name: 'Ключ' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('key-change-warning')).toContainText(
      'Все участники команды выйдут из системы, а ссылка-приглашение будет перевыпущена',
    )
    const field = dialog.getByTestId('access-key-input')
    await expect(field).toHaveAttribute('type', 'password')

    await dialog.getByTestId('access-key-generate').click()
    await expect(field).toHaveAttribute('type', 'text')
    await expect(field).toHaveValue(/^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/)

    // Ключ общей команды прогона не меняем: закрываем без сохранения
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog).toBeHidden()
  })

  test('переименование команды', async ({ page, request }) => {
    const ws = await getWorkspaceBySlug(request, 'e2e-team')
    if (!ws) {
      throw new Error('e2e-team workspace not found')
    }
    const originalName = ws.name

    await signIn(page)

    const row = page.locator('tbody tr').filter({
      has: page.locator('code', { hasText: /^e2e-team$/ }),
    })
    await row.getByRole('button', { name: 'Переименовать' }).click()

    const input = page.getByPlaceholder(/Новое название/)
    await input.clear()
    await input.fill(`${originalName} (Updated)`)

    const saveBtn = page.getByRole('dialog').getByRole('button', { name: 'Сохранить' })
    await saveBtn.click()

    await expect(page.getByText(`${originalName} (Updated)`)).toBeVisible({ timeout: 5000 })

    await updateWorkspaceName(request, ws.id, originalName)
  })

  test('выход из админ-панели', async ({ page }) => {
    await signIn(page)

    const logoutBtn = page.getByRole('button', { name: /выйти/i })
    await logoutBtn.click()

    await expect(page.getByText('Панель администратора')).toBeVisible()

    // После выхода перезагрузка снова показывает форму входа
    await page.reload()
    await expect(page.getByText('Панель администратора')).toBeVisible()
  })
})
