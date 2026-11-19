import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SpotlightModal from '../../components/SpotlightModal'
import type { Card } from '../../types'

const card = (id: string, text: string): Card => ({
  id,
  column_id: 'col-1',
  group_id: null,
  text,
  author: 'Анна',
  author_id: 'p-anna',
  color: '#FFFFFF',
  position: 0,
  likes: [],
  masked: false,
  created_at: '2026-03-01T10:00:00Z',
})

const first = card('c-1', 'Первая карточка')
const second = card('c-2', 'Вторая карточка')

function props(overrides: Partial<React.ComponentProps<typeof SpotlightModal>> = {}) {
  return {
    card: first,
    anonymous: false,
    isFacilitator: false,
    currentUserId: 'p-me',
    onClose: vi.fn(),
    onCreateActionItem: vi.fn(),
    onLike: vi.fn(),
    ...overrides,
  }
}

describe('SpotlightModal — окно «В фокусе обсуждения»', () => {
  it('участник закрывает окно у себя крестиком: фокус у всех не снимается', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SpotlightModal {...props({ onClose })} />)

    expect(screen.getByRole('dialog')).toHaveTextContent('Первая карточка')
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    // Фокус ведущего остаётся: о нём напоминает строка с кнопкой «Открыть»
    expect(screen.getByTestId('spotlight-minimized')).toHaveTextContent('Первая карточка')
  })

  it('Esc и «Закрыть у себя» тоже закрывают окно только на своём экране', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SpotlightModal {...props({ onClose })} />)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Открыть' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByTestId('spotlight-close-local-btn'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('пока ведущий листает карточки, закрытое окно не всплывает заново', async () => {
    const user = userEvent.setup()
    const view = render(<SpotlightModal {...props()} />)
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))

    view.rerender(<SpotlightModal {...props({ card: second })} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('spotlight-minimized')).toHaveTextContent('Вторая карточка')
  })

  it('ведущий снял фокус — строка исчезает, новый фокус снова открывает окно', async () => {
    const user = userEvent.setup()
    const view = render(<SpotlightModal {...props()} />)
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))

    view.rerender(<SpotlightModal {...props({ card: null })} />)
    expect(screen.queryByTestId('spotlight-minimized')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    view.rerender(<SpotlightModal {...props({ card: second })} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('Вторая карточка')
  })

  it('у ведущего закрытие окна снимает фокус для всех', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SpotlightModal {...props({ isFacilitator: true, onClose })} />)

    expect(screen.queryByTestId('spotlight-close-local-btn')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: 'Снять фокус для всех' }))
    expect(onClose).toHaveBeenCalledTimes(3)
    // Окно ведущего закрывает сервер (событие о снятии фокуса), а не локальное состояние
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('участник стал управлять фокусом — закрытое у себя окно возвращается', async () => {
    const user = userEvent.setup()
    const view = render(<SpotlightModal {...props()} />)
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    view.rerender(<SpotlightModal {...props({ isFacilitator: true })} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('объясняет, чем закрытие у участника отличается от закрытия у ведущего', () => {
    const participant = render(<SpotlightModal {...props()} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('Окно можно закрыть у себя')
    participant.unmount()

    render(<SpotlightModal {...props({ isFacilitator: true })} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('Закрытие окна снимает фокус у всех')
  })

  it('readOnly отключает голосование, снятие голоса, создание и быстрое добавление задач', () => {
    const onCreateActionItem = vi.fn()
    render(
      <SpotlightModal
        {...props({
          readOnly: true,
          isFacilitator: true,
          allowMultipleVotes: true,
          card: { ...first, likes: ['p-me'] },
          queueCards: [
            { card: { ...first, likes: ['p-me'] }, columnTitle: 'Хорошо' },
            { card: second, columnTitle: 'Хорошо' },
          ],
          onCreateActionItem,
          onSelectCard: vi.fn(),
          onRemoveVote: vi.fn(),
          onQuickCreateActionItem: vi.fn(),
        })}
      />,
    )

    expect(screen.getByTestId('spotlight-unlike-btn')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Создать задачу' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'В задачу и далее' })).toBeDisabled()
    expect(screen.getByTestId('spotlight-quick-task-input')).toBeDisabled()
    expect(screen.getByTestId('spotlight-quick-task-submit')).toBeDisabled()
  })

  it('Dot Voting кнопка «−» снимает голос, а связанные задачи и быстрая форма работают', async () => {
    const user = userEvent.setup()
    const onRemoveVote = vi.fn()
    const onQuickCreateActionItem = vi.fn().mockResolvedValue(undefined)

    render(
      <SpotlightModal
        {...props({
          allowMultipleVotes: true,
          card: { ...first, likes: ['p-me', 'p-me'] },
          onRemoveVote,
          onQuickCreateActionItem,
          actionItems: [
            {
              id: 'ai-1',
              board_id: 'b-1',
              title: 'Связанная задача',
              text: 'Детали',
              assignee: 'Анна',
              status: 'open',
              source_card_ids: ['c-1'],
              completed_at: null,
              created_at: '2026-03-01T10:00:00Z',
            },
          ],
        })}
      />,
    )

    expect(screen.getByTestId('spotlight-tasks-section')).toHaveTextContent('Связанная задача')

    await user.click(screen.getByTestId('spotlight-unlike-btn'))
    expect(onRemoveVote).toHaveBeenCalledWith('c-1')

    await user.type(screen.getByTestId('spotlight-quick-task-input'), 'Ускорить CI')
    await user.type(screen.getByTestId('spotlight-quick-task-assignee'), 'Борис')
    await user.click(screen.getByTestId('spotlight-quick-task-submit'))

    expect(onQuickCreateActionItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-1' }),
      'Ускорить CI',
      'Борис',
    )
  })

  it('секция задач вынесена из фиксированного контейнера карточки, чтобы не обрезаться', () => {
    render(
      <SpotlightModal
        {...props({
          onQuickCreateActionItem: vi.fn(),
          actionItems: [
            {
              id: 'ai-1',
              board_id: 'b-1',
              title: 'Отдельная секция задач',
              text: 'Детали',
              assignee: null,
              status: 'open',
              source_card_ids: ['c-1'],
              completed_at: null,
              created_at: '2026-03-01T10:00:00Z',
            },
          ],
        })}
      />,
    )

    const cardText = screen.getByText('Первая карточка')
    const tasksSection = screen.getByTestId('spotlight-tasks-section')
    expect(cardText.closest('.h-\\[280px\\]')).not.toBeNull()
    expect(tasksSection.closest('.h-\\[280px\\]')).toBeNull()
  })
})
