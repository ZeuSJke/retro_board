import {
  ACCENT_PRESETS,
  ACCENT_STORAGE_KEY,
  applyAccent,
  CARD_COLOR_PRESETS,
  LEGACY_DARK_MODE_KEY,
  resolveInitialAccent,
  type AccentKey,
} from '../lib/board-themes'

export const THEME_PRESETS = ACCENT_PRESETS.map((p) => ({
  id: p.id,
  name: p.name,
  color: p.swatch,
}))

export const CARD_COLORS = CARD_COLOR_PRESETS.map((p) => p.hex)

export const PRIMARY_COLOR_KEY = ACCENT_STORAGE_KEY
export const DARK_MODE_KEY = LEGACY_DARK_MODE_KEY

const USER_COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#0EA5E9', '#8B5CF6', '#EC4899']

export function userColor(name: string): string {
  if (!name) return USER_COLORS[0]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length]
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (!parts[0]) return '?'
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return parts[0].slice(0, 2).toUpperCase()
}

export function isLight(hex?: string | null): boolean {
  if (!hex) return true
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return true
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 155
}

export function applyTheme(accentOrHex: string, _dark?: boolean): void {
  const valid = ACCENT_PRESETS.find((p) => p.id === accentOrHex || p.swatch.toLowerCase() === accentOrHex.toLowerCase())
  const key: AccentKey = valid ? valid.id : resolveInitialAccent()
  applyAccent(key)
}
