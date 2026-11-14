/**
 * Темы команды: одно название темы на все ретроспективы.
 * Контракт: `backend/app/schemas.py` (WorkspaceThemeOut, BoardThemeStat).
 */

export interface ThemeBoardRef {
  id: string
  name: string
  slug: string | null
  created_at: string
}

/** Тема команды из `GET /api/boards/themes`. */
export interface TeamTheme {
  id: string
  name: string
  description: string
  /** На скольких досках команды тема названа в итогах. */
  boards_count: number
  /** Сколько досок подряд, заканчивая последней доской с итогами; 0 — на последней не называли. */
  streak: number
  /** Последняя доска, в итогах которой тема названа. */
  last_board: ThemeBoardRef
}

/** Счётчики темы в итогах доски (`theme_stats`): серия считается до этой доски включительно. */
export interface BoardThemeStat {
  id: string
  name: string
  description: string
  boards_count: number
  streak: number
}
