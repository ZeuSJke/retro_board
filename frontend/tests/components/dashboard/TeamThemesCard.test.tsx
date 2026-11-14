import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TeamThemesCard from '../../../components/dashboard/TeamThemesCard'
import type { TeamTheme } from '../../../types/themes'

const theme = (overrides: Partial<TeamTheme> & Pick<TeamTheme, 'id' | 'name'>): TeamTheme => ({
  description: '',
  boards_count: 1,
  streak: 1,
  last_board: { id: 'b-last', name: 'Спринт 12', slug: 'sprint-12', created_at: '2026-11-10T10:00:00Z' },
  ...overrides,
})

const RECURRING: TeamTheme[] = [
  theme({
    id: 't1',
    name: 'Долгое ревью',
    description: 'Пул-реквесты ждут ревью по несколько дней',
    boards_count: 3,
    streak: 3,
  }),
  theme({
    id: 't2',
    name: 'Нестабильные тесты',
    description: '',
    boards_count: 2,
    streak: 0,
    last_board: { id: 'b-9', name: 'Спринт 9', slug: null, created_at: '2026-09-10T10:00:00Z' },
  }),
  theme({ id: 't3', name: 'Хорошая демо-встреча', boards_count: 1, streak: 1 }),
]

describe('TeamThemesCard — «Повторяющиеся темы»', () => {
  it('показывает название, описание, число досок, серию и ссылку на последнюю доску', () => {
    render(<TeamThemesCard themes={RECURRING} aiEnabled />)

    const items = screen.getAllByTestId('team-theme')
    // Тема, названная один раз, убрана под кнопку
    expect(items).toHaveLength(2)

    const first = within(items[0])
    expect(first.getByText('Долгое ревью')).toBeInTheDocument()
    expect(first.getByText('Пул-реквесты ждут ревью по несколько дней')).toBeInTheDocument()
    expect(first.getByText(/на 3 досках/)).toBeInTheDocument()
    expect(first.getByText('3-й спринт подряд')).toBeInTheDocument()
    expect(first.getByRole('link', { name: /Спринт 12/ })).toHaveAttribute('href', '/board/sprint-12')
  })

  it('серия из одной доски не подписывается; прерванная серия честно помечена', () => {
    render(<TeamThemesCard themes={RECURRING} aiEnabled />)
    const second = within(screen.getAllByTestId('team-theme')[1])
    expect(second.queryByText(/спринт подряд/)).not.toBeInTheDocument()
    expect(second.getByText('В последних итогах не названа')).toBeInTheDocument()
    // У доски без slug ссылка ведёт по id
    expect(second.getByRole('link', { name: /Спринт 9/ })).toHaveAttribute('href', '/board/b-9')
  })

  it('не показывает сырую разметку в названии и описании', () => {
    render(
      <TeamThemesCard
        themes={[
          theme({
            id: 't1',
            name: '**Долгое ревью**',
            description: '`PR` висят __по три дня__',
            boards_count: 2,
            streak: 2,
          }),
        ]}
        aiEnabled
      />,
    )
    const card = screen.getByTestId('team-themes-card')
    expect(card.textContent).not.toMatch(/\*\*|__|`/)
    expect(screen.getByText('Долгое ревью')).toBeInTheDocument()
    expect(screen.getByText('PR висят по три дня')).toBeInTheDocument()
  })

  it('темы, названные один раз, открываются по кнопке отдельным списком', async () => {
    const user = userEvent.setup()
    render(<TeamThemesCard themes={RECURRING} aiEnabled />)

    expect(screen.queryByText('Хорошая демо-встреча')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Показать ещё 1 тему — встречались один раз/ }))

    expect(screen.getByText('Встречались один раз')).toBeInTheDocument()
    expect(screen.getByText('Хорошая демо-встреча')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Свернуть список' }))
    expect(screen.queryByText('Хорошая демо-встреча')).not.toBeInTheDocument()
  })

  it('длинный список сворачивается до четырёх тем', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 7 }, (_, i) =>
      theme({ id: `t${i}`, name: `Тема ${i + 1}`, boards_count: 2, streak: 2 }),
    )
    render(<TeamThemesCard themes={many} aiEnabled />)

    expect(screen.getAllByTestId('team-theme')).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: 'Показать ещё 3 темы' }))
    expect(screen.getAllByTestId('team-theme')).toHaveLength(7)
  })

  it('если ничего не повторялось, темы показаны с честной подписью', () => {
    render(<TeamThemesCard themes={[RECURRING[2]]} aiEnabled />)
    expect(screen.getByText(/Пока ни одна тема не повторилась/)).toBeInTheDocument()
    expect(screen.getByText('Хорошая демо-встреча')).toBeInTheDocument()
    expect(screen.getByText(/на 1 доске/)).toBeInTheDocument()
  })

  it('пустое состояние объясняет, откуда берутся темы', () => {
    render(<TeamThemesCard themes={[]} aiEnabled />)
    expect(screen.getByText('Тем пока нет')).toBeInTheDocument()
    expect(screen.getByText(/Темы берутся из итогов досок/)).toBeInTheDocument()
    expect(screen.queryByTestId('team-themes-ai-off')).not.toBeInTheDocument()
  })

  it('без AI пустое состояние говорит, что темы не формируются', () => {
    render(<TeamThemesCard themes={[]} aiEnabled={false} />)
    expect(screen.getByTestId('team-themes-ai-off')).toHaveTextContent(
      'AI на сервере не настроен',
    )
  })

  it('ошибка загрузки — сообщение и «Повторить», а не пустое состояние', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<TeamThemesCard themes={[]} error onRetry={onRetry} aiEnabled />)

    expect(screen.getByText('Не удалось загрузить темы команды')).toBeInTheDocument()
    expect(screen.queryByText('Тем пока нет')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
