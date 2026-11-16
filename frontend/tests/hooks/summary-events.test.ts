import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBoardSummary } from '../../hooks/useBoardSummary'
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

const apiMocks = vi.hoisted(() => ({
  getActionItems: vi.fn().mockResolvedValue([]),
  getBoardSummary: vi.fn(),
}))

vi.mock('../../api', () => apiMocks)

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

describe('useBoardSummary — защита от устаревшего ответа', () => {
  beforeEach(() => {
    apiMocks.getBoardSummary.mockReset()
  })

  it('игнорирует поздний ответ getBoardSummary после переключения boardId', async () => {
    let resolveFirst!: (val: {
      id: string
      board_id: string
      summary_text: string
      key_themes: string[]
      recommendations: string[]
      created_at: string
    }) => void
    apiMocks.getBoardSummary.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )

    const { result, rerender } = renderHook(
      ({ boardId }: { boardId: string }) =>
        useBoardSummary({ boardId, hasSummary: true, onMarkHasSummary: vi.fn() }),
      { initialProps: { boardId: 'board-1' } },
    )

    act(() => {
      result.current.openSummary()
    })
    rerender({ boardId: 'board-2' })

    let resolveSecond!: (val: {
      id: string
      board_id: string
      summary_text: string
      key_themes: string[]
      recommendations: string[]
      created_at: string
    }) => void
    apiMocks.getBoardSummary.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve
        }),
    )
    act(() => {
      result.current.openSummary()
    })

    await act(async () => {
      resolveFirst({
        id: 'sum-old',
        board_id: 'board-1',
        summary_text: 'Старые итоги',
        key_themes: [],
        recommendations: [],
        created_at: '2026-11-15T10:00:00Z',
      })
      await Promise.resolve()
    })

    expect(result.current.summary).toBeNull()
    expect(result.current.summaryLoading).toBe(true)

    await act(async () => {
      resolveSecond({
        id: 'sum-new',
        board_id: 'board-2',
        summary_text: 'Новые итоги',
        key_themes: [],
        recommendations: [],
        created_at: '2026-11-15T10:01:00Z',
      })
      await Promise.resolve()
    })

    expect(result.current.summary?.id).toBe('sum-new')
    expect(result.current.summaryLoading).toBe(false)
  })
})
