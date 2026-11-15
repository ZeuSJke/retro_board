import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CreateBoardDialog from '../../components/CreateBoardDialog'
import BoardsPanel from '../../components/BoardsPanel'
import { onBoardsRefreshRequested } from '../../lib/board-list-signals'
import { showToast } from '../../store/toastStore'
import type { BoardListItem } from '../../types'

const api = vi.hoisted(() => ({
  createBoard: vi.fn(),
  getBoardTemplates: vi.fn(),
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
})

function dialogProps(existingBoards: BoardListItem[], open = true) {
  return { open, onOpenChange: vi.fn(), existingBoards, onCreated: vi.fn() }
}

describe('CreateBoardDialog — форма новой доски', () => {
  it('введённое не сбрасывается, когда коллега меняет любую доску', async () => {
    const user = userEvent.setup()
    const boards = [item('b-1', 'Спринт 1')]
    const view = render(<CreateBoardDialog {...dialogProps(boards)} />)

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
    const view = render(<CreateBoardDialog {...dialogProps(boards)} />)
    await user.type(screen.getByTestId('create-board-name-input'), 'Черновик')

    view.rerender(<CreateBoardDialog {...dialogProps(boards, false)} />)
    await waitFor(() => expect(screen.queryByTestId('create-board-name-input')).not.toBeInTheDocument())
    view.rerender(<CreateBoardDialog {...dialogProps(boards)} />)

    expect(await screen.findByTestId('create-board-name-input')).toHaveValue('')
  })

  it('кнопки закреплены: «Создать» вне прокручиваемой части, поля — внутри', () => {
    render(<CreateBoardDialog {...dialogProps([item('b-1', 'Спринт 1')])} />)

    const submit = screen.getByTestId('create-board-submit-btn')
    const nameInput = screen.getByTestId('create-board-name-input')
    expect(nameInput.closest('.overflow-y-auto')).not.toBeNull()
    expect(submit.closest('.overflow-y-auto')).toBeNull()
    // Кнопка остаётся в той же форме: Enter в поле названия создаёт доску
    expect(submit.closest('form')).toBe(nameInput.closest('form'))
  })

  it('исходная доска для переноса задач: по умолчанию первая, выбранная не слетает от обновлений', async () => {
    const user = userEvent.setup()
    api.createBoard.mockResolvedValue({ id: 'b-new', name: 'Спринт 3', slug: 'sprint-3', columns: [] })
    const boards = [item('b-2', 'Спринт 2', { action_items_open: 4 }), item('b-1', 'Спринт 1')]
    const props = dialogProps(boards)
    const view = render(<CreateBoardDialog {...props} />)

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
    render(<CreateBoardDialog {...dialogProps([])} />)

    await user.type(screen.getByTestId('create-board-name-input'), 'Спринт')
    await user.click(screen.getByTestId('create-board-submit-btn'))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Название доски: не длиннее 120 символов', 'error'),
    )
    // Форма остаётся открытой с введённым названием
    expect(screen.getByTestId('create-board-name-input')).toHaveValue('Спринт')
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
