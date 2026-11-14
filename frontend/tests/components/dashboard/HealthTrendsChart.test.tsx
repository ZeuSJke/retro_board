import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import HealthTrendsChart from '../../../components/dashboard/HealthTrendsChart'
import type { HealthQuestion, HealthTrendPoint } from '../../../types/health'

const QUESTIONS: HealthQuestion[] = [
  { key: 'pace', title: 'Темп', hint: 'Успеваем без переработок и не простаиваем' },
  { key: 'quality', title: 'Качество', hint: 'Довольны тем, что выпускаем' },
  { key: 'process', title: 'Процесс', hint: 'Наш способ работы помогает' },
  { key: 'atmosphere', title: 'Атмосфера', hint: 'В команде комфортно' },
  { key: 'clarity', title: 'Ясность целей', hint: 'Понимаем, что делаем и зачем' },
]

const POINTS: HealthTrendPoint[] = [
  {
    board_id: 'b1',
    board_name: 'Спринт 1',
    created_at: '2026-10-01T10:00:00Z',
    averages: { pace: 1.4, quality: 3, process: 2, atmosphere: 3 },
    roti_average: null,
  },
  {
    board_id: 'b2',
    board_name: 'Спринт 2',
    created_at: '2026-10-15T10:00:00Z',
    averages: { pace: 2, quality: 2.5, process: 2, atmosphere: 3 },
    roti_average: 4.2,
  },
]

describe('HealthTrendsChart — динамика health check между досками', () => {
  it('ряд на каждый из пяти вопросов и ряд оценки встречи', () => {
    render(<HealthTrendsChart questions={QUESTIONS} points={POINTS} />)

    for (const key of ['pace', 'quality', 'process', 'atmosphere', 'clarity', 'roti']) {
      expect(screen.getByTestId(`health-trend-row-${key}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('health-trend-row-roti')).toHaveTextContent('Оценка встречи')
  })

  it('последнее значение, шкала, состояние словом и изменение к прошлой доске', () => {
    render(<HealthTrendsChart questions={QUESTIONS} points={POINTS} />)

    const pace = screen.getByTestId('health-trend-row-pace')
    expect(within(pace).getByTestId('health-trend-value-pace')).toHaveTextContent('2.0')
    expect(pace).toHaveTextContent('из 3')
    // Состояние названо словом, а не только цветом
    expect(pace).toHaveTextContent('Средне')
    expect(pace).toHaveTextContent('+0.6')

    const quality = screen.getByTestId('health-trend-row-quality')
    expect(quality).toHaveTextContent('Хорошо')
    expect(quality).toHaveTextContent('−0.5')

    expect(screen.getByTestId('health-trend-row-process')).toHaveTextContent('без изменений')

    const roti = screen.getByTestId('health-trend-row-roti')
    expect(within(roti).getByTestId('health-trend-value-roti')).toHaveTextContent('4.2')
    expect(roti).toHaveTextContent('из 5')
    // У оценки встречи светофора нет
    expect(roti).not.toHaveTextContent(/Плохо|Средне|Хорошо/)
  })

  it('вопрос без ответов честно пуст', () => {
    render(<HealthTrendsChart questions={QUESTIONS} points={POINTS} />)
    const clarity = screen.getByTestId('health-trend-row-clarity')
    expect(clarity).toHaveTextContent('Ответов пока нет')
    expect(within(clarity).queryByTestId('health-trend-value-clarity')).not.toBeInTheDocument()
  })

  it('те же числа доступны таблицей: доски подписаны названиями', () => {
    render(<HealthTrendsChart questions={QUESTIONS} points={POINTS} />)
    const table = screen.getByRole('table', { name: /Health check команды/ })
    expect(within(table).getByRole('columnheader', { name: 'Спринт 1' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Спринт 2' })).toBeInTheDocument()
    const paceRow = within(table).getByRole('rowheader', { name: /Темп/ }).closest('tr')!
    expect(within(paceRow).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1.4', '2.0'])
    const rotiRow = within(table).getByRole('rowheader', { name: /Оценка встречи/ }).closest('tr')!
    expect(within(rotiRow).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      'нет ответов',
      '4.2',
    ])
  })

  it('подпись под графиками называет первую и последнюю доску', () => {
    render(<HealthTrendsChart questions={QUESTIONS} points={POINTS} />)
    expect(screen.getByText(/от «Спринт 1» до «Спринт 2»/)).toBeInTheDocument()
  })

  it('одна доска — значение есть, сравнения нет', () => {
    render(<HealthTrendsChart questions={QUESTIONS} points={[POINTS[0]]} />)
    const pace = screen.getByTestId('health-trend-row-pace')
    expect(pace).toHaveTextContent('1.4')
    expect(pace).toHaveTextContent('Плохо')
    expect(pace).not.toHaveTextContent(/[+−]\d/)
    expect(screen.getByText(/Одна доска с ответами: «Спринт 1»/)).toBeInTheDocument()
  })

  it('без данных ничего не рисует', () => {
    const { container } = render(<HealthTrendsChart questions={QUESTIONS} points={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
