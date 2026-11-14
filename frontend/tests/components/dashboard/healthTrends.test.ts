import { describe, it, expect } from 'vitest'
import { buildHealthTrendRows, ROTI_ROW_KEY } from '../../../components/dashboard/healthTrends'
import type { HealthQuestion, HealthTrendPoint } from '../../../types/health'

const QUESTIONS: HealthQuestion[] = [
  { key: 'pace', title: 'Темп', hint: 'Успеваем без переработок' },
  { key: 'quality', title: 'Качество', hint: 'Довольны тем, что выпускаем' },
]

const POINTS: HealthTrendPoint[] = [
  {
    board_id: 'b2',
    board_name: 'Спринт 2',
    created_at: '2026-10-15T10:00:00Z',
    averages: { pace: 2.5 },
    roti_average: 4,
  },
  {
    board_id: 'b1',
    board_name: 'Спринт 1',
    created_at: '2026-10-01T10:00:00Z',
    averages: { pace: 1.5, quality: 3 },
    roti_average: null,
  },
  {
    board_id: 'b3',
    board_name: 'Спринт 3',
    created_at: '2026-10-29T10:00:00Z',
    averages: { pace: 2.5, quality: 2 },
    roti_average: 4.5,
  },
]

describe('ряды блока «Health check команды»', () => {
  it('по ряду на вопрос и ряд оценки встречи, доски — от старых к новым', () => {
    const { rows, axis } = buildHealthTrendRows(QUESTIONS, POINTS)
    expect(axis.map((a) => a.fullName)).toEqual(['Спринт 1', 'Спринт 2', 'Спринт 3'])
    expect(rows.map((r) => r.key)).toEqual(['pace', 'quality', ROTI_ROW_KEY])
    expect(rows[0].points.map((p) => p.value)).toEqual([1.5, 2.5, 2.5])
    expect(rows[0].points.map((p) => p.key)).toEqual(['b1', 'b2', 'b3'])
  })

  it('у вопросов шкала 1–3, у оценки встречи — 1–5', () => {
    const { rows } = buildHealthTrendRows(QUESTIONS, POINTS)
    expect([rows[0].scaleMin, rows[0].scaleMax]).toEqual([1, 3])
    const roti = rows.find((r) => r.key === ROTI_ROW_KEY)!
    expect([roti.scaleMin, roti.scaleMax, roti.kind]).toEqual([1, 5, 'roti'])
  })

  it('пропуск ответа на доске — пустая точка; изменение считается к предыдущей доске с ответом', () => {
    const { rows } = buildHealthTrendRows(QUESTIONS, POINTS)
    const quality = rows[1]
    expect(quality.points.map((p) => p.value)).toEqual([3, null, 2])
    expect(quality.latest).toBe(2)
    expect(quality.latestBoard).toBe('Спринт 3')
    expect(quality.delta).toBe(-1)

    const roti = rows[2]
    expect(roti.points.map((p) => p.value)).toEqual([null, 4, 4.5])
    expect(roti.delta).toBe(0.5)
  })

  it('без изменений — нулевая разница; одна точка — сравнивать не с чем', () => {
    const { rows } = buildHealthTrendRows(QUESTIONS, POINTS)
    expect(rows[0].delta).toBe(0)

    const single = buildHealthTrendRows(QUESTIONS, [POINTS[1]])
    expect(single.rows[0].latest).toBe(1.5)
    expect(single.rows[0].delta).toBeNull()
    const roti = single.rows.find((r) => r.key === ROTI_ROW_KEY)!
    expect(roti.latest).toBeNull()
    expect(roti.latestBoard).toBeNull()
  })

  it('без списка вопросов ряды строятся по ключам из данных', () => {
    const { rows } = buildHealthTrendRows([], POINTS)
    expect(rows.map((r) => r.key)).toEqual(['pace', 'quality', ROTI_ROW_KEY])
    expect(rows[0].title).toBe('pace')
  })

  it('нет точек — нет оси, ряды пустые', () => {
    const { rows, axis } = buildHealthTrendRows(QUESTIONS, [])
    expect(axis).toEqual([])
    expect(rows.every((r) => r.points.length === 0 && r.latest === null)).toBe(true)
  })
})
