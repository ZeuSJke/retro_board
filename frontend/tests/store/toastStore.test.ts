import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('sonner', () => ({ toast: toastMock }))

import { showToast } from '../../store/toastStore'

describe('showToast', () => {
  beforeEach(() => {
    toastMock.mockClear()
    toastMock.error.mockClear()
    toastMock.success.mockClear()
  })

  it('по умолчанию показывает информационное уведомление', () => {
    showToast('Сообщение')
    expect(toastMock).toHaveBeenCalledWith('Сообщение')
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('ошибка и успех уходят в соответствующие варианты sonner', () => {
    showToast('Не получилось', 'error')
    showToast('Готово', 'success')
    // У ошибки есть id по тексту: одинаковые сообщения не складываются в стопку
    expect(toastMock.error).toHaveBeenCalledWith('Не получилось', { id: 'error:Не получилось' })
    expect(toastMock.success).toHaveBeenCalledWith('Готово')
    expect(toastMock).not.toHaveBeenCalled()
  })
})
