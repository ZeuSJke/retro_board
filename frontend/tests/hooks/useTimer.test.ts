import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimer } from '../../hooks/useTimer'
import { timerDisplaySeconds } from '../../lib/timer'
import type { WsMessage } from '../../types'

const playTimerChime = vi.hoisted(() => vi.fn())

vi.mock('@/lib/board-themes', () => ({
  playTimerChime,
}))

describe('useTimer', () => {
  let sendWs: ReturnType<typeof vi.fn<(msg: WsMessage) => void>>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
    localStorage.clear()
    playTimerChime.mockClear()
    sendWs = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('начальное состояние: пять минут, таймер не идёт', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    expect(result.current.timer).toEqual({
      duration: 300,
      remaining: 300,
      running: false,
      endsAt: null,
    })
    expect(result.current.autoAdvance).toBe(false)
    expect(result.current.soundMuted).toBe(false)
  })

  it('timer_start: таймер идёт до момента окончания, состояние не меняется каждую секунду', () => {
    const { result } = renderHook(() => useTimer(sendWs))

    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 120, remaining: 120, ts: Date.now() })
    })

    const started = result.current.timer
    expect(started).toMatchObject({ duration: 120, remaining: 120, running: true })
    expect(started.endsAt).toBe(Date.now() + 120_000)

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    // Тот же объект состояния: доска из-за отсчёта не перерисовывается
    expect(result.current.timer).toBe(started)
    // А остаток считается от момента окончания
    expect(timerDisplaySeconds(result.current.timer)).toBe(115)
  })

  it('отметка времени отправителя не используется: момент окончания — по своим часам', () => {
    const { result } = renderHook(() => useTimer(sendWs))

    act(() => {
      // Часы отправителя отстают на час — на показания это не влияет
      result.current.handleTimerWsEvent('timer_start', {
        duration: 60,
        remaining: 60,
        ts: Date.now() - 3_600_000,
      })
    })

    expect(timerDisplaySeconds(result.current.timer)).toBe(60)
  })

  it('таймер не отстаёт, если вкладка была в фоне и таймеры браузера не срабатывали', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 300, remaining: 300 })
    })

    // Часы ушли вперёд на две минуты, а ни один таймер за это время не сработал
    vi.setSystemTime(new Date(Date.now() + 120_000))

    expect(timerDisplaySeconds(result.current.timer)).toBe(180)
  })

  it('timer_pause останавливает таймер на присланном остатке', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 120, remaining: 120 })
    })
    act(() => {
      vi.advanceTimersByTime(3000)
      result.current.handleTimerWsEvent('timer_pause', { remaining: 117, duration: 120 })
    })

    expect(result.current.timer).toEqual({ duration: 120, remaining: 117, running: false, endsAt: null })

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(timerDisplaySeconds(result.current.timer)).toBe(117)
    expect(playTimerChime).not.toHaveBeenCalled()
  })

  it('timer_pause без длительности сохраняет прежнюю', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    act(() => {
      result.current.handleTimerWsEvent('timer_reset', { duration: 600 })
      result.current.handleTimerWsEvent('timer_pause', { remaining: 42 })
    })
    expect(result.current.timer).toMatchObject({ duration: 600, remaining: 42, running: false })
  })

  it('timer_reset возвращает таймер к полной длительности', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 120, remaining: 60 })
      result.current.handleTimerWsEvent('timer_reset', { duration: 300 })
    })
    expect(result.current.timer).toEqual({ duration: 300, remaining: 300, running: false, endsAt: null })
  })

  it('когда время вышло: таймер останавливается на нуле, звучит сигнал и вызывается onExpire', () => {
    const onExpire = vi.fn()
    const { result } = renderHook(() => useTimer(sendWs, { onExpire }))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 10, remaining: 10 })
    })

    act(() => {
      vi.advanceTimersByTime(9_999)
    })
    expect(result.current.timer.running).toBe(true)
    expect(onExpire).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.timer).toEqual({ duration: 10, remaining: 0, running: false, endsAt: null })
    expect(playTimerChime).toHaveBeenCalledTimes(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('с выключенным звуком сигнала нет, но onExpire вызывается', () => {
    const onExpire = vi.fn()
    const { result } = renderHook(() => useTimer(sendWs, { onExpire }))
    act(() => {
      result.current.toggleSoundMuted()
      result.current.handleTimerWsEvent('timer_start', { duration: 5, remaining: 5 })
    })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(playTimerChime).not.toHaveBeenCalled()
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('retro_timer_muted')).toBe('true')
  })

  it('пауза до срока отменяет окончание: ни сигнала, ни onExpire', () => {
    const onExpire = vi.fn()
    const { result } = renderHook(() => useTimer(sendWs, { onExpire }))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 10, remaining: 10 })
    })
    act(() => {
      vi.advanceTimersByTime(4000)
      result.current.handleTimerWsEvent('timer_pause', { remaining: 6 })
    })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(onExpire).not.toHaveBeenCalled()
    expect(playTimerChime).not.toHaveBeenCalled()
  })

  it('перезапуск таймера переносит окончание: старый срок не срабатывает', () => {
    const onExpire = vi.fn()
    const { result } = renderHook(() => useTimer(sendWs, { onExpire }))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 10, remaining: 10 })
    })
    act(() => {
      vi.advanceTimersByTime(8000)
      // Ведущий добавил минуту
      result.current.handleTimerWsEvent('timer_start', { duration: 70, remaining: 62 })
    })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(onExpire).not.toHaveBeenCalled()
    expect(result.current.timer.running).toBe(true)

    act(() => {
      vi.advanceTimersByTime(57_000)
    })
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('длинный таймер перепроверяется не реже раза в минуту и заканчивается вовремя', () => {
    const onExpire = vi.fn()
    const { result } = renderHook(() => useTimer(sendWs, { onExpire }))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 900, remaining: 900 })
    })
    act(() => {
      vi.advanceTimersByTime(899_000)
    })
    expect(onExpire).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('при возврате на вкладку истёкший таймер завершается сразу', () => {
    const onExpire = vi.fn()
    const { result } = renderHook(() => useTimer(sendWs, { onExpire }))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 30, remaining: 30 })
    })

    // Вкладка в фоне: часы ушли вперёд, таймер браузера ещё не сработал
    vi.setSystemTime(new Date(Date.now() + 45_000))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.timer).toMatchObject({ remaining: 0, running: false })
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('timer_start с нулевым остатком (таймер истёк, пока нас не было): стоит на нуле без сигнала', () => {
    const onExpire = vi.fn()
    const { result } = renderHook(() => useTimer(sendWs, { onExpire }))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 120, remaining: 0, ts: Date.now() })
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.timer).toEqual({ duration: 120, remaining: 0, running: false, endsAt: null })
    expect(playTimerChime).not.toHaveBeenCalled()
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('некорректные данные события игнорируются', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    const before = result.current.timer
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 'x', remaining: null })
      result.current.handleTimerWsEvent('timer_pause', {})
      result.current.handleTimerWsEvent('timer_reset', { duration: -1 })
    })
    expect(result.current.timer).toBe(before)
  })

  it('сервер не прислал таймер после подключения: локальный отсчёт сбрасывается', () => {
    const onExpire = vi.fn()
    const { result } = renderHook(() => useTimer(sendWs, { onExpire }))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 120, remaining: 90 })
    })

    // Сессию завершили, пока клиент был не в сети: таймера на сервере больше нет
    act(() => {
      result.current.handleTimerAbsent()
    })

    expect(result.current.timer).toEqual({ duration: 120, remaining: 120, running: false, endsAt: null })
    act(() => {
      vi.advanceTimersByTime(200_000)
    })
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('отсутствие таймера на сервере не трогает таймер, который и так стоит в начале', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    const before = result.current.timer
    act(() => {
      result.current.handleTimerAbsent()
    })
    expect(result.current.timer).toBe(before)
  })

  it('состояние таймера не пишется в localStorage и не читается оттуда', () => {
    localStorage.setItem(
      'retro_timer_board-1',
      JSON.stringify({ duration: 120, remaining: 60, running: true, savedAt: Date.now() }),
    )
    const { result } = renderHook(() => useTimer(sendWs))
    expect(result.current.timer.running).toBe(false)
    expect(result.current.timer.remaining).toBe(300)

    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 200, remaining: 200 })
    })
    const keys = Object.keys(localStorage).filter((k) => k !== 'retro_timer_board-1')
    expect(keys.filter((k) => k.startsWith('retro_timer_') && k !== 'retro_timer_muted')).toEqual([])
  })

  it('handleTimerStart отправляет timer_start', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    act(() => {
      result.current.handleTimerStart(300, 300)
    })
    expect(sendWs).toHaveBeenCalledWith({
      event: 'timer_start',
      data: expect.objectContaining({ duration: 300, remaining: 300 }),
    })
  })

  it('handleTimerPause отправляет остаток на текущий момент — тот, что видит нажавший', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 120, remaining: 120 })
    })
    act(() => {
      vi.advanceTimersByTime(3400)
    })
    act(() => {
      result.current.handleTimerPause()
    })
    // Прошло 3,4 с: на экране 01:57
    expect(sendWs).toHaveBeenCalledWith({
      event: 'timer_pause',
      data: { remaining: 117, duration: 120 },
    })
  })

  it('handleTimerReset отправляет timer_reset', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    act(() => {
      result.current.handleTimerReset(600)
    })
    expect(sendWs).toHaveBeenCalledWith({ event: 'timer_reset', data: { duration: 600 } })
  })

  it('handleAddTime у идущего таймера продлевает его от текущего остатка', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 120, remaining: 120 })
    })
    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    act(() => {
      result.current.handleAddTime(60)
    })
    expect(sendWs).toHaveBeenCalledWith({
      event: 'timer_start',
      data: expect.objectContaining({ duration: 180, remaining: 160 }),
    })
  })

  it('handleAddTime у остановленного таймера увеличивает остаток на паузе', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    act(() => {
      result.current.handleTimerWsEvent('timer_pause', { duration: 120, remaining: 30 })
    })
    act(() => {
      result.current.handleAddTime(120)
    })
    expect(sendWs).toHaveBeenCalledWith({
      event: 'timer_pause',
      data: { duration: 240, remaining: 150 },
    })
  })

  it('обработчики стабильны: смена состояния таймера не пересоздаёт их', () => {
    const { result } = renderHook(() => useTimer(sendWs))
    const before = { ...result.current }
    act(() => {
      result.current.handleTimerWsEvent('timer_start', { duration: 120, remaining: 120 })
    })
    expect(result.current.handleTimerPause).toBe(before.handleTimerPause)
    expect(result.current.handleAddTime).toBe(before.handleAddTime)
    expect(result.current.handleTimerWsEvent).toBe(before.handleTimerWsEvent)
  })
})
