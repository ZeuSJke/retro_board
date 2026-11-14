import { test, expect } from '@playwright/test'
import { getWorkspaceBySlug, updateWorkspaceName, deleteWorkspace } from './helpers'

const ADMIN_URL = '/admin'
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme'

test.describe('Admin — управление пространствами', () => {
  // Список slug'ов созданных тестовых workspaces для последующей очистки
  const createdWorkspaceSlugs: string[] = []

  // Очистка: удалить все workspaces, созданные тестами
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

  test('отклоняет неверный пароль', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.getByPlaceholder(/логин/i).fill(ADMIN_LOGIN)
    await page.getByPlaceholder(/пароль/i).fill('wrongpass')
    await page.getByRole('button', { name: /войти/i }).click()
    await expect(page.getByText(/неверный/i)).toBeVisible()
  })

  test('успешный вход и просмотр пространств', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.getByPlaceholder(/логин/i).fill(ADMIN_LOGIN)
    await page.getByPlaceholder(/пароль/i).fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: /войти/i }).click()
    await expect(page.getByText(/Рабочие пространства/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: /Создать workspace/i })).toBeVisible()
  })

  test('создание нового пространства', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.getByPlaceholder(/логин/i).fill(ADMIN_LOGIN)
    await page.getByPlaceholder(/пароль/i).fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: /войти/i }).click()
    await page.getByText(/Рабочие пространства/i).waitFor({ timeout: 5000 })

    const uniqueSuffix = Date.now()
    const workspaceSlug = `test-ws-${uniqueSuffix}`
    createdWorkspaceSlugs.push(workspaceSlug)

    const createBtn = page.getByRole('button', { name: /Создать workspace/i })
    await createBtn.click()

    const nameInput = page.getByPlaceholder(/Платформа/i)
    await nameInput.fill(`Test WS ${uniqueSuffix}`)

    const slugInput = page.getByPlaceholder('platform-team')
    await slugInput.fill(workspaceSlug)

    const keyInputs = page.locator('input[type="password"]')
    const passwordInput = keyInputs.last()
    await passwordInput.fill('test-key-123')

    const submitBtn = page.getByRole('dialog').getByRole('button', { name: 'Создать' })
    await submitBtn.click()

    await expect(page.getByText(`Test WS ${uniqueSuffix}`)).toBeVisible({ timeout: 5000 })
  })

  test('переименование пространства', async ({ page, request }) => {
    const ws = await getWorkspaceBySlug(request, 'e2e-team')
    if (!ws) {
      throw new Error('e2e-team workspace not found')
    }
    const originalName = ws.name

    await page.goto(ADMIN_URL)
    await page.getByPlaceholder(/логин/i).fill(ADMIN_LOGIN)
    await page.getByPlaceholder(/пароль/i).fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: /войти/i }).click()
    await page.getByText(/Рабочие пространства/i).waitFor({ timeout: 5000 })

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
    await page.goto(ADMIN_URL)
    await page.getByPlaceholder(/логин/i).fill(ADMIN_LOGIN)
    await page.getByPlaceholder(/пароль/i).fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: /войти/i }).click()
    await page.getByText(/Рабочие пространства/i).waitFor({ timeout: 5000 })

    const logoutBtn = page.getByRole('button', { name: /выйти/i })
    await logoutBtn.click()

    await expect(page.getByText('Панель администратора')).toBeVisible()
  })
})
