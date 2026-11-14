/**
 * Сообщения об ошибках API и защита от двойных уведомлений.
 *
 * Перехватчик ответов (`api/index.ts`) показывает общий тост только для ошибок, о которых
 * никто не сообщил сам. Вызов `getApiErrorMessage` означает «это сообщение сейчас увидит
 * пользователь» и помечает ошибку — второго тоста от перехватчика не будет.
 */

const reportedErrors = new WeakSet<object>()

/** Пометить ошибку как показанную пользователю (или намеренно обработанную без сообщения). */
export function markApiErrorReported(error: unknown): void {
  if (error != null && typeof error === 'object') {
    reportedErrors.add(error)
  }
}

export function isApiErrorReported(error: unknown): boolean {
  return error != null && typeof error === 'object' && reportedErrors.has(error)
}

/** HTTP-статус ответа, если ошибка пришла от сервера. */
export function getApiErrorStatus(error: unknown): number | undefined {
  if (error != null && typeof error === 'object') {
    const status = (error as { response?: { status?: unknown } }).response?.status
    if (typeof status === 'number') return status
  }
  return undefined
}

export const SESSION_EXPIRED_MESSAGE = 'Сессия завершилась — войдите снова'
export const RATE_LIMIT_MESSAGE = 'Слишком много запросов. Подождите немного.'

/**
 * Понятный текст ошибки API (обычно Axios) для показа пользователю.
 * Помечает ошибку как показанную — см. описание модуля.
 */
export function getApiErrorMessage(error: unknown, fallback = 'Произошла ошибка'): string {
  markApiErrorReported(error)
  const status = getApiErrorStatus(error)
  // У этих статусов текст сервера служебный и на английском — заменяем своим
  if (status === 401) return SESSION_EXPIRED_MESSAGE
  if (status === 429) return RATE_LIMIT_MESSAGE
  if (error != null && typeof error === 'object') {
    const err = error as { response?: { data?: { detail?: string } } }
    const detail = err.response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }
  }
  return fallback
}
