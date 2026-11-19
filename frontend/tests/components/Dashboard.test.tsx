import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render as rtlRender, screen, waitFor, fireEvent, within } from '@testing-library/react'
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
import { showToast } from '../../store/toastStore'
import { isApiErrorReported } from '../../utils/apiError'
import type { AgentToken, DashboardActionItem, WsMessage } from '../../types'
import type { HealthTrendPoint } from '../../types/health'
import type { TeamTheme } from '../../types/themes'

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

const mockItems: DashboardActionItem[] = [
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

// Признак ai_enabled приходит из /workspaces/me: сверка сессии кладёт его в стор
const serverState = { aiEnabled: true }
const mockGetBoard = vi.fn()
const mockGetBoardSummary = vi.fn()
const mockLogoutWorkspace = vi.fn(() => Promise.resolve())
const mockGetTeamThemes = vi.fn((): Promise<TeamTheme[]> => Promise.resolve([]))
const mockGetHealthTrends = vi.fn((): Promise<HealthTrendPoint[]> => Promise.resolve([]))

const mockCreateActionItem = vi.fn(
  (payload: {
    board_id?: string
    title?: string
    text?: string
    assignee?: string | null
    status?: 'open' | 'in_progress' | 'done'
    external_url?: string | null
  }) =>
    Promise.resolve({
      id: 'i-new',
      board_id: payload.board_id ?? 'b1',
      title: payload.title ?? payload.text ?? '',
      text: payload.text ?? '',
      assignee: payload.assignee ?? null,
      status: payload.status ?? 'open',
      source_card_ids: [],
      external_url: payload.external_url ?? null,
      completed_at: null,
      created_at: '2026-03-01T10:00:00Z',
    }),
)

vi.mock('../../api', () => ({
  getBoards: vi.fn(() => Promise.resolve(mockBoards)),
  getAllActionItems: vi.fn(() => Promise.resolve(mockItems)),
  getActionItemTrends: vi.fn(() => Promise.resolve([])),
  getMoodTrends: vi.fn(() => Promise.resolve([])),
  getWorkspaceInsights: () => mockGetWorkspaceInsights(),
  createActionItem: (payload: Record<string, unknown>) => mockCreateActionItem(payload),
  updateActionItem: vi.fn((id: string, data: Record<string, unknown>) =>
    Promise.resolve({ ...(mockItems.find((i) => i.id === id) ?? mockItems[0]), ...data }),
  ),
  deleteActionItem: vi.fn(() => Promise.resolve()),
  refreshWorkspaceSession: vi.fn(() => {
    useAppStore.getState().setAiEnabled(serverState.aiEnabled)
    return Promise.resolve({ ai_enabled: serverState.aiEnabled })
  }),
  getBoard: (...args: unknown[]) => mockGetBoard(...args),
  getBoardSummary: (...args: unknown[]) => mockGetBoardSummary(...args),
  regenerateBoardSummary: vi.fn(),
  logoutWorkspace: () => mockLogoutWorkspace(),
  renameParticipant: vi.fn(),
  loginToWorkspace: vi.fn(),
}))

vi.mock('../../api/themes', () => ({
  getTeamThemes: () => mockGetTeamThemes(),
}))

vi.mock('../../api/health', () => ({
  getHealthTrends: () => mockGetHealthTrends(),
  getHealthQuestions: vi.fn(() =>
    Promise.resolve([
      { key: 'pace', title: 'Темп', hint: 'Успеваем без переработок' },
      { key: 'quality', title: 'Качество', hint: 'Довольны тем, что выпускаем' },
    ]),
  ),
}))

const mockGetAgentTokens = vi.fn((): Promise<AgentToken[]> => Promise.resolve([]))
const mockCreateAgentToken = vi.fn()
const mockRevokeAgentToken = vi.fn()

vi.mock('../../api/agentTokens', () => ({
  getAgentTokens: () => mockGetAgentTokens(),
  createAgentToken: (payload: unknown) => mockCreateAgentToken(payload),
  revokeAgentToken: (tokenId: string) => mockRevokeAgentToken(tokenId),
}))

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

// Сокет команды: запоминаем обработчик, чтобы присылать события списка досок
const ws = { handler: null as ((msg: WsMessage) => void) | null }
vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: (_channel: string, onMessage: (msg: WsMessage) => void) => {
    ws.handler = onMessage
    return { sendMessage: vi.fn(), connected: true }
  },
}))

