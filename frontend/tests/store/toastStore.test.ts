import { describe, it, expect, vi } from 'vitest'
import { showToast, dismissToast, useToasts } from '../../store/toastStore'
import { renderHook, act } from '@testing-library/react'

describe('toastStore', () => {
  it('showToast adds a toast and useToasts returns it', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      showToast('Test message', 'error')
    })

    const toasts = result.current
    expect(toasts.length).toBeGreaterThanOrEqual(1)
    const last = toasts[toasts.length - 1]
    expect(last.message).toBe('Test message')
    expect(last.type).toBe('error')
  })

  it('dismissToast removes a toast', () => {
    const { result } = renderHook(() => useToasts())

    let id: number
    act(() => {
      showToast('Dismiss me', 'info')
      id = result.current[result.current.length - 1].id
    })

    act(() => {
      dismissToast(id!)
    })

    expect(result.current.find((t) => t.id === id)).toBeUndefined()
  })

  it('auto-dismisses after 5 seconds', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToasts())

    act(() => {
      showToast('Auto dismiss', 'info')
    })

    const id = result.current[result.current.length - 1].id

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.find((t) => t.id === id)).toBeUndefined()
    vi.useRealTimers()
  })
})
