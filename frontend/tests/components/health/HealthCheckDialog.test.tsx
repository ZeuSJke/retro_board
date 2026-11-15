import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  HEALTH_CHECK_START,
  HealthCheckDialog,
  RotiPrompt,
  useHealthCheck,
  type HealthCheckController,
} from '../../../components/health'
import type { WsMessage } from '../../../types'
import { useAppStore } from '../../../store'
import { showToast } from '../../../store/toastStore'
import { makeBroadcast, makeSummary } from './fixtures'

const mockGetBoardHealth = vi.fn()
const mockSubmitBoardHealth = vi.fn()
const mockSubmitBoardRoti = vi.fn()

vi.mock('../../../api/health', () => ({
  getBoardHealth: (...args: unknown[]) => mockGetBoardHealth(...args),
  submitBoardHealth: (...args: unknown[]) => mockSubmitBoardHealth(...args),
  submitBoardRoti: (...args: unknown[]) => mockSubmitBoardRoti(...args),
}))

vi.mock('../../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

// Состояние опроса последнего рендера: через него тесты присылают серверные события
const board: { health: HealthCheckController | null } = { health: null }
const live = (): HealthCheckController => {
  if (!board.health) throw new Error('BoardStub ещё не отрисован')
  return board.health
}

/** Так компоненты подключаются к доске: хук, два окна и кнопка в шапке. */
function BoardStub({ sendMessage }: { sendMessage?: (msg: WsMessage) => void }) {
  const health = useHealthCheck('b1')
  useEffect(() => {
    board.health = health
  })
  return (
    <>
      <button type="button" onClick={health.openDialog}>
        Health check
      </button>
      <HealthCheckDialog
        health={health}
        onStartForTeam={sendMessage ? () => sendMessage(HEALTH_CHECK_START) : undefined}
      />
      <RotiPrompt health={health} />
    </>
  )
}

async function renderBoard(sendMessage?: (msg: WsMessage) => void) {
  const user = userEvent.setup()
  render(<BoardStub sendMessage={sendMessage} />)
  await waitFor(() => expect(live().loading).toBe(false))
  return user
}

describe('HealthCheckDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      workspace: { workspaceId: 'w1', workspaceSlug: 'team', workspaceName: 'Команда' },
      participant: { id: 'p-1', name: 'Анна' },
    })
    mockGetBoardHealth.mockResolvedValue(makeSummary())
  })

  it('пять вопросов со светофором; ответы отправляются, после ответа — сводка без имён', async () => {
    const user = await renderBoard()
    await user.click(screen.getByRole('button', { name: 'Health check' }))

    const dialog = await screen.findByTestId('health-check-dialog')
    for (const title of ['Темп', 'Качество', 'Процесс', 'Атмосфера', 'Ясность целей']) {
      const group = within(dialog).getByRole('group', { name: title })
      expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'Плохо',
        'Средне',
        'Хорошо',
      ])
    }
    expect(screen.getByTestId('health-progress')).toHaveTextContent('Отвечено 0 из 5')
    expect(screen.getByTestId('health-submit')).toBeDisabled()

    await user.click(screen.getByTestId('health-answer-pace-3'))
    await user.click(screen.getByTestId('health-answer-quality-1'))
    // Передумал: повторный выбор заменяет ответ
    await user.click(screen.getByTestId('health-answer-quality-2'))
    expect(screen.getByTestId('health-answer-quality-2')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('health-answer-quality-1')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('health-progress')).toHaveTextContent('Отвечено 2 из 5')

    mockSubmitBoardHealth.mockResolvedValue(
      makeSummary(
        { pace: [0, 1, 2], quality: [1, 2, 0] },
        { participants: 3, mine: { pace: 3, quality: 2 } },
      ),
    )
    await user.click(screen.getByTestId('health-submit'))

    expect(mockSubmitBoardHealth).toHaveBeenCalledWith('b1', { pace: 3, quality: 2 })

    const summary = await screen.findByTestId('health-summary')
    expect(screen.getByTestId('health-participants')).toHaveTextContent('Ответили 3 участника')
    const pace = within(summary).getByTestId('health-summary-pace')
    expect(within(pace).getByRole('img')).toHaveAccessibleName(
      'Темп: плохо — 0, средне — 1, хорошо — 2',
    )
    expect(within(pace).getByText(/ваш ответ/)).toHaveTextContent('ваш ответ: Хорошо')
    expect(within(summary).getByTestId('health-summary-clarity')).toHaveTextContent('Ясность целей')
    // В сводке только распределение — имён участников нет
    expect(summary.textContent).not.toContain('Анна')
    expect(within(summary).getByText(/без имён/)).toBeInTheDocument()
  })

  it('сводка обновляется по событию health_updated, пока окно открыто', async () => {
    mockGetBoardHealth.mockResolvedValue(
      makeSummary({ pace: [0, 0, 1] }, { participants: 1, mine: { pace: 3 } }),
    )
    const user = await renderBoard()
    await user.click(screen.getByRole('button', { name: 'Health check' }))

    // Уже отвечал — окно открывается сразу на сводке
    expect(await screen.findByTestId('health-participants')).toHaveTextContent('Ответил 1 участник')

    act(() => {
      live().handleServerEvent({
        event: 'health_updated',
        data: makeBroadcast({ pace: [2, 0, 1] }, { participants: 3 }),
      })
    })

    expect(screen.getByTestId('health-participants')).toHaveTextContent('Ответили 3 участника')
    expect(within(screen.getByTestId('health-summary-pace')).getByRole('img')).toHaveAccessibleName(
      'Темп: плохо — 2, средне — 0, хорошо — 1',
    )
    // Свой ответ остался прежним: в событии личных ответов нет
    expect(screen.getByTestId('health-summary-pace')).toHaveTextContent('ваш ответ: Хорошо')
  })

  it('«Изменить ответы» возвращает к вопросам с прежними ответами', async () => {
    mockGetBoardHealth.mockResolvedValue(
      makeSummary({ pace: [0, 1, 0] }, { participants: 1, mine: { pace: 2 } }),
    )
    const user = await renderBoard()
    await user.click(screen.getByRole('button', { name: 'Health check' }))

    await user.click(await screen.findByTestId('health-edit-answers'))
    expect(screen.getByTestId('health-answer-pace-2')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('health-submit')).toHaveTextContent('Сохранить ответы')

    await user.click(screen.getByRole('button', { name: 'К сводке' }))
    expect(screen.getByTestId('health-summary')).toBeInTheDocument()
  })

  it('по запросу ведущего окно открывается само и называет, кто запустил опрос', async () => {
    await renderBoard()
    expect(screen.queryByTestId('health-check-dialog')).not.toBeInTheDocument()

    act(() => {
      live().handleServerEvent({
        event: 'health_check_requested',
        data: { requested_by: 'Борис', participant_id: 'p-2' },
      })
    })

    const dialog = await screen.findByTestId('health-check-dialog')
    expect(dialog).toHaveTextContent('Борис приглашает пройти опрос')
  })

  it('ошибка сохранения оставляет вопросы на экране', async () => {
    const user = await renderBoard()
    await user.click(screen.getByRole('button', { name: 'Health check' }))
    await user.click(await screen.findByTestId('health-answer-pace-1'))

    mockSubmitBoardHealth.mockRejectedValue({ response: { status: 500, data: {} } })
    await user.click(screen.getByTestId('health-submit'))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Не удалось сохранить ответы', 'error'),
    )
    expect(screen.queryByTestId('health-summary')).not.toBeInTheDocument()
    expect(screen.getByTestId('health-answer-pace-1')).toHaveAttribute('aria-pressed', 'true')
  })

  it('если сводка не загрузилась — сообщение и «Повторить»', async () => {
    mockGetBoardHealth.mockRejectedValue({ response: { status: 500, data: {} } })
    const user = await renderBoard()
    await user.click(screen.getByRole('button', { name: 'Health check' }))

    expect(await screen.findByText('Не удалось загрузить сводку опроса')).toBeInTheDocument()

    mockGetBoardHealth.mockResolvedValue(makeSummary())
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByTestId('health-progress')).toBeInTheDocument()
  })

  it('окно открывается со свежей сводкой, даже если события сокета были пропущены', async () => {
    mockGetBoardHealth.mockResolvedValue(
      makeSummary({ pace: [0, 0, 1] }, { participants: 1, mine: { pace: 3 } }),
    )
    const user = await renderBoard()

    // Пока окно было закрыто, ответили ещё двое, а событие до клиента не дошло
    mockGetBoardHealth.mockResolvedValue(
      makeSummary({ pace: [1, 1, 1] }, { participants: 3, mine: { pace: 3 } }),
    )
    await user.click(screen.getByRole('button', { name: 'Health check' }))

    await waitFor(() =>
      expect(screen.getByTestId('health-participants')).toHaveTextContent('Ответили 3 участника'),
    )
  })

  it('«Запустить у всех» есть только при переданном обработчике и шлёт health_check_start', async () => {
    const sendMessage = vi.fn()
    const user = await renderBoard(sendMessage)
    await user.click(screen.getByRole('button', { name: 'Health check' }))

    await user.click(await screen.findByTestId('health-start-for-team'))
    expect(sendMessage).toHaveBeenCalledWith({ event: 'health_check_start', data: {} })
  })

  it('без обработчика кнопки запуска у всех нет', async () => {
    const user = await renderBoard()
    await user.click(screen.getByRole('button', { name: 'Health check' }))
    await screen.findByTestId('health-progress')
    expect(screen.queryByTestId('health-start-for-team')).not.toBeInTheDocument()
  })

  it('в сводке видна оценка встречи, если её ставили', async () => {
    mockGetBoardHealth.mockResolvedValue(
      makeSummary(
        { pace: [0, 0, 2] },
        { participants: 2, mine: { pace: 3 }, roti: { average: 4.5, answers: 2 } },
      ),
    )
    const user = await renderBoard()
    await user.click(screen.getByRole('button', { name: 'Health check' }))
    expect(await screen.findByTestId('health-summary-roti')).toHaveTextContent(
      'Оценка встречи4.5 из 5 · 2 оценки',
    )
  })
})

