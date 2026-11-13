import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBoardWebSocket } from '../../hooks/useBoardWebSocket'

// Capture the message handler passed to useWebSocket
let wsMessageHandler: ((msg: { event: string; data: unknown }) => void) | null = null
const mockSendMessage = vi.fn()

vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: (_boardId: string, onMessage: (msg: { event: string; data: unknown }) => void) => {
    wsMessageHandler = onMessage
    return { sendMessage: mockSendMessage }
  },
}))

vi.mock('../../store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ username: 'TestUser', theme: { primary: '#6750A4', dark: false }, setUsername: vi.fn(), setCurrentBoard: vi.fn(), setTheme: vi.fn(), currentBoardId: null }),
}))

vi.mock('../../api', () => ({
  getActionItems: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../utils/wsData', () => ({
  asCard: (d: unknown) => d,
  asColumn: (d: unknown) => d,
  asGroup: (d: unknown) => d,
  asActionItem: (d: unknown) => d,
}))

describe('useBoardWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    wsMessageHandler = null
  })

  function setup(params?: Partial<Parameters<typeof useBoardWebSocket>[0]>) {
    return renderHook(() =>
      useBoardWebSocket({
        boardId: 'board-1',
        ...params,
      }),
    )
  }

  it('initializes with empty columns and action items', () => {
    const { result } = setup()
    expect(result.current.columns).toEqual([])
    expect(result.current.actionItems).toEqual([])
    expect(result.current.activeUsers).toEqual([])
    expect(result.current.facilitator).toBeNull()
    expect(result.current.phase).toBeNull()
  })

  it('handles column_created event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'column_created',
        data: { id: 'col-1', board_id: 'board-1', title: 'Good', color: '#6750A4', position: 0 },
      })
    })

    expect(result.current.columns).toHaveLength(1)
    expect(result.current.columns[0].title).toBe('Good')
  })

  it('handles column_updated event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'column_created',
        data: { id: 'col-1', board_id: 'board-1', title: 'Good', color: '#6750A4', position: 0 },
      })
    })

    act(() => {
      wsMessageHandler?.({
        event: 'column_updated',
        data: { id: 'col-1', title: 'Great', color: '#006E1C' },
      })
    })

    expect(result.current.columns[0].title).toBe('Great')
  })

  it('handles column_deleted event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'column_created',
        data: { id: 'col-1', board_id: 'board-1', title: 'Good', color: '#6750A4', position: 0 },
      })
    })

    act(() => {
      wsMessageHandler?.({ event: 'column_deleted', data: { id: 'col-1' } })
    })

    expect(result.current.columns).toHaveLength(0)
  })

  it('handles card_created event', () => {
    const { result } = setup()

    // Create column first
    act(() => {
      wsMessageHandler?.({
        event: 'column_created',
        data: { id: 'col-1', board_id: 'board-1', title: 'Good', color: '#6750A4', position: 0 },
      })
    })

    act(() => {
      wsMessageHandler?.({
        event: 'card_created',
        data: { id: 'card-1', column_id: 'col-1', text: 'Test card', author: 'Alice', position: 0, likes: [], color: '#fff', group_id: null },
      })
    })

    expect(result.current.columns[0].cards).toHaveLength(1)
    expect(result.current.columns[0].cards[0].text).toBe('Test card')
  })

  it('handles card_updated event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'column_created',
        data: { id: 'col-1', board_id: 'board-1', title: 'Good', color: '#6750A4', position: 0 },
      })
    })

    act(() => {
      wsMessageHandler?.({
        event: 'card_created',
        data: { id: 'card-1', column_id: 'col-1', text: 'Test', author: 'Alice', position: 0, likes: [], color: '#fff', group_id: null },
      })
    })

    act(() => {
      wsMessageHandler?.({
        event: 'card_updated',
        data: { id: 'card-1', column_id: 'col-1', text: 'Updated', author: 'Alice', position: 0, likes: ['Bob'], color: '#fff', group_id: null },
      })
    })

    expect(result.current.columns[0].cards[0].text).toBe('Updated')
    expect(result.current.columns[0].cards[0].likes).toEqual(['Bob'])
  })

  it('handles card_deleted event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'column_created',
        data: { id: 'col-1', board_id: 'board-1', title: 'Good', color: '#6750A4', position: 0 },
      })
    })

    act(() => {
      wsMessageHandler?.({
        event: 'card_created',
        data: { id: 'card-1', column_id: 'col-1', text: 'Test', author: 'Alice', position: 0, likes: [], color: '#fff', group_id: null },
      })
    })

    act(() => {
      wsMessageHandler?.({ event: 'card_deleted', data: { id: 'card-1' } })
    })

    expect(result.current.columns[0].cards).toHaveLength(0)
  })

  it('handles presence_update event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'presence_update',
        data: { users: ['Alice', 'Bob'] },
      })
    })

    expect(result.current.activeUsers).toEqual(['Alice', 'Bob'])
  })

  it('handles facilitator_update event', () => {
    const onFacilitatorChanged = vi.fn()
    const { result } = setup({ onFacilitatorChanged })

    act(() => {
      wsMessageHandler?.({
        event: 'facilitator_update',
        data: { facilitator: 'Alice', phase: 'brainstorm' },
      })
    })

    expect(result.current.facilitator).toBe('Alice')
    expect(result.current.phase).toBe('brainstorm')
    expect(onFacilitatorChanged).toHaveBeenCalledWith('Alice', 'brainstorm')
  })

  it('handles phase_update event', () => {
    const onPhaseChanged = vi.fn()
    const { result } = setup({ onPhaseChanged })

    act(() => {
      wsMessageHandler?.({
        event: 'phase_update',
        data: { phase: 'vote' },
      })
    })

    expect(result.current.phase).toBe('vote')
    expect(onPhaseChanged).toHaveBeenCalledWith('vote')
  })

  it('forwards timer events to callback', () => {
    const onTimerWsEvent = vi.fn()
    setup({ onTimerWsEvent })

    act(() => {
      wsMessageHandler?.({
        event: 'timer_start',
        data: { duration: 120, remaining: 120, ts: Date.now() },
      })
    })

    expect(onTimerWsEvent).toHaveBeenCalledWith('timer_start', expect.objectContaining({ duration: 120 }))
  })

  it('handles action_item_created event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'action_item_created',
        data: { id: 'ai-1', board_id: 'board-1', title: 'Task', text: 'Do it', status: 'open', assignee: null, source_card_ids: [] },
      })
    })

    expect(result.current.actionItems).toHaveLength(1)
    expect(result.current.actionItems[0].title).toBe('Task')
  })

  it('handles action_item_updated event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'action_item_created',
        data: { id: 'ai-1', board_id: 'board-1', title: 'Task', text: 'Do it', status: 'open', assignee: null, source_card_ids: [] },
      })
    })

    act(() => {
      wsMessageHandler?.({
        event: 'action_item_updated',
        data: { id: 'ai-1', board_id: 'board-1', title: 'Task Updated', text: 'Do it', status: 'in_progress', assignee: 'Bob', source_card_ids: [] },
      })
    })

    expect(result.current.actionItems[0].title).toBe('Task Updated')
    expect(result.current.actionItems[0].status).toBe('in_progress')
  })

  it('handles action_item_deleted event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'action_item_created',
        data: { id: 'ai-1', board_id: 'board-1', title: 'Task', text: 'Do it', status: 'open', assignee: null, source_card_ids: [] },
      })
    })

    act(() => {
      wsMessageHandler?.({ event: 'action_item_deleted', data: { id: 'ai-1' } })
    })

    expect(result.current.actionItems).toHaveLength(0)
  })

  it('handles cursor_move event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'cursor_move',
        data: { username: 'Alice', x: 100, y: 200 },
      })
    })

    expect(result.current.cursorsRef.current['Alice']).toEqual({ x: 100, y: 200 })
  })

  it('handles cursor_leave event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'cursor_move',
        data: { username: 'Alice', x: 100, y: 200 },
      })
    })

    act(() => {
      wsMessageHandler?.({ event: 'cursor_leave', data: { username: 'Alice' } })
    })

    expect(result.current.cursorsRef.current['Alice']).toBeUndefined()
  })

  it('handles group_collapse event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'group_collapse',
        data: { group_id: 'g-1', collapsed: true },
      })
    })

    expect(result.current.collapsedGroups['g-1']).toBe(true)
  })

  it('handles group_created event', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'column_created',
        data: { id: 'col-1', board_id: 'board-1', title: 'Good', color: '#6750A4', position: 0 },
      })
    })

    act(() => {
      wsMessageHandler?.({
        event: 'group_created',
        data: { id: 'g-1', column_id: 'col-1', title: 'Group 1' },
      })
    })

    expect(result.current.columns[0].groups).toHaveLength(1)
    expect(result.current.columns[0].groups[0].title).toBe('Group 1')
  })

  it('handles group_deleted event and ungroups cards', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'column_created',
        data: { id: 'col-1', board_id: 'board-1', title: 'Good', color: '#6750A4', position: 0 },
      })
    })

    act(() => {
      wsMessageHandler?.({
        event: 'group_created',
        data: { id: 'g-1', column_id: 'col-1', title: 'Group 1' },
      })
    })

    act(() => {
      wsMessageHandler?.({
        event: 'card_created',
        data: { id: 'card-1', column_id: 'col-1', text: 'Card', author: 'Alice', position: 0, likes: [], color: '#fff', group_id: 'g-1' },
      })
    })

    act(() => {
      wsMessageHandler?.({
        event: 'group_deleted',
        data: { id: 'g-1', column_id: 'col-1', card_ids: ['card-1'] },
      })
    })

    expect(result.current.columns[0].groups).toHaveLength(0)
    expect(result.current.columns[0].cards[0].group_id).toBeNull()
  })

  it('does not duplicate action items on re-create', () => {
    const { result } = setup()

    act(() => {
      wsMessageHandler?.({
        event: 'action_item_created',
        data: { id: 'ai-1', board_id: 'board-1', title: 'Task', text: 'Do it', status: 'open', assignee: null, source_card_ids: [] },
      })
    })

    act(() => {
      wsMessageHandler?.({
        event: 'action_item_created',
        data: { id: 'ai-1', board_id: 'board-1', title: 'Task', text: 'Do it', status: 'open', assignee: null, source_card_ids: [] },
      })
    })

    expect(result.current.actionItems).toHaveLength(1)
  })

  it('sendMessage delegates to WebSocket', () => {
    const { result } = setup()

    act(() => {
      result.current.sendMessage({ event: 'test', data: {} })
    })

    expect(mockSendMessage).toHaveBeenCalledWith({ event: 'test', data: {} })
  })

  it('tracks sessionSynced on facilitator_update and resets when boardId changes', () => {
    const { result, rerender } = renderHook(
      ({ boardId }: { boardId: string }) => useBoardWebSocket({ boardId }),
      { initialProps: { boardId: 'board-1' } },
    )

    expect(result.current.sessionSynced).toBe(false)

    act(() => {
      wsMessageHandler?.({
        event: 'facilitator_update',
        data: { facilitator: null, phase: null },
      })
    })

    expect(result.current.sessionSynced).toBe(true)

    rerender({ boardId: 'board-2' })
    expect(result.current.sessionSynced).toBe(false)
  })

  it('forwards board_created, board_updated, board_deleted, and summary_failed callbacks', () => {
    const onBoardCreated = vi.fn()
    const onBoardUpdated = vi.fn()
    const onBoardDeleted = vi.fn()
    const onSummaryFailed = vi.fn()
    setup({ onBoardCreated, onBoardUpdated, onBoardDeleted, onSummaryFailed })

    act(() => {
      wsMessageHandler?.({
        event: 'board_created',
        data: {
          id: 'b-2',
          name: 'New Board',
          slug: 'new-board',
          max_votes: 5,
          created_at: '2026-01-01T00:00:00Z',
          action_items_total: 0,
          action_items_open: 0,
          has_summary: false,
        },
      })
      wsMessageHandler?.({
        event: 'board_updated',
        data: { id: 'b-2', name: 'Renamed', slug: 'renamed', max_votes: 3 },
      })
      wsMessageHandler?.({
        event: 'board_deleted',
        data: { id: 'b-2' },
      })
      wsMessageHandler?.({
        event: 'summary_failed',
        data: { message: 'AI timeout' },
      })
    })

    expect(onBoardCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-2', name: 'New Board' }))
    expect(onBoardUpdated).toHaveBeenCalledWith({ id: 'b-2', name: 'Renamed', slug: 'renamed', max_votes: 3 })
    expect(onBoardDeleted).toHaveBeenCalledWith('b-2')
    expect(onSummaryFailed).toHaveBeenCalledWith('AI timeout')
  })
})
