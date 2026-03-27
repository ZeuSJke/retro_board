import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import Dashboard from '../../components/Dashboard'

// Mock next/navigation
const mockPush = vi.fn()
const mockBack = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}))

// Mock API
const mockBoards = [
  {
    id: 'b1',
    name: 'Sprint 1',
    slug: 'sprint-1',
    max_votes: 5,
    created_at: '2026-01-10T10:00:00Z',
    action_items_total: 3,
    action_items_open: 2,
  },
  {
    id: 'b2',
    name: 'Sprint 2',
    slug: 'sprint-2',
    max_votes: 5,
    created_at: '2026-02-10T10:00:00Z',
    action_items_total: 1,
    action_items_open: 0,
  },
]

const mockItems = [
  {
    id: 'i1',
    board_id: 'b1',
    title: 'Fix CI',
    text: 'Fix CI pipeline description',
    assignee: 'Alice',
    jira_issue_key: null,
    status: 'open',
    completed_at: null,
    created_at: '2026-01-11T10:00:00Z',
    board_name: 'Sprint 1',
  },
  {
    id: 'i2',
    board_id: 'b1',
    title: 'Update docs',
    text: 'Update documentation for API',
    assignee: 'Bob',
    jira_issue_key: null,
    status: 'done',
    completed_at: '2026-01-15T10:00:00Z',
    created_at: '2026-01-12T10:00:00Z',
    board_name: 'Sprint 1',
  },
  {
    id: 'i3',
    board_id: 'b2',
    title: 'Add tests',
    text: 'Write unit tests for dashboard',
    assignee: null,
    jira_issue_key: null,
    status: 'in_progress',
    completed_at: null,
    created_at: '2026-02-11T10:00:00Z',
    board_name: 'Sprint 2',
  },
]

vi.mock('../../api', () => ({
  getBoards: vi.fn(() => Promise.resolve(mockBoards)),
  getAllActionItems: vi.fn(() => Promise.resolve(mockItems)),
  updateActionItem: vi.fn((_id: string, data: Record<string, unknown>) => Promise.resolve({ ...mockItems[0], ...data })),
  deleteActionItem: vi.fn(() => Promise.resolve()),
  getJiraStatus: vi.fn(() => Promise.resolve({ configured: false })),
}))

// Mock CSS modules
vi.mock('../../components/Dashboard.module.css', () => ({
  default: new Proxy({}, { get: (_, key) => key }),
}))

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders sections after loading', async () => {
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('История ретро')).toBeDefined()
    })

    expect(screen.getByText('Прошлые ретро')).toBeDefined()
    expect(screen.getByText('Все задачи')).toBeDefined()
  })

  it('renders board cards', async () => {
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getAllByText('Sprint 1').length).toBeGreaterThan(0)
    })
    // Check board card names specifically by class
    const boardCards = screen.getAllByText('Sprint 1').filter(
      el => el.className === 'boardCardName'
    )
    expect(boardCards).toHaveLength(1)
    expect(screen.getAllByText('Sprint 2').length).toBeGreaterThan(0)
  })

  it('renders action items', async () => {
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Fix CI')).toBeDefined()
    })
    expect(screen.getByText('Fix CI pipeline description')).toBeDefined()
    expect(screen.getByText('Add tests')).toBeDefined()

    // Done items are collapsed by default
    expect(screen.queryByText('Update documentation for API')).toBeNull()

    // Expand done section
    fireEvent.click(screen.getByText(/Выполненные/))
    expect(screen.getByText('Update docs')).toBeDefined()
    expect(screen.getByText('Update documentation for API')).toBeDefined()
  })

  it('navigates to board on click', async () => {
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getAllByText('Sprint 1').length).toBeGreaterThan(0)
    })
    // Click specifically on the board card name
    const boardCard = screen.getAllByText('Sprint 1').find(
      el => el.className === 'boardCardName'
    )!
    fireEvent.click(boardCard)
    expect(mockPush).toHaveBeenCalledWith('/board/sprint-1')
  })

  it('navigates back on button click', async () => {
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('История ретро')).toBeDefined()
    })
    fireEvent.click(screen.getByTitle('Назад'))
    expect(mockBack).toHaveBeenCalled()
  })

  it('filters items by status', async () => {
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Fix CI')).toBeDefined()
    })

    // Select "Выполнено" (done) — done items show in main list, no collapse
    const statusSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(statusSelect, { target: { value: 'done' } })

    expect(screen.queryByText('Fix CI')).toBeNull()
    expect(screen.getByText('Update docs')).toBeDefined()
    expect(screen.queryByText('Add tests')).toBeNull()
    // No collapsed section when filtering by specific status
    expect(screen.queryByText(/Выполненные/)).toBeNull()
  })

})
