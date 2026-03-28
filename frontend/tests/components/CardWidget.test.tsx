import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CardWidget from '../../components/CardWidget'
import type { Card } from '../../types'

// Mock dnd-kit
vi.mock('@dnd-kit/sortable', () => ({
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

// Mock theme utils
vi.mock('../../utils/theme', () => ({
  isLight: () => true,
  userColor: () => '#6750A4',
  initials: (name: string) => name.slice(0, 2),
  applyTheme: vi.fn(),
  CARD_COLORS: ['#FFFFFF'],
}))

// Mock API
vi.mock('../../api', () => ({
  toggleLike: vi.fn().mockResolvedValue({ id: '1', likes: ['TestUser'], text: 'Hello', author: 'Alice', color: '#FFFFFF', column_id: 'c1', group_id: null, position: 0, created_at: '' }),
  deleteCard: vi.fn().mockResolvedValue(undefined),
  removeCardFromGroup: vi.fn().mockResolvedValue({ id: '1', likes: [], text: 'Hello', author: 'Alice', color: '#FFFFFF', column_id: 'c1', group_id: null, position: 0, created_at: '' }),
  updateCard: vi.fn().mockResolvedValue({ id: '1', likes: [], text: 'Updated', author: 'Alice', color: '#FFFFFF', column_id: 'c1', group_id: null, position: 0, created_at: '' }),
}))

const baseCard: Card = {
  id: '1',
  column_id: 'c1',
  group_id: null,
  text: 'Hello world',
  author: 'Alice',
  color: '#FFFFFF',
  position: 0,
  likes: [],
  created_at: '2024-01-01T00:00:00Z',
}

describe('CardWidget', () => {
  const onUpdate = vi.fn()
  const onDelete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders card text and author', () => {
    render(<CardWidget card={baseCard} onUpdate={onUpdate} onDelete={onDelete} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows like count', () => {
    const card = { ...baseCard, likes: ['Bob', 'Charlie'] }
    render(<CardWidget card={card} onUpdate={onUpdate} onDelete={onDelete} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('disables like button when canVote is false and not liked', () => {
    render(<CardWidget card={baseCard} canVote={false} onUpdate={onUpdate} onDelete={onDelete} />)
    const likeBtn = screen.getByTitle('Лимит голосов исчерпан')
    expect(likeBtn).toBeDisabled()
  })

  it('enables like button when canVote is false but already liked', () => {
    const card = { ...baseCard, likes: ['TestUser'] }
    render(<CardWidget card={card} canVote={false} onUpdate={onUpdate} onDelete={onDelete} />)
    const likeBtn = screen.getByTitle('Убрать лайк')
    expect(likeBtn).not.toBeDisabled()
  })

  it('calls toggleLike on like button click', async () => {
    const user = userEvent.setup()
    render(<CardWidget card={baseCard} canVote={true} onUpdate={onUpdate} onDelete={onDelete} />)
    const likeBtn = screen.getByTitle('Лайк')
    await user.click(likeBtn)
    const { toggleLike } = await import('../../api')
    expect(toggleLike).toHaveBeenCalledWith('1', 'TestUser')
  })
})
