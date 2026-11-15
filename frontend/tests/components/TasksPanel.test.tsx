import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MasterColumn, { selectPreviousOpenItems } from '../../components/MasterColumn'
import SuggestActionItemsDialog from '../../components/SuggestActionItemsDialog'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'
import type { ActionItem, DashboardActionItem } from '../../types'

const api = vi.hoisted(() => ({
  carryForward: vi.fn(),
  createActionItem: vi.fn(),
  deleteActionItem: vi.fn(),
  getAllActionItems: vi.fn(),
  suggestActionItems: vi.fn(),
  updateActionItem: vi.fn(),
}))

vi.mock('../../api', () => api)

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

const task = (id: string, extra: Partial<ActionItem> = {}): ActionItem => ({
  id,
  board_id: 'b-current',
  title: `Задача ${id}`,
  text: `Текст ${id}`,
  assignee: null,
  source_card_ids: [],
  status: 'open',
  completed_at: null,
  created_at: '2026-03-01T10:00:00Z',
  ...extra,
})

const prevTask = (id: string, extra: Partial<DashboardActionItem> = {}): DashboardActionItem => ({
  ...task(id),
  board_id: 'b-old',
  board_name: 'Спринт 1',
  ...extra,
})

function renderPanel(props: Partial<React.ComponentProps<typeof MasterColumn>> = {}) {
  const handlers = { onCreated: vi.fn(), onUpdated: vi.fn(), onDeleted: vi.fn() }
  const view = render(
    <MasterColumn boardId="b-current" actionItems={[]} {...handlers} {...props} />,
  )
  return { ...view, ...handlers }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ aiEnabled: true })
})

describe('Панель «Задачи» — блок «Открытые с прошлых ретро»', () => {
  it('панель называется «Задачи»', () => {
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Задачи' })).toBeInTheDocument()
  })

  it('в блок не попадают задачи этой доски, закрытые и перенесённые оригиналы', () => {
    const picked = selectPreviousOpenItems(
      [
        prevTask('open'),
        prevTask('in-progress', { status: 'in_progress' }),
        prevTask('done', { status: 'done' }),
        prevTask('carried', { superseded_by_id: 'copy' }),
        prevTask('own', { board_id: 'b-current' }),
      ],
      'b-current',
    )
    expect(picked.map((i) => i.id)).toEqual(['open', 'in-progress'])
  })

  it('ошибка загрузки — отдельное состояние с «Повторить», а не «все задачи закрыты»', async () => {
    const user = userEvent.setup()
    api.getAllActionItems.mockRejectedValueOnce({
      response: { status: 500, data: { detail: 'Внутренняя ошибка сервера' } },
    })
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Открытые с прошлых ретро/ }))

    const error = await screen.findByTestId('prev-items-error')
    expect(error).toHaveTextContent('Не удалось загрузить задачи прошлых ретро')
    expect(error).toHaveTextContent('Внутренняя ошибка сервера')
    expect(screen.queryByText('Все задачи с прошлых ретро закрыты.')).not.toBeInTheDocument()

    api.getAllActionItems.mockResolvedValue([prevTask('open')])
    await user.click(within(error).getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('Задача open')).toBeInTheDocument()
    expect(screen.queryByTestId('prev-items-error')).not.toBeInTheDocument()
  })

  it('пустой ответ сервера — честное «все закрыты»', async () => {
    const user = userEvent.setup()
    api.getAllActionItems.mockResolvedValue([])
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Открытые с прошлых ретро/ }))

    expect(await screen.findByText('Все задачи с прошлых ретро закрыты.')).toBeInTheDocument()
  })

  it('«На доску» переносит задачу, а не создаёт её копию', async () => {
    const user = userEvent.setup()
    const copy = task('copy', { title: 'Задача open' })
    api.getAllActionItems.mockResolvedValue([prevTask('open')])
    api.carryForward.mockResolvedValue([copy])
    const { onCreated } = renderPanel()

    await user.click(screen.getByRole('button', { name: /Открытые с прошлых ретро/ }))
    await user.click(await screen.findByRole('button', { name: 'На доску' }))

    await waitFor(() =>
      expect(api.carryForward).toHaveBeenCalledWith({
        source_board_id: 'b-old',
        target_board_id: 'b-current',
        item_ids: ['open'],
      }),
    )
    // Сервер пометил оригинал перенесённым: второй записи для той же задачи нет
    expect(api.createActionItem).not.toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledWith(copy)
    // Оригинал из блока уходит: рядом со своей копией он больше не показывается
    await waitFor(() => expect(screen.queryByRole('button', { name: 'На доску' })).not.toBeInTheDocument())
    expect(showToast).toHaveBeenCalledWith('Задача перенесена на эту доску', 'success')
  })

  it('задачу уже перенесли — вторая копия не появляется, список обновляется', async () => {
    const user = userEvent.setup()
    api.getAllActionItems.mockResolvedValue([prevTask('open')])
    api.carryForward.mockResolvedValue([])
    const { onCreated } = renderPanel()

    await user.click(screen.getByRole('button', { name: /Открытые с прошлых ретро/ }))
    await user.click(await screen.findByRole('button', { name: 'На доску' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'На доску' })).not.toBeInTheDocument())
    expect(onCreated).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('уже перенесли'), 'info')
  })
})

