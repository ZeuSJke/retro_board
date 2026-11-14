import { api } from './index'
import type {
  HealthAnswerValue,
  HealthQuestion,
  HealthSummary,
  HealthTrendPoint,
  RotiValue,
} from '../types/health'

/** Вопросы health check: одинаковые для всех досок, чтобы спринты были сравнимы. */
export const getHealthQuestions = (): Promise<HealthQuestion[]> =>
  api.get<HealthQuestion[]>('/boards/health/questions').then((r) => r.data)

/** Средние по вопросам и оценка встречи по доскам команды, от старых к новым. */
export const getHealthTrends = (): Promise<HealthTrendPoint[]> =>
  api.get<HealthTrendPoint[]>('/boards/health-trends').then((r) => r.data)

/** Сводка health check по доске и собственные ответы участника. */
export const getBoardHealth = (boardId: string): Promise<HealthSummary> =>
  api.get<HealthSummary>(`/boards/${boardId}/health`).then((r) => r.data)

/** Ответить на вопросы (можно на часть); повторный ответ заменяет прежний. */
export const submitBoardHealth = (
  boardId: string,
  answers: Record<string, HealthAnswerValue>,
): Promise<HealthSummary> =>
  api.post<HealthSummary>(`/boards/${boardId}/health`, { answers }).then((r) => r.data)

/** Оценить встречу одним числом от 1 до 5. */
export const submitBoardRoti = (boardId: string, value: RotiValue): Promise<HealthSummary> =>
  api.post<HealthSummary>(`/boards/${boardId}/roti`, { value }).then((r) => r.data)
