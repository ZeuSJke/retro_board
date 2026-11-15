export type AccentKey = 'violet' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky'

export interface AccentPreset {
  id: AccentKey
  name: string
  swatch: string
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'violet', name: 'Фиолетовый', swatch: '#4F46E5' },
  { id: 'indigo', name: 'Индиго', swatch: '#3B82F6' },
  { id: 'emerald', name: 'Изумруд', swatch: '#10B981' },
  { id: 'amber', name: 'Янтарь', swatch: '#F59E0B' },
  { id: 'rose', name: 'Розовый', swatch: '#F43F5E' },
  { id: 'sky', name: 'Небесный', swatch: '#0EA5E9' },
]

export const ACCENT_STORAGE_KEY = 'retro_accent'
export const LEGACY_PRIMARY_COLOR_KEY = 'retro_primary_color'
export const LEGACY_DARK_MODE_KEY = 'retro_dark_mode'
export const DOT_GRID_STORAGE_KEY = 'retro_dot_grid'

const LEGACY_HEX_TO_ACCENT: Record<string, AccentKey> = {
  '#6750a4': 'violet',
  '#6c5ce7': 'violet',
  '#4f46e5': 'violet',
  '#1976d2': 'indigo',
  '#006e1c': 'emerald',
  '#00796b': 'emerald',
  '#e8760a': 'amber',
  '#ba1a1a': 'rose',
  '#c2185b': 'rose',
}

export function resolveInitialAccent(): AccentKey {
  if (typeof window === 'undefined') return 'violet'
  const stored = localStorage.getItem(ACCENT_STORAGE_KEY)
  if (stored && ACCENT_PRESETS.some((p) => p.id === stored)) {
    return stored as AccentKey
  }
  const legacyHex = localStorage.getItem(LEGACY_PRIMARY_COLOR_KEY)?.toLowerCase()
  if (legacyHex && LEGACY_HEX_TO_ACCENT[legacyHex]) {
    return LEGACY_HEX_TO_ACCENT[legacyHex]
  }
  return 'violet'
}

export function applyAccent(accent: AccentKey): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.accent = accent
  localStorage.setItem(ACCENT_STORAGE_KEY, accent)
}

export interface CardColorPreset {
  id: string
  name: string
  hex: string
  swatchClass: string
  cardClass: string
  accentDot: string
}

/**
 * Адаптивные тона карточек: мягкие пастельные подложки на Light
 * и глубокие полупрозрачные оттенки на Dark.
 */
export const CARD_COLOR_PRESETS: CardColorPreset[] = [
  {
    id: 'default',
    name: 'Базовый',
    hex: '#FFFFFF',
    swatchClass: 'bg-white dark:bg-zinc-900 border-border',
    cardClass: 'bg-card border-border/80',
    accentDot: '#94A3B8',
  },
  {
    id: 'amber',
    name: 'Тёплый песок',
    hex: '#FFF8E1',
    swatchClass: 'bg-amber-100 dark:bg-amber-900/80 border-amber-300 dark:border-amber-500/80',
    cardClass: 'bg-amber-50/90 dark:bg-amber-900/40 border-amber-200/80 dark:border-amber-500/45',
    accentDot: '#F59E0B',
  },
  {
    id: 'emerald',
    name: 'Мята',
    hex: '#E8F5E9',
    swatchClass: 'bg-emerald-100 dark:bg-emerald-900/80 border-emerald-300 dark:border-emerald-500/80',
    cardClass: 'bg-emerald-50/90 dark:bg-emerald-900/40 border-emerald-200/80 dark:border-emerald-500/45',
    accentDot: '#10B981',
  },
  {
    id: 'sky',
    name: 'Небо',
    hex: '#E3F2FD',
    swatchClass: 'bg-sky-100 dark:bg-sky-900/80 border-sky-300 dark:border-sky-500/80',
    cardClass: 'bg-sky-50/90 dark:bg-sky-900/40 border-sky-200/80 dark:border-sky-500/45',
    accentDot: '#0EA5E9',
  },
  {
    id: 'violet',
    name: 'Лаванда',
    hex: '#EDE7F6',
    swatchClass: 'bg-violet-100 dark:bg-violet-900/80 border-violet-300 dark:border-violet-500/80',
    cardClass: 'bg-violet-50/90 dark:bg-violet-900/40 border-violet-200/80 dark:border-violet-500/45',
    accentDot: '#8B5CF6',
  },
  {
    id: 'rose',
    name: 'Коралл',
    hex: '#FCE4EC',
    swatchClass: 'bg-rose-100 dark:bg-rose-900/80 border-rose-300 dark:border-rose-500/80',
    cardClass: 'bg-rose-50/90 dark:bg-rose-900/40 border-rose-200/80 dark:border-rose-500/45',
    accentDot: '#F43F5E',
  },
  {
    id: 'teal',
    name: 'Бирюза',
    hex: '#E0F2F1',
    swatchClass: 'bg-teal-100 dark:bg-teal-900/80 border-teal-300 dark:border-teal-500/80',
    cardClass: 'bg-teal-50/90 dark:bg-teal-900/40 border-teal-200/80 dark:border-teal-500/45',
    accentDot: '#14B8A6',
  },
]

