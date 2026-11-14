import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Column from '../../components/Column'
import type { Column as ColumnType } from '../../types'

// Mock dnd-kit
vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useDndContext: () => ({ active: null }),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

// Mock store
vi.mock('../../store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ username: 'TestUser', theme: { primary: '#6750A4', dark: false }, setUsername: vi.fn(), setCurrentBoard: vi.fn(), setTheme: vi.fn(), currentBoardId: null }),
}))

// Mock API
vi.mock('../../api', () => ({
  updateColumn: vi.fn(),
  deleteColumn: vi.fn(),
  createCard: vi.fn(),
  createGroup: vi.fn(),
  addCardToGroup: vi.fn(),
  toggleLike: vi.fn(),
  deleteCard: vi.fn(),
  removeCardFromGroup: vi.fn(),
  updateCard: vi.fn(),
}))

// Mock theme
vi.mock('../../utils/theme', () => ({
  userColor: () => '#6750A4',
  initials: (name: string) => name.slice(0, 2),
}))

const baseColumn: ColumnType = {
  id: 'col-1',
  board_id: 'b1',
  title: 'Что хорошо',
  color: '#006E1C',
  position: 0,
  cards: [
    {
      id: 'card-1',
      column_id: 'col-1',
      group_id: null,
      text: 'Great teamwork',
      author: 'Alice',
      color: '#FFFFFF',
      position: 0,
      likes: [],
      created_at: '2024-01-01T00:00:00Z',
    },
  ],
  groups: [],
}

const noop = vi.fn()

describe('Column', () => {
  it('renders column title', () => {
    render(
      <Column
        column={baseColumn}
        onUpdate={noop}
        onDelete={noop}
        onCardCreated={noop}
        onCardUpdated={noop}
        onCardDeleted={noop}
        onGroupCreated={noop}
        onGroupUpdated={noop}
        onGroupDeleted={noop}
        groupTargetId={null}
        collapsedGroups={{}}
        onToggleCollapse={noop}
      />,
    )
    expect(screen.getByText('Что хорошо')).toBeInTheDocument()
  })

  it('renders card count', () => {
    render(
      <Column
        column={baseColumn}
        onUpdate={noop}
        onDelete={noop}
        onCardCreated={noop}
        onCardUpdated={noop}
        onCardDeleted={noop}
        onGroupCreated={noop}
        onGroupUpdated={noop}
        onGroupDeleted={noop}
        groupTargetId={null}
        collapsedGroups={{}}
        onToggleCollapse={noop}
      />,
    )
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders cards', () => {
    render(
      <Column
        column={baseColumn}
        onUpdate={noop}
        onDelete={noop}
        onCardCreated={noop}
        onCardUpdated={noop}
        onCardDeleted={noop}
        onGroupCreated={noop}
        onGroupUpdated={noop}
        onGroupDeleted={noop}
        groupTargetId={null}
        collapsedGroups={{}}
        onToggleCollapse={noop}
      />,
    )
    expect(screen.getByText('Great teamwork')).toBeInTheDocument()
  })

  it('has add button', () => {
    render(
      <Column
        column={baseColumn}
        onUpdate={noop}
        onDelete={noop}
        onCardCreated={noop}
        onCardUpdated={noop}
        onCardDeleted={noop}
        onGroupCreated={noop}
        onGroupUpdated={noop}
        onGroupDeleted={noop}
        groupTargetId={null}
        collapsedGroups={{}}
        onToggleCollapse={noop}
      />,
    )
    expect(screen.getByText('Добавить карточку')).toBeInTheDocument()
  })

  it('hides auto_awesome AI cluster button and other authors cards during brainstormHidden', () => {
    const col: ColumnType = {
      ...baseColumn,
      cards: [
        ...baseColumn.cards,
        {
          id: 'card-2',
          column_id: 'col-1',
          group_id: null,
          text: 'My own thought',
          author: 'TestUser',
          color: '#FFFFFF',
          position: 1,
          likes: [],
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
    }

    render(
      <Column
        column={col}
        onUpdate={noop}
        onDelete={noop}
        onCardCreated={noop}
        onCardUpdated={noop}
        onCardDeleted={noop}
        onGroupCreated={noop}
        onGroupUpdated={noop}
        onGroupDeleted={noop}
        groupTargetId={null}
        collapsedGroups={{}}
        onToggleCollapse={noop}
        currentUser="TestUser"
        brainstormHidden
      />,
    )

    expect(screen.queryByTitle('Сгруппировать похожие (AI)')).not.toBeInTheDocument()
    expect(screen.queryByText('Great teamwork')).not.toBeInTheDocument()
    expect(screen.getByText('My own thought')).toBeInTheDocument()
  })

  it('disables color dot, title edit prompt, auto-cluster, and delete action when readOnly', () => {
    const col: ColumnType = {
      ...baseColumn,
      cards: [
        ...baseColumn.cards,
        {
          id: 'card-2',
          column_id: 'col-1',
          group_id: null,
          text: 'Second card',
          author: 'Bob',
          color: '#FFFFFF',
          position: 1,
          likes: [],
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
    }

    render(
      <Column
        column={col}
        onUpdate={noop}
        onDelete={noop}
        onCardCreated={noop}
        onCardUpdated={noop}
        onCardDeleted={noop}
        onGroupCreated={noop}
        onGroupUpdated={noop}
        onGroupDeleted={noop}
        groupTargetId={null}
        collapsedGroups={{}}
        onToggleCollapse={noop}
        readOnly
      />,
    )

    expect(screen.queryByTitle('Изменить цвет')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Двойной клик чтобы редактировать')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Удалить колонку')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Сгруппировать похожие (AI)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /добавить карточку/i })).toBeDisabled()
  })

  it('keeps top padding inside the scrollable cards area so top card borders and rings are not clipped', () => {
    render(
      <Column
        column={baseColumn}
        onUpdate={noop}
        onDelete={noop}
        onCardCreated={noop}
        onCardUpdated={noop}
        onCardDeleted={noop}
        onGroupCreated={noop}
        onGroupUpdated={noop}
        onGroupDeleted={noop}
        groupTargetId={null}
        collapsedGroups={{}}
        onToggleCollapse={noop}
      />,
    )

    const cardText = screen.getByText('Great teamwork')
    const scrollArea = cardText.closest('.overflow-y-auto')
    expect(scrollArea).not.toBeNull()
    expect(scrollArea?.className).toContain('pt-1.5')
    expect(scrollArea?.className).toContain('pb-3')
  })
})
