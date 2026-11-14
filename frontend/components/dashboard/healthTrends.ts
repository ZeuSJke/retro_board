import type { HealthQuestion, HealthTrendPoint } from '@/types/health'
import { HEALTH_MAX, HEALTH_MIN, ROTI_MAX, ROTI_MIN } from '@/components/health/scale'
import { buildBoardAxis, sortBoardPoints, type BoardAxisEntry } from './chartLabels'

/** Значение одного вопроса на одной доске. */
export interface HealthTrendRowPoint {
  /** id доски — ключ точки. */
  key: string
  fullName: string
  date: string
  /** `null` — на этой доске на вопрос не отвечали. */
  value: number | null
}

/** Ряд дашборда: динамика одного вопроса (или оценки встречи) между досками. */
export interface HealthTrendRow {
  key: string
  kind: 'health' | 'roti'
  title: string
  hint: string
  scaleMin: number
  scaleMax: number
  points: HealthTrendRowPoint[]
  /** Последнее известное значение и доска, на которой оно получено. */
  latest: number | null
  latestBoard: string | null
  /** Изменение к предыдущей доске с ответами; `null` — сравнивать не с чем. */
  delta: number | null
}

export const ROTI_ROW_KEY = 'roti'

function summarize(points: HealthTrendRowPoint[]): Pick<HealthTrendRow, 'latest' | 'latestBoard' | 'delta'> {
  const known = points.filter((p): p is HealthTrendRowPoint & { value: number } => p.value !== null)
  const last = known[known.length - 1]
  const previous = known[known.length - 2]
  return {
    latest: last ? last.value : null,
    latestBoard: last ? last.fullName : null,
    delta: last && previous ? Math.round((last.value - previous.value) * 100) / 100 : null,
  }
}

/**
 * Собрать ряды для блока «Health check команды»: по ряду на вопрос и ряд оценки встречи.
 * Доски идут от старых к новым; вопросы — в порядке, заданном сервером.
 */
export function buildHealthTrendRows(
  questions: readonly HealthQuestion[],
  points: readonly HealthTrendPoint[],
): { rows: HealthTrendRow[]; axis: BoardAxisEntry[] } {
  const sorted = sortBoardPoints(points)
  const axis = buildBoardAxis(sorted)

  // Вопросы не загрузились — показываем то, что есть в данных, под ключами вопросов
  const known: HealthQuestion[] =
    questions.length > 0
      ? [...questions]
      : Array.from(new Set(sorted.flatMap((p) => Object.keys(p.averages ?? {})))).map((key) => ({
          key,
          title: key,
          hint: '',
        }))

  const series = (pick: (point: HealthTrendPoint) => number | null | undefined) =>
    sorted.map((point, index) => {
      const value = pick(point)
      return {
        key: axis[index].key,
        fullName: axis[index].fullName,
        date: axis[index].date,
        value: typeof value === 'number' && Number.isFinite(value) ? value : null,
      }
    })

  const rows: HealthTrendRow[] = known.map((question) => {
    const rowPoints = series((point) => point.averages?.[question.key])
    return {
      key: question.key,
      kind: 'health',
      title: question.title,
      hint: question.hint,
      scaleMin: HEALTH_MIN,
      scaleMax: HEALTH_MAX,
      points: rowPoints,
      ...summarize(rowPoints),
    }
  })

  const rotiPoints = series((point) => point.roti_average)
  rows.push({
    key: ROTI_ROW_KEY,
    kind: 'roti',
    title: 'Оценка встречи',
    hint: 'Стоила ли встреча потраченного времени',
    scaleMin: ROTI_MIN,
    scaleMax: ROTI_MAX,
    points: rotiPoints,
    ...summarize(rotiPoints),
  })

  return { rows, axis }
}
