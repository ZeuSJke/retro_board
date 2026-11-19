import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CreateBoardDialog from '../../components/CreateBoardDialog'
import BoardsPanel from '../../components/BoardsPanel'
import { onBoardsRefreshRequested } from '../../lib/board-list-signals'
import { makeQueryClient } from '../../lib/query-client'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'
import type { BoardListItem } from '../../types'

const api = vi.hoisted(() => ({
  createBoard: vi.fn(),
  getBoardTemplates: vi.fn(),
  getAllActionItems: vi.fn(),
  updateActionItem: vi.fn(),
}))

vi.mock('../../api', () => api)

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

const item = (id: string, name: string, extra: Partial<BoardListItem> = {}): BoardListItem => ({
  id,
  name,
  slug: id,
  max_votes: 5,
  created_at: '2026-03-01T10:00:00Z',
  action_items_total: 0,
  action_items_open: 0,
  has_summary: false,
  cards_count: 0,
  ...extra,
})

beforeAll(() => {
  // Radix Switch и Select измеряют себя через ResizeObserver, которого нет в jsdom
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  api.getBoardTemplates.mockResolvedValue([])
  api.getAllActionItems.mockResolvedValue([])
})

afterEach(() => {
  act(() => {
    useAppStore.getState().clearSession()
  })
})