const HEX_TO_CARD_PRESET: Record<string, CardColorPreset> = {
  '#ffffff': CARD_COLOR_PRESETS[0],
  '#fafafa': CARD_COLOR_PRESETS[0],
  '#fff8e1': CARD_COLOR_PRESETS[1],
  '#fff9c4': CARD_COLOR_PRESETS[1],
  '#ffe0b2': CARD_COLOR_PRESETS[1],
  '#ffeb3b': CARD_COLOR_PRESETS[1],
  '#fef3c7': CARD_COLOR_PRESETS[1],
  '#fff3e0': CARD_COLOR_PRESETS[1],
  '#e8f5e9': CARD_COLOR_PRESETS[2],
  '#c8e6c9': CARD_COLOR_PRESETS[2],
  '#dcedc8': CARD_COLOR_PRESETS[2],
  '#d1fae5': CARD_COLOR_PRESETS[2],
  '#e3f2fd': CARD_COLOR_PRESETS[3],
  '#bbdefb': CARD_COLOR_PRESETS[3],
  '#e0f2fe': CARD_COLOR_PRESETS[3],
  '#ede7f6': CARD_COLOR_PRESETS[4],
  '#e1bee7': CARD_COLOR_PRESETS[4],
  '#f3e5f5': CARD_COLOR_PRESETS[4],
  '#fce4ec': CARD_COLOR_PRESETS[5],
  '#f8bbd9': CARD_COLOR_PRESETS[5],
  '#ffcdd2': CARD_COLOR_PRESETS[5],
  '#ffebee': CARD_COLOR_PRESETS[5],
  '#e0f2f1': CARD_COLOR_PRESETS[6],
  '#e0f7fa': CARD_COLOR_PRESETS[6],
  '#b2ebf2': CARD_COLOR_PRESETS[6],
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '')
  const normalized =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ]
}

function rgbToHue([r, g, b]: [number, number, number]): number {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  if (delta === 0) return 0
  let hue = 0
  if (max === rn) hue = ((gn - bn) / delta) % 6
  else if (max === gn) hue = (bn - rn) / delta + 2
  else hue = (rn - gn) / delta + 4
  hue = Math.round(hue * 60)
  return hue < 0 ? hue + 360 : hue
}

const PRESET_HUE_MAP: Array<{ preset: CardColorPreset; hue: number }> =
  CARD_COLOR_PRESETS.slice(1).map((preset) => ({
    preset,
    hue: rgbToHue(parseHexRgb(preset.accentDot) ?? [255, 255, 255]),
  }))

export function getCardColorPreset(hex?: string | null): CardColorPreset {
  if (!hex) return CARD_COLOR_PRESETS[0]
  const normalized = hex.trim().toLowerCase()
  const exact = HEX_TO_CARD_PRESET[normalized]
  if (exact) return exact

  const rgb = parseHexRgb(normalized)
  if (!rgb) return CARD_COLOR_PRESETS[0]
  // Keep near-neutral whites/grays on the default surface preset.
  if (Math.max(...rgb) - Math.min(...rgb) < 16) {
    return CARD_COLOR_PRESETS[0]
  }

  const targetHue = rgbToHue(rgb)
  let best = CARD_COLOR_PRESETS[1]
  let minDist = Infinity
  for (const item of PRESET_HUE_MAP) {
    const rawDiff = Math.abs(targetHue - item.hue)
    const dist = Math.min(rawDiff, 360 - rawDiff)
    if (dist < minDist) {
      minDist = dist
      best = item.preset
    }
  }
  return best
}

export const COLUMN_COLOR_PALETTE = [
  '#10B981', // Изумруд
  '#EF4444', // Красный
  '#F59E0B', // Янтарь
  '#3B82F6', // Синий
  '#6366F1', // Индиго
  '#EC4899', // Розовый
  '#14B8A6', // Бирюза
  '#64748B', // Графит
]

/** Названия цветов колонок — подписи образцов для клавиатуры и экранного диктора. */
export const COLUMN_COLOR_NAMES: Record<string, string> = {
  '#10B981': 'Изумруд',
  '#EF4444': 'Красный',
  '#F59E0B': 'Янтарь',
  '#3B82F6': 'Синий',
  '#6366F1': 'Индиго',
  '#EC4899': 'Розовый',
  '#14B8A6': 'Бирюза',
  '#64748B': 'Графит',
}

export function getColumnColorName(hex: string): string {
  return COLUMN_COLOR_NAMES[hex.toUpperCase()] ?? hex
}

export const QUICK_REACTIONS = ['❤️', '👍', '🔥', '🎉', '💡', '👏', '😂'] as const

export const MOOD_OPTIONS = [
  { score: 1, emoji: '😫', label: 'Тяжёлый спринт' },
  { score: 2, emoji: '😕', label: 'Было непросто' },
  { score: 3, emoji: '😐', label: 'Нормально' },
  { score: 4, emoji: '🙂', label: 'Хорошо' },
  { score: 5, emoji: '🤩', label: 'Отлично!' },
] as const

/**
 * Короткий двухтоновый сигнал окончания таймера на WebAudio API.
 */
export function playTimerChime(): void {
  if (typeof window === 'undefined') return
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const notes = [587.33, 880] // D5 -> A5

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + idx * 0.16)
      gain.gain.setValueAtTime(0.001, now + idx * 0.16)
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.16 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.45)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + idx * 0.16)
      osc.stop(now + idx * 0.16 + 0.48)
    })

    setTimeout(() => {
      ctx.close().catch(() => {})
    }, 1200)
  } catch {
    // Браузер может блокировать WebAudio до взаимодействия
  }
}

export const AVATAR_GRADIENTS = [
  'from-indigo-500 to-violet-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-sky-500 to-blue-600',
  'from-fuchsia-500 to-purple-600',
]

export function getUserAvatarGradient(name: string): string {
  if (!name) return AVATAR_GRADIENTS[0]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

export function getUserInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return trimmed.slice(0, 2).toUpperCase()
}
