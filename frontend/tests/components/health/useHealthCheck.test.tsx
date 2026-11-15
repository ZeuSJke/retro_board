import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { HEALTH_CHECK_START, useHealthCheck } from '../../../components/health/useHealthCheck'
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

const ME = { id: 'p-1', name: 'Анна' }

async function setup(boardId: string | null = 'b1') {
  const view = renderHook((props: { boardId: string | null }) => useHealthCheck(props.boardId), {
    initialProps: { boardId },
  })
  if (boardId) await waitFor(() => expect(view.result.current.loading).toBe(false))
  return view
}

describe('useHealthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      workspace: { workspaceId: 'w1', workspaceSlug: 'team', workspaceName: 'Команда' },
      participant: ME,
    })
    mockGetBoardHealth.mockResolvedValue(makeSummary())
  })

  it('читает сводку доски и разделяет свои ответы и оценку встречи', async () => {
    mockGetBoardHealth.mockResolvedValue(
      makeSummary(
        { pace: [0, 1, 1] },
        { participants: 2, mine: { pace: 3, roti: 4 }, roti: { average: 4, answers: 1 } },
      ),
    )
    const { result } = await setup()

    expect(mockGetBoardHealth).toHaveBeenCalledWith('b1')
    expect(result.current.questions.map((q) => q.key)).toEqual([
      'pace',
      'quality',
      'process',
      'atmosphere',
      'clarity',
    ])
    expect(result.current.myAnswers).toEqual({ pace: 3 })
    expect(result.current.myRoti).toBe(4)
    expect(result.current.hasAnswered).toBe(true)
    expect(result.current.dialogOpen).toBe(false)
    expect(result.current.rotiOpen).toBe(false)
  })

  it('без сессии ничего не запрашивает', () => {
    useAppStore.setState({ participant: null })
    const { result } = renderHook(() => useHealthCheck('b1'))
    expect(mockGetBoardHealth).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    act(() => result.current.openDialog())
    expect(result.current.dialogOpen).toBe(false)
  })

  it('health_updated обновляет сводку и не трогает свои ответы', async () => {
    mockGetBoardHealth.mockResolvedValue(
      makeSummary({ pace: [0, 0, 1] }, { participants: 1, mine: { pace: 3 } }),
    )
    const { result } = await setup()

    act(() => {
      result.current.onHealthUpdated(makeBroadcast({ pace: [1, 0, 1] }, { participants: 2 }))
    })

    expect(result.current.summary?.participants).toBe(2)
    expect(result.current.questions[0]).toMatchObject({ red: 1, green: 1, answers: 2 })
    expect(result.current.myAnswers).toEqual({ pace: 3 })
  })

  it('события чужой доски и мусор игнорируются', async () => {
    const { result } = await setup()
    const before = result.current.summary

    act(() => {
      result.current.onHealthUpdated(makeBroadcast({ pace: [5, 0, 0] }, { board_id: 'other' }))
      result.current.onHealthUpdated(null)
      result.current.onHealthUpdated({ board_id: 'b1' })
      result.current.onHealthUpdated('строка')
    })

    expect(result.current.summary).toBe(before)
  })

  it('handleServerEvent разбирает три события и не трогает остальные', async () => {
    const { result } = await setup()

    let handled = false
    act(() => {
      handled = result.current.handleServerEvent({
        event: 'health_check_requested',
        data: { requested_by: 'Борис', participant_id: 'p-2' },
      })
    })
    expect(handled).toBe(true)
    expect(result.current.dialogOpen).toBe(true)
    expect(result.current.requestedBy).toBe('Борис')

    act(() => {
      handled = result.current.handleServerEvent({
        event: 'health_updated',
        data: makeBroadcast({ quality: [0, 2, 0] }, { participants: 2 }),
      })
    })
    expect(handled).toBe(true)
    expect(result.current.summary?.participants).toBe(2)

    act(() => {
      handled = result.current.handleServerEvent({ event: 'roti_requested', data: {} })
    })
    expect(handled).toBe(true)
    expect(result.current.rotiOpen).toBe(true)

    act(() => {
      handled = result.current.handleServerEvent({ event: 'card_deleted', data: { id: 'c-1' } })
    })
    expect(handled).toBe(false)
  })

  it('опрос, который запустил сам участник: окно открыто, имя не показывается, есть подтверждение', async () => {
    const { result } = await setup()
    act(() => {
      result.current.onHealthCheckRequested({ requested_by: ME.name, participant_id: ME.id })
    })
    expect(result.current.dialogOpen).toBe(true)
    expect(result.current.requestedBy).toBeNull()
    expect(showToast).toHaveBeenCalledWith('Опрос открыт у всех, кто сейчас на доске', 'success')
  })

  it('оценку встречи по запросу сервера не переспрашивает у того, кто уже оценил', async () => {
    mockGetBoardHealth.mockResolvedValue(makeSummary({}, { mine: { roti: 5 } }))
    const { result } = await setup()

    act(() => result.current.onRotiRequested())
    expect(result.current.rotiOpen).toBe(false)

    // Вручную окно открыть можно — чтобы изменить оценку
    act(() => result.current.openRoti())
    expect(result.current.rotiOpen).toBe(true)
    act(() => result.current.closeRoti())
    expect(result.current.rotiOpen).toBe(false)
  })

  it('запрос оценки во время загрузки сводки ждёт ответа сервера', async () => {
    let resolve: (value: unknown) => void = () => {}
    mockGetBoardHealth.mockReturnValue(new Promise((r) => (resolve = r)))
    const { result } = renderHook(() => useHealthCheck('b1'))

    act(() => result.current.onRotiRequested())
    expect(result.current.rotiOpen).toBe(false)

    await act(async () => {
      resolve(makeSummary())
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.rotiOpen).toBe(true))
  })

  it('submitAnswers сохраняет ответы и подставляет ответ сервера', async () => {
    const { result } = await setup()
    mockSubmitBoardHealth.mockResolvedValue(
      makeSummary({ pace: [0, 0, 1] }, { participants: 1, mine: { pace: 3 } }),
    )

    let ok = false
    await act(async () => {
      ok = await result.current.submitAnswers({ pace: 3 })
    })

    expect(ok).toBe(true)
    expect(mockSubmitBoardHealth).toHaveBeenCalledWith('b1', { pace: 3 })
    expect(result.current.myAnswers).toEqual({ pace: 3 })
    expect(result.current.summary?.participants).toBe(1)
    expect(result.current.submitting).toBe(false)
  })

  it('пустой набор ответов не отправляется', async () => {
    const { result } = await setup()
    let ok = true
    await act(async () => {
      ok = await result.current.submitAnswers({})
    })
    expect(ok).toBe(false)
    expect(mockSubmitBoardHealth).not.toHaveBeenCalled()
  })

  it('ошибка сохранения — один тост с текстом сервера, состояние прежнее', async () => {
    const { result } = await setup()
    mockSubmitBoardHealth.mockRejectedValue({
      response: { status: 404, data: { detail: 'Доска не найдена' } },
    })

    let ok = true
    await act(async () => {
      ok = await result.current.submitAnswers({ pace: 1 })
    })

    expect(ok).toBe(false)
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('Доска не найдена', 'error')
    expect(result.current.myAnswers).toEqual({})
    expect(result.current.submitting).toBe(false)
  })

  it('submitRoti сохраняет оценку, закрывает окно и благодарит', async () => {
    const { result } = await setup()
    mockSubmitBoardRoti.mockResolvedValue(
      makeSummary({}, { mine: { roti: 4 }, roti: { average: 4, answers: 1 } }),
    )
    act(() => result.current.onRotiRequested())
    expect(result.current.rotiOpen).toBe(true)

    await act(async () => {
      await result.current.submitRoti(4)
    })

    expect(mockSubmitBoardRoti).toHaveBeenCalledWith('b1', 4)
    expect(result.current.myRoti).toBe(4)
    expect(result.current.rotiOpen).toBe(false)
    expect(showToast).toHaveBeenCalledWith('Спасибо! Оценка встречи сохранена', 'success')
  })

  it('ошибка оценки встречи оставляет окно открытым', async () => {
    const { result } = await setup()
    mockSubmitBoardRoti.mockRejectedValue({ response: { status: 500, data: {} } })
    act(() => result.current.onRotiRequested())

    let ok = true
    await act(async () => {
      ok = await result.current.submitRoti(2)
    })

    expect(ok).toBe(false)
    expect(result.current.rotiOpen).toBe(true)
    expect(showToast).toHaveBeenCalledWith('Не удалось сохранить оценку встречи', 'error')
  })

  it('сообщение запуска опроса у всех — событие health_check_start без данных', () => {
    expect(HEALTH_CHECK_START).toEqual({ event: 'health_check_start', data: {} })
  })

  it('ошибка загрузки показывается, refresh повторяет запрос', async () => {
    mockGetBoardHealth.mockRejectedValueOnce({
      response: { status: 500, data: { detail: 'Сервис недоступен' } },
    })
    const { result } = await setup()

    expect(result.current.summary).toBeNull()
    expect(result.current.loadError).toBe('Сервис недоступен')

    mockGetBoardHealth.mockResolvedValueOnce(makeSummary({}, { participants: 3 }))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.summary?.participants).toBe(3))
    expect(result.current.loadError).toBeNull()
  })

  it('открытие окна и запрос ведущего перечитывают сводку', async () => {
    const { result } = await setup()
    expect(mockGetBoardHealth).toHaveBeenCalledTimes(1)

    act(() => result.current.openDialog())
    await waitFor(() => expect(mockGetBoardHealth).toHaveBeenCalledTimes(2))
    // Сводка, которая уже есть, остаётся на экране, пока идёт чтение
    expect(result.current.loading).toBe(false)

    act(() => result.current.onHealthCheckRequested({ requested_by: 'Борис', participant_id: 'p-2' }))
    await waitFor(() => expect(mockGetBoardHealth).toHaveBeenCalledTimes(3))
  })

  it('чтение, начатое до отправки ответов, не затирает ответ сервера на отправку', async () => {
    const { result } = await setup()

    let resolveRead: (value: unknown) => void = () => {}
    mockGetBoardHealth.mockReturnValueOnce(new Promise((r) => (resolveRead = r)))
    act(() => result.current.refresh())

    mockSubmitBoardHealth.mockResolvedValue(
      makeSummary({ pace: [0, 0, 1] }, { participants: 1, mine: { pace: 3 } }),
    )
    await act(async () => {
      await result.current.submitAnswers({ pace: 3 })
    })

    // Медленное чтение возвращает состояние до ответа
    await act(async () => {
      resolveRead(makeSummary())
      await Promise.resolve()
    })

    expect(result.current.myAnswers).toEqual({ pace: 3 })
    expect(result.current.summary?.participants).toBe(1)
  })

  it('событие, пришедшее во время чтения: сводка — из события, свои ответы — из чтения', async () => {
    mockGetBoardHealth.mockResolvedValue(
      makeSummary({ pace: [0, 0, 1] }, { participants: 1, mine: { pace: 3 } }),
    )
    const { result } = await setup()

    let resolveRead: (value: unknown) => void = () => {}
    mockGetBoardHealth.mockReturnValueOnce(new Promise((r) => (resolveRead = r)))
    act(() => result.current.refresh())

    act(() => {
      result.current.onHealthUpdated(makeBroadcast({ pace: [1, 1, 1] }, { participants: 3 }))
    })
    await act(async () => {
      resolveRead(
        makeSummary({ pace: [0, 1, 1] }, { participants: 2, mine: { pace: 3, quality: 2 } }),
      )
      await Promise.resolve()
    })

    expect(result.current.summary?.participants).toBe(3)
    expect(result.current.questions[0]).toMatchObject({ red: 1, yellow: 1, green: 1 })
    expect(result.current.myAnswers).toEqual({ pace: 3, quality: 2 })
  })

  it('при смене доски окна закрываются, сводка читается заново', async () => {
    const view = await setup('b1')
    act(() => view.result.current.openDialog())
    expect(view.result.current.dialogOpen).toBe(true)

    mockGetBoardHealth.mockResolvedValue(makeSummary({}, { board_id: 'b2', participants: 7 }))
    view.rerender({ boardId: 'b2' })

    expect(view.result.current.dialogOpen).toBe(false)
    await waitFor(() => expect(view.result.current.summary?.participants).toBe(7))
    expect(mockGetBoardHealth).toHaveBeenLastCalledWith('b2')
  })
})