const fullBoard = (id: string, name: string) => ({
  id,
  name,
  slug: id,
  max_votes: 5,
  created_at: '2026-01-10T10:00:00Z',
  columns: [],
})

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverState.aiEnabled = true
    useAppStore.setState({
      _hasHydrated: true,
      username: 'Алиса',
      currentBoardId: 'b1',
      workspace: { workspaceId: 'w-1', workspaceSlug: 'team-a', workspaceName: 'Team A' },
      participant: { id: 'p-1', name: 'Алиса' },
      aiEnabled: null,
    })
  })

  it('renders KPI header, AI insights card, and tabs after loading', async () => {
    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Доски команды')).toBeInTheDocument()
    })

    expect(screen.getByText('Панель управления')).toBeInTheDocument()
    expect(screen.getByText('Аналитика по спринтам')).toBeInTheDocument()
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

const THEMES: TeamTheme[] = [
  {
    id: 't1',
    name: 'Долгое ревью',
    description: 'Пул-реквесты ждут ревью по несколько дней',
    boards_count: 3,
    streak: 3,
    last_board: { id: 'b2', name: 'Sprint 2', slug: 'sprint-2', created_at: '2026-02-10T10:00:00Z' },
  },
]

const resetSession = () => {
  vi.clearAllMocks()
  serverState.aiEnabled = true
  useAppStore.setState({
    username: 'Алиса',
    currentBoardId: 'b1',
    workspace: { workspaceId: 'w-1', workspaceSlug: 'team-a', workspaceName: 'Team A' },
    participant: { id: 'p-1', name: 'Алиса' },
    aiEnabled: null,
  })
}

describe('Dashboard — шапка', () => {
  beforeEach(() => {
    resetSession()
    // Панель досок (ScrollArea) и профиль (Switch) измеряют себя через ResizeObserver,
    // которого нет в jsdom
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('кнопка «Новая доска» доступна по названию и без подписи на узком экране', async () => {
    render(<Dashboard />)
    const button = await screen.findByTestId('dashboard-new-board-btn')
    expect(button).toHaveAccessibleName('Новая доска')
  })

  it('список досок открывается из шапки и ведёт на выбранную доску', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)

    await user.click(await screen.findByRole('button', { name: 'Список досок' }))
    const panel = await screen.findByRole('dialog', { name: 'Доски команды' })
    expect(within(panel).getByText('Sprint 1')).toBeInTheDocument()

    await user.click(within(panel).getByText('Sprint 2'))
    expect(mockPush).toHaveBeenCalledWith('/board/sprint-2')
  })

  it('профиль открывается из шапки; «Выйти» завершает сессию на сервере и показывает вход', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)

    await user.click(await screen.findByTestId('user-settings-btn'))
    expect(await screen.findByText('Профиль и оформление')).toBeInTheDocument()
    expect(screen.getByLabelText('Имя участника')).toHaveValue('Алиса')

    await user.click(screen.getByTestId('logout-btn'))

    await waitFor(() => expect(mockLogoutWorkspace).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: /войти на доску/i })).toBeInTheDocument()
    expect(useAppStore.getState().workspace).toBeNull()
  })

  it('кнопка «Новая задача» создаёт задачу через диалог без влияния на фильтры списка', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)
    await screen.findByText('Fix CI')

    await user.click(screen.getByTestId('dashboard-new-task-btn'))
    const dialog = await screen.findByTestId('new-task-dialog')
    await user.type(within(dialog).getByTestId('new-task-title-input'), 'Разобрать логи')
    await user.type(within(dialog).getByTestId('new-task-text-input'), 'Проверить алерты за неделю')
    await user.click(within(dialog).getByTestId('new-task-submit-btn'))

    await waitFor(() =>
      expect(mockCreateActionItem).toHaveBeenCalledWith(
        expect.objectContaining({
          board_id: 'b1',
          title: 'Разобрать логи',
          text: 'Проверить алерты за неделю',
          status: 'open',
        }),
      ),
    )
    expect(await screen.findByText('Разобрать логи')).toBeInTheDocument()
  })

  it('удаление задачи показывает 5-секундный тост с кнопкой отмены', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)
    await screen.findByText('Fix CI')

    const card = screen.getByTestId('action-item-card-i1')
    await user.click(within(card).getByTitle('Удалить'))
    const alertDialog = await screen.findByRole('alertdialog')
    await user.click(within(alertDialog).getByRole('button', { name: 'Удалить' }))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Задача удалена',
        'info',
        expect.objectContaining({
          duration: 5000,
          action: expect.objectContaining({ label: 'Отменить' }),
        }),
      ),
    )
  })
})

