import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBoardWebSocket } from '../../hooks/useBoardWebSocket'

// Capture the message handler passed to useWebSocket
let wsMessageHandler: ((msg: { event: string; data: unknown }) => void) | null = null
let wsOpenHandler: (() => void) | null = null
const mockSendMessage = vi.fn()

vi.mock('../../hooks/useWebSocket', () => ({
  WS_CLOSE_POLICY_VIOLATION: 1008,
  useWebSocket: (
    _boardId: string,
    onMessage: (msg: { event: string; data: unknown }) => void,
    onOpen?: () => void,
  ) => {
    wsMessageHandler = onMessage
    wsOpenHandler = onOpen ?? null
    return {
      sendMessage: mockSendMessage,
      connected: true,
      status: 'open',
      reconnect: vi.fn(),
      stop: vi.fn(),
    }
  },
}))

// Текущий участник — p-me по имени TestUser
vi.mock('../../store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ username: 'TestUser', participant: { id: 'p-me', name: 'TestUser' }, aiEnabled: null, theme: { primary: '#6750A4', dark: false }, setUsername: vi.fn(), setCurrentBoard: vi.fn(), setTheme: vi.fn(), currentBoardId: null }),
}))

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

vi.mock('../../api', () => ({
  getActionItems: vi.fn().mockResolvedValue([]),
  // Перечитывание доски проверяется отдельно (useBoardWebSocket.sync.test.ts)
  getBoard: vi.fn(() => new Promise(() => {})),
}))

import { showToast } from '../../store/toastStore'
import { getBoard } from '../../api'

const COLUMN = { id: 'col-1', board_id: 'board-1', title: 'Good', color: '#6750A4', position: 0 }

