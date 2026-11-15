/**
 * Таймер этапа считается от момента окончания, а не уменьшением счётчика раз в секунду:
 * в фоновой вкладке таймеры браузера срабатывают реже, и счётчик отставал бы.
 *
 * Сервер в событиях таймера присылает остаток в секундах (при подключении — уже за вычетом
 * прошедшего времени). Момент окончания клиент фиксирует по своим часам в момент получения:
 * так расхождение часов клиента и сервера на показания не влияет.
 */
import type { TimerState } from '@/types'

export const DEFAULT_TIMER_SECONDS = 300

export const IDLE_TIMER: TimerState = {
  duration: DEFAULT_TIMER_SECONDS,
  remaining: DEFAULT_TIMER_SECONDS,
  running: false,
  endsAt: null,
}

/** Сколько секунд осталось сейчас (дробное значение). */
export function timerRemainingSeconds(timer: TimerState, now: number = Date.now()): number {
  const atEvent = Math.max(0, timer.remaining)
  if (!timer.running || timer.endsAt == null) return atEvent
  // Больше, чем было в момент события, остаться не может — даже если часы перевели назад
  return Math.max(0, Math.min(atEvent, (timer.endsAt - now) / 1000))
}

/** Остаток для показа: целые секунды с округлением вверх, 00:00 — ровно в момент окончания. */
export function timerDisplaySeconds(timer: TimerState, now: number = Date.now()): number {
  return Math.ceil(timerRemainingSeconds(timer, now))
}

/** Состояние идущего таймера: остаток известен сейчас, окончание — через столько же. */
export function runningTimer(duration: number, remaining: number, now: number = Date.now()): TimerState {
  return { duration, remaining, running: true, endsAt: now + remaining * 1000 }
}

export function stoppedTimer(duration: number, remaining: number): TimerState {
  return { duration, remaining: Math.max(0, remaining), running: false, endsAt: null }
}