describe('Dashboard — темы команды, AI и health check', () => {
  beforeEach(resetSession)

  it('блок «Повторяющиеся темы» берёт темы из списка команды, а не из инсайтов', async () => {
    mockGetTeamThemes.mockResolvedValueOnce(THEMES)
    const user = userEvent.setup()
    render(<Dashboard />)

    const card = await screen.findByTestId('team-themes-card')
    expect(within(card).getByText('Долгое ревью')).toBeInTheDocument()
    expect(within(card).getByText('3-й спринт подряд')).toBeInTheDocument()
    expect(within(card).getByText(/на 3 досках/)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Sprint 2/ })).toHaveAttribute(
      'href',
      '/board/sprint-2',
    )

    // Инсайты присылают свои «темы» — на дашборде они темами не становятся
    await user.click(screen.getByRole('button', { name: /Собрать инсайты/i }))
    await screen.findByText('Команда стабильно закрывает задачи.')
    expect(screen.queryByText('CI/CD')).not.toBeInTheDocument()
    expect(within(card).getAllByTestId('team-theme')).toHaveLength(1)
  })

  it('темы не загрузились — блок говорит об этом и предлагает повторить', async () => {
    mockGetTeamThemes.mockRejectedValueOnce({ response: { status: 500, data: {} } })
    const user = userEvent.setup()
    render(<Dashboard />)

    const card = await screen.findByTestId('team-themes-card')
    expect(within(card).getByText('Не удалось загрузить темы команды')).toBeInTheDocument()

    mockGetTeamThemes.mockResolvedValueOnce(THEMES)
    await user.click(within(card).getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Долгое ревью')).toBeInTheDocument()
  })

  it('без AI: блок анализа назван сводкой, а пустые темы объясняют причину', async () => {
    serverState.aiEnabled = false
    render(<Dashboard />)

    expect(await screen.findByText('Сводка по спринтам')).toBeInTheDocument()
    expect(screen.queryByText('Аналитика по спринтам')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Собрать сводку' })).toBeInTheDocument()
    expect(screen.getByTestId('team-themes-ai-off')).toBeInTheDocument()
  })

  it('health check: без ответов — объяснение, откуда возьмётся динамика', async () => {
    render(<Dashboard />)
    const card = await screen.findByTestId('health-trends-card')
    expect(card).toHaveTextContent('Здоровье команды')
    expect(card).toHaveTextContent('Ответов пока нет')
  })

  it('health check: с ответами — ряд на каждый вопрос и оценка встречи', async () => {
    mockGetHealthTrends.mockResolvedValueOnce([
      {
        board_id: 'b1',
        board_name: 'Sprint 1',
        created_at: '2026-01-10T10:00:00Z',
        averages: { pace: 1.5, quality: 3 },
        roti_average: 4,
      },
      {
        board_id: 'b2',
        board_name: 'Sprint 2',
        created_at: '2026-02-10T10:00:00Z',
        averages: { pace: 2.5, quality: 3 },
        roti_average: 4.5,
      },
    ])
    render(<Dashboard />)

    // График подгружается отдельным чанком
    const pace = await screen.findByTestId('health-trend-row-pace', undefined, { timeout: 5000 })
    expect(pace).toHaveTextContent('Темп')
    expect(pace).toHaveTextContent('2.5')
    expect(screen.getByTestId('health-trend-row-quality')).toHaveTextContent('Качество')
    expect(screen.getByTestId('health-trend-row-roti')).toHaveTextContent('4.5')
    expect(screen.getByTestId('health-trends-card')).not.toHaveTextContent('Ответов пока нет')
  })
})

