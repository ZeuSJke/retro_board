import { test, expect, type APIRequestContext } from '@playwright/test'
import {
  cleanupBoards,
  createBoardViaAPI,
  dismissWelcome,
  ensureE2EWorkspace,
  getCsrfHeaders,
  loginWorkspace,
  setUsername,
  API,
  BASE_URL,
} from './helpers'

async function apiHeaders(request: APIRequestContext, token: string) {
  const csrf = await getCsrfHeaders(request)
  return { ...csrf, 'X-Workspace-Token': token }
}

test.describe('Brand Identity, UX Polish & Regression Flows', () => {
  let workspaceToken: string

  test.beforeEach(async ({ page, request }) => {
    const ws = await ensureE2EWorkspace(request)
    workspaceToken = String(ws.token || '')
    await cleanupBoards(request, workspaceToken)
    await setUsername(page, 'Анна Тест')
    await loginWorkspace(page, request)
  })

  test('serves crisp vector icon.svg and renders BrandMark on Welcome, Board, BoardsPanel, Dashboard, Admin', async ({
    page,
    request,
  }) => {
    // 1. Verify /icon.svg responds cleanly with vector SVG
    const iconRes = await request.get(`${BASE_URL}/icon.svg`)
    expect(iconRes.status()).toBe(200)
    const iconBody = await iconRes.text()
    expect(iconBody).toContain('<svg')
    expect(iconBody).toContain('#10B981')
    expect(iconBody).toContain('#F59E0B')

    // 2. Verify BrandMark renders in WelcomeDialog (clean incognito context without localStorage)
    const freshCtx = await page.context().browser()!.newContext()
    const freshPage = await freshCtx.newPage()
    await freshPage.goto('/')
    await expect(freshPage.getByText('RetroBoard').first()).toBeVisible({ timeout: 15000 })
    await expect(freshPage.locator('svg[aria-hidden="true"] rect[fill="#10B981"]').first()).toBeVisible()
    await freshCtx.close()

    // 3. Board Topbar & BoardsPanel
    await createBoardViaAPI(request, 'Brand Check Board', workspaceToken)
    await page.goto('/')
    await dismissWelcome(page)
    await expect(page.locator('header svg[aria-hidden="true"] rect[fill="#10B981"]').first()).toBeVisible({
      timeout: 15000,
    })

    await page.getByTestId('boards-drawer-btn').click()
    await expect(page.getByText('Доски команды')).toBeVisible()
    await expect(
      page.locator('[role="dialog"] svg[aria-hidden="true"] rect[fill="#10B981"]').first(),
    ).toBeVisible()
    await page.keyboard.press('Escape')

    // 4. Dashboard
    await page.getByTestId('dashboard-nav-link').click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 })
    await expect(page.locator('header').getByText('Панель управления')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('header svg[aria-hidden="true"] rect[fill="#10B981"]').first()).toBeVisible()

    // 5. Admin login
    await page.goto('/admin')
    await expect(page.getByText('Панель администратора')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('svg[aria-hidden="true"] rect[fill="#10B981"]').first()).toBeVisible()
  })

  test('CommandPalette opens on mouse click of Ctrl+K button and switches boards', async ({
    page,
    request,
  }) => {
    await createBoardViaAPI(request, 'Alpha Retro', workspaceToken)
    await createBoardViaAPI(request, 'Beta Target Sprint', workspaceToken)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await dismissWelcome(page)

    const trigger = page.getByTestId('command-palette-trigger')
    await expect(trigger).toBeVisible({ timeout: 15000 })
    await trigger.click()

    await expect(page.getByPlaceholder('Найти доску или команду...')).toBeVisible()
    await page.getByPlaceholder('Найти доску или команду...').fill('Alpha Retro')
    await page.locator('[cmdk-item]', { hasText: 'Alpha Retro' }).click()

    await expect(page.locator('header')).toContainText('Alpha Retro', {
      timeout: 15000,
    })
  })

  test('restores historical card colors, highlights active swatch, and supports color picking', async ({
    page,
    request,
  }) => {
    const board = await createBoardViaAPI(request, 'Legacy Colors Board', workspaceToken)
    const headers = await apiHeaders(request, workspaceToken)
    const colId = board.columns[0].id

    await request.post(`${API}/cards/`, {
      headers,
      data: { column_id: colId, text: 'Legacy Amber Card', author: 'Алиса', color: '#FFF9C4' },
    })
    await request.post(`${API}/cards/`, {
      headers,
      data: { column_id: colId, text: 'Legacy Sky Card', author: 'Борис', color: '#BBDEFB' },
    })
    await request.post(`${API}/cards/`, {
      headers,
      data: { column_id: colId, text: 'Legacy Mint Card', author: 'Вика', color: '#C8E6C9' },
    })

    await page.goto('/')
    await dismissWelcome(page)

    const amberCard = page.locator('[data-testid^="card-"]').filter({ hasText: 'Legacy Amber Card' })
    const skyCard = page.locator('[data-testid^="card-"]').filter({ hasText: 'Legacy Sky Card' })
    const mintCard = page.locator('[data-testid^="card-"]').filter({ hasText: 'Legacy Mint Card' })

    await expect(amberCard).toHaveClass(/bg-amber-50/, { timeout: 15000 })
    await expect(skyCard).toHaveClass(/bg-sky-50/)
    await expect(mintCard).toHaveClass(/bg-emerald-50/)

    // Open menu on amber card -> amber swatch must be highlighted -> switch to rose
    await amberCard.hover()
    await amberCard.getByLabel('Действия с карточкой').click()
    await expect(page.getByTestId('card-color-option-amber')).toHaveClass(/ring-primary/)

    await page.getByTestId('card-color-option-rose').click()
    await expect(amberCard).toHaveClass(/bg-rose-50/, { timeout: 10000 })
  })

  test('grouped card header keeps count badge on far right and hover actions to its left', async ({
    page,
    request,
  }) => {
    const board = await createBoardViaAPI(request, 'Group Corner Board', workspaceToken)
    const headers = await apiHeaders(request, workspaceToken)
    const colId = board.columns[0].id

    const gRes = await request.post(`${API}/groups/`, {
      headers,
      data: { column_id: colId, title: 'Больше токенов для команды и моделей' },
    })
    const group = await gRes.json()

    const c1 = await (
      await request.post(`${API}/cards/`, {
        headers,
        data: { column_id: colId, text: 'Нужно больше токенов', author: 'Влад', color: '#FFFFFF' },
      })
    ).json()
    const c2 = await (
      await request.post(`${API}/cards/`, {
        headers,
        data: { column_id: colId, text: 'Увеличить лимиты', author: 'Николай', color: '#FFFFFF' },
      })
    ).json()

    await request.post(`${API}/groups/${group.id}/set_card/${c1.id}`, { headers })
    await request.post(`${API}/groups/${group.id}/set_card/${c2.id}`, { headers })

    await page.goto('/')
    await dismissWelcome(page)

    const groupHdr = page.locator('div.group\\/hdr', { hasText: 'Больше токенов' })
    await expect(groupHdr).toBeVisible({ timeout: 15000 })

    const renameBtn = groupHdr.getByTitle('Переименовать группу')
    const dissolveBtn = groupHdr.getByTitle('Расформировать группу')
    const countBadge = groupHdr.locator('div', { hasText: /^2$/ }).last()

    await groupHdr.hover()
    await expect(renameBtn).toBeVisible()
    await expect(dissolveBtn).toBeVisible()

    const renameBox = await renameBtn.boundingBox()
    const dissolveBox = await dissolveBtn.boundingBox()
    const countBox = await countBadge.boundingBox()
    const hdrBox = await groupHdr.boundingBox()

    expect(renameBox).not.toBeNull()
    expect(dissolveBox).not.toBeNull()
    expect(countBox).not.toBeNull()
    expect(hdrBox).not.toBeNull()

    // Actions appear cleanly to the LEFT of the count badge, and count stays anchored at the top-right corner
    expect(renameBox!.x + renameBox!.width).toBeLessThanOrEqual(dissolveBox!.x + 2)
    expect(dissolveBox!.x + dissolveBox!.width).toBeLessThanOrEqual(countBox!.x + 2)
    expect(hdrBox!.x + hdrBox!.width - (countBox!.x + countBox!.width)).toBeLessThan(12)
  })

  test('voter tooltip in rightmost column wraps and stays inside viewport', async ({
    page,
    request,
  }) => {
    const board = await createBoardViaAPI(request, 'Right Tooltip Board', workspaceToken)
    const headers = await apiHeaders(request, workspaceToken)
    const lastCol = board.columns[board.columns.length - 1]

    const card = await (
      await request.post(`${API}/cards/`, {
        headers,
        data: {
          column_id: lastCol.id,
          text: 'Правая колонка с длинным списком голосов',
          author: 'Altyn',
          color: '#FFFFFF',
        },
      })
    ).json()

    for (const voter of ['Nikolai Belous', 'Кирилл Ч', 'Egor', 'Александр Длиннофамильный']) {
      await request.post(`${API}/cards/${card.id}/like?username=${encodeURIComponent(voter)}`, {
        headers,
      })
    }

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await dismissWelcome(page)

    const cardEl = page.getByTestId('card-widget').filter({
      hasText: 'Правая колонка с длинным списком голосов',
    })
    await expect(cardEl).toBeVisible({ timeout: 15000 })

    const likeBtn = cardEl.locator('button', { hasText: '4' }).first()
    await likeBtn.hover()

    const tooltip = page.locator('[role="tooltip"]').filter({ hasText: 'Nikolai Belous' }).first()
    await expect(tooltip).toBeVisible({ timeout: 5000 })

    const tipBox = await tooltip.boundingBox()
    expect(tipBox).not.toBeNull()
    expect(tipBox!.x).toBeGreaterThanOrEqual(0)
    expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(1280)
  })

  test('return to board -> become facilitator during mouse movement -> advance to vote -> voting, limit tooltip, settings save keep votes, lock shows clear state', async ({
    page,
    request,
  }) => {
    // Seed a board with max_votes=1 and two cards
    const board = await createBoardViaAPI(request, 'Return Vote Board', workspaceToken)
    const headers = await apiHeaders(request, workspaceToken)
    await request.patch(`${API}/boards/${board.id}`, {
      headers,
      data: { max_votes: 1 },
    })

    const colId = board.columns[0].id
    await request.post(`${API}/cards/`, {
      headers,
      data: { column_id: colId, text: 'Карточка для голоса А', author: 'Иван', color: '#E8F5E9' },
    })
    await request.post(`${API}/cards/`, {
      headers,
      data: { column_id: colId, text: 'Карточка для голоса Б', author: 'Мария', color: '#E3F2FD' },
    })

    // Navigate first to dashboard, then return to the board
    await page.goto('/dashboard')
    await expect(page.getByText('Панель управления')).toBeVisible({ timeout: 15000 })
    await page.goto(`/board/${board.slug || board.id}`)
    await dismissWelcome(page)
    await expect(page.getByTestId('become-facilitator-btn')).toBeVisible({ timeout: 15000 })

    // Move mouse continuously across the canvas before clicking facilitator & phases (verifies cursor_move never drops WS control events)
    await page.mouse.move(200, 300)
    for (let x = 220; x <= 600; x += 20) {
      await page.mouse.move(x, 320 + (x % 40))
    }

    await page.getByTestId('become-facilitator-btn').click()
    await expect(page.getByTestId('phase-step-brainstorm')).toBeVisible({ timeout: 10000 })

    for (const step of ['reveal', 'discuss', 'vote'] as const) {
      await page.mouse.move(350, 350)
      await page.mouse.move(480, 380)
      await page.getByTestId(`phase-step-${step}`).click()
    }

    await expect(page.getByText('1/1')).toBeVisible({ timeout: 10000 })

    // Vote on Card A -> succeeds and hits limit (0/1 · лимит)
    const cardAEl = page.getByTestId('card-widget').filter({ hasText: 'Карточка для голоса А' })
    const cardBEl = page.getByTestId('card-widget').filter({ hasText: 'Карточка для голоса Б' })

    await cardAEl.locator('button[title="Лайк"]').click()
    await expect(cardAEl.locator('button[title="Убрать лайк"]')).toContainText('1', { timeout: 10000 })
    await expect(page.getByText('0/1 · лимит')).toBeVisible({ timeout: 10000 })

    // Card B is disabled due to limit and hovering shows explanation tooltip
    const disabledBtnB = cardBEl.locator('button[title="Лимит голосов исчерпан"]')
    await expect(disabledBtnB).toBeDisabled()
    const btnBox = await disabledBtnB.boundingBox()
    expect(btnBox).not.toBeNull()
    await page.mouse.move(btnBox!.x + btnBox!.width / 2, btnBox!.y + btnBox!.height / 2)
    await expect(
      page.locator('[role="tooltip"]').filter({ hasText: 'Лимит голосов исчерпан (1/1)' }).first(),
    ).toBeVisible({ timeout: 5000 })

    // Increase max_votes via BoardSettingsDialog -> existing vote on Card A MUST NOT reset!
    await page.getByTestId('board-settings-btn').click()
    await page.locator('#board-settings-votes').fill('3')
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await expect(cardAEl.locator('button[title="Убрать лайк"]')).toContainText('1', { timeout: 10000 })
    await expect(cardBEl.locator('button[title="Лайк"]')).toBeEnabled({ timeout: 10000 })

    // Vote on Card B works now
    await cardBEl.locator('button[title="Лайк"]').click()
    await expect(cardBEl.locator('button[title="Убрать лайк"]')).toContainText('1', { timeout: 10000 })

    // Stop facilitation with lock_board checked -> shows amber read-only indicator & clear tooltip
    await page.getByTestId('stop-facilitator-btn').click()
    await page.getByRole('checkbox').click()
    await page.getByRole('button', { name: 'Завершить' }).click()

    await expect(page.getByText('Доска заблокирована для правок')).toBeVisible({ timeout: 10000 })
    await expect(cardAEl.locator('button[title="Доска заблокирована для правок"]')).toBeDisabled()
  })

  test('SummaryModal renders clean themes list and numbered recommendations without oval bubbles', async ({
    page,
    request,
  }) => {
    const board = await createBoardViaAPI(request, 'Summary Layout Board', workspaceToken)

    await page.route(`**/api/boards/${board.id}/summary`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'sum-1',
          board_id: board.id,
          summary_text: 'Команда провела продуктивную ретроспективу с фокусом на стабильность.',
          key_themes: [
            'Техническое улучшение производительности фронтенда и плавная синхронизация курсоров',
            'Автоматизация E2E проверок перед каждым релизом',
          ],
          recommendations: [
            'Закрепить сквозные E2E-тесты голосования в CI',
            'Настроить мониторинг WS-подключений в Grafana',
          ],
          created_at: new Date().toISOString(),
        }),
      })
    })

    await page.goto(`/board/${board.slug || board.id}`)
    await dismissWelcome(page)

    await page.getByTestId('export-menu-btn').click()
    await page.getByText('Итоги ретро и AI').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Итоги ретроспективы')).toBeVisible({ timeout: 10000 })

    const firstThemeItem = dialog.locator('ul li', {
      hasText: 'Техническое улучшение производительности фронтенда',
    })
    await expect(firstThemeItem).toBeVisible()
    // Ensure key themes are list items, not rounded-full pill badges
    await expect(firstThemeItem).not.toHaveClass(/rounded-full/)

    const recsList = dialog.locator('ol li')
    await expect(recsList).toHaveCount(2)
    await expect(recsList.nth(0)).toContainText('1')
    await expect(recsList.nth(1)).toContainText('2')
  })

  test('floating reactions travel across full board height instead of bottom strip', async ({
    page,
    request,
  }) => {
    const board = await createBoardViaAPI(request, 'Full Board Reactions', workspaceToken)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/board/${board.slug || board.id}`)
    await dismissWelcome(page)

    await page.getByRole('button', { name: 'Отправить реакцию' }).click()
    await page.getByRole('button', { name: '🔥' }).click()

    const overlay = page.getByTestId('reactions-overlay')
    await expect(overlay).toBeVisible({ timeout: 5000 })

    const overlayBox = await overlay.boundingBox()
    expect(overlayBox).not.toBeNull()
    // Overlay covers almost the entire viewport height (below topbar)
    expect(overlayBox!.height).toBeGreaterThan(600)

    // Mid-flight, reaction should have risen well into the upper half of the board
    await page.waitForTimeout(1600)
    const reactionBox = await overlay.locator('.animate-float-up').first().boundingBox()
    expect(reactionBox).not.toBeNull()
    expect(reactionBox!.y).toBeLessThan(400)
  })

  test('responsive columns fill 1920px, center on 2560px ultrawide, scroll with 6 columns, and adapt on mobile', async ({
    page,
    request,
  }) => {
    const board = await createBoardViaAPI(request, 'Responsive Layout Board', workspaceToken)
    const headers = await apiHeaders(request, workspaceToken)

    // 1. 1920x1080: 3 columns expand beyond old 336px and fill space next to MasterColumn
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/board/${board.slug || board.id}`)
    await dismissWelcome(page)

    const cols = page.getByTestId('board-column')
    await expect(cols).toHaveCount(3, { timeout: 15000 })

    const col0Fhd = await cols.nth(0).boundingBox()
    const col2Fhd = await cols.nth(2).boundingBox()
    const masterFhd = await page.getByTestId('master-column').boundingBox()
    expect(col0Fhd).not.toBeNull()
    expect(col2Fhd).not.toBeNull()
    expect(masterFhd).not.toBeNull()

    // Each column stretches cleanly (> 420px instead of fixed 336px) and leaves no huge void
    expect(col0Fhd!.width).toBeGreaterThan(420)
    expect(masterFhd!.x - (col2Fhd!.x + col2Fhd!.width)).toBeLessThan(40)

    // 2. 2560x1440 ultrawide: columns cap near max-w-[580px] and center inside canvas
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.waitForTimeout(150)
    const col0Uw = await cols.nth(0).boundingBox()
    const col2Uw = await cols.nth(2).boundingBox()
    const masterUw = await page.getByTestId('master-column').boundingBox()
    expect(col0Uw).not.toBeNull()
    expect(col2Uw).not.toBeNull()
    expect(masterUw).not.toBeNull()

    expect(col0Uw!.width).toBeGreaterThanOrEqual(520)
    expect(col0Uw!.width).toBeLessThanOrEqual(585)
    const leftGap = col0Uw!.x
    const rightGap = masterUw!.x - (col2Uw!.x + col2Uw!.width)
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(24)

    // 3. 6 columns on 1280x800 -> horizontal overflow without clipping left edge + scroll arrow
    for (let i = 4; i <= 6; i++) {
      await request.post(`${API}/columns/`, {
        headers,
        data: { board_id: board.id, title: `Extra Col ${i}`, color: '#6366F1' },
      })
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.reload()
    await dismissWelcome(page)
    await expect(cols).toHaveCount(6, { timeout: 15000 })

    const col0Overflow = await cols.nth(0).boundingBox()
    expect(col0Overflow).not.toBeNull()
    expect(col0Overflow!.x).toBeGreaterThanOrEqual(0)
    expect(col0Overflow!.width).toBeGreaterThanOrEqual(276)

    const rightScrollBtn = page.getByRole('button', { name: 'Прокрутить колонки вправо' })
    await expect(rightScrollBtn).toBeVisible()
    await rightScrollBtn.click()
    await expect(page.getByRole('button', { name: 'Прокрутить колонки влево' })).toBeVisible({
      timeout: 5000,
    })

    // 4. Mobile 390x844 -> single focused column ~86vw, page has no overflow
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(150)
    const col0Mob = await cols.nth(0).boundingBox()
    expect(col0Mob).not.toBeNull()
    expect(col0Mob!.width).toBeGreaterThan(290)
    expect(col0Mob!.width).toBeLessThan(370)
  })

  test('resizable Action Items sidebar toggles cleanly and remembers drag width', async ({
    page,
    request,
  }) => {
    const board = await createBoardViaAPI(request, 'Resizable Sidebar Board', workspaceToken)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/board/${board.slug || board.id}`)
    await dismissWelcome(page)

    const masterCol = page.getByTestId('master-column')
    await expect(masterCol).toBeVisible({ timeout: 15000 })
    const initialBox = await masterCol.boundingBox()
    expect(initialBox).not.toBeNull()

    // Drag separator left to widen sidebar
    const separator = page.getByRole('separator', { name: 'Изменить ширину панели Итоги' })
    const sepBox = await separator.boundingBox()
    expect(sepBox).not.toBeNull()

    await page.mouse.move(sepBox!.x + sepBox!.width / 2, sepBox!.y + sepBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(sepBox!.x - 100, sepBox!.y + sepBox!.height / 2, { steps: 5 })
    await page.mouse.up()

    const widenedBox = await masterCol.boundingBox()
    expect(widenedBox).not.toBeNull()
    expect(widenedBox!.width).toBeGreaterThan(initialBox!.width + 60)

    // Double-click separator resets width back to adaptive default
    const updatedSepBox = await separator.boundingBox()
    await page.mouse.dblclick(
      updatedSepBox!.x + updatedSepBox!.width / 2,
      updatedSepBox!.y + updatedSepBox!.height / 2,
    )
    await expect.poll(async () => (await masterCol.boundingBox())!.width).toBeCloseTo(
      initialBox!.width,
      -1,
    )

    // Toggle Итоги off -> master column hides & columns reclaim space
    const col0Before = (await page.getByTestId('board-column').first().boundingBox())!.width
    await page.getByRole('button', { name: /Итоги/ }).click()
    await expect(masterCol).not.toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(260)
    const col0After = (await page.getByTestId('board-column').first().boundingBox())!.width
    expect(col0After).toBeGreaterThan(col0Before + 40)
  })

  test('non-modal export dropdown lets user open board settings in a single click', async ({
    page,
    request,
  }) => {
    const board = await createBoardViaAPI(request, 'Topbar Dropdown Flow', workspaceToken)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/board/${board.slug || board.id}`)
    await dismissWelcome(page)

    await page.getByTestId('export-menu-btn').click()
    await expect(page.getByRole('menuitem', { name: 'Итоги ретро и AI' })).toBeVisible()

    // Direct single click on neighboring button opens settings without being blocked by an overlay
    await page.getByTestId('board-settings-btn').click()
    await expect(page.getByRole('dialog')).toContainText('Настройки доски')
  })
})
