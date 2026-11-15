import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CardWidget from '../../components/CardWidget'
import { TooltipProvider } from '../../components/ui/tooltip'
import type { Card } from '../../types'

// Mock dnd-kit
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

// Mock store: текущий участник — p-me по имени TestUser
vi.mock('../../store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ username: 'TestUser', participant: { id: 'p-me', name: 'TestUser' }, aiEnabled: null, theme: { primary: '#6750A4', dark: false }, setUsername: vi.fn(), setCurrentBoard: vi.fn(), setTheme: vi.fn(), currentBoardId: null }),
}))

// Mock theme utils
vi.mock('../../utils/theme', () => ({
  userColor: () => '#6750A4',
  initials: (name: string) => name.slice(0, 2),
}))

const apiCard = (overrides: Partial<Card> = {}): Card => ({
  id: '1',
  column_id: 'c1',
  group_id: null,
  text: 'Hello',
  author: 'Alice',
  author_id: 'p-alice',
  color: '#FFFFFF',
  position: 0,
  likes: [],
  masked: false,
  created_at: '',
  ...overrides,
})

// Mock API
vi.mock('../../api', () => ({
  toggleLike: vi.fn(),
  deleteCard: vi.fn().mockResolvedValue(undefined),
  removeCardFromGroup: vi.fn(),
  updateCard: vi.fn(),
  moveCard: vi.fn(),
}))

const baseCard: Card = {
  id: '1',
  column_id: 'c1',
  group_id: null,
  text: 'Hello world',
  author: 'Alice',
  author_id: 'p-alice',
  color: '#FFFFFF',
  position: 0,
  likes: [],
  masked: false,
  created_at: '2024-01-01T00:00:00Z',
}

/** Моя карточка: автор — участник сессии. */
const myCard: Card = { ...baseCard, author: 'TestUser', author_id: 'p-me' }

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Действия с карточкой' }))
  return screen.findByTestId('card-edit-item')
}