describe('Dashboard — значок «AI-итоги»', () => {
  beforeEach(resetSession)

  const openSummary = async () => {
    const user = userEvent.setup()
    render(<Dashboard />)
    await user.click(await screen.findByRole('tab', { name: /Доски/i }))
    await user.click(screen.getByRole('button', { name: 'AI-итоги доски «Sprint 1»' }))
    return user
  }

  it('доска не загрузилась — понятное сообщение вместо тишины', async () => {
    mockGetBoard.mockRejectedValueOnce({
      response: { status: 404, data: { detail: 'Доска не найдена' } },
    })
    await openSummary()

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Не удалось открыть итоги доски «Sprint 1». Доска не найдена',
        'error',
      ),
    )
    expect(screen.queryByText('Итоги ретроспективы')).not.toBeInTheDocument()
    expect(mockGetBoardSummary).not.toHaveBeenCalled()
    // Кнопка снова доступна — можно повторить
    expect(screen.getByRole('button', { name: 'AI-итоги доски «Sprint 1»' })).not.toBeDisabled()
  })

  it('нет ответа сервера — сообщение с подсказкой, что делать', async () => {
    mockGetBoard.mockRejectedValueOnce(new Error('Network Error'))
    await openSummary()

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Не удалось открыть итоги доски «Sprint 1». Проверьте соединение и попробуйте ещё раз.',
        'error',
      ),
    )
  })

  it('итогов у доски нет — открывается окно итогов с объяснением, значок у доски пропадает', async () => {
    mockGetBoard.mockResolvedValueOnce(fullBoard('b1', 'Sprint 1'))
    mockGetBoardSummary.mockResolvedValueOnce(null)
    await openSummary()

    // Что именно написано в пустом окне, решает SummaryModal; здесь важно, что оно открыто
    // для нужной доски и что это не ошибка
    const dialog = await screen.findByRole('dialog', { name: /Итоги ретроспективы/ })
    expect(dialog).toHaveTextContent('Sprint 1')
    expect(dialog).not.toHaveTextContent('Не удалось загрузить итоги доски')
    expect(showToast).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: 'AI-итоги доски «Sprint 1»', hidden: true }),
    ).not.toBeInTheDocument()
  })

  it('итоги не загрузились — ошибка показана в окне', async () => {
    mockGetBoard.mockResolvedValueOnce(fullBoard('b1', 'Sprint 1'))
    mockGetBoardSummary.mockRejectedValueOnce({ response: { status: 500, data: {} } })
    await openSummary()

    expect(await screen.findByText('Не удалось загрузить итоги доски')).toBeInTheDocument()
  })

  it('итоги есть — в окне видны темы с серией «N-й спринт подряд»', async () => {
    mockGetBoard.mockResolvedValueOnce(fullBoard('b1', 'Sprint 1'))
    mockGetBoardSummary.mockResolvedValueOnce({
      id: 's1',
      board_id: 'b1',
      session_id: 1,
      summary_text: 'Обсудили ревью.',
      key_themes: ['Долгое ревью', 'Новая тема'],
      recommendations: [],
      created_at: '2026-01-10T12:00:00Z',
      theme_stats: [
        { id: 't1', name: 'Долгое ревью', description: '', boards_count: 3, streak: 3 },
        { id: 't2', name: 'Новая тема', description: '', boards_count: 1, streak: 1 },
      ],
    })
    await openSummary()

    expect(await screen.findByText('Обсудили ревью.')).toBeInTheDocument()
    const badges = screen.getAllByTestId('theme-streak-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveTextContent('3-й спринт подряд')
  })
})

