import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dashboard from '../../components/Dashboard'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockBoards = [
  {
    id: 'b1',
    name: 'Sprint 1',
    slug: 'sprint-1',
    max_votes: 5,
    created_at: '2026-01-10T10:00:00Z',
    action_items_total: 3,
    action_items_open: 2,
    has_summary: true,
    cards_count: 8,
    mood_avg: 4.2,
    mood_count: 5,
  },
  {
    id: 'b2',
    name: 'Sprint 2',
    slug: 'sprint-2',
    max_votes: 5,
    created_at: '2026-02-10T10:00:00Z',
    action_items_total: 1,
    action_items_open: 0,
    has_summary: false,
    cards_count: 4,
    mood_avg: null,
    mood_count: 0,
  },
]

const mockItems = [
  {
    id: 'i1',
    board_id: 'b1',
    title: 'Fix CI',
    text: 'Fix CI pipeline description',
    assignee: 'Alice',
    status: 'open',
    source_card_ids: [],
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
    status: 'done',
    source_card_ids: [],
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
    status: 'in_progress',
    source_card_ids: [],
    completed_at: null,
    created_at: '2026-02-11T10:00:00Z',
    board_name: 'Sprint 2',
  },
]

const mockGetWorkspaceInsights = vi.fn(() =>
  Promise.resolve({
    recurring_themes: ['CI/CD', 'Документация'],
    recommendations: ['Автоматизировать тесты'],
    summary_text: 'Команда стабильно закрывает задачи.',
    boards_analyzed: 2,
    generated_by_ai: false,
  }),
)

vi.mock('../../api', () => ({
  getBoards: vi.fn(() => Promise.resolve(mockBoards)),
  getAllActionItems: vi.fn(() => Promise.resolve(mockItems)),
  getActionItemTrends: vi.fn(() => Promise.resolve([])),
  getMoodTrends: vi.fn(() => Promise.resolve([])),
  getWorkspaceInsights: () => mockGetWorkspaceInsights(),
  updateActionItem: vi.fn((_id: string, data: Record<string, unknown>) =>
    Promise.resolve({ ...mockItems[0], ...data }),
  ),
  deleteActionItem: vi.fn(() => Promise.resolve()),
}))

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders KPI header, AI insights card, and tabs after loading', async () => {
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Панель управления')).toBeInTheDocument()
    })

    expect(screen.getByText('Доски команды')).toBeInTheDocument()
    expect(screen.getByText('Кросс-спринт AI-аналитика')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Задачи/i })).toBeInTheDocument()
  })

  it('switches to boards tab and navigates to board on click', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Доски/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: /Доски/i }))
    expect(screen.getByText('Sprint 2')).toBeInTheDocument()

    const openButtons = screen.getAllByRole('button', { name: /Открыть доску/i })
    await user.click(openButtons[0])
    expect(mockPush).toHaveBeenCalledWith('/board/sprint-1')
  })

  it('renders action items and expands completed section', async () => {
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Fix CI')).toBeInTheDocument()
    })
    expect(screen.getByText('Fix CI pipeline description')).toBeInTheDocument()
    expect(screen.getByText('Add tests')).toBeInTheDocument()

    expect(screen.queryByText('Update documentation for API')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(/Завершённые/))
    expect(screen.getByText('Update docs')).toBeInTheDocument()
    expect(screen.getByText('Update documentation for API')).toBeInTheDocument()
  })

  it('switches between list and kanban views', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Fix CI')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Канбан/i }))
    expect(screen.getByText('Открыто')).toBeInTheDocument()
    expect(screen.getByText('В работе')).toBeInTheDocument()
    expect(screen.getByText('Выполнено')).toBeInTheDocument()
    expect(screen.getByText('Update docs')).toBeInTheDocument()

    // Collapse "Выполнено" kanban column and expand back
    await user.click(screen.getByRole('button', { name: /Свернуть колонку Выполнено/i }))
    expect(screen.getByText(/Колонка свёрнута \(1\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Развернуть колонку Выполнено/i }))
    expect(screen.getByText('Update docs')).toBeInTheDocument()
  })

  it('renders clickable links in tasks and collapses long kanban columns beyond 6 items', async () => {
    const user = userEvent.setup()
    const apiMod = await import('../../api')
    const manyItems = [
      {
        ...mockItems[0],
        id: 'link-item',
        title: 'См. [доку](https://docs.example.com)',
        text: 'Подробнее на https://tracker.example.com/browse/RETRO-1.',
      },
      ...Array.from({ length: 7 }, (_, i) => ({
        ...mockItems[0],
        id: `extra-${i}`,
        title: `Задача списка ${i + 1}`,
        text: `Описание ${i + 1}`,
        status: 'open' as const,
      })),
    ]
    vi.mocked(apiMod.getAllActionItems).mockResolvedValueOnce(manyItems)

    render(<Dashboard />)

    const docLink = await screen.findByRole('link', { name: 'доку' })
    expect(docLink).toHaveAttribute('href', 'https://docs.example.com/')
    const urlLink = screen.getByRole('link', {
      name: 'https://tracker.example.com/browse/RETRO-1',
    })
    expect(urlLink).toHaveAttribute('href', 'https://tracker.example.com/browse/RETRO-1')

    await user.click(screen.getByRole('button', { name: /Канбан/i }))
    expect(screen.getByRole('button', { name: /Показать ещё 2/i })).toBeInTheDocument()
    expect(screen.queryByText('Задача списка 7')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Показать ещё 2/i }))
    expect(screen.getByText('Задача списка 7')).toBeInTheDocument()
  })

  it('fetches AI insights when clicking button', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Собрать инсайты/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Собрать инсайты/i }))
    await waitFor(() => {
      expect(mockGetWorkspaceInsights).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText('Команда стабильно закрывает задачи.')).toBeInTheDocument()
  })

  it('navigates home on back button click', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /К доске/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /К доске/i }))
    expect(mockPush).toHaveBeenCalledWith('/')
  })
})
