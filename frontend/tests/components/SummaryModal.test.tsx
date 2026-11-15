import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SummaryModal from '../../components/SummaryModal'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'
import type { ActionItem, Board, BoardSummary } from '../../types'

const api = vi.hoisted(() => ({
  getBoardSummary: vi.fn(),
  regenerateBoardSummary: vi.fn(),
}))

vi.mock('../../api', () => api)

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

const board: Board = {
  id: 'b-1',
  name: 'Спринт 42',
  slug: 'sprint-42',
  max_votes: 5,
  created_at: '2026-03-01T10:00:00Z',
  has_summary: false,
  columns: [],
}

const summary: BoardSummary = {
  id: 's-1',
  board_id: 'b-1',
  session_id: null,
  summary_text: 'Команда ускорила релизы.',
  key_themes: ['Релизы'],
  recommendations: ['Добавить тесты'],
  created_at: '2026-03-01T12:00:00Z',
}

const task = (id: string, extra: Partial<ActionItem> = {}): ActionItem => ({
  id,
  board_id: 'b-1',
  title: `Задача ${id}`,
  text: 'Текст',
  assignee: null,
  source_card_ids: [],
  status: 'open',
  completed_at: null,
  created_at: '2026-03-01T10:00:00Z',
  ...extra,
})

function renderSummary(props: Partial<React.ComponentProps<typeof SummaryModal>> = {}) {
  const onSummaryUpdated = vi.fn()
  const view = render(
    <SummaryModal
      open
      onOpenChange={vi.fn()}
      board={board}
      actionItems={[]}
      summary={null}
      loading={false}
      error={null}
      onSummaryUpdated={onSummaryUpdated}
      {...props}
    />,
  )
  return { ...view, onSummaryUpdated }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ aiEnabled: true })
})