describe('Панель «Задачи» — статус задачи', () => {
  it('на заблокированной доске статус меняется: работа над задачами идёт и после ретро', async () => {
    const user = userEvent.setup()
    const item = task('1')
    api.updateActionItem.mockResolvedValue({ ...item, status: 'in_progress' })
    const { onUpdated } = renderPanel({ actionItems: [item], readOnly: true })

    const status = screen.getByTestId('action-item-status')
    expect(status).toBeEnabled()
    expect(status).toHaveAttribute('title', 'Статус: Открыто — нажмите, чтобы сменить')
    await user.click(status)

    await waitFor(() => expect(api.updateActionItem).toHaveBeenCalledWith('1', { status: 'in_progress' }))
    expect(onUpdated).toHaveBeenLastCalledWith({ ...item, status: 'in_progress' })
  })

  it('на заблокированной доске задачи нельзя добавлять и удалять', () => {
    renderPanel({ actionItems: [task('1')], readOnly: true })

    expect(screen.queryByRole('button', { name: 'Добавить' })).not.toBeInTheDocument()
    expect(screen.queryByTitle('Удалить задачу')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-suggest-action-items-btn')).not.toBeInTheDocument()
  })

  it('перенесённая задача помечена, её статус здесь не меняется', async () => {
    const user = userEvent.setup()
    renderPanel({ actionItems: [task('1', { superseded_by_id: 'copy' })] })

    expect(screen.getByTestId('action-item-carried')).toHaveTextContent('Перенесена на другую доску')
    const status = screen.getByTestId('action-item-status')
    expect(status).toBeDisabled()
    expect(status.getAttribute('title')).not.toContain('нажмите')
    await user.click(status)

    expect(api.updateActionItem).not.toHaveBeenCalled()
  })
})

describe('Панель «Задачи» — AI-подбор', () => {
  it('ошибка AI: окно остаётся и называет причину, «Повторить» спрашивает ещё раз', async () => {
    const user = userEvent.setup()
    api.suggestActionItems.mockRejectedValueOnce({
      response: { status: 503, data: { detail: 'Не удалось получить предложения от AI' } },
    })
    renderPanel()

    await user.click(screen.getByTestId('ai-suggest-action-items-btn'))

    const error = await screen.findByTestId('suggest-error')
    expect(error).toHaveTextContent('Не удалось получить предложения от AI')
    expect(screen.queryByTestId('suggest-empty')).not.toBeInTheDocument()
    // Причина названа в окне — второго сообщения тостом нет
    expect(showToast).not.toHaveBeenCalled()

    api.suggestActionItems.mockResolvedValue({
      board_id: 'b-current',
      suggestions: [{ title: 'Ускорить ревью', text: 'Договориться о сроках', source_card_ids: [] }],
    })
    await user.click(within(error).getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByDisplayValue('Ускорить ревью')).toBeInTheDocument()
    expect(screen.queryByTestId('suggest-error')).not.toBeInTheDocument()
  })

  it('сервер ответил «AI не настроен»: это не ошибка и не «мало данных»', async () => {
    const user = userEvent.setup()
    // Признак ai_enabled ещё не известен, кнопка показана
    useAppStore.setState({ aiEnabled: null })
    api.suggestActionItems.mockRejectedValue({
      response: { status: 503, data: { detail: 'AI сервис не настроен' } },
    })
    renderPanel()

    await user.click(screen.getByTestId('ai-suggest-action-items-btn'))

    expect(await screen.findByTestId('suggest-not-configured')).toHaveTextContent(
      'AI на этом сервере не настроен',
    )
    expect(screen.queryByTestId('suggest-error')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument()
  })

  it('AI отработал, но предложить нечего — «мало данных»', async () => {
    const user = userEvent.setup()
    api.suggestActionItems.mockResolvedValue({ board_id: 'b-current', suggestions: [] })
    renderPanel()

    await user.click(screen.getByTestId('ai-suggest-action-items-btn'))

    expect(await screen.findByTestId('suggest-empty')).toHaveTextContent('Предложить пока нечего')
    expect(screen.queryByTestId('suggest-error')).not.toBeInTheDocument()
  })
})

describe('SuggestActionItemsDialog — состояния', () => {
  const base = {
    open: true,
    onOpenChange: vi.fn(),
    loading: false,
    suggestions: [],
    onCreateSelected: vi.fn(),
  }

  it('три разных причины пустого окна выглядят по-разному', () => {
    const empty = render(<SuggestActionItemsDialog {...base} />)
    expect(screen.getByTestId('suggest-empty')).toBeInTheDocument()
    empty.unmount()

    const failed = render(
      <SuggestActionItemsDialog {...base} failure={{ kind: 'error', message: 'Сервис не ответил' }} />,
    )
    expect(screen.getByTestId('suggest-error')).toHaveTextContent('Сервис не ответил')
    failed.unmount()

    render(
      <SuggestActionItemsDialog
        {...base}
        failure={{ kind: 'not_configured', message: 'AI сервис не настроен' }}
      />,
    )
    expect(screen.getByTestId('suggest-not-configured')).toBeInTheDocument()
  })

  it('старый текст «AI не нашёл достаточно данных» при ошибке не показывается', () => {
    render(
      <SuggestActionItemsDialog {...base} failure={{ kind: 'error', message: 'Сервис не ответил' }} />,
    )
    expect(screen.queryByText(/не нашёл достаточно данных/)).not.toBeInTheDocument()
  })
})
