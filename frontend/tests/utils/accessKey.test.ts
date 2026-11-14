import { describe, expect, it } from 'vitest'
import { generateAccessKey } from '../../utils/accessKey'

describe('generateAccessKey', () => {
  it('выдаёт ключ из четырёх групп без похожих знаков, в серверных границах', () => {
    const key = generateAccessKey()

    // Без 0 и O, 1, l и I
    expect(key).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{5}(-[A-HJ-NP-Za-km-np-z2-9]{5}){3}$/)
    expect(key.length).toBeGreaterThanOrEqual(4)
    expect(new TextEncoder().encode(key).length).toBeLessThanOrEqual(72)
  })

  it('каждый раз новый и использует весь алфавит', () => {
    const keys = Array.from({ length: 200 }, () => generateAccessKey())

    expect(new Set(keys).size).toBe(200)
    // 4000 знаков из 56 возможных: каждый встретится, если выбор не перекошен
    expect(new Set(keys.join('').replace(/-/g, '')).size).toBe(56)
  })
})
