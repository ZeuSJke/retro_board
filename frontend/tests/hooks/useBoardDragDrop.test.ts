import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCallback, useState } from 'react'
import type { DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core'
import { useBoardDragDrop } from '../../hooks/useBoardDragDrop'
import { applyBoardChange, type BoardChange } from '../../lib/board-events'
import type { Card, Column } from '../../types'

const mockMoveCard = vi.fn()
const mockBulkUpdateCards = vi.fn()
const mockCreateGroup = vi.fn()
const mockAddCardToGroup = vi.fn()
const mockRemoveCardFromGroup = vi.fn()
const mockMoveGroup = vi.fn()
const mockShowToast = vi.fn()

vi.mock('../../api', () => ({
  moveCard: (...args: unknown[]) => mockMoveCard(...args),
  bulkUpdateCards: (...args: unknown[]) => mockBulkUpdateCards(...args),
  createGroup: (...args: unknown[]) => mockCreateGroup(...args),
  addCardToGroup: (...args: unknown[]) => mockAddCardToGroup(...args),
  removeCardFromGroup: (...args: unknown[]) => mockRemoveCardFromGroup(...args),
  moveGroup: (...args: unknown[]) => mockMoveGroup(...args),
}))

vi.mock('../../store/toastStore', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}))

function makeCard(id: string, position: number, extra: Partial<Card> = {}): Card {
  return {
    id,
    column_id: 'col-1',
    group_id: null,
    text: `Card ${id}`,
    author: 'Alice',
    author_id: null,
    masked: false,
    color: '#FFFFFF',
    position,
    likes: [],
    created_at: '2024-01-01T00:00:00Z',
    ...extra,
  }
}

function makeColumns(): Column[] {
  return [
    {
      id: 'col-1',
      board_id: 'b-1',
      title: 'Good',
      color: '#006E1C',
      position: 0,
      groups: [{ id: 'g-1', column_id: 'col-1', title: 'Group 1', position: 0 }],
      cards: [makeCard('c1', 0), makeCard('c2', 1), makeCard('c3', 2, { group_id: 'g-1' })],
    },
    {
      id: 'col-2',
      board_id: 'b-1',
      title: 'Bad',
      color: '#BA1A1A',
      position: 1,
      groups: [],
      cards: [makeCard('x1', 0, { column_id: 'col-2' })],
    },
  ]
}

const ids = (columns: Column[], index = 0) => columns[index].cards.map((c) => c.id)

function setupDragDrop(initial = makeColumns()) {
  const dragActive: boolean[] = []
  const onRejected = vi.fn()
  const changes: BoardChange[] = []
  const hook = renderHook(() => {
    const [columns, setColumns] = useState<Column[]>(initial)
    const applyChange = useCallback((change: BoardChange) => {
      changes.push(change)
      setColumns((prev) => applyBoardChange(prev, change))
    }, [])
    const dnd = useBoardDragDrop({
      columns,
      applyChange,
      onDragActiveChange: (active) => dragActive.push(active),
      onRejected,
    })
    return { columns, setColumns, applyChange, ...dnd }
  })
  return { ...hook, dragActive, onRejected, changes }
}

type Hook = ReturnType<typeof setupDragDrop>['result']

function start(result: Hook, id: string, modifiers: { altKey?: boolean; shiftKey?: boolean } = {}) {
  act(() => {
    result.current.onDragStart({
      active: { id },
      activatorEvent: { altKey: false, shiftKey: false, ...modifiers },
    } as unknown as DragStartEvent)
  })
}

function over(result: Hook, id: string, overId: string | null) {
  act(() => {
    result.current.onDragOver({
      active: { id },
      over: overId ? { id: overId } : null,
    } as unknown as DragOverEvent)
  })
}

async function drop(result: Hook, id: string, overId: string | null) {
  await act(async () => {
    await result.current.onDragEnd({
      active: { id },
      over: overId ? { id: overId } : null,
    } as unknown as DragEndEvent)
  })
}

