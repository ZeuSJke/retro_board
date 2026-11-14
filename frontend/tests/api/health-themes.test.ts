import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'

type ReqInterceptor = (config: { method?: string; headers: Record<string, string> }) => {
  method?: string
  headers: Record<string, string>
}
type ResErrorInterceptor = (err: unknown) => Promise<never>

// api/index.ts и api/client.ts создают по экземпляру axios: перехватчики собираем по порядку
// создания и берём последние — их регистрирует api/client.ts (он импортирует api/index.ts).
const { mockGet, mockPost, reqInterceptors, resErrInterceptors } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  reqInterceptors: [] as ReqInterceptor[],
  resErrInterceptors: [] as ResErrorInterceptor[],
}))

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: mockGet,
      post: mockPost,
      patch: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn((fn: ReqInterceptor) => reqInterceptors.push(fn)) },
        response: {
          use: vi.fn((_ok: unknown, errFn: ResErrorInterceptor) => resErrInterceptors.push(errFn)),
        },
      },
    })),
  },
}))

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

import {
  getBoardHealth,
  getHealthQuestions,
  getHealthTrends,
  submitBoardHealth,
  submitBoardRoti,
} from '../../api/health'
import { getTeamThemes } from '../../api/themes'
import { getApiErrorMessage } from '../../utils/apiError'

const clientRequest = () => reqInterceptors[reqInterceptors.length - 1]
const clientResponseError = () => resErrInterceptors[resErrInterceptors.length - 1]

describe('API health check и тем команды', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('вопросы и тренды — статические пути раньше /{board_id}', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ key: 'pace', title: 'Темп', hint: '' }] })
    expect(await getHealthQuestions()).toEqual([{ key: 'pace', title: 'Темп', hint: '' }])
    expect(mockGet).toHaveBeenLastCalledWith('/boards/health/questions')

    mockGet.mockResolvedValueOnce({ data: [] })
    expect(await getHealthTrends()).toEqual([])
    expect(mockGet).toHaveBeenLastCalledWith('/boards/health-trends')
  })

  it('сводка по доске', async () => {
    const summary = { board_id: 'b1', participants: 0, questions: [], roti: { average: null, answers: 0 }, mine: {} }
    mockGet.mockResolvedValueOnce({ data: summary })
    expect(await getBoardHealth('b1')).toEqual(summary)
    expect(mockGet).toHaveBeenCalledWith('/boards/b1/health')
  })

  it('ответы уходят словарём «вопрос → значение»', async () => {
    mockPost.mockResolvedValueOnce({ data: { board_id: 'b1' } })
    await submitBoardHealth('b1', { pace: 3, quality: 1 })
    expect(mockPost).toHaveBeenCalledWith('/boards/b1/health', { answers: { pace: 3, quality: 1 } })
  })

  it('оценка встречи уходит одним числом', async () => {
    mockPost.mockResolvedValueOnce({ data: { board_id: 'b1' } })
    await submitBoardRoti('b1', 4)
    expect(mockPost).toHaveBeenCalledWith('/boards/b1/roti', { value: 4 })
  })

  it('темы команды', async () => {
    mockGet.mockResolvedValueOnce({ data: [] })
    expect(await getTeamThemes()).toEqual([])
    expect(mockGet).toHaveBeenCalledWith('/boards/themes')
  })
})

describe('клиент новых модулей API: те же правила, что у основного', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      workspace: { workspaceId: 'w1', workspaceSlug: 'team-1', workspaceName: 'Team 1' },
      participant: { id: 'p-1', name: 'Анна' },
    })
    Object.defineProperty(document, 'cookie', { writable: true, value: 'csrf_token=csrf-abc-123' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('перехватчики клиента зарегистрированы отдельно от основного экземпляра', () => {
    expect(reqInterceptors.length).toBeGreaterThanOrEqual(2)
    expect(resErrInterceptors.length).toBeGreaterThanOrEqual(2)
  })

  it('небезопасные методы получают X-CSRF-Token, GET — нет', () => {
    const post = clientRequest()({ method: 'post', headers: {} })
    expect(post.headers['X-CSRF-Token']).toBe('csrf-abc-123')
    const get = clientRequest()({ method: 'get', headers: {} })
    expect(get.headers['X-CSRF-Token']).toBeUndefined()
  })

  it('ответ 401 сбрасывает сессию без тоста', async () => {
    vi.useFakeTimers()
    const error = { response: { status: 401, data: {} }, config: { url: '/boards/themes' } }
    await expect(clientResponseError()(error)).rejects.toBe(error)
    vi.runAllTimers()
    expect(useAppStore.getState().workspace).toBeNull()
    expect(useAppStore.getState().participant).toBeNull()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('ошибка сервера, о которой никто не сообщил, даёт общий тост', async () => {
    vi.useFakeTimers()
    const error = { response: { status: 500, data: {} }, config: { url: '/boards/health-trends' } }
    await expect(clientResponseError()(error)).rejects.toBe(error)
    vi.runAllTimers()
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('Что-то пошло не так', 'error')
  })

  it('если вызывающий код показал ошибку сам, второго тоста нет', async () => {
    vi.useFakeTimers()
    const error = {
      response: { status: 423, data: { detail: 'Доска заблокирована' } },
      config: { url: '/boards/b1/health' },
    }
    await expect(clientResponseError()(error)).rejects.toBe(error)
    expect(getApiErrorMessage(error, 'Не удалось сохранить ответы')).toBe('Доска заблокирована')
    vi.runAllTimers()
    expect(showToast).not.toHaveBeenCalled()
  })
})
