import { describe, it, expect } from 'vitest'
import {
  HEALTH_OPTIONS,
  isHealthAnswerValue,
  isRotiValue,
  optionForTone,
  toneForAverage,
} from '../../../components/health/scale'

describe('шкала health check', () => {
  it('светофор: 1 — красный, 2 — жёлтый, 3 — зелёный, у каждого ответа есть подпись', () => {
    expect(HEALTH_OPTIONS.map((o) => [o.value, o.tone])).toEqual([
      [1, 'red'],
      [2, 'yellow'],
      [3, 'green'],
    ])
    expect(HEALTH_OPTIONS.every((o) => o.label.length > 0)).toBe(true)
  })

  it('среднее округляется к ближайшему цвету', () => {
    expect(toneForAverage(1)).toBe('red')
    expect(toneForAverage(1.49)).toBe('red')
    expect(toneForAverage(1.5)).toBe('yellow')
    expect(toneForAverage(2.49)).toBe('yellow')
    expect(toneForAverage(2.5)).toBe('green')
    expect(toneForAverage(3)).toBe('green')
    expect(optionForTone(toneForAverage(2.75)).label).toBe('Хорошо')
  })

  it('принимает только значения из контракта', () => {
    expect([0, 1, 2, 3, 4, 2.5, '2', null].map(isHealthAnswerValue)).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ])
    expect([0, 1, 5, 6, 3.5, '4', undefined].map(isRotiValue)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ])
  })
})