function card(id: string, position: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    column_id: 'col-1',
    group_id: null,
    text: `Card ${id}`,
    author: 'Alice',
    author_id: 'p-alice',
    color: '#fff',
    position,
    likes: [],
    masked: false,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

describe('useBoardWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    wsMessageHandler = null
    wsOpenHandler = null
  })

  function emit(event: string, data: unknown) {
    act(() => {
      wsMessageHandler?.({ event, data })
    })
  }

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
    expect(result.current.participants).toEqual([])
    expect(result.current.readyIds).toEqual([])
    expect(result.current.facilitator).toEqual({ id: null, name: null, online: false })
    expect(result.current.phase).toBeNull()
    expect(result.current.myId).toBe('p-me')
  })

  it('отдаёт колонки из снимка сразу, до resetBoard', () => {
    const initial = [{ ...COLUMN, cards: [], groups: [] }]
    const { result } = setup({ initialColumns: initial })

    expect(result.current.columns).toEqual(initial)
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

  it('presence_update: участники с идентификаторами, тёзки — разные записи', () => {
    const { result } = setup()

    emit('presence_update', {
      users: ['Анна', 'Анна', 'Bob'],
      participants: [
        { id: 'p-1', name: 'Анна' },
        { id: 'p-2', name: 'Анна' },
        { id: 'p-3', name: 'Bob' },
      ],
    })

    expect(result.current.participants).toEqual([
      { id: 'p-1', name: 'Анна' },
      { id: 'p-2', name: 'Анна' },
      { id: 'p-3', name: 'Bob' },
    ])
    expect(result.current.knownNames).toEqual({ 'p-1': 'Анна', 'p-2': 'Анна', 'p-3': 'Bob' })
  })

  it('имена ушедших участников остаются известны — ими подписываются голоса', () => {
    const { result } = setup()

    emit('presence_update', { users: ['Анна'], participants: [{ id: 'p-1', name: 'Анна' }] })
    emit('presence_update', { users: [], participants: [] })

    expect(result.current.participants).toEqual([])
    expect(result.current.knownNames).toEqual({ 'p-1': 'Анна' })
  })

  it('facilitator_update: ведущий — участник с идентификатором и признаком «в сети»', () => {
    const onFacilitatorChanged = vi.fn()
    const { result } = setup({ onFacilitatorChanged })

    emit('facilitator_update', {
      facilitator: 'Alice',
      facilitator_id: 'p-alice',
      facilitator_online: true,
      phase: 'brainstorm',
      session_id: 1,
    })

    expect(result.current.facilitator).toEqual({ id: 'p-alice', name: 'Alice', online: true })
    expect(result.current.phase).toBe('brainstorm')
    expect(onFacilitatorChanged).toHaveBeenCalledWith(
      { id: 'p-alice', name: 'Alice', online: true },
      'brainstorm',
    )

    // Ведущий пропал из сети: сессия продолжается, роль можно забрать
    emit('facilitator_update', {
      facilitator: 'Alice',
      facilitator_id: 'p-alice',
      facilitator_online: false,
      phase: 'brainstorm',
      session_id: 1,
    })
    expect(result.current.facilitator).toEqual({ id: 'p-alice', name: 'Alice', online: false })
  })

  it('facilitator_update без ведущего завершает сессию и чистит готовность с фокусом', () => {
    const { result } = setup()

    emit('ready_update', { ready_users: ['Bob'], ready_ids: ['p-bob'] })
    emit('spotlight_update', { card_id: 'card-1' })
    emit('facilitator_update', {
      facilitator: null,
      facilitator_id: null,
      facilitator_online: false,
      phase: null,
      session_id: null,
    })

    expect(result.current.facilitator.id).toBeNull()
    expect(result.current.readyIds).toEqual([])
    expect(result.current.spotlightCardId).toBeNull()
  })

  it('ready_update: готовность считается по идентификаторам участников', () => {
    const { result } = setup()

    emit('ready_update', { ready_users: ['Анна', 'Анна'], ready_ids: ['p-1', 'p-2'] })

    expect(result.current.readyIds).toEqual(['p-1', 'p-2'])
  })

  it('typing_update: печатающие различаются по participant_id', () => {
    const { result } = setup()

    emit('typing_update', {
      typing: [
        { participant_id: 'p-1', username: 'Анна', column_id: 'col-1' },
        { participant_id: 'p-2', username: 'Анна', column_id: 'col-1' },
        { username: 'Без участника', column_id: 'col-1' },
      ],
    })

    expect(result.current.typingUsers).toEqual([
      { participant_id: 'p-1', username: 'Анна', column_id: 'col-1' },
      { participant_id: 'p-2', username: 'Анна', column_id: 'col-1' },
    ])
  })

  it('reaction: в пузыре имя и идентификатор отправителя', () => {
    const { result } = setup()

    emit('reaction', { id: 'r-1', emoji: '🔥', username: 'Анна', participant_id: 'p-1' })

    expect(result.current.reactions).toHaveLength(1)
    expect(result.current.reactions[0]).toMatchObject({
      id: 'r-1',
      emoji: '🔥',
      username: 'Анна',
      participantId: 'p-1',
    })
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

  it('cursor_move: курсоры хранятся по участнику — у тёзок они разные', () => {
    const { result } = setup()

    emit('cursor_move', { participant_id: 'p-1', username: 'Анна', x: 100, y: 200 })
    emit('cursor_move', { participant_id: 'p-2', username: 'Анна', x: 300, y: 400 })

    expect(result.current.cursorsRef.current).toEqual({
      'p-1': { x: 100, y: 200, name: 'Анна' },
      'p-2': { x: 300, y: 400, name: 'Анна' },
    })
  })

  it('cursor_move без участника игнорируется', () => {
    const { result } = setup()
    emit('cursor_move', { username: 'Alice', x: 100, y: 200 })
    expect(result.current.cursorsRef.current).toEqual({})
  })

  it('cursor_leave убирает курсор только этого участника', () => {
    const { result } = setup()

    emit('cursor_move', { participant_id: 'p-1', username: 'Анна', x: 100, y: 200 })
    emit('cursor_move', { participant_id: 'p-2', username: 'Анна', x: 300, y: 400 })
    emit('cursor_leave', { participant_id: 'p-1', username: 'Анна' })

    expect(result.current.cursorsRef.current['p-1']).toBeUndefined()
    expect(result.current.cursorsRef.current['p-2']).toEqual({ x: 300, y: 400, name: 'Анна' })
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
      result.current.sendMessage({ event: 'ready_toggle', data: {} })
    })

    expect(mockSendMessage).toHaveBeenCalledWith({ event: 'ready_toggle', data: {} })
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
        data: { facilitator: null, facilitator_id: null, facilitator_online: false, phase: null },
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

  // ── новый контракт: порядок, видимость, переименование ─────────────────────

  function setupWithCards(ids: string[], params?: Partial<Parameters<typeof useBoardWebSocket>[0]>) {
    const hook = setup(params)
    emit('column_created', COLUMN)
    ids.forEach((id, idx) => emit('card_created', card(id, idx)))
    return hook
  }

  const cardIds = (result: { current: ReturnType<typeof useBoardWebSocket> }, columnIdx = 0) =>
    result.current.columns[columnIdx].cards.map((c) => c.id)

  it('card_moved: порядок берётся из column_card_ids, а не из устаревших позиций', () => {
    const { result } = setupWithCards(['A', 'B', 'C', 'D'])

    // Сервер поставил D на второе место и перенумеровал соседей: A, D, B, C.
    // В событии только сама карточка — у B и C локально остались позиции 1 и 2.
    emit('card_moved', {
      card: card('D', 1),
      old_column_id: 'col-1',
      column_card_ids: ['A', 'D', 'B', 'C'],
      old_column_card_ids: ['A', 'D', 'B', 'C'],
    })

    expect(cardIds(result)).toEqual(['A', 'D', 'B', 'C'])
    // Позиции приведены к присланному порядку — сортировка по ним даёт тот же результат
    expect(result.current.columns[0].cards.map((c) => c.position)).toEqual([0, 1, 2, 3])
  })

  it('card_moved между колонками: обе колонки получают итоговый порядок', () => {
    const { result } = setupWithCards(['A', 'B', 'C'])
    emit('column_created', { ...COLUMN, id: 'col-2', title: 'Bad', position: 1 })
    emit('card_created', card('X', 0, { column_id: 'col-2' }))
    emit('card_created', card('Y', 1, { column_id: 'col-2' }))

    emit('card_moved', {
      card: card('B', 1, { column_id: 'col-2' }),
      old_column_id: 'col-1',
      column_card_ids: ['X', 'B', 'Y'],
      old_column_card_ids: ['A', 'C'],
    })

    expect(cardIds(result, 0)).toEqual(['A', 'C'])
    expect(result.current.columns[0].cards.map((c) => c.position)).toEqual([0, 1])
    expect(cardIds(result, 1)).toEqual(['X', 'B', 'Y'])
    expect(result.current.columns[1].cards.map((c) => c.position)).toEqual([0, 1, 2])
  })

  it('column_updated без cards и groups не затирает содержимое колонки', () => {
    const { result } = setupWithCards(['A', 'B'])
    emit('group_created', { id: 'g-1', column_id: 'col-1', title: 'Group', position: 0 })

    emit('column_updated', { id: 'col-1', board_id: 'board-1', title: 'Great', color: '#006E1C', position: 0 })

    expect(result.current.columns[0].title).toBe('Great')
    expect(cardIds(result)).toEqual(['A', 'B'])
    expect(result.current.columns[0].groups).toHaveLength(1)
  })

  it('column_updated игнорирует cards и groups, даже если они есть в событии', () => {
    const { result } = setupWithCards(['A', 'B'])

    emit('column_updated', { id: 'col-1', title: 'Great', cards: [], groups: [] })

    expect(cardIds(result)).toEqual(['A', 'B'])
  })

  it('masked-карточка кладётся как есть: клиент её не раскрывает и не прячет', () => {
    const { result } = setupWithCards([])

    emit('card_created', card('hidden', 0, { text: '', author: '', author_id: null, masked: true }))
    emit('card_created', card('mine', 1, { author: 'TestUser', author_id: 'p-me' }))

    const cards = result.current.columns[0].cards
    expect(cards[0]).toMatchObject({ id: 'hidden', masked: true, text: '', author_id: null })
    expect(cards[1]).toMatchObject({ id: 'mine', masked: false, author_id: 'p-me' })

    // После раскрытия сервер присылает ту же карточку уже с содержимым
    emit('card_updated', card('hidden', 0, { text: 'Секрет', author: 'Alice' }))
    expect(result.current.columns[0].cards[0]).toMatchObject({ masked: false, text: 'Секрет' })
  })

  it('cards_visibility_changed перечитывает доску с сервера', () => {
    setup()

    emit('cards_visibility_changed', {})

    expect(getBoard).toHaveBeenCalledWith('board-1')
  })

  it('participant_renamed обновляет имя у карточек этого участника, в составе доски и у ведущего', () => {
    const onParticipantRenamed = vi.fn()
    const { result } = setupWithCards([], { onParticipantRenamed })
    emit('card_created', card('c1', 0, { author: 'Анна', author_id: 'p-1' }))
    emit('card_created', card('c2', 1, { author: 'Анна', author_id: 'p-2' }))
    emit('card_created', card('c3', 2, { author: 'Участник', author_id: null }))
    emit('presence_update', {
      users: ['Анна', 'Анна'],
      participants: [
        { id: 'p-1', name: 'Анна' },
        { id: 'p-2', name: 'Анна' },
      ],
    })
    emit('facilitator_update', {
      facilitator: 'Анна',
      facilitator_id: 'p-1',
      facilitator_online: true,
      phase: 'discuss',
    })
    emit('cursor_move', { participant_id: 'p-1', username: 'Анна', x: 1, y: 2 })
    emit('typing_update', { typing: [{ participant_id: 'p-1', username: 'Анна', column_id: 'col-1' }] })

    emit('participant_renamed', { participant_id: 'p-1', name: 'Анна Петрова' })

    const authors = result.current.columns[0].cards.map((c) => c.author)
    // Тёзка (p-2) и анонимная карточка не затронуты
    expect(authors).toEqual(['Анна Петрова', 'Анна', 'Участник'])
    expect(result.current.participants).toEqual([
      { id: 'p-1', name: 'Анна Петрова' },
      { id: 'p-2', name: 'Анна' },
    ])
    expect(result.current.knownNames['p-1']).toBe('Анна Петрова')
    expect(result.current.facilitator).toEqual({ id: 'p-1', name: 'Анна Петрова', online: true })
    expect(result.current.cursorsRef.current['p-1'].name).toBe('Анна Петрова')
    expect(result.current.typingUsers[0].username).toBe('Анна Петрова')
    expect(onParticipantRenamed).toHaveBeenCalledWith('p-1', 'Анна Петрова')
  })

  it('auto_cluster_completed: чужая группировка — уведомление, своя — без него', () => {
    setup()

    emit('auto_cluster_completed', {
      column_id: 'col-1',
      groups_count: 2,
      username: 'Alice',
      participant_id: 'p-alice',
    })
    expect(showToast).toHaveBeenCalledWith('Alice сгруппировал(а) карточки', 'info')

    vi.mocked(showToast).mockClear()
    emit('auto_cluster_completed', {
      column_id: 'col-1',
      groups_count: 2,
      username: 'TestUser',
      participant_id: 'p-me',
    })
    expect(showToast).not.toHaveBeenCalled()
  })

  it('auto_cluster_completed: «это запустил я» — по идентификатору, а не по имени', () => {
    setup()

    // Тёзка: имя совпадает с моим, но это другой участник — уведомление нужно
    emit('auto_cluster_completed', {
      column_id: 'col-1',
      groups_count: 1,
      username: 'TestUser',
      participant_id: 'p-namesake',
    })
    expect(showToast).toHaveBeenCalledWith('TestUser сгруппировал(а) карточки', 'info')

    // Моя группировка под другим именем (сменил имя в другой вкладке) — уведомления нет
    vi.mocked(showToast).mockClear()
    emit('auto_cluster_completed', {
      column_id: 'col-1',
      groups_count: 1,
      username: 'Старое имя',
      participant_id: 'p-me',
    })
    expect(showToast).not.toHaveBeenCalled()
  })

  it('summary_generated сообщает, были ли итоги пересозданы по кнопке', () => {
    const onSummaryGenerated = vi.fn()
    setup({ onSummaryGenerated })

    emit('summary_generated', { summary_text: 'Итоги' })
    expect(onSummaryGenerated).toHaveBeenLastCalledWith(false)

    emit('summary_generated', { summary: {}, board_id: 'board-1', regenerated: true })
    expect(onSummaryGenerated).toHaveBeenLastCalledWith(true)
  })

  it('при подключении запрашивает состав доски, не называя себя: личность задаёт сессия', () => {
    setup()

    act(() => {
      wsOpenHandler?.()
    })

    expect(mockSendMessage).toHaveBeenCalledWith({ event: 'identify', data: {} })
  })

  it('курсор и уход с доски отправляются без имени', () => {
    const { result } = setup()
    const boardEl = {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      scrollLeft: 0,
      scrollTop: 0,
    } as unknown as HTMLDivElement

    act(() => {
      result.current.handleMouseMove({ clientX: 40, clientY: 60 } as React.MouseEvent, boardEl)
      result.current.handleMouseLeave()
    })

    expect(mockSendMessage).toHaveBeenCalledWith({ event: 'cursor_move', data: { x: 40, y: 60 } })
    expect(mockSendMessage).toHaveBeenCalledWith({ event: 'cursor_leave', data: {} })
  })

  it('неизвестные события (health check и т. п.) не ломают состояние', () => {
    const { result } = setupWithCards(['A'])

    emit('health_check_requested', { requested_by: 'Alice', participant_id: 'p-alice' })
    emit('roti_requested', {})
    emit('pong', {})

    expect(cardIds(result)).toEqual(['A'])
  })

  it('события health check уходят владельцу и дальше не разбираются', () => {
    const onServerEvent = vi.fn((msg: { event: string }) => msg.event.startsWith('health_') || msg.event === 'roti_requested')
    const { result } = setupWithCards(['A'], { onServerEvent })

    emit('health_check_requested', { requested_by: 'Alice', participant_id: 'p-alice' })
    emit('health_updated', { board_id: 'board-1', questions: [] })
    emit('roti_requested', {})

    const seen = onServerEvent.mock.calls.map(([msg]) => msg.event)
    expect(seen).toEqual(expect.arrayContaining(['health_check_requested', 'health_updated', 'roti_requested']))
    expect(cardIds(result)).toEqual(['A'])
  })

  it('groups_collapsed и group_collapse синхронизируют свёрнутые группы; group_deleted и смена boardId очищают состояние', () => {
    const callbacks = {
      onTimerWsEvent: vi.fn(),
      onFacilitatorChanged: vi.fn(),
      onPhaseChanged: vi.fn(),
      onBoardUpdated: vi.fn(),
      onBoardDeleted: vi.fn(),
    }
    const { result, rerender } = renderHook(
      ({ boardId }: { boardId: string }) =>
        useBoardWebSocket({
          boardId,
          ...callbacks,
        }),
      { initialProps: { boardId: 'board-1' } },
    )

    // Снимок свёрнутых групп на старте/переподключении заменяет старое состояние
    act(() => {
      wsOpenHandler?.()
    })
    emit('groups_collapsed', { group_ids: ['g-1', 'g-2'] })
    expect(result.current.collapsedGroups).toEqual({ 'g-1': true, 'g-2': true })

    // Инкрементальное переключение и удаление одной группы
    emit('group_collapse', { group_id: 'g-3', collapsed: true })
    emit('group_collapse', { group_id: 'g-1', collapsed: false })
    expect(result.current.collapsedGroups).toEqual({ 'g-1': false, 'g-2': true, 'g-3': true })

    emit('group_deleted', { id: 'g-2', column_id: 'col-1' })
    expect(result.current.collapsedGroups).toEqual({ 'g-1': false, 'g-3': true })

    // При переподключении без groups_collapsed в пачке присутствия свёрнутые группы сбрасываются
    act(() => {
      wsOpenHandler?.()
    })
    emit('presence_update', { participants: [{ id: 'p-me', name: 'TestUser' }] })
    expect(result.current.collapsedGroups).toEqual({})

    // Заполняем снова и проверяем сброс при смене boardId
    emit('groups_collapsed', { group_ids: ['g-9'] })
    expect(result.current.collapsedGroups).toEqual({ 'g-9': true })

    act(() => {
      rerender({ boardId: 'board-2' })
    })
    expect(result.current.collapsedGroups).toEqual({})
  })
})
