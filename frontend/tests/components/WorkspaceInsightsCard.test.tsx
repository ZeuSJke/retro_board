import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorkspaceInsightsCard from '../../components/WorkspaceInsightsCard'
import type { WorkspaceInsights } from '../../types'

const insights = (overrides: Partial<WorkspaceInsights> = {}): WorkspaceInsights => ({
  recurring_themes: [],
  recommendations: [],
  summary_text: 'Проанализировано ретроспектив: 3.',
  boards_analyzed: 3,
  generated_by_ai: false,
  ...overrides,
})

describe('WorkspaceInsightsCard', () => {
  it('с AI — называется AI-аналитикой и предлагает собрать инсайты', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    render(<WorkspaceInsightsCard insights={null} loading={false} onRefresh={onRefresh} aiEnabled />)

    expect(screen.getByText('Кросс-спринт AI-аналитика')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Собрать инсайты' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('без AI — это «Сводка по спринтам» с пояснением, без обещаний AI', () => {
    render(
      <WorkspaceInsightsCard insights={null} loading={false} onRefresh={() => {}} aiEnabled={false} />,
    )

    expect(screen.getByText('Сводка по спринтам')).toBeInTheDocument()
    expect(screen.queryByText(/AI-аналитика/)).not.toBeInTheDocument()
    expect(screen.getByText(/AI на сервере не настроен/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Собрать сводку' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /инсайты/i })).not.toBeInTheDocument()
  })

  it('не выдаёт тексты карточек за темы и не показывает сырую разметку', () => {
    render(
      <WorkspaceInsightsCard
        insights={insights({
          // Так раньше отвечал запасной вариант без AI: тексты карточек вместо тем
          recurring_themes: ['**Очень долгое** ревью кода', 'Починить `CI`'],
          summary_text: 'Итог: **настроение** растёт.',
          recommendations: ['- Заведите задачу по теме «__ревью__»', '**'],
        })}
        loading={false}
        onRefresh={() => {}}
        aiEnabled={false}
      />,
    )

    const card = screen.getByTestId('workspace-insights-card')
    expect(card.textContent).not.toMatch(/\*\*|__|`/)
    expect(card).not.toHaveTextContent('Очень долгое')
    expect(card).not.toHaveTextContent('Повторяющиеся темы')
    expect(screen.getByText('Итог: настроение растёт.')).toBeInTheDocument()
    expect(screen.getByText('Заведите задачу по теме «ревью»')).toBeInTheDocument()
    // Рекомендация, от которой после очистки ничего не осталось, не показывается
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Статистика')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Обновить сводку' })).toBeInTheDocument()
  })

  it('AI настроен, но ответила статистика — об этом сказано', () => {
    render(
      <WorkspaceInsightsCard insights={insights()} loading={false} onRefresh={() => {}} aiEnabled />,
    )
    expect(screen.getByText(/AI сейчас недоступен/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Обновить анализ' })).toBeInTheDocument()
  })

  it('ответ модели помечен «AI», пометки о недоступности нет', () => {
    render(
      <WorkspaceInsightsCard
        insights={insights({ generated_by_ai: true, summary_text: 'Команда ускорилась.' })}
        loading={false}
        onRefresh={() => {}}
        aiEnabled
      />,
    )
    expect(screen.getByText('AI')).toBeInTheDocument()
    expect(screen.queryByText(/AI сейчас недоступен/)).not.toBeInTheDocument()
  })

  it('во время запроса кнопка недоступна', () => {
    render(<WorkspaceInsightsCard insights={null} loading onRefresh={() => {}} aiEnabled />)
    expect(screen.getByRole('button', { name: 'Собрать инсайты' })).toBeDisabled()
  })
})
