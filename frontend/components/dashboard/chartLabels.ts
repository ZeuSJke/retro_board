/**
 * Подписи досок на графиках дашборда.
 *
 * Точка графика — доска. На оси стоит её название (а не дата: две доски за один день
 * были бы неразличимы), полная дата — в подсказке. Ключ точки — id доски, поэтому
 * одинаковые подписи не склеивают точки, а подписи разных досок всегда различаются.
 */

export interface BoardPoint {
  board_id: string
  board_name: string
  created_at: string
}

export interface BoardAxisEntry {
  /** Уникальный ключ точки на оси — id доски. */
  key: string
  /** Подпись на оси: название доски, при необходимости сокращённое. */
  label: string
  fullName: string
  /** Дата создания доски для подсказки, например «14 ноября 2026 г.». */
  date: string
}

const MAX_LABEL_CHARS = 18
const TAIL_CHARS = 5

/**
 * Сократить название до `max` символов, сохранив конец: номер спринта обычно стоит
 * в хвосте («Ретроспектива команды — спринт 12» → «Ретроспектив…нт 12»).
 */
export function shortenBoardName(name: string, max = MAX_LABEL_CHARS): string {
  const clean = name.trim()
  if (clean.length <= max) return clean
  const head = clean.slice(0, max - TAIL_CHARS - 1).trimEnd()
  const tail = clean.slice(-TAIL_CHARS).trimStart()
  return `${head}…${tail}`
}

export function formatBoardDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function shortDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' })
}

/** Доски от старых к новым; при равной дате порядок исходный. */
export function sortBoardPoints<T extends BoardPoint>(points: readonly T[]): T[] {
  return points
    .map((point, index) => ({ point, index, time: new Date(point.created_at).getTime() || 0 }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map((entry) => entry.point)
}

/**
 * Сколько символов отвести подписи: чем больше досок на графике, тем короче подписи —
 * иначе они не помещаются и recharts прячет часть из них.
 */
export function labelLimitFor(count: number): number {
  if (count <= 3) return 24
  if (count <= 4) return MAX_LABEL_CHARS
  if (count <= 6) return 13
  return 11
}

/**
 * Подписи оси для набора досок (в порядке входного массива).
 * Если сокращённые названия совпали, к ним добавляется дата, а если совпала и она — номер.
 */
export function buildBoardAxis(points: readonly BoardPoint[]): BoardAxisEntry[] {
  const limit = labelLimitFor(points.length)
  const entries = points.map((point) => ({
    key: point.board_id,
    label: shortenBoardName(point.board_name, limit),
    fullName: point.board_name,
    date: formatBoardDate(point.created_at),
    created_at: point.created_at,
  }))

  const disambiguate = (suffix: (entry: (typeof entries)[number], order: number) => string) => {
    const groups = new Map<string, (typeof entries)[number][]>()
    for (const entry of entries) {
      const group = groups.get(entry.label)
      if (group) group.push(entry)
      else groups.set(entry.label, [entry])
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      group.forEach((entry, order) => {
        entry.label = `${entry.label}${suffix(entry, order)}`
      })
    }
  }

  disambiguate((entry) => {
    const date = shortDate(entry.created_at)
    return date ? ` · ${date}` : ''
  })
  disambiguate((_entry, order) => ` (${order + 1})`)

  return entries.map(({ key, label, fullName, date }) => ({ key, label, fullName, date }))
}
