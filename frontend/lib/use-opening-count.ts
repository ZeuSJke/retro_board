import { useState } from 'react'

/**
 * Номер открытия диалога: 0 — ещё не открывали, дальше растёт с каждым открытием.
 *
 * Используйте как `key` содержимого: каждое открытие начинается с чистого состояния
 * (и нового запроса данных), а при закрытии содержимое остаётся на месте до конца анимации.
 * Пока номер равен 0, содержимое не рисуйте — иначе оно запросит данные до первого открытия.
 */
export function useOpeningCount(open: boolean): number {
  const [count, setCount] = useState(open ? 1 : 0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setCount((n) => n + 1)
  }
  return count
}
