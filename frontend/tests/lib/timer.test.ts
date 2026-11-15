import { describe, it, expect } from 'vitest'
import {
  IDLE_TIMER,
  runningTimer,
  stoppedTimer,
  timerDisplaySeconds,
  timerRemainingSeconds,
} from '../../lib/timer'

describe('таймер от момента окончания', () => {
  const now = 1_800_000_000_000

  it('идущий таймер считает остаток от момента окончания, а не шагами по секунде', () => {
    const timer = runningTimer(300, 120, now)
    expect(timer.endsAt).toBe(now + 120_000)
    expect(timerRemainingSeconds(timer, now)).toBe(120)
    expect(timerRemainingSeconds(timer, now + 5_500)).toBe(114.5)
    // Вкладка проспала полторы минуты — отставания нет
    expect(timerRemainingSeconds(timer, now + 90_000)).toBe(30)
  })

  it('после срока остаток нулевой, отрицательным не бывает', () => {
    const timer = runningTimer(60, 10, now)
    expect(timerRemainingSeconds(timer, now + 10_000)).toBe(0)
    expect(timerRemainingSeconds(timer, now + 3_600_000)).toBe(0)
  })

  it('показ округляется вверх: 00:00 — ровно в момент окончания', () => {
    const timer = runningTimer(60, 10, now)
    expect(timerDisplaySeconds(timer, now)).toBe(10)
    expect(timerDisplaySeconds(timer, now + 1)).toBe(10)
    expect(timerDisplaySeconds(timer, now + 1_000)).toBe(9)
    expect(timerDisplaySeconds(timer, now + 9_999)).toBe(1)
    expect(timerDisplaySeconds(timer, now + 10_000)).toBe(0)
  })

  it('остаток не превышает того, что было на момент события, даже если часы перевели назад', () => {
    const timer = runningTimer(60, 10, now)
    expect(timerRemainingSeconds(timer, now - 60_000)).toBe(10)
  })

  it('остановленный таймер хранит остаток как есть', () => {
    const paused = stoppedTimer(300, 47)
    expect(paused).toEqual({ duration: 300, remaining: 47, running: false, endsAt: null })
    expect(timerRemainingSeconds(paused, now + 999_999)).toBe(47)
    expect(timerDisplaySeconds(stoppedTimer(300, -5))).toBe(0)
  })

  it('таймер по умолчанию — пять минут, не идёт', () => {
    expect(IDLE_TIMER).toEqual({ duration: 300, remaining: 300, running: false, endsAt: null })
  })
})
