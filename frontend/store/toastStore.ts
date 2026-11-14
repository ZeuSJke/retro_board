import { toast } from 'sonner'

export function showToast(message: string, type: 'error' | 'info' | 'success' = 'info') {
  if (typeof window === 'undefined') return
  if (type === 'error') {
    toast.error(message)
  } else if (type === 'success') {
    toast.success(message)
  } else {
    toast(message)
  }
}
