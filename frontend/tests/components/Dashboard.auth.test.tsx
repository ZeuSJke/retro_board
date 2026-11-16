import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dashboard from '../../components/Dashboard'
import { makeQueryClient } from '../../lib/query-client'
import { useAppStore } from '../../store'

const render = (ui: React.ReactElement) => {
  const client = makeQueryClient()
  return rtlRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}

const mockPush = vi.fn()
const mockGetBoards = vi.fn()
const mockGetAllActionItems = vi.fn()
const mockLoginToWorkspace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({ sendMessage: vi.fn(), connected: false }),
}))

vi.mock('../../api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../api')
  return {
    ...actual,
    getBoards: (...args: unknown[]) => mockGetBoards(...args),
    getAllActionItems: (...args: unknown[]) => mockGetAllActionItems(...args),
    updateActionItem: vi.fn(),
    deleteActionItem: vi.fn(),
    loginToWorkspace: (...args: unknown[]) => mockLoginToWorkspace(...args),
    // Сверка сессии идёт параллельно с данными дашборда — в этих тестах сети нет
    refreshWorkspaceSession: vi.fn(() => Promise.resolve({ ai_enabled: false })),
  }
})

vi.mock('../../api/themes', () => ({
  getTeamThemes: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../../api/health', () => ({
  getHealthTrends: vi.fn(() => Promise.resolve([])),
  getHealthQuestions: vi.fn(() => Promise.resolve([])),
}))

describe('Dashboard — 401 and workspace expiration recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      username: 'Алиса',
      currentBoardId: null,
      workspace: {
        workspaceId: 'w-1',
        workspaceSlug: 'team-a',
        workspaceName: 'Team A',
      },
      participant: { id: 'p-1', name: 'Алиса' },
    })
  })

  it('shows WelcomeDialog when loadData receives 401 and reloads boards on re-login', async () => {
    const user = userEvent.setup()

    mockGetBoards
      .mockImplementationOnce(() => {
        useAppStore.getState().clearSession()
        return Promise.reject(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }))
      })
      .mockResolvedValueOnce([
        {
          id: 'b-1',
          name: 'Восстановленная доска',
          slug: 'restored',
          max_votes: 5,
          created_at: '2026-01-01T00:00:00Z',
          action_items_total: 0,
          action_items_open: 0,
          has_summary: false,
        },
      ])
    mockGetAllActionItems
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce([])

    mockLoginToWorkspace.mockResolvedValueOnce({
      workspace: {
        workspaceId: 'w-1',
        workspaceSlug: 'team-a',
        workspaceName: 'Team A',
      },
      participant: { id: 'p-2', name: 'Алиса' },
    })

    render(<Dashboard />)

    // Должен появиться WelcomeDialog с полями входа в команду
    expect(await screen.findByRole('button', { name: /войти на доску/i })).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/код команды|fmrm/i), 'team-a')
    await user.type(screen.getByPlaceholderText(/ключ доступа/i), 'secret')
    await user.click(screen.getByRole('button', { name: /войти на доску/i }))

    await waitFor(() => {
      // Имя подставлено из прошлой сессии и уходит на сервер вместе с кодом и ключом
      expect(mockLoginToWorkspace).toHaveBeenCalledWith({
        workspace_slug: 'team-a',
        access_key: 'secret',
        name: 'Алиса',
      })
    })

    const boardsTab = await screen.findByRole('tab', { name: /Доски \(1\)/i })
    await user.click(boardsTab)

    await waitFor(() => {
      expect(screen.getAllByText('Восстановленная доска').length).toBeGreaterThan(0)
    })
  })

  it('shows WelcomeDialog when workspace state resets to null mid-session', async () => {
    mockGetBoards.mockResolvedValue([])
    mockGetAllActionItems.mockResolvedValue([])

    render(<Dashboard />)

    await waitFor(() => {
      expect(mockGetBoards).toHaveBeenCalledTimes(1)
    })

    expect(screen.queryByRole('button', { name: /войти на доску/i })).not.toBeInTheDocument()

    // Имитация сброса сессии axios interceptor-ом при 401 mid-session
    useAppStore.getState().clearSession()

    expect(await screen.findByRole('button', { name: /войти на доску/i })).toBeInTheDocument()
  })
})
