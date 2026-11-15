/** Безопасный разбор внешней ссылки задачи (только http/https). */
export interface SafeExternalLink {
  href: string
  label: string
}

export function parseSafeExternalUrl(raw: string | null | undefined): SafeExternalLink | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    const path = url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/$/, '') : ''
    const combined = `${url.hostname}${path}`
    const label = combined.length > 34 ? `${combined.slice(0, 31)}…` : combined
    return { href: url.toString(), label }
  } catch {
    return null
  }
}
