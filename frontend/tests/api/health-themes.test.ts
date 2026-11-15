import { describe, it, expect, vi, beforeEach } from 'vitest'

// Модули ходят через общий клиент из api/index.ts; его правила (CSRF, 401, тосты)
// проверяет tests/api/interceptors.test.ts.
const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: mockGet,
      post: mockPost,
      patch: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
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
