import { Frown, Meh, Smile, type LucideIcon } from 'lucide-react'
import type { HealthAnswerValue, RotiValue } from '@/types/health'

export type HealthTone = 'red' | 'yellow' | 'green'

export interface HealthOption {
  value: HealthAnswerValue
  tone: HealthTone
  /** Подпись ответа: цвет никогда не единственный носитель смысла. */
  label: string
  Icon: LucideIcon
}

/** Светофор: 1 — красный, 2 — жёлтый, 3 — зелёный. */
export const HEALTH_OPTIONS: readonly HealthOption[] = [
  { value: 1, tone: 'red', label: 'Плохо', Icon: Frown },
  { value: 2, tone: 'yellow', label: 'Средне', Icon: Meh },
  { value: 3, tone: 'green', label: 'Хорошо', Icon: Smile },
]

export const HEALTH_MIN = 1
export const HEALTH_MAX = 3

export const ROTI_VALUES: readonly RotiValue[] = [1, 2, 3, 4, 5]
export const ROTI_MIN = 1
export const ROTI_MAX = 5

/**
 * Классы оформления по цвету светофора (обе темы).
 * У выбранной кнопки текст подобран под заливку так, чтобы контраст был не ниже 4.5:1:
 * белый на красном, тёмный на жёлтом и зелёном.
 */
export const TONE_CLASSES: Record<HealthTone, { dot: string; selected: string; idle: string }> = {
  red: {
    dot: 'bg-red-500',
    selected: 'border-red-600 bg-red-600 text-white shadow-sm',
    idle: 'border-border text-red-600 hover:border-red-400 hover:bg-red-500/10 dark:text-red-400',
  },
  yellow: {
    dot: 'bg-amber-500',
    selected: 'border-amber-400 bg-amber-400 text-amber-950 shadow-sm',
    idle: 'border-border text-amber-600 hover:border-amber-400 hover:bg-amber-400/15 dark:text-amber-400',
  },
  green: {
    dot: 'bg-emerald-500',
    selected: 'border-emerald-500 bg-emerald-500 text-emerald-950 shadow-sm',
    idle: 'border-border text-emerald-600 hover:border-emerald-400 hover:bg-emerald-500/10 dark:text-emerald-400',
  },
}

/** Цвета светофора для SVG-графиков — те же оттенки, что у точек (`dot`) выше. */
export const TONE_HEX: Record<HealthTone, string> = {
  red: '#EF4444',
  yellow: '#F59E0B',
  green: '#10B981',
}

export function isHealthAnswerValue(value: unknown): value is HealthAnswerValue {
  return value === 1 || value === 2 || value === 3
}

export function isRotiValue(value: unknown): value is RotiValue {
  return typeof value === 'number' && Number.isInteger(value) && value >= ROTI_MIN && value <= ROTI_MAX
}

/** Цвет светофора для среднего ответа: округление к ближайшему из трёх значений. */
export function toneForAverage(average: number): HealthTone {
  if (average < 1.5) return 'red'
  if (average < 2.5) return 'yellow'
  return 'green'
}

export function optionForTone(tone: HealthTone): HealthOption {
  return HEALTH_OPTIONS.find((option) => option.tone === tone) ?? HEALTH_OPTIONS[1]
}
