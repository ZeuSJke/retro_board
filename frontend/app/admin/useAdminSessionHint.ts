'use client'

import { useSyncExternalStore } from 'react'
import { getAdminSessionHint, subscribeAdminSessionHint } from '@/api/admin'

const unknownOnServer = (): boolean | null => null

/**
 * Отметка о входе администратора в этом браузере (см. `api/admin.ts`).
 *
 * `null` — ещё не знаем: на сервере и при первой отрисовке в браузере localStorage не читается,
 * чтобы разметка совпала. `false` — входа не было, форму входа можно показывать без запроса.
 */
export function useAdminSessionHint(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribeAdminSessionHint,
    getAdminSessionHint,
    unknownOnServer,
  )
}
