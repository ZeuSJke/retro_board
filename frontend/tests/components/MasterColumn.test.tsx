import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MasterColumn, { selectPreviousOpenItems } from '../../components/MasterColumn'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'
import type { ActionItem, DashboardActionItem } from '../../types'

const mockCreateActionItem = vi.fn()
const mockUpdateActionItem = vi.fn()
const mockDeleteActionItem = vi.fn()
const mockGetAllActionItems = vi.fn()
const mockCarryForward = vi.fn()
const mockSuggestActionItems = vi.fn()

vi.mock('../../api', () => ({
  createActionItem: (...args: unknown[]) => mockCreateActionItem(...args),
  updateActionItem: (...args: unknown[]) => mockUpdateActionItem(...args),
  deleteActionItem: (...args: unknown[]) => mockDeleteActionItem(...args),
  getAllActionItems: (...args: unknown[]) => mockGetAllActionItems(...args),
  carryForward: (...args: unknown[]) => mockCarryForward(...args),
  suggestActionItems: (...args: unknown[]) => mockSuggestActionItems(...args),
}))

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

const sampleItem = (overrides: Partial<ActionItem> = {}): ActionItem => ({
  id: 'ai-1',
  board_id: 'b-1',
  title: 'Починить тесты',
  text: 'Добавить проверки для панели задач',
  assignee: 'Алиса',
  status: 'open',
  source_card_ids: [],
  completed_at: null,
  created_at: '2026-11-15T10:00:00Z',
  ...overrides,
})

describe('selectPreviousOpenItems', () => {
  it('excludes current board, completed items, and superseded originals', () => {
    const items: DashboardActionItem[] = [
      { ...sampleItem({ id: 'cur', board_id: 'b-1', status: 'open' }), board_name: 'Текущая' },
      { ...sampleItem({ id: 'done', board_id: 'b-0', status: 'done' }), board_name: 'Старая' },
      {
        ...sampleItem({
          id: 'sup',
          board_id: 'b-0',
          status: 'open',
          superseded_by_id: 'ai-copy',
        }),
        board_name: 'Старая',
      },
      { ...sampleItem({ id: 'keep', board_id: 'b-0', status: 'in_progress' }), board_name: 'Старая' },
    ]
    expect(selectPreviousOpenItems(items, 'b-1').map((i) => i.id)).toEqual(['keep'])
  })
})

