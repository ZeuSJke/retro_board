/**
 * Здоровье команды и оценка встречи.
 * Контракт: `backend/app/schemas.py` (HealthQuestion, HealthSummaryOut, HealthTrendPoint).
 */

/** Ответ светофором: 1 — красный, 2 — жёлтый, 3 — зелёный. */
export type HealthAnswerValue = 1 | 2 | 3

/** Оценка встречи: от 1 (зря потраченное время) до 5 (очень полезно). */
export type RotiValue = 1 | 2 | 3 | 4 | 5

/** Ключ оценки встречи в `HealthSummary.mine`. */
export const ROTI_KEY = 'roti'

export interface HealthQuestion {
  key: string
  title: string
  hint: string
}

/** Распределение ответов команды на один вопрос — без имён. */
export interface HealthQuestionSummary extends HealthQuestion {
  red: number
  yellow: number
  green: number
  answers: number
  /** Средний ответ от 1 до 3; `null` — на вопрос ещё никто не ответил. */
  average: number | null
}

export interface HealthRotiSummary {
  average: number | null
  answers: number
}

/** Сводка по доске из события `health_updated`: личных ответов в ней нет. */
export interface HealthTeamSummary {
  board_id: string
  /** Сколько участников ответили хотя бы на один вопрос. */
  participants: number
  questions: HealthQuestionSummary[]
  roti: HealthRotiSummary
}

/** Ответ `GET|POST /api/boards/{id}/health` и `POST …/roti`: сводка и свои ответы. */
export interface HealthSummary extends HealthTeamSummary {
  /** Ответы текущего участника: ключ вопроса (или `roti`) → значение. */
  mine: Record<string, number>
}

/** Точка `GET /api/boards/health-trends`: средние по вопросам на одной доске. */
export interface HealthTrendPoint {
  board_id: string
  board_name: string
  created_at: string
  /** Ключ вопроса → средний ответ (1–3). Вопросов без ответов в словаре нет. */
  averages: Record<string, number>
  /** Средняя оценка встречи (1–5); `null` — встречу не оценивали. */
  roti_average: number | null
}

/** Данные события `health_check_requested`: кто запустил опрос. */
export interface WsHealthCheckRequestedData {
  requested_by?: string
  participant_id?: string
}
