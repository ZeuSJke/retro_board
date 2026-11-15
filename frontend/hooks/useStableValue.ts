'use client'

import { useState } from 'react'

/**
 * Вернуть прежний объект, пока новое значение ему равно по смыслу.
 *
 * Производные данные (`useMemo` от колонок) пересоздаются при каждом изменении доски, даже
 * если их содержимое то же. Мемоизированные компоненты сравнивают пропсы по ссылке, поэтому
 * «тот же по содержимому, но новый» объект перерисовал бы их зря.
 */
export function useStableValue<T>(value: T, isEqual: (a: T, b: T) => boolean): T {
  const [stable, setStable] = useState(value)
  if (stable === value || isEqual(stable, value)) return stable
  // Значение действительно изменилось: запоминаем его (React сразу повторит рендер)
  setStable(value)
  return value
}

/** Словари с одинаковыми ключами и значениями. */
export function shallowEqualRecords<V>(a: Record<string, V>, b: Record<string, V>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key])
}
