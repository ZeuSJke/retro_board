import { test, expect } from '@playwright/test'

const ADMIN_URL = '/admin'

test.describe('Admin — управление пространствами', () => {
  test('показывает форму логина', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.getByText('Панель управления')).toBeVisible()
    await expect(page.getByPlaceholder(/логин/i)).toBeVisible()
    await expect(page.getByPlaceholder(/пароль/i)).toBeVisible()
  })

  test('отклоняет неверный пароль', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.getByPlaceholder(/логин/i).fill('admin')
    await page.getByPlaceholder(/пароль/i).fill('wrongpass')
    await page.getByRole('button', { name: /войти/i }).click()
    await expect(page.getByText(/неверный/i)).toBeVisible()
  })

  test('успешный вход и просмотр пространств', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.getByPlaceholder(/логин/i).fill('admin')
    await page.getByPlaceholder(/пароль/i).fill('changeme')
    await page.getByRole('button', { name: /войти/i }).click()
    await expect(page.getByText(/пространства/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: /создать/i })).toBeVisible()
  })

  test('создание нового пространства', async ({ page }) => {
    // Войти в админ-панель
    await page.goto(ADMIN_URL)
    await page.getByPlaceholder(/логин/i).fill('admin')
    await page.getByPlaceholder(/пароль/i).fill('changeme')
    await page.getByRole('button', { name: /войти/i }).click()
    await page.getByText(/пространства/i).waitFor({ timeout: 5000 })

    // Создать пространство
    const uniqueSuffix = Date.now()
    const createBtn = page.getByRole('button', { name: /создать пространство/i })
    await createBtn.click()

    // Заполнить форму
    const nameInput = page.getByPlaceholder(/FMRM Core/)
    await nameInput.fill(`Test WS ${uniqueSuffix}`)

    const slugInput = page.getByPlaceholder(/fmrm-core/)
    await slugInput.fill(`test-ws-${uniqueSuffix}`)

    const keyInputs = page.locator('input[type="password"]')
    const passwordInput = keyInputs.last()
    await passwordInput.fill('test-key-123')

    // Сохранить
    const saveBtn = page.getByRole('button', { name: /сохранить/i }).last()
    await saveBtn.click()

    // Проверить, что пространство появилось
    await expect(page.getByText(`Test WS ${uniqueSuffix}`)).toBeVisible({ timeout: 5000 })
  })

  test('переименование пространства', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.getByPlaceholder(/логин/i).fill('admin')
    await page.getByPlaceholder(/пароль/i).fill('changeme')
    await page.getByRole('button', { name: /войти/i }).click()
    await page.getByText(/пространства/i).waitFor({ timeout: 5000 })

    // Получить первое пространство и кликнуть на кнопку переименования
    const firstRow = page.locator('[class*="tableRow"]').first()
    const editBtn = firstRow.getByRole('button').nth(0) // Первая кнопка — редактировать

    await editBtn.click()

    // Изменить имя
    const input = page.getByPlaceholder(/Новое название/)
    const oldValue = await input.inputValue()
    const newValue = `${oldValue} (Updated)`

    await input.clear()
    await input.fill(newValue)

    // Сохранить
    const saveBtn = page.getByRole('button', { name: /сохранить/i }).last()
    await saveBtn.click()

    // Проверить обновление
    await expect(page.getByText(newValue)).toBeVisible({ timeout: 5000 })
  })

  test('выход из админ-панели', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.getByPlaceholder(/логин/i).fill('admin')
    await page.getByPlaceholder(/пароль/i).fill('changeme')
    await page.getByRole('button', { name: /войти/i }).click()
    await page.getByText(/пространства/i).waitFor({ timeout: 5000 })

    // Выйти
    const logoutBtn = page.getByRole('button', { name: /выйти/i })
    await logoutBtn.click()

    // Вернуться к форме входа
    await expect(page.getByText('Панель управления')).toBeVisible()
  })
})