describe('Dashboard — одна реальная задача считается один раз', () => {
  beforeEach(resetSession)

  it('перенесённый оригинал не показывается и не попадает в счётчики', async () => {
    const apiMod = await import('../../api')
    // Сервер по умолчанию прячет перенесённые оригиналы; проверяем, что дашборд
    // не посчитает дубль, даже если оригинал придёт в ответе
    const withCarried: Array<DashboardActionItem & { superseded_by_id: string | null }> = [
      {
        ...mockItems[0],
        id: 'orig',
        title: 'Починить CI',
        board_id: 'b1',
        board_name: 'Sprint 1',
        superseded_by_id: 'copy',
      },
      {
        ...mockItems[0],
        id: 'copy',
        title: 'Починить CI',
        board_id: 'b2',
        board_name: 'Sprint 2',
        superseded_by_id: null,
      },
    ]
    vi.mocked(apiMod.getAllActionItems).mockResolvedValueOnce(withCarried)

    render(<Dashboard />)

    expect(await screen.findByRole('tab', { name: 'Задачи (1)' })).toBeInTheDocument()
    expect(screen.getAllByText('Починить CI')).toHaveLength(1)
    expect(screen.getByTestId('kpi-open-tasks')).toHaveTextContent(/^1$/)
  })

  it('карточки досок: «перенесены», «нет задач» и живой счётчик открытых', async () => {
    const user = userEvent.setup()
    const apiMod = await import('../../api')
    vi.mocked(apiMod.getBoards).mockResolvedValueOnce([
      // Все задачи первой доски перенесены: живых записей на ней нет
      { ...mockBoards[0], action_items_total: 2, action_items_open: 0 },
      { ...mockBoards[1], action_items_total: 1, action_items_open: 1 },
      {
        ...mockBoards[1],
        id: 'b3',
        name: 'Sprint 3',
        slug: 'sprint-3',
        action_items_total: 0,
        action_items_open: 0,
      },
    ])
    vi.mocked(apiMod.getAllActionItems).mockResolvedValueOnce([
      { ...mockItems[2], id: 'only', status: 'open' },
    ])

    render(<Dashboard />)
    await user.click(await screen.findByRole('tab', { name: /Доски/i }))

    const card = (name: string) => screen.getByText(name).closest('.rounded-xl') as HTMLElement
    expect(card('Sprint 1')).toHaveTextContent('Задачи перенесены')
    expect(card('Sprint 2')).toHaveTextContent('1 открыт.')
    expect(card('Sprint 3')).toHaveTextContent('Нет задач')

    // Закрываем задачу на вкладке задач — счётчик на карточке доски меняется сразу
    await user.click(screen.getByRole('tab', { name: /Задачи/i }))
    await user.click(screen.getByTitle('Открыто → В работе'))
    await user.click(await screen.findByTitle('В работе → Выполнено'))
    await user.click(screen.getByRole('tab', { name: /Доски/i }))
    await waitFor(() => expect(card('Sprint 2')).toHaveTextContent('Все задачи закрыты'))
  })

  it('«Открытых задач» — все незакрытые, как на карточках досок; задачи в работе названы отдельно', async () => {
    render(<Dashboard />)
    // В исходных данных: одна открытая, одна в работе, одна выполненная
    expect(await screen.findByTestId('kpi-open-tasks')).toHaveTextContent(/^2$/)
    expect(screen.getByText('в работе: 1')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Задачи (3)' })).toBeInTheDocument()
  })

  it('удаление доски у коллеги убирает и её задачи', async () => {
    render(<Dashboard />)
    expect(await screen.findByText('Fix CI')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Задачи (3)' })).toBeInTheDocument()

    act(() => {
      ws.handler?.({ event: 'board_deleted', data: { id: 'b1' } })
    })

    await waitFor(() => {
      expect(screen.queryByText('Fix CI')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('tab', { name: 'Задачи (1)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Доски (1)' })).toBeInTheDocument()
  })

  it('кнопка «Токены агентов» в шапке открывает настройки токенов команды', async () => {
    const user = userEvent.setup()
    mockGetAgentTokens.mockResolvedValueOnce([
      {
        id: 'tok-team',
        workspace_id: 'w-1',
        participant_id: 'p-bot-1',
        name: 'Team Helper',
        token_prefix: 'rba_team11',
        scope: 'read_only',
        created_by_id: 'p-1',
        created_at: '2026-11-14T10:00:00Z',
        last_used_at: null,
        revoked_at: null,
      },
    ])

    render(<Dashboard />)
    await screen.findByText('Fix CI')

    await user.click(screen.getByTestId('team-settings-btn'))
    const dialog = await screen.findByTestId('agent-tokens-dialog')
    expect(within(dialog).getByText('Team A')).toBeInTheDocument()
    expect(await within(dialog).findByText('Team Helper')).toBeInTheDocument()
  })

  it('на карточке задачи в дашборде можно прикрепить внешнюю ссылку', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)
    await screen.findByText('Fix CI')

    await user.click(screen.getByTestId('action-item-link-btn-i1'))
    const input = await screen.findByPlaceholderText('https://tracker.company.ru/TASK-1')
    await user.type(input, 'https://tracker.yandex.ru/RETRO-42')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    const api = await import('../../api')
    await waitFor(() =>
      expect(api.updateActionItem).toHaveBeenCalledWith('i1', {
        external_url: 'https://tracker.yandex.ru/RETRO-42',
      }),
    )
    const link = await screen.findByTestId('action-item-external-link')
    expect(link).toHaveAttribute('href', 'https://tracker.yandex.ru/RETRO-42')
  })

  it('до гидрации стора показывает индикатор загрузки вместо нулевых счётчиков и окна входа', () => {
    useAppStore.setState({ _hasHydrated: false, workspace: null, participant: null })
    render(<Dashboard />)

    expect(screen.getByText('Загружаем отчёты...')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-key-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kpi-open-tasks')).not.toBeInTheDocument()

    act(() => {
      useAppStore.setState({ _hasHydrated: true })
    })
    expect(screen.getByTestId('workspace-key-input')).toBeInTheDocument()
  })

  it('ошибка загрузки досок/задач помечается показанной и не вызывает повторный тост', async () => {
    const serverErr = Object.assign(new Error('Server Error'), {
      response: { status: 500, data: {} },
    })
    const apiMod = await import('../../api')
    vi.mocked(apiMod.getBoards).mockRejectedValueOnce(serverErr)

    render(<Dashboard />)
    expect(await screen.findByText('Не удалось загрузить аналитику')).toBeInTheDocument()
    expect(isApiErrorReported(serverErr)).toBe(true)
    expect(showToast).not.toHaveBeenCalled()
  })
})
