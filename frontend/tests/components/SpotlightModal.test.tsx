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
})