describe('CardWidget', () => {
  const onUpdate = vi.fn()
  const onDelete = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    const api = await import('../../api')
    vi.mocked(api.toggleLike).mockResolvedValue(apiCard({ likes: ['p-me'] }))
    vi.mocked(api.updateCard).mockResolvedValue(apiCard({ text: 'Updated' }))
  })

  it('renders card text and author', () => {
    render(<CardWidget card={baseCard} onUpdate={onUpdate} onDelete={onDelete} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows like count', () => {
    const card = { ...baseCard, likes: ['p-bob', 'p-charlie'] }
    render(<CardWidget card={card} onUpdate={onUpdate} onDelete={onDelete} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('disables like button when canVote is false and not liked', () => {
    render(<CardWidget card={baseCard} canVote={false} onUpdate={onUpdate} onDelete={onDelete} />)
    const likeBtn = screen.getByTitle('Лимит голосов исчерпан')
    expect(likeBtn).toBeDisabled()
  })

  it('enables like button when canVote is false but already liked', () => {
    const card = { ...baseCard, likes: ['p-me'] }
    render(<CardWidget card={card} canVote={false} onUpdate={onUpdate} onDelete={onDelete} />)
    const likeBtn = screen.getByTitle('Убрать лайк')
    expect(likeBtn).not.toBeDisabled()
  })

  it('голос ставится от имени сессии: в запрос уходит только карточка', async () => {
    const user = userEvent.setup()
    render(<CardWidget card={baseCard} canVote={true} onUpdate={onUpdate} onDelete={onDelete} />)
    await user.click(screen.getByTitle('Лайк'))
    const { toggleLike } = await import('../../api')
    expect(toggleLike).toHaveBeenCalledWith('1')
    // До ответа сервера голос сразу виден как мой — по идентификатору участника
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ likes: ['p-me'] }))
  })

  it('«мой голос» определяется по идентификатору, а не по имени', () => {
    // Голос тёзки (то же имя, другой участник) и голос из старой карточки с именем — не мои
    const card = { ...baseCard, likes: ['p-namesake', 'TestUser'] }
    render(<CardWidget card={card} onUpdate={onUpdate} onDelete={onDelete} />)
    expect(screen.getByTitle('Лайк')).toBeInTheDocument()
    expect(screen.queryByTitle('Убрать лайк')).not.toBeInTheDocument()
    // Но в сумме такие голоса считаются
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('снимает только свой голос: чужие и анонимные остаются', async () => {
    const user = userEvent.setup()
    const card = { ...baseCard, likes: ['anon', 'p-me', 'p-bob'] }
    render(<CardWidget card={card} onUpdate={onUpdate} onDelete={onDelete} />)
    await user.click(screen.getByTitle('Убрать лайк'))
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ likes: ['anon', 'p-bob'] }))
  })

  it('в подсказке голосов — имена известных участников, остальные числом', async () => {
    const user = userEvent.setup()
    const card = { ...baseCard, likes: ['p-me', 'p-bob', 'p-bob', '0f8fad5b-d9cb-469f-a165-70867728950e', 'Старое Имя'] }
    render(
      <TooltipProvider delayDuration={0}>
        <CardWidget
          card={card}
          voterNames={{ 'p-bob': 'Борис' }}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      </TooltipProvider>,
    )
    await user.hover(screen.getByTitle('Убрать лайк'))
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Вы, Борис ×2, Старое Имя и ещё 1')
  })

  it('changes card sticker color from dropdown menu', async () => {
    const user = userEvent.setup()
    render(<CardWidget card={baseCard} onUpdate={onUpdate} onDelete={onDelete} />)
    await user.click(screen.getByRole('button', { name: 'Действия с карточкой' }))
    const mintOption = await screen.findByTestId('card-color-option-emerald')
    await user.click(mintOption)
    const { updateCard } = await import('../../api')
    expect(updateCard).toHaveBeenCalledWith('1', { color: '#E8F5E9' })
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ color: '#E8F5E9' }))
  })
})

