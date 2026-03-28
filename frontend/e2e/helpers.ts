import { type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://localhost:8000/api'

/** Delete all boards (and cascade-deletes columns, cards, action items). */
export async function cleanupBoards(request: APIRequestContext) {
  const res = await request.get(`${API}/boards/`)
  const boards = await res.json()
  for (const b of boards) {
    await request.delete(`${API}/boards/${b.id}`)
  }
}

/** Set username in localStorage to skip welcome dialog. Clears stale state. */
export async function setUsername(page: Page, name = 'E2E Тестер') {
  await page.addInitScript((n) => {
    // Clear stale board lock flags and timer state from previous tests
    const keysToRemove = Object.keys(localStorage).filter(
      (k) => k.startsWith('retro_locked_') || k.startsWith('retro_timer_'),
    )
    keysToRemove.forEach((k) => localStorage.removeItem(k))
    const store = { state: { username: n, currentBoardId: null, theme: { primary: '#6750A4', dark: false } }, version: 0 }
    localStorage.setItem('retroboard-app', JSON.stringify(store))
  }, name)
}

/** Dismiss welcome dialog if it appears (Next.js hydration may show it). */
export async function dismissWelcome(page: Page) {
  const btn = page.getByText('Войти на доску')
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click()
  }
}

/** Create a board via API and return its data. */
export async function createBoardViaAPI(request: APIRequestContext, name: string) {
  const res = await request.post(`${API}/boards/`, { data: { name } })
  return res.json()
}

/** Create an action item via API. */
export async function createActionItemViaAPI(
  request: APIRequestContext,
  boardId: string,
  text: string,
  opts?: { title?: string; assignee?: string; status?: string },
) {
  const res = await request.post(`${API}/action-items/`, {
    data: { board_id: boardId, text, ...opts },
  })
  return res.json()
}
