import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBoardWebSocket } from '../../hooks/useBoardWebSocket'
import type { ActionItem, Board, Card, Column, WsMessage } from '../../types'

// ── Сокет: управляем открытием, закрытием и входящими сообщениями ────────────

interface CloseInfo {
  code: number
  reason: string
  wasOpen: boolean
  failedAttempts: number
}

interface SocketDouble {
  onMessage: ((msg: WsMessage) => void) | null
  onOpen: ((info: { reconnected: boolean }) => void) | null
  onClose: ((info: CloseInfo) => void) | null
  status: 'connecting' | 'open' | 'reconnecting' | 'closed'
  sendMessage: ReturnType<typeof vi.fn>
  reconnect: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

const socket = vi.hoisted(
  (): SocketDouble => ({
    onMessage: null,
    onOpen: null,
    onClose: null,
    status: 'open',
    sendMessage: vi.fn(),
    reconnect: vi.fn(),
    stop: vi.fn(),
  }),
)

vi.mock('../../hooks/useWebSocket', () => ({
  WS_CLOSE_POLICY_VIOLATION: 1008,
  useWebSocket: (
    _boardId: string,
    onMessage: (msg: WsMessage) => void,
    onOpen: (info: { reconnected: boolean }) => void,
    options: { onClose: typeof socket.onClose },
  ) => {
    socket.onMessage = onMessage
    socket.onOpen = onOpen
    socket.onClose = options?.onClose ?? null
    return {
      sendMessage: socket.sendMessage,
      connected: socket.status === 'open',
      status: socket.status,
      reconnect: socket.reconnect,
      stop: socket.stop,
    }
  },
}))

vi.mock('../../store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ username: 'Я', participant: { id: 'p-me', name: 'Я' } }),
}))

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

const api = vi.hoisted(() => ({
  getBoard: vi.fn(),
  getActionItems: vi.fn(),
}))

vi.mock('../../api', () => api)

// ── Данные ───────────────────────────────────────────────────────────────────

function card(id: string, position: number, extra: Partial<Card> = {}): Card {
  return {
    id,
    column_id: 'col-1',
    group_id: null,
    text: `Карточка ${id}`,
    author: 'Анна',
    author_id: 'p-anna',
    color: '#FFFFFF',
    position,
    likes: [],
    masked: false,
    created_at: `2026-01-01T00:00:0${position}Z`,
    ...extra,
  }
}

function column(cards: Card[]): Column {
  return { id: 'col-1', board_id: 'board-1', title: 'Хорошо', color: '#10B981', position: 0, cards, groups: [] }
}

function board(seq: number, cards: Card[], extra: Partial<Board> = {}): Board {
  return {
    id: 'board-1',
    name: 'Спринт',
    slug: 'sprint',
    max_votes: 5,
    created_at: '2026-01-01T00:00:00Z',
    event_seq: seq,
    event_epoch: 'e1',
    columns: [column(cards)],
    moods: [],
    ...extra,
  }
}

function actionItem(id: string): ActionItem {
  return {
    id,
    board_id: 'board-1',
    title: `Задача ${id}`,
    text: '',
    assignee: null,
    source_card_ids: [],
    status: 'open',
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
  }
}

/** Обещание, которое выполняется по команде теста. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

type Hook = { current: ReturnType<typeof useBoardWebSocket> }
const cardIds = (result: Hook) => result.current.columns[0]?.cards.map((c) => c.id) ?? []

function emit(event: string, data: unknown, seq?: number, epoch = 'e1') {
  act(() => {
    socket.onMessage?.({
      event,
      data: data as Record<string, unknown>,
      ...(seq !== undefined ? { seq, epoch } : {}),
    })
  })
}

function setup(params: Partial<Parameters<typeof useBoardWebSocket>[0]> = {}, initial = board(5, [card('A', 0), card('B', 1)])) {
  const hook = renderHook(() => useBoardWebSocket({ boardId: 'board-1', ...params }))
  act(() => {
    hook.result.current.resetBoard(initial)
  })
  return hook
}

/** Открыть сокет и дождаться первой сверки (на сервере ничего не изменилось). */
async function openInSync(result: Hook, seq = 5, cards = [card('A', 0), card('B', 1)]) {
  api.getBoard.mockResolvedValueOnce(board(seq, cards))
  act(() => {
    socket.onOpen?.({ reconnected: false })
  })
  await flush()
  api.getBoard.mockClear()
  api.getActionItems.mockClear()
}