describe('SummaryModal — одно уместное действие', () => {
  it('на вкладке Markdown кнопок генерации нет, даже когда итоги готовы', async () => {
    const user = userEvent.setup()
    renderSummary({ summary })
    expect(screen.getByTestId('regenerate-summary-btn')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Markdown и Slack' }))

    expect(screen.queryByTestId('regenerate-summary-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('generate-summary-btn')).not.toBeInTheDocument()
  })

  it('каждое открытие начинается с вкладки итогов', async () => {
    const user = userEvent.setup()
    const view = renderSummary({ summary })
    await user.click(screen.getByRole('tab', { name: 'Markdown и Slack' }))

    view.rerender(
      <SummaryModal
        open={false}
        onOpenChange={vi.fn()}
        board={board}
        actionItems={[]}
        summary={summary}
        loading={false}
        error={null}
        onSummaryUpdated={vi.fn()}
      />,
    )
    view.rerender(
      <SummaryModal
        open
        onOpenChange={vi.fn()}
        board={board}
        actionItems={[]}
        summary={summary}
        loading={false}
        error={null}
        onSummaryUpdated={vi.fn()}
      />,
    )

    expect(screen.getByRole('tab', { name: 'AI-резюме и темы' })).toHaveAttribute('data-state', 'active')
  })
})

describe('SummaryModal — AI не настроен', () => {
  it('объясняет причину и предлагает открыть экспорт', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ aiEnabled: false })
    renderSummary()

    expect(screen.getByTestId('ai-unavailable-note')).toHaveTextContent('AI на этом сервере не настроен')
    expect(screen.queryByTestId('summary-retry-btn')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('summary-open-export-btn'))

    expect(screen.getByRole('tab', { name: 'Markdown и Slack' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByText(/# Ретроспектива: Спринт 42/)).toBeInTheDocument()
  })
})

describe('SummaryModal — генерация не удалась', () => {
  it('показывает причину, «Повторить» и «Открыть экспорт» вместо одного красного текста', () => {
    renderSummary({ error: 'Не удалось сгенерировать итоги' })

    const state = screen.getByTestId('summary-error-state')
    expect(state).toHaveTextContent('Не удалось сгенерировать итоги')
    expect(state).toHaveTextContent('AI-сервис не ответил или вернул ошибку')
    expect(screen.getByTestId('summary-retry-btn')).toBeInTheDocument()
    expect(screen.getByTestId('summary-open-export-btn')).toBeInTheDocument()
    // Одно действие генерации: отдельной кнопки «Сгенерировать» в этом состоянии нет
    expect(screen.queryByTestId('generate-summary-btn')).not.toBeInTheDocument()
  })

  it('«Повторить» запускает генерацию заново, удача убирает ошибку', async () => {
    const user = userEvent.setup()
    api.regenerateBoardSummary.mockResolvedValue(summary)
    const { onSummaryUpdated, rerender } = renderSummary({ error: 'Не удалось сгенерировать итоги' })

    await user.click(screen.getByTestId('summary-retry-btn'))

    await waitFor(() => expect(onSummaryUpdated).toHaveBeenCalledWith(summary))
    expect(api.regenerateBoardSummary).toHaveBeenCalledWith('b-1')
    expect(api.getBoardSummary).not.toHaveBeenCalled()

    // Владелец состояния отдал итоги, а текст ошибки у него остался прежним
    rerender(
      <SummaryModal
        open
        onOpenChange={vi.fn()}
        board={{ ...board, has_summary: true }}
        actionItems={[]}
        summary={summary}
        loading={false}
        error="Не удалось сгенерировать итоги"
        onSummaryUpdated={onSummaryUpdated}
      />,
    )
    expect(screen.getByText('Команда ускорила релизы.')).toBeInTheDocument()
    expect(screen.queryByTestId('summary-error-state')).not.toBeInTheDocument()
    expect(screen.queryByTestId('summary-stale-note')).not.toBeInTheDocument()
  })

  it('повтор тоже не удался — состояние с действиями остаётся, причина в уведомлении', async () => {
    const user = userEvent.setup()
    api.regenerateBoardSummary.mockRejectedValue({
      response: { status: 502, data: { detail: 'Не удалось сгенерировать AI-резюме' } },
    })
    renderSummary({ error: 'Не удалось сгенерировать итоги' })

    await user.click(screen.getByTestId('summary-retry-btn'))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Не удалось сгенерировать AI-резюме', 'error'),
    )
    expect(screen.getByTestId('summary-error-state')).toBeInTheDocument()
    expect(screen.getByTestId('summary-retry-btn')).toBeEnabled()
  })

  it('новые итоги не получились, но прошлые есть: показывает их с пояснением', () => {
    renderSummary({
      board: { ...board, has_summary: true },
      summary,
      error: 'Не удалось сгенерировать итоги',
    })

    expect(screen.getByTestId('summary-stale-note')).toHaveTextContent(
      'Не удалось сгенерировать итоги. Ниже — итоги, сохранённые раньше.',
    )
    expect(screen.getByText('Команда ускорила релизы.')).toBeInTheDocument()
    expect(screen.queryByTestId('summary-error-state')).not.toBeInTheDocument()
  })
})

describe('SummaryModal — сохранённые итоги не загрузились', () => {
  it('«Повторить» перечитывает сохранённое, а не запускает генерацию', async () => {
    const user = userEvent.setup()
    api.getBoardSummary.mockResolvedValue(summary)
    const { onSummaryUpdated } = renderSummary({
      board: { ...board, has_summary: true },
      error: 'Не удалось загрузить AI-итоги',
    })

    expect(screen.getByTestId('summary-error-state')).toHaveTextContent('сохранены на сервере')
    await user.click(screen.getByTestId('summary-retry-btn'))

    await waitFor(() => expect(onSummaryUpdated).toHaveBeenCalledWith(summary))
    expect(api.getBoardSummary).toHaveBeenCalledWith('b-1')
    expect(api.regenerateBoardSummary).not.toHaveBeenCalled()
  })

  it('перечитать сохранённое можно и без настроенного AI', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ aiEnabled: false })
    api.getBoardSummary.mockResolvedValue(summary)
    const { onSummaryUpdated } = renderSummary({
      board: { ...board, has_summary: true },
      error: 'Не удалось загрузить AI-итоги',
    })

    await user.click(screen.getByTestId('summary-retry-btn'))

    await waitFor(() => expect(onSummaryUpdated).toHaveBeenCalledWith(summary))
  })
})

describe('SummaryModal — задачи в сводке', () => {
  it('перенесённая на другую доску задача в пост для Slack не попадает, в Markdown помечена', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderSummary({
      actionItems: [task('1'), task('2', { superseded_by_id: 'copy-2' })],
    })

    await user.click(screen.getByRole('tab', { name: 'Markdown и Slack' }))
    expect(screen.getByText(/Задача 2\*\* — Перенесена на другую доску/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Скопировать пост для Slack' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const post = writeText.mock.calls[0][0] as string
    expect(post).toContain('*Задачи (1):*')
    expect(post).toContain('Задача 1')
    expect(post).not.toContain('Задача 2')
  })
})
