import { toast } from 'sonner'

export function showToast(message: string, type: 'error' | 'info' | 'success' = 'info') {
  if (typeof window === 'undefined') return
  if (type === 'error') {
    // Одинаковые ошибки не складываются в стопку: несколько запросов, упавших по одной
    // причине (истёкшая сессия, заблокированная доска), дают одно уведомление
    toast.error(message, { id: `error:${message}` })
  } else if (type === 'success') {
    toast.success(message)
  } else {
    toast(message)
  }
}