beforeEach(() => {
  vi.clearAllMocks()
  socket.status = 'open'
  api.getActionItems.mockResolvedValue([])
  api.getBoard.mockImplementation(() => new Promise(() => {}))
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Номера событий ───────────────────────────────────────────────────────────

describe('номера событий', () => {
  it('событие, следующее по номеру, применяется', async () => {
    const { result } = setup()
    await openInSync(result)

    emit('card_created', card('C', 2), 6)

    expect(cardIds(result)).toEqual(['A', 'B', 'C'])
    expect(api.getBoard).not.toHaveBeenCalled()
  })

  it('событие с номером не больше номера снимка пропускается: оно уже вошло в снимок', async () => {
    const { result } = setup()
    await openInSync(result)

    // Устаревший текст карточки под номером, который снимок уже учёл
    emit('card_updated', card('A', 0, { text: 'Старый текст' }), 5)
    emit('card_deleted', { id: 'B' }, 4)

    expect(cardIds(result)).toEqual(['A', 'B'])
    expect(result.current.columns[0].cards[0].text).toBe('Карточка A')
    expect(api.getBoard).not.toHaveBeenCalled()
  })

  it('пропуск в номерах: доска перечитывается, событие применяется поверх снимка', async () => {
    const { result } = setup()
    await openInSync(result)

    // Шестое событие потерялось: в снимке сервера карточка C, созданная им, есть
    api.getBoard.mockResolvedValueOnce(board(6, [card('A', 0), card('B', 1), card('C', 2)]))
    emit('card_created', card('D', 3), 7)
    expect(api.getBoard).toHaveBeenCalledWith('board-1')
    // Пока снимка нет, событие не применено
    expect(cardIds(result)).toEqual(['A', 'B'])
    await flush()

    expect(cardIds(result)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('смена поколения нумерации (рестарт сервера) — перечитать доску', async () => {
    const { result } = setup()
    await openInSync(result)

    api.getBoard.mockResolvedValueOnce(
      board(1, [card('A', 0), card('Z', 1)], { event_epoch: 'e2' }),
    )
    emit('card_created', card('Z', 1), 1, 'e2')
    await flush()

    expect(cardIds(result)).toEqual(['A', 'Z'])
    // Дальше отсчёт идёт в новом поколении
    emit('card_created', card('Y', 2), 2, 'e2')
    expect(cardIds(result)).toEqual(['A', 'Z', 'Y'])
  })

  it('события без номера (курсоры, присутствие, таймер) применяются всегда', async () => {
    const onTimerWsEvent = vi.fn()
    const { result } = setup({ onTimerWsEvent })
    await openInSync(result)

    emit('presence_update', { participants: [{ id: 'p-anna', name: 'Анна' }] })
    emit('timer_start', { duration: 60, remaining: 60 })

    expect(result.current.participants).toEqual([{ id: 'p-anna', name: 'Анна' }])
    expect(onTimerWsEvent).toHaveBeenCalledWith('timer_start', { duration: 60, remaining: 60 })
  })

  it('события, пришедшие за время чтения снимка, не теряются и не применяются дважды', async () => {
    const { result } = setup()
    await openInSync(result)

    const pending = deferred<Board>()
    api.getBoard.mockReturnValueOnce(pending.promise)
    emit('cards_visibility_changed', {}, 6)

    // Пока идёт чтение: седьмое событие сервер успел включить в снимок, восьмое — нет
    emit('card_created', card('C', 2), 7)
    emit('card_created', card('D', 3), 8)
    expect(cardIds(result)).toEqual(['A', 'B'])

    await act(async () => {
      pending.resolve(board(7, [card('A', 0), card('B', 1), card('C', 2)]))
      await Promise.resolve()
    })
    await flush()

    expect(cardIds(result)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('событие, которое сервер посчитал вошедшим в снимок во время чтения, — повод перечитать ещё раз', async () => {
    const { result } = setup()
    await openInSync(result)

    const first = deferred<Board>()
    api.getBoard.mockReturnValueOnce(first.promise)
    emit('cards_visibility_changed', {}, 6)
    emit('card_created', card('C', 2), 7)

    // Снимок с номером 7 собран до того, как карточка C попала в базу: её в нём нет
    api.getBoard.mockResolvedValueOnce(board(7, [card('A', 0), card('B', 1), card('C', 2)]))
    await act(async () => {
      first.resolve(board(7, [card('A', 0), card('B', 1)]))
      await Promise.resolve()
    })
    await flush()

    expect(api.getBoard).toHaveBeenCalledTimes(2)
    expect(cardIds(result)).toEqual(['A', 'B', 'C'])
  })
})

// ── Подключение и переподключение ────────────────────────────────────────────

describe('подключение', () => {
  it('первое подключение сверяет номер событий: если он тот же, доска и задачи не перечитываются', async () => {
    const onBoardSnapshot = vi.fn()
    const onResynced = vi.fn()
    const { result } = setup({ onBoardSnapshot, onResynced })
    api.getBoard.mockResolvedValueOnce(board(5, [card('A', 0), card('B', 1)]))
    api.getActionItems.mockClear()
    const before = result.current.columns

    act(() => {
      socket.onOpen?.({ reconnected: false })
    })
    await flush()

    expect(api.getBoard).toHaveBeenCalledTimes(1)
    // Между снимком страницы и подпиской ничего не произошло
    expect(result.current.columns).toBe(before)
    expect(api.getActionItems).not.toHaveBeenCalled()
    expect(onBoardSnapshot).not.toHaveBeenCalled()
    expect(onResynced).not.toHaveBeenCalled()
  })

  it('первое подключение закрывает «дыру» между снимком страницы и подпиской на события', async () => {
    const onBoardSnapshot = vi.fn()
    const { result } = setup({ onBoardSnapshot })
    // Пока страница грузилась, на доске появилась карточка C (событие 6) — сокета ещё не было
    const fresh = board(6, [card('A', 0), card('B', 1), card('C', 2)])
    api.getBoard.mockResolvedValueOnce(fresh)
    api.getActionItems.mockResolvedValue([actionItem('t1')])

    act(() => {
      socket.onOpen?.({ reconnected: false })
    })
    await flush()

    expect(cardIds(result)).toEqual(['A', 'B', 'C'])
    expect(result.current.actionItems.map((i) => i.id)).toEqual(['t1'])
    expect(onBoardSnapshot).toHaveBeenCalledWith(fresh)
  })

  it('после переподключения доска и задачи перечитываются всегда', async () => {
    const onBoardSnapshot = vi.fn()
    const onResynced = vi.fn()
    const { result } = setup({ onBoardSnapshot, onResynced })
    await openInSync(result)

    // Пока связи не было, удалили карточку B и добавили задачу; номер событий вырос
    const fresh = board(9, [card('A', 0)])
    api.getBoard.mockResolvedValueOnce(fresh)
    api.getActionItems.mockResolvedValueOnce([actionItem('t2')])
    act(() => {
      socket.onClose?.({ code: 1006, reason: '', wasOpen: true, failedAttempts: 0 })
      socket.onOpen?.({ reconnected: true })
    })
    await flush()

    expect(cardIds(result)).toEqual(['A'])
    expect(result.current.actionItems.map((i) => i.id)).toEqual(['t2'])
    expect(onBoardSnapshot).toHaveBeenCalledWith(fresh)
    expect(onResynced).toHaveBeenCalledWith('reconnect')
  })

  it('после переподключения перечитывает доску, даже если номер событий не изменился', async () => {
    const { result } = setup()
    await openInSync(result)

    // Имя автора сменили событием без номера, пока связи не было
    api.getBoard.mockResolvedValueOnce(board(5, [card('A', 0, { author: 'Анна Петрова' }), card('B', 1)]))
    act(() => {
      socket.onOpen?.({ reconnected: true })
    })
    await flush()

    expect(result.current.columns[0].cards[0].author).toBe('Анна Петрова')
    expect(api.getActionItems).toHaveBeenCalledTimes(1)
  })

  it('после переподключения события копятся до снимка, даже если идут по порядку', async () => {
    const { result } = setup()
    await openInSync(result)

    const pending = deferred<Board>()
    api.getBoard.mockReturnValueOnce(pending.promise)
    act(() => {
      socket.onOpen?.({ reconnected: true })
    })
    // Пока связи не было, прошли события 6 и 7; первым после подключения пришло 8
    emit('card_created', card('E', 4), 8)
    expect(cardIds(result)).toEqual(['A', 'B'])

    await act(async () => {
      pending.resolve(board(7, [card('A', 0), card('B', 1), card('C', 2), card('D', 3)]))
      await Promise.resolve()
    })
    await flush()

    expect(cardIds(result)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('запрашивает состав доски при каждом открытии сокета', () => {
    setup()
    act(() => {
      socket.onOpen?.({ reconnected: false })
    })
    expect(socket.sendMessage).toHaveBeenCalledWith({ event: 'identify', data: {} })
  })
})

// ── Состояние связи для баннера ──────────────────────────────────────────────

describe('состояние связи', () => {
  it('online → reconnecting → syncing → online', async () => {
    const { result, rerender } = setup()
    await openInSync(result)
    expect(result.current.connection).toBe('online')

    socket.status = 'reconnecting'
    act(() => {
      socket.onClose?.({ code: 1006, reason: '', wasOpen: true, failedAttempts: 0 })
    })
    rerender()
    expect(result.current.connection).toBe('reconnecting')

    // Связь вернулась: пока доска не перечитана, баннер не исчезает
    const pending = deferred<Board>()
    api.getBoard.mockReturnValueOnce(pending.promise)
    socket.status = 'open'
    act(() => {
      socket.onOpen?.({ reconnected: true })
    })
    rerender()
    expect(result.current.connection).toBe('syncing')

    await act(async () => {
      pending.resolve(board(5, [card('A', 0), card('B', 1)]))
      await Promise.resolve()
    })
    await flush()
    expect(result.current.connection).toBe('online')
  })

  it('доску не удаётся перечитать: состояние sync-failed и повтор с нарастающей паузой', async () => {
    vi.useFakeTimers()
    const { result } = setup()
    api.getBoard.mockRejectedValueOnce({ response: { status: 500 } })
    act(() => {
      socket.onOpen?.({ reconnected: true })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.connection).toBe('sync-failed')
    expect(api.getBoard).toHaveBeenCalledTimes(1)

    api.getBoard.mockResolvedValueOnce(board(6, [card('A', 0)]))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(api.getBoard).toHaveBeenCalledTimes(2)
    expect(result.current.connection).toBe('online')
    expect(cardIds(result)).toEqual(['A'])
  })

  it('без связи перечитывание не повторяется по таймеру: оно случится при подключении', async () => {
    vi.useFakeTimers()
    socket.status = 'reconnecting'
    const { result } = setup()
    api.getBoard.mockRejectedValue(new Error('Network Error'))

    act(() => {
      result.current.resync('rejected')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })

    expect(api.getBoard).toHaveBeenCalledTimes(1)
  })
})

// ── Доска или сессия пропали ─────────────────────────────────────────────────

describe('сервер отказывает в подключении', () => {
  it('отказ при рукопожатии: если доски больше нет (404) — подключение останавливается', async () => {
    const onBoardGone = vi.fn()
    const { result } = setup({ onBoardGone })
    api.getBoard.mockRejectedValueOnce({ response: { status: 404 } })

    act(() => {
      socket.onClose?.({ code: 1006, reason: '', wasOpen: false, failedAttempts: 1 })
    })
    await flush()

    expect(socket.stop).toHaveBeenCalled()
    expect(onBoardGone).toHaveBeenCalledTimes(1)
    expect(result.current.connection).toBe('closed')
  })

  it('обычный обрыв связи проверки доступа не вызывает', async () => {
    setup()
    act(() => {
      socket.onClose?.({ code: 1006, reason: '', wasOpen: true, failedAttempts: 0 })
    })
    await flush()
    expect(api.getBoard).not.toHaveBeenCalled()
  })

  it('код 1008: проверяет доступ запросом — истёкшую сессию обработает перехватчик API', async () => {
    const onBoardGone = vi.fn()
    setup({ onBoardGone })
    api.getBoard.mockRejectedValueOnce({ response: { status: 401 } })

    act(() => {
      socket.onClose?.({ code: 1008, reason: 'Session ended', wasOpen: true, failedAttempts: 0 })
    })
    await flush()

    expect(api.getBoard).toHaveBeenCalledWith('board-1')
    expect(onBoardGone).not.toHaveBeenCalled()
    expect(socket.stop).not.toHaveBeenCalled()
  })

  it('повторные отказы при рукопожатии проверяют доступ не на каждой попытке', async () => {
    setup()
    api.getBoard.mockRejectedValue(new Error('Network Error'))
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      act(() => {
        socket.onClose?.({ code: 1006, reason: '', wasOpen: false, failedAttempts: attempt })
      })
    }
    await flush()
    // Попытки 1, 4 и 8
    expect(api.getBoard).toHaveBeenCalledTimes(3)
  })

  it('перечитывание получило 404 — доска удалена: остановка и уведомление владельца', async () => {
    const onBoardGone = vi.fn()
    const { result } = setup({ onBoardGone })
    api.getBoard.mockRejectedValueOnce({ response: { status: 404 } })

    act(() => {
      socket.onOpen?.({ reconnected: true })
    })
    await flush()

    expect(socket.stop).toHaveBeenCalled()
    expect(onBoardGone).toHaveBeenCalledTimes(1)
    expect(result.current.connection).toBe('closed')
  })
})

// ── Ответ REST против события сокета ─────────────────────────────────────────

describe('applyChange: один путь для оптимистичной правки, ответа REST и события', () => {
  it('запоздавший ответ REST не затирает более свежее событие сокета', async () => {
    const { result } = setup()
    await openInSync(result)

    // Я лайкнул (запрос в пути). Событие о моём лайке (6) и о лайке Боба (7) пришли раньше ответа
    emit('card_updated', card('A', 0, { likes: ['p-me'] }), 6)
    emit('card_updated', card('A', 0, { likes: ['p-me', 'p-bob'] }), 7)
    act(() => {
      result.current.applyChange({ type: 'card_updated', card: card('A', 0, { likes: ['p-me'] }) }, 'rest')
    })

    expect(result.current.columns[0].cards[0].likes).toEqual(['p-me', 'p-bob'])
  })

  it('ответ REST применяется, если события сокета ещё не было', async () => {
    const { result } = setup()
    await openInSync(result)

    act(() => {
      result.current.applyChange({ type: 'card_updated', card: card('A', 0, { text: 'Сохранено' }) }, 'rest')
    })
    expect(result.current.columns[0].cards[0].text).toBe('Сохранено')

    // Событие с теми же данными приходит следом и ничего не ломает
    emit('card_updated', card('A', 0, { text: 'Сохранено' }), 6)
    expect(result.current.columns[0].cards[0].text).toBe('Сохранено')
  })

  it('карточка из ответа REST и из события не дублируется, порядок прихода не важен', async () => {
    const { result } = setup()
    await openInSync(result)
    const created = card('C', 2)

    // Сначала ответ, потом событие
    act(() => {
      result.current.applyChange({ type: 'card_created', card: created }, 'rest')
    })
    emit('card_created', created, 6)
    expect(cardIds(result)).toEqual(['A', 'B', 'C'])

    // Сначала событие (и правка следом), потом запоздавший ответ
    const second = card('D', 3)
    emit('card_created', second, 7)
    emit('card_updated', { ...second, text: 'Уже отредактирована' }, 8)
    act(() => {
      result.current.applyChange({ type: 'card_created', card: second }, 'rest')
    })
    expect(cardIds(result)).toEqual(['A', 'B', 'C', 'D'])
    expect(result.current.columns[0].cards[3].text).toBe('Уже отредактирована')
  })

  it('оптимистичная правка применяется всегда', async () => {
    const { result } = setup()
    await openInSync(result)
    emit('card_updated', card('A', 0, { likes: ['p-bob'] }), 6)

    act(() => {
      result.current.applyChange({
        type: 'card_patched',
        id: 'A',
        patch: (c) => ({ ...c, likes: [...c.likes, 'p-me'] }),
      })
    })

    expect(result.current.columns[0].cards[0].likes).toEqual(['p-bob', 'p-me'])
  })

  it('событие через три секунды уже не мешает ответу REST', async () => {
    vi.useFakeTimers()
    const { result } = setup()
    api.getBoard.mockResolvedValueOnce(board(5, [card('A', 0), card('B', 1)]))
    act(() => {
      socket.onOpen?.({ reconnected: false })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    emit('card_updated', card('A', 0, { text: 'Из события' }), 6)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    act(() => {
      result.current.applyChange({ type: 'card_updated', card: card('A', 0, { text: 'Из ответа' }) }, 'rest')
    })

    expect(result.current.columns[0].cards[0].text).toBe('Из ответа')
  })
})

// ── Перетаскивание и снимок из ответа REST ───────────────────────────────────

describe('перечитывание не мешает тому, что участник делает сейчас', () => {
  it('пока участник тащит карточку, события копятся и применяются, когда он отпустит', async () => {
    const { result } = setup()
    await openInSync(result)

    act(() => {
      result.current.holdRemoteChanges()
    })
    emit('card_created', card('C', 2), 6)
    emit('card_deleted', { id: 'A' }, 7)
    // Под указателем ничего не прыгает
    expect(cardIds(result)).toEqual(['A', 'B'])

    act(() => {
      result.current.releaseRemoteChanges()
    })

    expect(cardIds(result)).toEqual(['B', 'C'])
    expect(api.getBoard).not.toHaveBeenCalled()
  })

  it('перечитывание во время перетаскивания откладывается до его конца', async () => {
    const { result } = setup()
    await openInSync(result)

    act(() => {
      result.current.holdRemoteChanges()
    })
    emit('cards_visibility_changed', {}, 6)
    act(() => {
      result.current.resync('rejected')
    })
    expect(api.getBoard).not.toHaveBeenCalled()

    api.getBoard.mockResolvedValueOnce(board(6, [card('A', 0)]))
    act(() => {
      result.current.releaseRemoteChanges()
    })
    await flush()

    expect(cardIds(result)).toEqual(['A'])
  })

  it('снимок, пришедший во время перетаскивания, не подменяет доску: она перечитывается после', async () => {
    const { result } = setup()
    await openInSync(result)

    const pending = deferred<Board>()
    api.getBoard.mockReturnValueOnce(pending.promise)
    emit('cards_visibility_changed', {}, 6)
    act(() => {
      result.current.holdRemoteChanges()
      // Предпросмотр перетаскивания
      result.current.applyChange({ type: 'card_relocated', id: 'A', column_id: 'col-1', position: 1 })
    })
    await act(async () => {
      pending.resolve(board(6, [card('A', 0)]))
      await Promise.resolve()
    })
    await flush()
    // Снимок не применён: участник всё ещё тащит карточку
    expect(cardIds(result)).toEqual(['B', 'A'])

    api.getBoard.mockResolvedValueOnce(board(6, [card('A', 0)]))
    act(() => {
      result.current.releaseRemoteChanges()
    })
    await flush()

    expect(api.getBoard).toHaveBeenCalledTimes(2)
    expect(cardIds(result)).toEqual(['A'])
  })

  it('доска из ответа REST применяется как снимок: задачи дочитываются, события старше снимка пропускаются', async () => {
    const onBoardSnapshot = vi.fn()
    const { result } = setup({ onBoardSnapshot })
    await openInSync(result)
    api.getActionItems.mockResolvedValueOnce([actionItem('t1')])

    // Раскрытие карточек: ответ содержит доску в новом виде и номер событий 8
    const revealed = board(8, [card('A', 0), card('B', 1, { text: 'Раскрыта' })])
    act(() => {
      result.current.applySnapshot(revealed)
    })
    await flush()

    expect(api.getBoard).not.toHaveBeenCalled()
    expect(result.current.columns[0].cards[1].text).toBe('Раскрыта')
    expect(result.current.actionItems.map((i) => i.id)).toEqual(['t1'])
    expect(onBoardSnapshot).toHaveBeenCalledWith(revealed)

    // События 6–8 уже учтены в ответе; девятое — новое
    emit('card_updated', card('B', 1, { text: 'Устаревшее' }), 7)
    emit('cards_visibility_changed', {}, 8)
    emit('card_created', card('C', 2), 9)

    expect(api.getBoard).not.toHaveBeenCalled()
    expect(result.current.columns[0].cards[1].text).toBe('Раскрыта')
    expect(cardIds(result)).toEqual(['A', 'B', 'C'])
  })
})

// ── Начальное состояние сессии после подключения ─────────────────────────────

describe('состояние сессии после переподключения', () => {
  it('фокус, готовность и набор текста, которых на сервере уже нет, сбрасываются', async () => {
    const onTimerAbsent = vi.fn()
    const { result } = setup({ onTimerAbsent })
    await openInSync(result)
    emit('spotlight_update', { card_id: 'A' })
    emit('ready_update', { ready_ids: ['p-anna'] })
    emit('typing_update', { typing: [{ participant_id: 'p-anna', username: 'Анна', column_id: 'col-1' }] })
    expect(result.current.spotlightCardId).toBe('A')

    // Переподключение: сервер присылает только то, что есть, — и состав доски последним
    act(() => {
      socket.onOpen?.({ reconnected: true })
    })
    emit('facilitator_update', { facilitator: null, facilitator_id: null, phase: null })
    emit('presence_update', { participants: [{ id: 'p-me', name: 'Я' }] })

    expect(result.current.spotlightCardId).toBeNull()
    expect(result.current.readyIds).toEqual([])
    expect(result.current.typingUsers).toEqual([])
    expect(onTimerAbsent).toHaveBeenCalledTimes(1)
  })

  it('то, что сервер прислал при подключении, остаётся', async () => {
    const onTimerAbsent = vi.fn()
    const onTimerWsEvent = vi.fn()
    const { result } = setup({ onTimerAbsent, onTimerWsEvent })
    await openInSync(result)

    act(() => {
      socket.onOpen?.({ reconnected: true })
    })
    emit('facilitator_update', { facilitator: 'Анна', facilitator_id: 'p-anna', phase: 'discuss' })
    emit('ready_update', { ready_ids: ['p-anna'] })
    emit('spotlight_update', { card_id: 'B' })
    emit('timer_start', { duration: 300, remaining: 120 })
    emit('presence_update', { participants: [{ id: 'p-me', name: 'Я' }] })

    expect(result.current.spotlightCardId).toBe('B')
    expect(result.current.readyIds).toEqual(['p-anna'])
    expect(onTimerWsEvent).toHaveBeenCalledWith('timer_start', { duration: 300, remaining: 120 })
    expect(onTimerAbsent).not.toHaveBeenCalled()
  })

  it('состав доски, пришедший позже, уже ничего не сбрасывает', async () => {
    const onTimerAbsent = vi.fn()
    const { result } = setup({ onTimerAbsent })
    await openInSync(result)
    act(() => {
      socket.onOpen?.({ reconnected: true })
    })
    emit('presence_update', { participants: [{ id: 'p-me', name: 'Я' }] })
    onTimerAbsent.mockClear()

    emit('spotlight_update', { card_id: 'A' })
    emit('presence_update', { participants: [{ id: 'p-me', name: 'Я' }, { id: 'p-anna', name: 'Анна' }] })

    expect(result.current.spotlightCardId).toBe('A')
    expect(onTimerAbsent).not.toHaveBeenCalled()
  })
})
