'use client'

import { Repeat2 } from 'lucide-react'
import type { BoardThemeStat } from '@/types/themes'
import { Badge } from '@/components/ui/badge'
import { boardsCountLabel, streakLabel } from './format'

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
}

function isThemeStat(value: unknown): value is BoardThemeStat {
  if (typeof value !== 'object' || value === null) return false
  const stat = value as Partial<BoardThemeStat>
  return typeof stat.name === 'string' && typeof stat.streak === 'number'
}

/**
 * Счётчики тем из итогов доски (`theme_stats`).
 * Поле появилось вместе со списком тем команды: у старых итогов его нет.
 */
export function getThemeStats(summary: unknown): BoardThemeStat[] {
  if (typeof summary !== 'object' || summary === null) return []
  const stats = (summary as { theme_stats?: unknown }).theme_stats
  return Array.isArray(stats) ? stats.filter(isThemeStat) : []
}

/** Счётчики темы по её названию из `key_themes` (названия совпадают со списком команды). */
export function findThemeStat(summary: unknown, themeName: string): BoardThemeStat | null {
  const key = normalize(themeName)
  return getThemeStats(summary).find((stat) => normalize(stat.name) === key) ?? null
}

interface ThemeStreakBadgeProps {
  /** Итоги доски: `GET …/summary`, `POST …/summary/regenerate` или событие `summary_generated`. */
  summary: unknown
  /** Название темы из `key_themes`. */
  theme: string
}

/**
 * Метка «N-й спринт подряд» у темы в окне итогов.
 * Показывается, только если тема поднимается дольше одной доски подряд.
 */
export default function ThemeStreakBadge({ summary, theme }: ThemeStreakBadgeProps) {
  const stat = findThemeStat(summary, theme)
  const label = stat ? streakLabel(stat.streak) : null
  if (!stat || !label) return null
  return (
    <Badge
      variant={stat.streak >= 3 ? 'warning' : 'secondary'}
      className="ml-auto shrink-0 whitespace-nowrap"
      title={`Тема встречалась ${boardsCountLabel(stat.boards_count)}`}
      data-testid="theme-streak-badge"
    >
      <Repeat2 className="h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  )
}