describe('CardWidget — права на карточку', () => {
  const onUpdate = vi.fn()
  const onDelete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('свою карточку можно править и удалять', async () => {
    const user = userEvent.setup()
    render(<CardWidget card={myCard} onUpdate={onUpdate} onDelete={onDelete} />)

    const editItem = await openMenu(user)
    expect(editItem).not.toHaveAttribute('data-disabled')
    expect(screen.getByTestId('card-delete-item')).not.toHaveAttribute('data-disabled')
    expect(screen.queryByText('Текст может менять только автор карточки')).not.toBeInTheDocument()
  })

  it('чужую карточку участник не правит и не удаляет — пункты отключены с причиной', async () => {
    const user = userEvent.setup()
    render(<CardWidget card={baseCard} onUpdate={onUpdate} onDelete={onDelete} />)

    const editItem = await openMenu(user)
    expect(editItem).toHaveAttribute('data-disabled')
    expect(screen.getByTestId('card-delete-item')).toHaveAttribute('data-disabled')
    expect(screen.getByText('Текст может менять только автор карточки')).toBeInTheDocument()
    expect(
      screen.getByText('Удалить чужую карточку может создатель доски или ведущий'),
    ).toBeInTheDocument()
  })

  it('двойной клик по тексту чужой карточки не открывает редактор', async () => {
    const user = userEvent.setup()
    render(<CardWidget card={baseCard} onUpdate={onUpdate} onDelete={onDelete} />)
    await user.dblClick(screen.getByText('Hello world'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('двойной клик по своей карточке открывает редактор', async () => {
    const user = userEvent.setup()
    render(<CardWidget card={myCard} onUpdate={onUpdate} onDelete={onDelete} />)
    await user.dblClick(screen.getByText('Hello world'))
    expect(screen.getByRole('textbox')).toHaveValue('Hello world')
  })

  it('модератор удаляет чужую карточку, но текст не правит', async () => {
    const user = userEvent.setup()
    render(<CardWidget card={baseCard} isModerator onUpdate={onUpdate} onDelete={onDelete} />)

    const editItem = await openMenu(user)
    expect(editItem).toHaveAttribute('data-disabled')
    const deleteItem = screen.getByTestId('card-delete-item')
    expect(deleteItem).not.toHaveAttribute('data-disabled')

    await user.click(deleteItem)
    await user.click(await screen.findByRole('button', { name: 'Удалить' }))
    const { deleteCard } = await import('../../api')
    expect(deleteCard).toHaveBeenCalledWith('1')
    expect(onDelete).toHaveBeenCalledWith('1')
  })

  it('карточка тёзки — чужая: совпадения имени недостаточно', async () => {
    const user = userEvent.setup()
    const namesakeCard: Card = { ...baseCard, author: 'TestUser', author_id: 'p-namesake' }
    render(<CardWidget card={namesakeCard} onUpdate={onUpdate} onDelete={onDelete} />)

    expect(await openMenu(user)).toHaveAttribute('data-disabled')
  })

  it('карточку без автора (до появления участников) может править любой', async () => {
    const user = userEvent.setup()
    const legacyCard: Card = { ...baseCard, author_id: null }
    render(<CardWidget card={legacyCard} onUpdate={onUpdate} onDelete={onDelete} />)

    expect(await openMenu(user)).not.toHaveAttribute('data-disabled')
    expect(screen.getByTestId('card-delete-item')).not.toHaveAttribute('data-disabled')
  })

  it('в анонимном режиме карточка без автора считается чужой', async () => {
    const user = userEvent.setup()
    const anonCard: Card = { ...baseCard, author: 'Участник', author_id: null }
    render(<CardWidget card={anonCard} anonymous onUpdate={onUpdate} onDelete={onDelete} />)

    expect(await openMenu(user)).toHaveAttribute('data-disabled')
    expect(screen.getByTestId('card-delete-item')).toHaveAttribute('data-disabled')
  })
})

describe('CardWidget — скрытый сбор и анонимный режим', () => {
  it('masked-карточка показывается заглушкой без текста, автора и действий', () => {
    const masked: Card = { ...baseCard, text: '', author: '', author_id: null, likes: [], masked: true }
    render(<CardWidget card={masked} onUpdate={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('Карточка скрыта')).toBeInTheDocument()
    expect(screen.queryByTestId('card-widget')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Действия с карточкой' })).not.toBeInTheDocument()
    expect(screen.queryByTitle('Лайк')).not.toBeInTheDocument()
  })

  it('клиент не прячет карточку сам: без masked она видна целиком', () => {
    render(<CardWidget card={baseCard} onUpdate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByText('Карточка скрыта')).not.toBeInTheDocument()
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('в анонимном режиме у чужой карточки автор «Участник», у своей — «Вы»', () => {
    const other: Card = { ...baseCard, author: 'Участник', author_id: null }
    const otherView = render(<CardWidget card={other} anonymous onUpdate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Участник')).toBeInTheDocument()
    otherView.unmount()

    render(<CardWidget card={myCard} anonymous onUpdate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Вы')).toBeInTheDocument()
    expect(screen.queryByText('TestUser')).not.toBeInTheDocument()
  })

  it('в анонимном режиме подсказка голосов не называет имён', async () => {
    const user = userEvent.setup()
    const card: Card = { ...baseCard, author: 'Участник', author_id: null, likes: ['anon', 'anon', 'p-me'] }
    render(
      <TooltipProvider delayDuration={0}>
        <CardWidget card={card} anonymous voterNames={{ 'p-me': 'TestUser' }} onUpdate={vi.fn()} onDelete={vi.fn()} />
      </TooltipProvider>,
    )
    await user.hover(screen.getByTitle('Убрать лайк'))
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('3 голоса (анонимно)')
    expect(tooltip).not.toHaveTextContent('TestUser')
  })
})
