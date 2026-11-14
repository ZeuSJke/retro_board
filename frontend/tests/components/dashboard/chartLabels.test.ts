import { describe, it, expect } from 'vitest'
import {
  buildBoardAxis,
  formatBoardDate,
  labelLimitFor,
  shortenBoardName,
  sortBoardPoints,
} from '../../../components/dashboard/chartLabels'

const point = (board_id: string, board_name: string, created_at: string) => ({
  board_id,
  board_name,
  created_at,
})

describe('подписи досок на графиках', () => {
  it('короткое название остаётся как есть', () => {
    expect(shortenBoardName('Спринт 12')).toBe('Спринт 12')
  })

  it('длинное название сокращается с сохранением хвоста — там номер спринта', () => {
    const label = shortenBoardName('Ретроспектива команды — спринт 12')
    expect(label.length).toBeLessThanOrEqual(18)
    expect(label.startsWith('Ретроспект')).toBe(true)
    expect(label.endsWith('нт 12')).toBe(true)
    expect(label).toContain('…')
  })

  it('две доски за один день получают разные подписи — по названию, а не по дате', () => {
    const axis = buildBoardAxis([
      point('b1', 'Спринт 7', '2026-11-14T09:00:00Z'),
      point('b2', 'Спринт 7 (повтор)', '2026-11-14T15:00:00Z'),
    ])
    expect(axis.map((a) => a.label)).toEqual(['Спринт 7', 'Спринт 7 (повтор)'])
    expect(axis.map((a) => a.key)).toEqual(['b1', 'b2'])
    // Дата — в подсказке, одинаковая у обеих досок
    expect(axis[0].date).toBe(axis[1].date)
    expect(axis[0].date).toContain('2026')
  })

  it('длинные названия, различающиеся только концом, не сливаются после сокращения', () => {
    const axis = buildBoardAxis([
      point('b1', 'Ретроспектива платформенной команды 1', '2026-10-01T10:00:00Z'),
      point('b2', 'Ретроспектива платформенной команды 2', '2026-10-15T10:00:00Z'),
    ])
    expect(axis[0].label).not.toBe(axis[1].label)
    expect(axis[0].fullName).toBe('Ретроспектива платформенной команды 1')
  })

  it('если сокращённые названия совпали, к подписи добавляется дата', () => {
    const axis = buildBoardAxis([
      point('b1', 'Очень длинное название доски — альфа, итог', '2026-10-01T10:00:00Z'),
      point('b2', 'Очень длинное название доски — бета, итог', '2026-10-15T10:00:00Z'),
    ])
    expect(axis[0].label).not.toBe(axis[1].label)
    expect(axis[0].label).toMatch(/· \d{1,2}\.\d{1,2}$/)
    expect(axis[1].label).toMatch(/· \d{1,2}\.\d{1,2}$/)
  })

  it('совпали и название, и дата — подписи различает номер', () => {
    const axis = buildBoardAxis([
      point('b1', 'Спринт', '2026-10-01T10:00:00Z'),
      point('b2', 'Спринт', '2026-10-01T12:00:00Z'),
    ])
    expect(new Set(axis.map((a) => a.label)).size).toBe(2)
    expect(axis[0].label).toMatch(/\(1\)$/)
    expect(axis[1].label).toMatch(/\(2\)$/)
  })

  it('чем больше досок на графике, тем короче подписи', () => {
    expect(labelLimitFor(2)).toBeGreaterThan(labelLimitFor(5))
    expect(labelLimitFor(5)).toBeGreaterThan(labelLimitFor(12))

    const long = 'Ретроспектива платформенной команды — спринт'
    const many = buildBoardAxis(
      Array.from({ length: 8 }, (_, i) =>
        point(`b${i}`, `${long} ${i + 1}`, `2026-0${i + 1}-01T10:00:00Z`),
      ),
    )
    expect(many.every((entry) => entry.label.length <= labelLimitFor(8))).toBe(true)
    // Номер спринта в хвосте сохраняется, поэтому подписи остаются разными
    expect(new Set(many.map((entry) => entry.label)).size).toBe(8)
  })

  it('сортирует доски от старых к новым и не меняет порядок при равной дате', () => {
    const sorted = sortBoardPoints([
      point('new', 'Новая', '2026-11-10T10:00:00Z'),
      point('same-a', 'А', '2026-11-01T10:00:00Z'),
      point('same-b', 'Б', '2026-11-01T10:00:00Z'),
      point('old', 'Старая', '2026-09-01T10:00:00Z'),
    ])
    expect(sorted.map((p) => p.board_id)).toEqual(['old', 'same-a', 'same-b', 'new'])
  })

  it('некорректная дата не ломает подсказку', () => {
    expect(formatBoardDate('не дата')).toBe('')
    expect(buildBoardAxis([point('b1', 'Доска', 'не дата')])[0].date).toBe('')
  })
})