describe('useBoardDragDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMoveCard.mockImplementation((id: string, data: { column_id: string; position: number }) =>
      Promise.resolve(makeCard(id, data.position, { column_id: data.column_id })),
    )
    mockBulkUpdateCards.mockImplementation(
      (data: { card_ids: string[]; column_id?: string; group_id?: string; group_title?: string }) =>
        Promise.resolve(
          data.card_ids.map((id, idx) =>
            makeCard(id, idx, {
              column_id: data.column_id ?? 'col-1',
              group_id: data.group_id ?? (data.group_title ? 'g-new' : null),
            }),
          ),
        ),
    )
    mockRemoveCardFromGroup.mockResolvedValue({})
    mockMoveGroup.mockResolvedValue({})
  })

  it('reorders ungrouped cards without creating a group on normal drop', async () => {
    const { result } = setupDragDrop()

    start(result, 'c1')
    over(result, 'c1', 'c2')
    expect(result.current.groupTargetId).toBeNull()
    await drop(result, 'c1', 'c2')

    expect(mockBulkUpdateCards).not.toHaveBeenCalled()
    expect(mockMoveCard).toHaveBeenCalledWith('c1', { column_id: 'col-1', position: 1 })
    expect(ids(result.current.columns)).toEqual(['c2', 'c1', 'c3'])
    expect(result.current.columns[0].cards.map((c) => c.position)).toEqual([0, 1, 2])
  })

  it('перенос в другую колонку: карточка встаёт в конец и запрос уходит с этой позицией', async () => {
    const { result } = setupDragDrop()

    start(result, 'c1')
    over(result, 'c1', 'col-col-2')
    // Предпросмотр: карточка уже во второй колонке
    expect(ids(result.current.columns, 1)).toEqual(['x1', 'c1'])
    await drop(result, 'c1', 'col-col-2')

    expect(mockMoveCard).toHaveBeenCalledWith('c1', { column_id: 'col-2', position: 1 })
    expect(ids(result.current.columns, 0)).toEqual(['c2', 'c3'])
    expect(ids(result.current.columns, 1)).toEqual(['x1', 'c1'])
  })

  it('карточку бросили туда же, где взяли: запроса нет', async () => {
    const { result, dragActive } = setupDragDrop()

    start(result, 'c1')
    await drop(result, 'c1', 'c1')

    expect(mockMoveCard).not.toHaveBeenCalled()
    expect(ids(result.current.columns)).toEqual(['c1', 'c2', 'c3'])
    expect(dragActive).toEqual([true, false])
  })

  it('карточку увели в другую колонку и вернули на прежнее место: порядок прежний, запроса нет', async () => {
    const { result } = setupDragDrop()

    start(result, 'c1')
    over(result, 'c1', 'col-col-2')
    // Обратно в свою колонку: предпросмотр ставит карточку в конец
    over(result, 'c1', 'c2')
    expect(ids(result.current.columns, 0)).toEqual(['c2', 'c3', 'c1'])
    await drop(result, 'c1', 'c2')

    expect(mockMoveCard).not.toHaveBeenCalled()
    expect(ids(result.current.columns, 0)).toEqual(['c1', 'c2', 'c3'])
    expect(ids(result.current.columns, 1)).toEqual(['x1'])
  })

  it('карточка из группы, отпущенная на самой себе, из группы не выходит', async () => {
    const { result } = setupDragDrop()

    start(result, 'c3')
    await drop(result, 'c3', 'c3')

    expect(mockRemoveCardFromGroup).not.toHaveBeenCalled()
    expect(mockMoveCard).not.toHaveBeenCalled()
    expect(result.current.columns[0].cards.find((c) => c.id === 'c3')?.group_id).toBe('g-1')
  })

  it('creates a group when dropping ungrouped card onto another ungrouped card with Alt key', async () => {
    const { result } = setupDragDrop()

    start(result, 'c1', { altKey: true })
    over(result, 'c1', 'c2')
    expect(result.current.groupTargetId).toBe('c2')
    await drop(result, 'c1', 'c2')

    // Один запрос: сервер создаёт группу и кладёт в неё обе карточки одной транзакцией
    expect(mockBulkUpdateCards).toHaveBeenCalledTimes(1)
    expect(mockBulkUpdateCards).toHaveBeenCalledWith({ card_ids: ['c2', 'c1'], group_title: 'Группа' })
    expect(mockCreateGroup).not.toHaveBeenCalled()
    expect(mockAddCardToGroup).not.toHaveBeenCalled()
    expect(mockMoveCard).not.toHaveBeenCalled()
    expect(result.current.columns[0].groups.map((g) => g.id)).toEqual(['g-1', 'g-new'])
    expect(result.current.columns[0].cards.filter((c) => c.group_id === 'g-new').map((c) => c.id).sort()).toEqual(['c1', 'c2'])
  })

  it('creates a group when Shift key is held during drag', async () => {
    const { result } = setupDragDrop()

    start(result, 'c1')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }))
    })
    await drop(result, 'c1', 'c2')

    expect(mockBulkUpdateCards).toHaveBeenCalledWith({ card_ids: ['c2', 'c1'], group_title: 'Группа' })
  })

  it('группировка с карточкой из другой колонки: перенос и группа — одним запросом', async () => {
    const { result } = setupDragDrop()

    start(result, 'x1', { altKey: true })
    over(result, 'x1', 'c2')
    await drop(result, 'x1', 'c2')

    expect(mockBulkUpdateCards).toHaveBeenCalledTimes(1)
    expect(mockBulkUpdateCards).toHaveBeenCalledWith({
      card_ids: ['c2', 'x1'],
      column_id: 'col-1',
      group_title: 'Группа',
    })
    expect(mockMoveCard).not.toHaveBeenCalled()
  })

  it('сбой группировки не оставляет пустой группы: группа не создаётся отдельным запросом, карточка возвращается', async () => {
    mockBulkUpdateCards.mockRejectedValueOnce({ response: { status: 500 } })
    const { result, onRejected } = setupDragDrop()

    start(result, 'x1', { altKey: true })
    over(result, 'x1', 'c2')
    await drop(result, 'x1', 'c2')

    expect(mockCreateGroup).not.toHaveBeenCalled()
    expect(mockShowToast).toHaveBeenCalledWith('Не удалось создать группу', 'error')
    // Карточка вернулась в свою колонку, новой группы нет
    expect(ids(result.current.columns, 1)).toEqual(['x1'])
    expect(ids(result.current.columns, 0)).toEqual(['c1', 'c2', 'c3'])
    expect(result.current.columns[0].groups.map((g) => g.id)).toEqual(['g-1'])
    expect(onRejected).toHaveBeenCalledTimes(1)
  })

  it('joins an existing group when dropping onto an already-grouped card without modifier', async () => {
    const { result } = setupDragDrop()

    start(result, 'c1')
    over(result, 'c1', 'c3')
    expect(result.current.groupTargetId).toBe('c3')
    await drop(result, 'c1', 'c3')

    expect(mockBulkUpdateCards).toHaveBeenCalledWith({ card_ids: ['c1'], group_id: 'g-1' })
    expect(mockMoveCard).not.toHaveBeenCalled()
    expect(result.current.columns[0].cards.find((c) => c.id === 'c1')?.group_id).toBe('g-1')
  })

  it('вступление в группу из другой колонки — тоже один запрос', async () => {
    const { result } = setupDragDrop()

    start(result, 'x1')
    over(result, 'x1', 'c3')
    await drop(result, 'x1', 'c3')

    expect(mockBulkUpdateCards).toHaveBeenCalledWith({
      card_ids: ['x1'],
      column_id: 'col-1',
      group_id: 'g-1',
    })
    expect(ids(result.current.columns, 1)).toEqual([])
  })

  it('карточка, вынутая из группы перетаскиванием, остаётся без группы', async () => {
    const { result } = setupDragDrop()

    start(result, 'c3')
    await drop(result, 'c3', 'c1')

    expect(mockRemoveCardFromGroup).toHaveBeenCalledWith('g-1', 'c3')
    expect(mockMoveCard).toHaveBeenCalledWith('c3', { column_id: 'col-1', position: 0 })
    expect(result.current.columns[0].cards.find((c) => c.id === 'c3')?.group_id).toBeNull()
  })

  it('rolls back optimistic reorder and shows toast when moveCard fails', async () => {
    let rejectMove!: (err: unknown) => void
    mockMoveCard.mockImplementationOnce(
      () =>
        new Promise((_res, rej) => {
          rejectMove = rej
        }),
    )
    const { result, onRejected } = setupDragDrop()

    start(result, 'c1')
    let dragEndPromise!: Promise<void>
    act(() => {
      dragEndPromise = result.current.onDragEnd({
        active: { id: 'c1' },
        over: { id: 'c2' },
      } as unknown as DragEndEvent)
    })

    // Оптимистично переставились до ответа сервера
    expect(ids(result.current.columns)).toEqual(['c2', 'c1', 'c3'])

    await act(async () => {
      rejectMove(new Error('network'))
      await dragEndPromise
    })

    expect(mockShowToast).toHaveBeenCalledWith('Не удалось переместить карточку', 'error')
    expect(ids(result.current.columns)).toEqual(['c1', 'c2', 'c3'])
    expect(onRejected).toHaveBeenCalledWith(expect.any(Error), { resync: false })
  })

  it('откат переноса точечный: событие, пришедшее за время запроса, не затирается', async () => {
    let rejectMove!: (err: unknown) => void
    mockMoveCard.mockImplementationOnce(
      () =>
        new Promise((_res, rej) => {
          rejectMove = rej
        }),
    )
    const { result } = setupDragDrop()

    start(result, 'c1')
    over(result, 'c1', 'col-col-2')
    let dragEndPromise!: Promise<void>
    act(() => {
      dragEndPromise = result.current.onDragEnd({
        active: { id: 'c1' },
        over: { id: 'col-col-2' },
      } as unknown as DragEndEvent)
    })

    // Пока запрос в пути, приходят события: новая карточка, лайк на перенесённой карточке,
    // переименование соседней
    act(() => {
      result.current.applyChange({ type: 'card_created', card: makeCard('new', 3) })
      result.current.applyChange({
        type: 'card_patched',
        id: 'c1',
        patch: (c) => ({ ...c, likes: ['p-bob'] }),
      })
      result.current.applyChange({
        type: 'card_updated',
        card: makeCard('c2', 1, { text: 'Отредактировано' }),
      })
    })

    await act(async () => {
      rejectMove({ response: { status: 403 } })
      await dragEndPromise
    })

    // Карточка вернулась на место, а всё пришедшее осталось
    expect(ids(result.current.columns, 0)).toEqual(['c1', 'c2', 'c3', 'new'])
    expect(ids(result.current.columns, 1)).toEqual(['x1'])
    const restored = result.current.columns[0].cards[0]
    expect(restored).toMatchObject({ id: 'c1', column_id: 'col-1', likes: ['p-bob'] })
    expect(result.current.columns[0].cards[1].text).toBe('Отредактировано')
  })

  it('двухшаговый перенос (из группы и на новое место) при сбое просит сверить доску', async () => {
    mockMoveCard.mockRejectedValueOnce({ response: { status: 500 } })
    const { result, onRejected } = setupDragDrop()

    start(result, 'c3')
    await drop(result, 'c3', 'c1')

    // Из группы карточку сервер мог уже вынуть: локальный откат не обязан совпасть с сервером
    expect(onRejected).toHaveBeenCalledWith(expect.anything(), { resync: true })
    expect(result.current.columns[0].cards.find((c) => c.id === 'c3')?.group_id).toBe('g-1')
    expect(ids(result.current.columns)).toEqual(['c1', 'c2', 'c3'])
  })

  describe('отмена перетаскивания', () => {
    it('onDragCancel возвращает карточку на место, в свою колонку и группу', () => {
      const { result, dragActive } = setupDragDrop()

      start(result, 'c3')
      over(result, 'c3', 'col-col-2')
      // Предпросмотр унёс карточку во вторую колонку и вынул из группы
      expect(ids(result.current.columns, 1)).toEqual(['x1', 'c3'])
      expect(result.current.columns[1].cards[1].group_id).toBeNull()

      act(() => {
        result.current.onDragCancel()
      })

      expect(ids(result.current.columns, 0)).toEqual(['c1', 'c2', 'c3'])
      expect(ids(result.current.columns, 1)).toEqual(['x1'])
      expect(result.current.columns[0].cards[2]).toMatchObject({ column_id: 'col-1', group_id: 'g-1' })
      expect(result.current.activeCard).toBeNull()
      expect(result.current.groupTargetId).toBeNull()
      expect(mockMoveCard).not.toHaveBeenCalled()
      expect(dragActive).toEqual([true, false])
    })

    it('бросили мимо доски — то же самое: карточка на месте, запросов нет', async () => {
      const { result } = setupDragDrop()

      start(result, 'c1')
      over(result, 'c1', 'col-col-2')
      await drop(result, 'c1', null)

      expect(ids(result.current.columns, 0)).toEqual(['c1', 'c2', 'c3'])
      expect(ids(result.current.columns, 1)).toEqual(['x1'])
      expect(mockMoveCard).not.toHaveBeenCalled()
    })

    it('отмена возвращает карточку в её текущем состоянии, а не снимком на начало перетаскивания', () => {
      const { result } = setupDragDrop()

      start(result, 'c1')
      over(result, 'c1', 'col-col-2')
      act(() => {
        result.current.applyChange({
          type: 'card_patched',
          id: 'c1',
          patch: (c) => ({ ...c, text: 'Новый текст' }),
        })
      })
      act(() => {
        result.current.onDragCancel()
      })

      expect(result.current.columns[0].cards[0]).toMatchObject({ id: 'c1', text: 'Новый текст' })
    })
  })

  describe('перенос группы', () => {
    it('группа переезжает в другую колонку вместе с карточками', async () => {
      const { result } = setupDragDrop()

      start(result, 'group-g-1')
      expect(result.current.activeGroup?.id).toBe('g-1')
      await drop(result, 'group-g-1', 'col-col-2')

      expect(mockMoveGroup).toHaveBeenCalledWith('g-1', { column_id: 'col-2' })
      expect(result.current.columns[0].groups).toEqual([])
      expect(result.current.columns[1].groups.map((g) => g.id)).toEqual(['g-1'])
      expect(ids(result.current.columns, 1).sort()).toEqual(['c3', 'x1'])
    })

    it('сервер отказал: группа и её карточки возвращаются в прежнюю колонку', async () => {
      mockMoveGroup.mockRejectedValueOnce({ response: { status: 423 } })
      const { result, onRejected } = setupDragDrop()

      start(result, 'group-g-1')
      await drop(result, 'group-g-1', 'col-col-2')

      expect(mockShowToast).toHaveBeenCalledWith('Не удалось переместить группу', 'error')
      expect(result.current.columns[0].groups.map((g) => g.id)).toEqual(['g-1'])
      expect(ids(result.current.columns, 0).sort()).toEqual(['c1', 'c2', 'c3'])
      expect(ids(result.current.columns, 1)).toEqual(['x1'])
      expect(onRejected).toHaveBeenCalledTimes(1)
    })

    it('группу бросили в ту же колонку: ничего не происходит', async () => {
      const { result, dragActive } = setupDragDrop()

      start(result, 'group-g-1')
      await drop(result, 'group-g-1', 'col-col-1')

      expect(mockMoveGroup).not.toHaveBeenCalled()
      expect(dragActive).toEqual([true, false])
    })
  })

  it('на время перетаскивания сообщает владельцу: чужие изменения откладываются', async () => {
    const { result, dragActive } = setupDragDrop()

    start(result, 'c1')
    expect(dragActive).toEqual([true])
    await drop(result, 'c1', 'c2')
    expect(dragActive).toEqual([true, false])
  })
})