function dialogProps(existingBoards: BoardListItem[], open = true) {
  return { open, onOpenChange: vi.fn(), existingBoards, onCreated: vi.fn() }
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient()
  return render(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}

describe('CreateBoardDialog — форма новой доски', () => {
  it('введённое не сбрасывается, когда коллега меняет любую доску', async () => {
    const user = userEvent.setup()
    const boards = [item('b-1', 'Спринт 1')]
    const view = renderWithQuery(<CreateBoardDialog {...dialogProps(boards)} />)

    await user.type(screen.getByTestId('create-board-name-input'), 'Спринт 43')
    await user.click(screen.getByRole('button', { name: /4Ls/ }))
    await user.click(screen.getByTestId('create-anonymous-switch'))

    // Событие board_updated от коллеги: список досок у родителя — новый массив
    view.rerender(<CreateBoardDialog {...dialogProps([item('b-1', 'Спринт 1 (переименован)')])} />)

    expect(screen.getByTestId('create-board-name-input')).toHaveValue('Спринт 43')
    expect(screen.getByTestId('create-anonymous-switch')).toBeChecked()
    expect(screen.getByRole('button', { name: /4Ls/ }).className).toContain('border-primary')
  })

  it('каждое новое открытие начинается с чистой формы', async () => {
    const user = userEvent.setup()
    const boards = [item('b-1', 'Спринт 1')]
    const view = renderWithQuery(<CreateBoardDialog {...dialogProps(boards)} />)
    await user.type(screen.getByTestId('create-board-name-input'), 'Черновик')

    view.rerender(<CreateBoardDialog {...dialogProps(boards, false)} />)
    await waitFor(() => expect(screen.queryByTestId('create-board-name-input')).not.toBeInTheDocument())
    view.rerender(<CreateBoardDialog {...dialogProps(boards)} />)

    expect(await screen.findByTestId('create-board-name-input')).toHaveValue('')
  })

  it('кнопки закреплены: «Создать» вне прокручиваемой части, поля — внутри', () => {
    renderWithQuery(<CreateBoardDialog {...dialogProps([item('b-1', 'Спринт 1')])} />)

    const submit = screen.getByTestId('create-board-submit-btn')
    const nameInput = screen.getByTestId('create-board-name-input')
    expect(nameInput.closest('.overflow-y-auto')).not.toBeNull()
    expect(submit.closest('.overflow-y-auto')).toBeNull()
    // Кнопка остаётся в той же форме: Enter в поле названия создаёт доску
    expect(submit.closest('form')).toBe(nameInput.closest('form'))
  })

  it('«Свой набор колонок» начинает с пустой доски и создаёт её без колонок', async () => {
    const user = userEvent.setup()
    api.createBoard.mockResolvedValue({ id: 'b-new', name: 'Пусто', slug: 'pusto', columns: [] })
    const props = dialogProps([])
    renderWithQuery(<CreateBoardDialog {...props} />)

    // «Пустая доска» больше не отдельный выбор — пустой холст задаётся своим набором
    expect(screen.queryByRole('button', { name: /Пустая доска/ })).not.toBeInTheDocument()

    await user.type(screen.getByTestId('create-board-name-input'), 'Пусто')
    await user.click(screen.getByRole('button', { name: /Свой набор колонок/ }))
    expect(screen.getByText(/Колонок пока нет/)).toBeInTheDocument()

    await user.click(screen.getByTestId('create-board-submit-btn'))

    await waitFor(() =>
      expect(api.createBoard).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Пусто', template: 'custom', custom_columns: [] }),
      ),
    )
  })

  it('исходная доска для переноса задач: по умолчанию первая, выбранная не слетает от обновлений', async () => {
    const user = userEvent.setup()
    api.createBoard.mockResolvedValue({ id: 'b-new', name: 'Спринт 3', slug: 'sprint-3', columns: [] })
    const boards = [item('b-2', 'Спринт 2', { action_items_open: 4 }), item('b-1', 'Спринт 1')]
    const props = dialogProps(boards)
    const view = renderWithQuery(<CreateBoardDialog {...props} />)

    expect(screen.getByText('4 открытых')).toBeInTheDocument()
    await user.type(screen.getByTestId('create-board-name-input'), 'Спринт 3')
    await user.click(screen.getByRole('switch', { name: 'Перенести незакрытые задачи' }))

    // Счётчик исходной доски обновился, пока окно открыто, — форма это показывает, а не сбрасывается
    view.rerender(
      <CreateBoardDialog
        {...props}
        existingBoards={[item('b-2', 'Спринт 2', { action_items_open: 5 }), item('b-1', 'Спринт 1')]}
      />,
    )
    expect(screen.getByText('5 открытых')).toBeInTheDocument()
    await user.click(screen.getByTestId('create-board-submit-btn'))

    await waitFor(() =>
      expect(api.createBoard).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Спринт 3', carry_forward_items: true, source_board_id: 'b-2' }),
      ),
    )
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-new' }))
  })

  it('ошибка проверки названия показана по полю', async () => {
    const user = userEvent.setup()
    api.createBoard.mockRejectedValue({
      response: {
        status: 422,
        data: { detail: [{ type: 'string_too_long', loc: ['body', 'name'], ctx: { max_length: 120 } }] },
      },
    })
    renderWithQuery(<CreateBoardDialog {...dialogProps([])} />)

    await user.type(screen.getByTestId('create-board-name-input'), 'Спринт')
    await user.click(screen.getByTestId('create-board-submit-btn'))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Название доски: не длиннее 120 символов', 'error'),
    )
    // Форма остаётся открытой с введённым названием
    expect(screen.getByTestId('create-board-name-input')).toHaveValue('Спринт')
  })

  it('канбан разбора задач: обновляет статусы, снимает done из выбора и отправляет carry_forward_item_ids', async () => {
    const user = userEvent.setup()
    api.getAllActionItems.mockResolvedValue([
      {
        id: 't-1',
        board_id: 'b-1',
        board_name: 'Спринт 1',
        title: 'Починить тесты',
        text: 'Стабилизировать CI',
        assignee: 'Анна',
        status: 'open',
        source_card_ids: [],
        completed_at: null,
        created_at: '2026-03-01T10:00:00Z',
      },
      {
        id: 't-2',
        board_id: 'b-2',
        board_name: 'Спринт 2',
        title: 'Настроить алерты',
        text: 'Добавить оповещения в Slack',
        assignee: 'Борис',
        status: 'in_progress',
        source_card_ids: ['c-9'],
        completed_at: null,
        created_at: '2026-03-02T10:00:00Z',
      },
    ])
    api.updateActionItem.mockImplementation((id: string, data: Record<string, unknown>) =>
      Promise.resolve({ id, status: data.status }),
    )
    api.createBoard.mockResolvedValue({ id: 'b-new', name: 'Спринт 3', slug: 'sprint-3', columns: [] })

    const boards = [item('b-2', 'Спринт 2'), item('b-1', 'Спринт 1')]
    renderWithQuery(<CreateBoardDialog {...dialogProps(boards)} />)

    await user.type(screen.getByTestId('create-board-name-input'), 'Спринт 3')
    await user.click(screen.getByTestId('open-create-kanban-btn'))

    const panel = await screen.findByTestId('create-board-kanban-panel')
    expect(within(panel).getByText('Починить тесты')).toBeInTheDocument()
    expect(within(panel).getByText('Настроить алерты')).toBeInTheDocument()

    // Выбираем обе открытые задачи для переноса
    await user.click(screen.getByTestId('carry-select-t-1'))
    await user.click(screen.getByTestId('carry-select-t-2'))
    expect(screen.getByTestId('carry-select-t-1')).toBeChecked()
    expect(screen.getByTestId('carry-select-t-2')).toBeChecked()

    // Переводим t-2 в «Выполнено» прямо в канбане — чекбокс должен автоматически сняться
    const card2 = screen.getByTestId('action-item-card-t-2')
    await user.click(within(card2).getByTitle('В работе → Выполнено'))
    await waitFor(() => expect(api.updateActionItem).toHaveBeenCalledWith('t-2', { status: 'done' }))
    expect(within(panel).getByText('К переносу: 1')).toBeInTheDocument()
    // Колонка «Выполнено» по умолчанию свёрнута — разворачиваем и убеждаемся, что выбор снят и отключён
    await user.click(within(panel).getByRole('button', { name: 'Развернуть колонку Выполнено' }))
    expect(screen.getByTestId('carry-select-t-2')).not.toBeChecked()
    expect(screen.getByTestId('carry-select-t-2')).toBeDisabled()
    expect(screen.getByTestId('carry-select-t-1')).toBeChecked()

    await user.click(screen.getByTestId('create-board-submit-btn'))
    await waitFor(() =>
      expect(api.createBoard).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Спринт 3',
          carry_forward_items: false,
          carry_forward_item_ids: ['t-1'],
        }),
      ),
    )
  })

  it('кэш задач диалога изолирован по workspaceId при переключении команды', async () => {
    const client = makeQueryClient()
    const participant = { id: 'p-1', name: 'Анна' }
    act(() => {
      useAppStore.getState().setSession({
        workspace: { workspaceId: 'ws-1', workspaceName: 'Команда 1', workspaceSlug: 'team-1' },
        participant,
      })
    })
    api.getAllActionItems
      .mockResolvedValueOnce([
        {
          id: 't-ws1',
          board_id: 'b-1',
          board_name: 'Спринт 1',
          title: 'Задача команды 1',
          text: 'Детали 1',
          assignee: null,
          status: 'open',
          source_card_ids: [],
          completed_at: null,
          created_at: '2026-03-01T10:00:00Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 't-ws2',
          board_id: 'b-2',
          board_name: 'Спринт 2',
          title: 'Задача команды 2',
          text: 'Детали 2',
          assignee: null,
          status: 'open',
          source_card_ids: [],
          completed_at: null,
          created_at: '2026-03-02T10:00:00Z',
        },
      ])

    const boards = [item('b-1', 'Спринт 1')]
    const view = render(
      <QueryClientProvider client={client}>
        <CreateBoardDialog {...dialogProps(boards)} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(api.getAllActionItems).toHaveBeenCalledTimes(1))

    act(() => {
      useAppStore.getState().setSession({
        workspace: { workspaceId: 'ws-2', workspaceName: 'Команда 2', workspaceSlug: 'team-2' },
        participant: { id: 'p-2', name: 'Анна' },
      })
    })
    view.rerender(
      <QueryClientProvider client={client}>
        <CreateBoardDialog {...dialogProps([item('b-2', 'Спринт 2')])} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(api.getAllActionItems).toHaveBeenCalledTimes(2))
    const cachedKeys = client
      .getQueryCache()
      .findAll({ queryKey: ['create-board-dialog'] })
      .map((q) => q.queryKey)
    expect(cachedKeys).toContainEqual(['create-board-dialog', 'ws-1', 'action-items'])
    expect(cachedKeys).toContainEqual(['create-board-dialog', 'ws-2', 'action-items'])
  })
})

