import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBoardWebSocket } from '../../hooks/useBoardWebSocket'

let wsMessageHandler: ((msg: { event: string; data: unknown }) => void) | null = null

vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: (_boardId: string, onMessage: (msg: { event: string; data: unknown }) => void) => {
    wsMessageHandler = onMessage
    return { sendMessage: vi.fn(), connected: true }
  },
}))

vi.mock('../../store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ username: 'Анна', participant: { id: 'p-me', name: 'Анна' }, aiEnabled: true }),
}))

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

vi.mock('../../api', () => ({
  getActionItems: vi.fn().mockResolvedValue([]),
}))

describe('useBoardWebSocket — событие summary_generated', () => {
  beforeEach(() => {
    wsMessageHandler = null
  })

  function setup() {
    const onSummaryGenerated = vi.fn()
    renderHook(() => useBoardWebSocket({ boardId: 'board-1', onSummaryGenerated }))
    return onSummaryGenerated
  }

  const emit = (data: unknown) =>
    act(() => {
      wsMessageHandler?.({ event: 'summary_generated', data })
    })

  it('итоги фазы «Итоги»: признака перегенерации нет — окно откроется у всех', () => {
    const onSummaryGenerated = setup()

    // В фазе «Итоги» сервер присылает сами итоги
    emit({ id: 's-1', board_id: 'board-1', summary_text: 'Итоги', key_themes: [], recommendations: [] })

    expect(onSummaryGenerated).toHaveBeenCalledTimes(1)
    expect(onSummaryGenerated).toHaveBeenCalledWith(false)
  })

  it('перегенерация по кнопке: признак regenerated доходит до доски', () => {
    const onSummaryGenerated = setup()

    emit({ summary: { id: 's-1' }, board_id: 'board-1', regenerated: true })

    expect(onSummaryGenerated).toHaveBeenCalledWith(true)
  })

  it('признак принимается только как true: мусор в поле перегенерацией не считается', () => {
    const onSummaryGenerated = setup()

    emit({ board_id: 'board-1', regenerated: 'yes' })

    expect(onSummaryGenerated).toHaveBeenCalledWith(false)
  })
})
