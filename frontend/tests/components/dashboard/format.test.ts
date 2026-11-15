import { describe, it, expect } from 'vitest'
import {
  boardsCountLabel,
  formatAverage,
  plainText,
  pluralRu,
  streakLabel,
} from '../../../components/dashboard/format'

describe('тексты блоков дашборда', () => {
  it('склоняет слова по числу', () => {
    const forms = ['участник', 'участника', 'участников'] as const
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map((n) => pluralRu(n, forms))).toEqual([
      'участник',
      'участника',
      'участников',
      'участников',
      'участников',
      'участник',
      'участника',
      'участников',
      'участников',
    ])
  })

  it('«на N досках» с правильным падежом', () => {
    expect(boardsCountLabel(1)).toBe('на 1 доске')
    expect(boardsCountLabel(3)).toBe('на 3 досках')
    expect(boardsCountLabel(11)).toBe('на 11 досках')
    expect(boardsCountLabel(21)).toBe('на 21 доске')
  })

  it('серия показывается только длиннее одной доски', () => {
    expect(streakLabel(0)).toBeNull()
    expect(streakLabel(1)).toBeNull()
    expect(streakLabel(2)).toBe('2-й спринт подряд')
    expect(streakLabel(3)).toBe('3-й спринт подряд')
  })

  it('убирает разметку Markdown, оставляя текст', () => {
    expect(plainText('**Долгое ревью** мешает релизам')).toBe('Долгое ревью мешает релизам')
    expect(plainText('__Важно__: `git push` без проверки')).toBe('Важно: git push без проверки')
    expect(plainText('- **CI** падает\n- тесты *нестабильны*')).toBe('CI падает тесты нестабильны')
    expect(plainText('## Итог\n1. Починить [пайплайн](https://ci.example.com/p/1)')).toBe(
      'Итог Починить пайплайн',
    )
    expect(plainText('Незакрытая **разметка')).toBe('Незакрытая разметка')
  })

  it('обычный текст со звёздочкой и подчёркиванием не портится', () => {
    expect(plainText('Оценка 5 * 2 = 10, файл my_file_name.ts')).toBe(
      'Оценка 5 * 2 = 10, файл my_file_name.ts',
    )
  })

  it('среднее — с одним знаком после точки', () => {
    expect(formatAverage(2)).toBe('2.0')
    expect(formatAverage(2.449)).toBe('2.4')
  })
})
