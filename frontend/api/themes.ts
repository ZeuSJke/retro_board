import { api } from './index'
import type { TeamTheme } from '../types/themes'

/** Темы команды со счётчиками: сначала те, что поднимаются дольше всего подряд. */
export const getTeamThemes = (): Promise<TeamTheme[]> =>
  api.get<TeamTheme[]>('/boards/themes').then((r) => r.data)
