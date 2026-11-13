import { describe, expect, it } from 'vitest'
import { CARD_COLOR_PRESETS, getCardColorPreset } from '@/lib/board-themes'

describe('getCardColorPreset', () => {
  it('maps current preset hex values to matching presets', () => {
    for (const preset of CARD_COLOR_PRESETS) {
      expect(getCardColorPreset(preset.hex).id).toBe(preset.id)
      expect(getCardColorPreset(preset.hex.toLowerCase()).id).toBe(preset.id)
    }
  })

  it('maps all historical pre-v3 CARD_COLORS hex values to colorful presets', () => {
    const legacyCases: Array<[string, string]> = [
      ['#FFF9C4', 'amber'],
      ['#FFE0B2', 'amber'],
      ['#C8E6C9', 'emerald'],
      ['#DCEDC8', 'emerald'],
      ['#BBDEFB', 'sky'],
      ['#E1BEE7', 'violet'],
      ['#F8BBD9', 'rose'],
      ['#FFCDD2', 'rose'],
      ['#B2EBF2', 'teal'],
      ['#E0F7FA', 'teal'],
    ]

    for (const [hex, expectedId] of legacyCases) {
      expect(getCardColorPreset(hex).id).toBe(expectedId)
    }
  })

  it('keeps neutral gray/white or empty values on default preset', () => {
    expect(getCardColorPreset(null).id).toBe('default')
    expect(getCardColorPreset(undefined).id).toBe('default')
    expect(getCardColorPreset('#FFFFFF').id).toBe('default')
    expect(getCardColorPreset('#F1F5F9').id).toBe('default')
  })

  it('falls back to nearest colorful preset for arbitrary custom saturated hexes', () => {
    expect(getCardColorPreset('#FCE8B2').id).toBe('amber')
    expect(getCardColorPreset('#BAE6FD').id).toBe('sky')
  })
})
