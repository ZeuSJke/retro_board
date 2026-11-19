import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ThemeStreakBadge, {
  findThemeStat,
  getThemeStats,
} from '../../../components/dashboard/ThemeStreakBadge'
import SummaryModal from '../../../components/SummaryModal'
import type { Board, BoardSummary } from '../../../types'
import type { BoardThemeStat } from '../../../types/themes'

vi.mock('../../../api', () => ({
  regenerateBoardSummary: vi.fn(),
}))

const STATS: BoardThemeStat[] = [
  { id: 't1', name: 'Долгое ревью', description: '', boards_count: 3, streak: 3 },
  { id: 't2', name: 'Нестабильные тесты', description: '', boards_count: 2, streak: 2 },
  { id: 't3', name: 'Новая тема', description: '', boards_count: 1, streak: 1 },
]

const summaryWithStats = <T = BoardThemeStat[] | undefined>(
  theme_stats: T,
): Omit<BoardSummary, 'theme_stats'> & { theme_stats: T } => ({
  id: 's1',
  board_id: 'b1',
  session_id: 1,
  summary_text: 'Команда обсудила ревью и тесты.',
  key_themes: ['Долгое ревью', 'Нестабильные тесты', 'Новая тема', 'Тема без статистики'],
  recommendations: [],
  created_at: '2026-11-14T10:00:00Z',
  theme_stats,
})

const BOARD: Board = {
  id: 'b1',
  name: 'Спринт 12',
  slug: 'sprint-12',
  max_votes: 5,
  created_at: '2026-11-14T09:00:00Z',
  columns: [],
}

describe('ThemeStreakBadge — «N-й спринт подряд» в итогах доски', () => {
  it('показывает серию длиннее одной доски', () => {
    render(<ThemeStreakBadge summary={summaryWithStats(STATS)} theme="Долгое ревью" />)
    expect(screen.getByTestId('theme-streak-badge')).toHaveTextContent('3-й спринт подряд')
    expect(screen.getByTestId('theme-streak-badge')).toHaveAttribute(
      'title',
      'Тема встречалась на 3 досках',
    )
  })

  it('для серии из одной доски и темы без статистики метки нет', () => {
    const { container, rerender } = render(
      <ThemeStreakBadge summary={summaryWithStats(STATS)} theme="Новая тема" />,
    )
    expect(container).toBeEmptyDOMElement()
    rerender(<ThemeStreakBadge summary={summaryWithStats(STATS)} theme="Тема без статистики" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('название сопоставляется без учёта регистра, пробелов и ё/е', () => {
    const summary = summaryWithStats([
      { id: 't1', name: 'Счёт задач', description: '', boards_count: 2, streak: 2 },
    ])
    expect(findThemeStat(summary, '  счет  задач ')?.id).toBe('t1')
  })

  it('итоги без theme_stats (созданные до списка тем) не ломают окно', () => {
    expect(getThemeStats(summaryWithStats(undefined))).toEqual([])
    expect(getThemeStats(null)).toEqual([])
    expect(getThemeStats(summaryWithStats([{ name: 'без серии' }, 'мусор', null]))).toEqual([])
  })
})

describe('SummaryModal — метка серии у ключевых тем', () => {
  it('у темы с серией больше 1 стоит «N-й спринт подряд», у остальных — нет', () => {
    render(
      <SummaryModal
        open
        onOpenChange={() => {}}
        board={BOARD}
        actionItems={[]}
        summary={summaryWithStats(STATS)}
        loading={false}
        error={null}
        onSummaryUpdated={() => {}}
      />,
    )

    const row = (name: string) => screen.getByText(name).closest('li')!
    expect(within(row('Долгое ревью')).getByText('3-й спринт подряд')).toBeInTheDocument()
    expect(within(row('Нестабильные тесты')).getByText('2-й спринт подряд')).toBeInTheDocument()
    expect(within(row('Новая тема')).queryByTestId('theme-streak-badge')).not.toBeInTheDocument()
    expect(
      within(row('Тема без статистики')).queryByTestId('theme-streak-badge'),
    ).not.toBeInTheDocument()
  })
})
