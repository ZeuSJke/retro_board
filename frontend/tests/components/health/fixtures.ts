import type { HealthQuestionSummary, HealthSummary } from '../../../types/health'

const QUESTIONS: Array<Pick<HealthQuestionSummary, 'key' | 'title' | 'hint'>> = [
  { key: 'pace', title: 'Темп', hint: 'Успеваем без переработок и не простаиваем' },
  { key: 'quality', title: 'Качество', hint: 'Довольны тем, что выпускаем, и не тонем в багах' },
  { key: 'process', title: 'Процесс', hint: 'Наш способ работы помогает, а не мешает' },
  { key: 'atmosphere', title: 'Атмосфера', hint: 'В команде комфортно и можно говорить открыто' },
  { key: 'clarity', title: 'Ясность целей', hint: 'Понимаем, что делаем и зачем' },
]

type Counts = Partial<Record<string, [red: number, yellow: number, green: number]>>

/** Сводка по доске в том виде, в каком её отдаёт сервер. */
export function makeSummary(
  counts: Counts = {},
  extra: Partial<Pick<HealthSummary, 'board_id' | 'participants' | 'roti' | 'mine'>> = {},
): HealthSummary {
  return {
    board_id: extra.board_id ?? 'b1',
    participants: extra.participants ?? 0,
    questions: QUESTIONS.map((q) => {
      const [red, yellow, green] = counts[q.key] ?? [0, 0, 0]
      const answers = red + yellow + green
      return {
        ...q,
        red,
        yellow,
        green,
        answers,
        average: answers ? Math.round(((red + 2 * yellow + 3 * green) / answers) * 100) / 100 : null,
      }
    }),
    roti: extra.roti ?? { average: null, answers: 0 },
    mine: extra.mine ?? {},
  }
}

/** Та же сводка без личных ответов — данные события `health_updated`. */
export function makeBroadcast(counts: Counts = {}, extra: Parameters<typeof makeSummary>[1] = {}) {
  const summary = makeSummary(counts, extra)
  // Тип — обычный объект (а не интерфейс), чтобы подходить и под `WsMessage.data`
  return {
    board_id: summary.board_id,
    participants: summary.participants,
    questions: summary.questions,
    roti: summary.roti,
  }
}