describe('MasterColumn', () => {
  const onCreated = vi.fn()
  const onUpdated = vi.fn()
  const onRestored = vi.fn()
  const onDeleted = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ aiEnabled: true })
    mockGetAllActionItems.mockResolvedValue([])
  })

  it('renders empty state hints for normal, cardsHidden, and readOnly modes', () => {
    const { rerender } = render(
      <MasterColumn
        boardId="b-1"
        actionItems={[]}
        onCreated={onCreated}
        onUpdated={onUpdated}
        onDeleted={onDeleted}
      />,
    )
    expect(screen.getByText('Пока нет задач')).toBeInTheDocument()
    expect(screen.getByText(/Перетащите карточку сюда/)).toBeInTheDocument()
    expect(screen.getByTestId('ai-suggest-action-items-btn')).toBeEnabled()

    rerender(
      <MasterColumn
        boardId="b-1"
        actionItems={[]}
        cardsHidden
        onCreated={onCreated}
        onUpdated={onUpdated}
        onDeleted={onDeleted}
      />,
    )
    expect(screen.getByText(/Пока карточки скрыты/)).toBeInTheDocument()
    expect(screen.getByTestId('ai-suggest-action-items-btn')).toBeDisabled()

    rerender(
      <MasterColumn
        boardId="b-1"
        actionItems={[]}
        readOnly
        onCreated={onCreated}
        onUpdated={onUpdated}
        onDeleted={onDeleted}
      />,
    )
    expect(screen.getByText(/Доска заблокирована: новые задачи/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Добавить/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-suggest-action-items-btn')).not.toBeInTheDocument()
  })

  it('creates a manual action item and validates external URL', async () => {
    const user = userEvent.setup()
    const created = sampleItem({ id: 'ai-new', title: 'Релиз', text: 'Проверить миграции' })
    mockCreateActionItem.mockResolvedValueOnce(created)

    render(
      <MasterColumn
        boardId="b-1"
        actionItems={[]}
        participants={['Алиса', 'Борис']}
        onCreated={onCreated}
        onUpdated={onUpdated}
        onDeleted={onDeleted}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Добавить/ }))
    await user.type(screen.getByPlaceholderText('Краткий заголовок (опционально)'), 'Релиз')
    await user.type(screen.getByPlaceholderText('Что нужно сделать...'), 'Проверить миграции')
    await user.type(
      screen.getByPlaceholderText('Ссылка в трекере (опционально, https://...)'),
      'javascript:alert(1)',
    )
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    expect(screen.getByText(/Укажите ссылку http:\/\/ или https:\/\//)).toBeInTheDocument()
    expect(mockCreateActionItem).not.toHaveBeenCalled()

    const linkInput = screen.getByPlaceholderText('Ссылка в трекере (опционально, https://...)')
    await user.clear(linkInput)
    await user.type(linkInput, 'https://tracker.example/ISSUE-1')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() => {
      expect(mockCreateActionItem).toHaveBeenCalledWith({
        board_id: 'b-1',
        title: 'Релиз',
        text: 'Проверить миграции',
        assignee: undefined,
        external_url: 'https://tracker.example/ISSUE-1',
      })
    })
    expect(onCreated).toHaveBeenCalledWith(created)
    expect(showToast).toHaveBeenCalledWith('Задача создана', 'success')
  })

  it('cycles status (including on readOnly board) and rolls back on failure', async () => {
    const user = userEvent.setup()
    const openItem = sampleItem({ status: 'open' })
    const inProgress = { ...openItem, status: 'in_progress' as const }
    mockUpdateActionItem.mockResolvedValueOnce(inProgress)

    render(
      <MasterColumn
        boardId="b-1"
        actionItems={[openItem]}
        readOnly
        onUpdated={onUpdated}
        onDeleted={onDeleted}
      />,
    )

    const statusBtn = screen.getByTestId('action-item-status')
    expect(statusBtn).toBeEnabled()
    await user.click(statusBtn)

    expect(onUpdated).toHaveBeenNthCalledWith(1, inProgress)
    await waitFor(() => {
      expect(mockUpdateActionItem).toHaveBeenCalledWith('ai-1', { status: 'in_progress' })
    })

    // Rollback on failure
    mockUpdateActionItem.mockRejectedValueOnce(new Error('network'))
    await user.click(statusBtn)
    await waitFor(() => {
      expect(onUpdated).toHaveBeenLastCalledWith(openItem)
      expect(showToast).toHaveBeenCalledWith('Не удалось обновить статус', 'error')
    })
  })

  it('locks editing and status on superseded (carried) items, while allowing deletion on non-carried items', async () => {
    const user = userEvent.setup()
    const carried = sampleItem({
      id: 'ai-carried',
      title: 'Старая',
      superseded_by_id: 'ai-copy',
    })
    const active = sampleItem({ id: 'ai-active', title: 'Текущая' })
    mockDeleteActionItem.mockRejectedValueOnce(new Error('server error'))

    render(
      <MasterColumn
        boardId="b-1"
        actionItems={[carried, active]}
        onCreated={onCreated}
        onUpdated={onUpdated}
        onRestored={onRestored}
        onDeleted={onDeleted}
      />,
    )

    expect(screen.getByTestId('action-item-carried')).toHaveTextContent('Перенесена на другую доску')
    const statusButtons = screen.getAllByTestId('action-item-status')
    expect(statusButtons[0]).toBeDisabled()
    expect(statusButtons[1]).toBeEnabled()
    expect(screen.getByTestId('action-item-delete-btn-ai-carried')).toBeDisabled()

    await user.click(screen.getByTestId('action-item-delete-btn-ai-active'))
    expect(screen.getByText('Удалить задачу?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Удалить' }))

    expect(onDeleted).toHaveBeenCalledWith('ai-active')
    await waitFor(() => {
      expect(onRestored).toHaveBeenCalledWith(active)
      expect(showToast).toHaveBeenCalledWith('Не удалось удалить задачу', 'error')
    })
  })

  it('loads previous retro items on expand, retries errors, and pulls items to current board', async () => {
    const user = userEvent.setup()
    const prevOpen: DashboardActionItem = {
      ...sampleItem({ id: 'ai-old', board_id: 'b-prev', title: 'Хвост спринта' }),
      board_name: 'Спринт 11',
    }
    const copied = sampleItem({ id: 'ai-copy', board_id: 'b-1', title: 'Хвост спринта' })

    mockGetAllActionItems
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([prevOpen])
    mockCarryForward.mockResolvedValueOnce([copied])

    render(
      <MasterColumn
        boardId="b-1"
        actionItems={[]}
        onCreated={onCreated}
        onUpdated={onUpdated}
        onDeleted={onDeleted}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Открытые с прошлых ретро/ }))
    expect(await screen.findByTestId('prev-items-error')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Хвост спринта')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'На доску' }))
    await waitFor(() => {
      expect(mockCarryForward).toHaveBeenCalledWith({
        source_board_id: 'b-prev',
        target_board_id: 'b-1',
        item_ids: ['ai-old'],
      })
    })
    expect(onCreated).toHaveBeenCalledWith(copied)
    expect(showToast).toHaveBeenCalledWith('Задача перенесена на эту доску', 'success')
  })

  it('triggers AI suggestion dialog and handles non-configured AI fallback', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ aiEnabled: false })

    const { rerender } = render(
      <MasterColumn
        boardId="b-1"
        actionItems={[]}
        onCreated={onCreated}
        onUpdated={onUpdated}
        onDeleted={onDeleted}
      />,
    )
    expect(screen.queryByTestId('ai-suggest-action-items-btn')).not.toBeInTheDocument()

    useAppStore.setState({ aiEnabled: true })
    mockSuggestActionItems.mockResolvedValueOnce({
      suggestions: [{ title: 'Автозадача', text: 'Настроить мониторинг', assignee: 'Алиса', source_card_ids: ['c-1'] }],
    })
    const created = sampleItem({ id: 'ai-sug', title: 'Автозадача', text: 'Настроить мониторинг' })
    mockCreateActionItem.mockResolvedValueOnce(created)

    rerender(
      <MasterColumn
        boardId="b-1"
        actionItems={[]}
        onCreated={onCreated}
        onUpdated={onUpdated}
        onDeleted={onDeleted}
      />,
    )
    await user.click(screen.getByTestId('ai-suggest-action-items-btn'))
    expect(await screen.findByText('Настроить мониторинг')).toBeInTheDocument()
  })
})
