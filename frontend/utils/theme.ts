import type { Theme } from '../types'

export function applyTheme({ primary, dark }: Theme): void {
  const root = document.documentElement

  const hex2rgb = (h: string): [number, number, number] => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t))
  const rgb2hex = (r: number[]) => '#' + r.map((v) => v.toString(16).padStart(2, '0')).join('')

  const p = hex2rgb(primary)
  const white = [255, 255, 255]
  const black = [0, 0, 0]

  root.style.setProperty('--md-primary', primary)
  root.style.setProperty('--md-primary-container', rgb2hex(mix(p, white, 0.85)))
  root.style.setProperty('--md-on-primary-container', rgb2hex(mix(p, black, 0.3)))
  root.style.setProperty('--md-secondary', rgb2hex(mix(p, [100, 100, 100], 0.5)))
  root.style.setProperty('--md-secondary-container', rgb2hex(mix(p, white, 0.78)))
  root.style.setProperty('--md-on-secondary-container', rgb2hex(mix(p, black, 0.4)))

  if (dark) {
    root.style.setProperty('--md-background', '#141218')
    root.style.setProperty('--md-surface', '#141218')
    root.style.setProperty('--md-surface-variant', '#2D2B32')
    root.style.setProperty('--md-on-surface', '#E6E1E5')
    root.style.setProperty('--md-on-surface-variant', '#CAC4D0')
    root.style.setProperty('--md-outline-variant', '#49454F')
    root.style.setProperty('--md-outline', '#938F99')
    root.style.setProperty('--md-on-primary', rgb2hex(mix(p, black, 0.4)))
  } else {
    root.style.setProperty('--md-background', '#FEF7FF')
    root.style.setProperty('--md-surface', '#FEF7FF')
    root.style.setProperty('--md-surface-variant', '#E7E0EC')
    root.style.setProperty('--md-on-surface', '#1C1B1F')
    root.style.setProperty('--md-on-surface-variant', '#49454F')
    root.style.setProperty('--md-outline-variant', '#CAC4D0')
    root.style.setProperty('--md-outline', '#79747E')
    root.style.setProperty('--md-on-primary', '#FFFFFF')
  }
}

export const PRIMARY_COLORS: string[] = [
  '#6750A4', '#0061A4', '#006E1C', '#BA1A1A', '#E8760A',
  '#006A60', '#7D5260', '#1B6CA8', '#FF6D00', '#43A047',
]

export const CARD_COLORS: string[] = [
  '#FFFFFF', '#FFF9C4', '#F8BBD9', '#C8E6C9', '#BBDEFB',
  '#FFE0B2', '#E1BEE7', '#B2EBF2', '#FFCDD2', '#DCEDC8',
]

export const AVATAR_COLORS: string[] = [
  '#6750A4', '#0061A4', '#006E1C', '#BA1A1A', '#E8760A', '#006A60', '#7D5260',
]

export function userColor(name: string = ''): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}

export function initials(name: string = ''): string {
  return name.slice(0, 2).toUpperCase()
}

export function isLight(hex: string): boolean {
  if (!hex || hex === '#FFFFFF') return true
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b > 180
}
