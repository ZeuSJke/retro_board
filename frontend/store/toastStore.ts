import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

export interface Toast {
  id: number
  message: string
  type: 'error' | 'info' | 'success'
}

let nextId = 0
let toasts: Toast[] = []
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

export function showToast(message: string, type: 'error' | 'info' | 'success' = 'info') {
  const id = ++nextId
  toasts = [...toasts, { id, message, type }]
  notify()

  if (typeof window !== 'undefined') {
    if (type === 'error') {
      toast.error(message)
    } else if (type === 'success') {
      toast.success(message)
    } else {
      toast(message)
    }
  }

  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    notify()
  }, 5000)
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  notify()
  if (typeof window !== 'undefined') {
    toast.dismiss()
  }
}

function getSnapshot() {
  return toasts
}

function subscribe(callback: () => void) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export function useToasts() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
