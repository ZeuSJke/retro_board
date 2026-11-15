'use client'

import { useEffect, useSyncExternalStore } from 'react'
import {
  checkAdminSession,
  getAdminSessionHint,
  subscribeAdminSessionHint,
  type AdminSessionHint,
} from '@/api/admin'

const unknownOnServer = (): AdminSessionHint => null

/**
 * Состояние сессии администратора в этом браузере (см. `api/admin.ts`).
 *
 * `null` — ещё не знаем: до ответа `GET /api/admin/session` страница показывает
 * «Проверка доступа...», а не форму входа и не список команд. Проверка идёт без
 * ответа 401 в консоли; после входа, выхода или 401 состояние меняется сразу.
 */
export function useAdminSessionHint(): AdminSessionHint {
  const hint = useSyncExternalStore<AdminSessionHint>(
    subscribeAdminSessionHint,
    getAdminSessionHint,
    unknownOnServer,
  )

  useEffect(() => {
    void checkAdminSession()
    // Возврат на вкладку — повод перепроверить httpOnly-cookie: выход в другой
    // вкладке иначе остался бы незамеченным до первого запроса с 401.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkAdminSession()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return hint
}
