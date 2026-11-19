import { toast } from 'sonner'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** Пояснение под заголовком: что произошло и что делать дальше. */
  description?: string
  /** Сколько показывать, мс. Длинному тексту нужно больше стандартных четырёх секунд. */
  duration?: number
  /** Кнопка быстрого действия (например, «Отменить»). */
  action?: ToastAction
}

export function showToast(
  message: string,
  type: 'error' | 'info' | 'success' = 'info',
  options?: ToastOptions,
) {
  if (typeof window === 'undefined') return
  if (type === 'error') {
    // Одинаковые ошибки не складываются в стопку: несколько запросов, упавших по одной
    // причине (истёкшая сессия, заблокированная доска), дают одно уведомление
    toast.error(message, { id: `error:${message}`, ...options })
  } else if (type === 'success') {
    if (options) toast.success(message, options)
    else toast.success(message)
  } else if (options) {
    toast(message, options)
  } else {
    toast(message)
  }
}