describe('RotiPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      workspace: { workspaceId: 'w1', workspaceSlug: 'team', workspaceName: 'Команда' },
      participant: { id: 'p-1', name: 'Анна' },
    })
    mockGetBoardHealth.mockResolvedValue(makeSummary())
  })

  it('по событию roti_requested спрашивает оценку; один клик — и она отправлена', async () => {
    const user = await renderBoard()
    expect(screen.queryByTestId('roti-prompt')).not.toBeInTheDocument()

    act(() => {
      live().handleServerEvent({ event: 'roti_requested', data: {} })
    })
    const prompt = await screen.findByTestId('roti-prompt')
    expect(within(prompt).getByRole('group', { name: 'Оценка встречи' })).toBeInTheDocument()
    expect(within(prompt).getAllByRole('button', { name: /^\d — / })).toHaveLength(5)

    mockSubmitBoardRoti.mockResolvedValue(
      makeSummary({}, { mine: { roti: 4 }, roti: { average: 4, answers: 1 } }),
    )
    await user.click(screen.getByTestId('roti-option-4'))

    expect(mockSubmitBoardRoti).toHaveBeenCalledWith('b1', 4)
    await waitFor(() => expect(screen.queryByTestId('roti-prompt')).not.toBeInTheDocument())
    expect(showToast).toHaveBeenCalledWith('Спасибо! Оценка встречи сохранена', 'success')
  })

  it('уже оценившего по запросу сервера не переспрашивает; вручную — показывает его оценку', async () => {
    mockGetBoardHealth.mockResolvedValue(makeSummary({}, { mine: { roti: 5 } }))
    await renderBoard()

    act(() => {
      live().handleServerEvent({ event: 'roti_requested', data: {} })
    })
    expect(screen.queryByTestId('roti-prompt')).not.toBeInTheDocument()

    act(() => live().openRoti())
    expect(await screen.findByTestId('roti-option-5')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('roti-option-3')).toHaveAttribute('aria-pressed', 'false')
  })

  it('ошибка отправки оставляет окно открытым', async () => {
    const user = await renderBoard()
    act(() => live().onRotiRequested())
    mockSubmitBoardRoti.mockRejectedValue({ response: { status: 500, data: {} } })

    await user.click(await screen.findByTestId('roti-option-2'))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Не удалось сохранить оценку встречи', 'error'),
    )
    expect(screen.getByTestId('roti-prompt')).toBeInTheDocument()
    expect(screen.getByTestId('roti-option-2')).not.toBeDisabled()
  })

  it('«Не сейчас» закрывает окно без отправки', async () => {
    const user = await renderBoard()
    act(() => live().onRotiRequested())

    await user.click(await screen.findByRole('button', { name: 'Не сейчас' }))

    await waitFor(() => expect(screen.queryByTestId('roti-prompt')).not.toBeInTheDocument())
    expect(mockSubmitBoardRoti).not.toHaveBeenCalled()
  })
})
