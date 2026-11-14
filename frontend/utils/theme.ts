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
