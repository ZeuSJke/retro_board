import { teamApi } from './client'
import type { TeamTheme } from '../types/themes'

/** Темы команды со счётчиками: сначала те, что поднимаются дольше всего подряд. */
export const getTeamThemes = (): Promise<TeamTheme[]> =>
  teamApi.get<TeamTheme[]>('/boards/themes').then((r) => r.data)
