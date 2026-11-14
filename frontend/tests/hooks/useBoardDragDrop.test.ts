import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState } from 'react'
import type { DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core'
import { useBoardDragDrop } from '../../hooks/useBoardDragDrop'
import type { Column } from '../../types'

const mockMoveCard = vi.fn()
const mockCreateGroup = vi.fn()
const mockAddCardToGroup = vi.fn()
const mockRemoveCardFromGroup = vi.fn()
const mockMoveGroup = vi.fn()
const mockShowToast = vi.fn()

vi.mock('../../api', () => ({
  moveCard: (...args: unknown[]) => mockMoveCard(...args),
  createGroup: (...args: unknown[]) => mockCreateGroup(...args),
  addCardToGroup: (...args: unknown[]) => mockAddCardToGroup(...args),
  removeCardFromGroup: (...args: unknown[]) => mockRemoveCardFromGroup(...args),
  moveGroup: (...args: unknown[]) => mockMoveGroup(...args),
}))

vi.mock('../../store/toastStore', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}))

function makeColumns(): Column[] {
  return [
    {
      id: 'col-1',
      board_id: 'b-1',
      title: 'Good',
      color: '#006E1C',
      position: 0,
      groups: [{ id: 'g-1', column_id: 'col-1', title: 'Group 1', position: 0 }],
      cards: [
        {
          id: 'c1',
          column_id: 'col-1',
          group_id: null,
          text: 'Card 1',
          author: 'Alice',
          author_id: null,
          masked: false,
          color: '#FFFFFF',
          position: 0,
          likes: [],
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'c2',
          column_id: 'col-1',
          group_id: null,
          text: 'Card 2',
          author: 'Bob',
          author_id: null,
          masked: false,
          color: '#FFFFFF',
          position: 1,
          likes: [],
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'c3',
          column_id: 'col-1',
          group_id: 'g-1',
          text: 'Card 3',
          author: 'Charlie',
          author_id: null,
          masked: false,
          color: '#FFFFFF',
          position: 2,
          likes: [],
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
    },
  ]
}

function setupDragDrop(initial = makeColumns()) {
  return renderHook(() => {
    const [columns, setColumns] = useState<Column[]>(initial)
    const dnd = useBoardDragDrop({ columns, setColumns })
    return { columns, ...dnd }
  })
}

describe('useBoardDragDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMoveCard.mockResolvedValue({})
    mockCreateGroup.mockResolvedValue({ id: 'g-new', column_id: 'col-1', title: 'Группа', position: 1 })
    mockAddCardToGroup.mockImplementation((groupId: string, cardId: string) =>
      Promise.resolve({
        id: cardId,
        column_id: 'col-1',
        group_id: groupId,
        text: `Card ${cardId}`,
        author: 'Alice',
        author_id: null,
        masked: false,
        color: '#FFFFFF',
        position: 0,
        likes: [],
        created_at: '2024-01-01T00:00:00Z',
      }),
    )
    mockRemoveCardFromGroup.mockResolvedValue({})
    mockMoveGroup.mockResolvedValue({})
  })

  it('reorders ungrouped cards without creating a group on normal drop', async () => {
    const { result } = setupDragDrop()

    act(() => {
      result.current.onDragStart({
        active: { id: 'c1' },
        activatorEvent: { altKey: false, shiftKey: false },
      } as unknown as DragStartEvent)
    })

    act(() => {
      result.current.onDragOver({
        active: { id: 'c1' },
        over: { id: 'c2' },
      } as unknown as DragOverEvent)
    })

    expect(result.current.groupTargetId).toBeNull()

    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'c1' },
        over: { id: 'c2' },
      } as unknown as DragEndEvent)
    })

    expect(mockCreateGroup).not.toHaveBeenCalled()
    expect(mockAddCardToGroup).not.toHaveBeenCalled()
    expect(mockMoveCard).toHaveBeenCalledWith('c1', { column_id: 'col-1', position: 1 })
    expect(result.current.columns[0].cards.map((c) => c.id)).toEqual(['c2', 'c1', 'c3'])
  })

  it('creates a group when dropping ungrouped card onto another ungrouped card with Alt key', async () => {
    const { result } = setupDragDrop()

    act(() => {
      result.current.onDragStart({
        active: { id: 'c1' },
        activatorEvent: { altKey: true, shiftKey: false },
      } as unknown as DragStartEvent)
    })

    act(() => {
      result.current.onDragOver({
        active: { id: 'c1' },
        over: { id: 'c2' },
      } as unknown as DragOverEvent)
    })

    expect(result.current.groupTargetId).toBe('c2')

    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'c1' },
        over: { id: 'c2' },
      } as unknown as DragEndEvent)
    })

    expect(mockCreateGroup).toHaveBeenCalledWith({ column_id: 'col-1', title: 'Группа' })
    expect(mockAddCardToGroup).toHaveBeenCalledWith('g-new', 'c2')
    expect(mockAddCardToGroup).toHaveBeenCalledWith('g-new', 'c1')
    expect(mockMoveCard).not.toHaveBeenCalled()
  })

  it('creates a group when Shift key is held during drag', async () => {
    const { result } = setupDragDrop()

    act(() => {
      result.current.onDragStart({
        active: { id: 'c1' },
        activatorEvent: { altKey: false, shiftKey: false },
      } as unknown as DragStartEvent)
    })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }))
    })

    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'c1' },
        over: { id: 'c2' },
      } as unknown as DragEndEvent)
    })

    expect(mockCreateGroup).toHaveBeenCalledWith({ column_id: 'col-1', title: 'Группа' })
    expect(mockAddCardToGroup).toHaveBeenCalledWith('g-new', 'c2')
    expect(mockAddCardToGroup).toHaveBeenCalledWith('g-new', 'c1')
  })

  it('joins an existing group when dropping onto an already-grouped card without modifier', async () => {
    const { result } = setupDragDrop()

    act(() => {
      result.current.onDragStart({
        active: { id: 'c1' },
        activatorEvent: { altKey: false, shiftKey: false },
      } as unknown as DragStartEvent)
    })

    act(() => {
      result.current.onDragOver({
        active: { id: 'c1' },
        over: { id: 'c3' },
      } as unknown as DragOverEvent)
    })

    expect(result.current.groupTargetId).toBe('c3')

    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'c1' },
        over: { id: 'c3' },
      } as unknown as DragEndEvent)
    })

    expect(mockCreateGroup).not.toHaveBeenCalled()
    expect(mockAddCardToGroup).toHaveBeenCalledWith('g-1', 'c1')
  })

  it('rolls back optimistic reorder and shows toast when moveCard fails', async () => {
    let rejectMove!: (err: unknown) => void
    mockMoveCard.mockImplementationOnce(
      () =>
        new Promise((_res, rej) => {
          rejectMove = rej
        }),
    )
    const { result } = setupDragDrop()

    act(() => {
      result.current.onDragStart({
        active: { id: 'c1' },
        activatorEvent: { altKey: false, shiftKey: false },
      } as unknown as DragStartEvent)
    })

    let dragEndPromise!: Promise<void>
    act(() => {
      dragEndPromise = result.current.onDragEnd({
        active: { id: 'c1' },
        over: { id: 'c2' },
      } as unknown as DragEndEvent)
    })

    // Оптимистично переставились до ответа сервера
    expect(result.current.columns[0].cards.map((c) => c.id)).toEqual(['c2', 'c1', 'c3'])

    await act(async () => {
      rejectMove(new Error('network'))
      await dragEndPromise
    })

    expect(mockShowToast).toHaveBeenCalledWith('Не удалось переместить карточку', 'error')
    expect(result.current.columns[0].cards.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })
})