describe('BoardsPanel — счётчики досок', () => {
  const panelProps = (boards: BoardListItem[], open: boolean) => ({
    open,
    onOpenChange: vi.fn(),
    boards,
    currentBoardId: 'b-1',
    onSelectBoard: vi.fn(),
    onOpenCreateBoard: vi.fn(),
    onNavigateDashboard: vi.fn(),
  })

  it('при каждом открытии просит перечитать список досок', () => {
    const listener = vi.fn()
    const unsubscribe = onBoardsRefreshRequested(listener)
    try {
      const boards = [item('b-1', 'Спринт 1')]
      const view = render(<BoardsPanel {...panelProps(boards, false)} />)
      expect(listener).not.toHaveBeenCalled()

      view.rerender(<BoardsPanel {...panelProps(boards, true)} />)
      expect(listener).toHaveBeenCalledTimes(1)

      view.rerender(<BoardsPanel {...panelProps(boards, false)} />)
      view.rerender(<BoardsPanel {...panelProps(boards, true)} />)
      expect(listener).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
    }
  })

  it('показывает число карточек из списка, а не ноль', () => {
    render(<BoardsPanel {...panelProps([item('b-1', 'Спринт 1', { cards_count: 9 })], true)} />)

    expect(screen.getByTestId('board-cards-count')).toHaveTextContent('9 карт.')
    expect(screen.getByRole('button', { name: 'Панель управления' })).toBeInTheDocument()
  })
})
