import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RichCardText } from '../../components/RichCardText'
import CardWidget from '../../components/CardWidget'
import SpotlightModal from '../../components/SpotlightModal'
import BoardToolbar from '../../components/BoardToolbar'
import CommandPalette from '../../components/CommandPalette'
import type { Card } from '../../types'

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

vi.mock('../../store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      username: 'TestUser',
      theme: { primary: '#6750A4', dark: false },
      setUsername: vi.fn(),
      setCurrentBoard: vi.fn(),
      setTheme: vi.fn(),
      currentBoardId: null,
    }),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))

vi.mock('../../api', () => ({
  toggleLike: vi.fn().mockResolvedValue({
    id: 'c1',
    column_id: 'col1',
    group_id: null,
    text: 'Card',
    author: 'Alice',
    color: '#FFFFFF',
    position: 0,
    likes: ['TestUser', 'TestUser'],
    created_at: '2026-01-01T00:00:00Z',
  }),
  deleteCard: vi.fn().mockResolvedValue(undefined),
  moveCard: vi.fn().mockResolvedValue({
    id: 'c1',
    column_id: 'col2',
    group_id: null,
    text: 'Card',
    author: 'Alice',
    color: '#FFFFFF',
    position: 0,
    likes: [],
    created_at: '2026-01-01T00:00:00Z',
  }),
  removeCardFromGroup: vi.fn().mockResolvedValue({}),
  updateCard: vi.fn().mockResolvedValue({}),
}))

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
})

const baseCard: Card = {
  id: 'c1',
  column_id: 'col1',
  group_id: null,
  text: 'Сделать **релиз** по задаче `RETRO-12` https://example.com/issue/12',
  author: 'Alice',
  color: '#FFFFFF',
  position: 0,
  likes: ['TestUser'],
  created_at: '2026-01-01T00:00:00Z',
}

describe('RichCardText', () => {
  it('renders autolinks, inline code, bold text, and escapes raw HTML safely', () => {
    const parentClick = vi.fn()
    const { container } = render(
      <div onClick={parentClick}>
        <RichCardText text="Проверь **важный** фикс `fix()` на https://example.com/pr/1 <script>alert(1)</script>" />
      </div>,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('важный').tagName).toBe('STRONG')
    expect(screen.getByText('fix()').tagName).toBe('CODE')

    const link = screen.getByRole('link', { name: 'https://example.com/pr/1' })
    expect(link).toHaveAttribute('href', 'https://example.com/pr/1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    fireEvent.click(link)
    expect(parentClick).not.toHaveBeenCalled()
  })
})

describe('CardWidget cursor & powerups', () => {
  const onUpdate = vi.fn()
  const onDelete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses cursor-default on card surface and exposes visible drag handle', () => {
    render(<CardWidget card={baseCard} onUpdate={onUpdate} onDelete={onDelete} />)
    const cardEl = screen.getByTestId('card-widget')
    expect(cardEl.className).toContain('cursor-default')
    expect(cardEl.className).not.toMatch(/(^|\s)cursor-grab(\s|$)/)

    const handle = screen.getByTestId('card-drag-handle')
    expect(handle).toBeInTheDocument()
    expect(handle.className).toContain('cursor-grab')
  })

  it('supports dot voting + / - controls and ×N counter', async () => {
    const user = userEvent.setup()
    const dotCard: Card = { ...baseCard, likes: ['TestUser', 'TestUser'] }
    render(
      <CardWidget
        card={dotCard}
        allowMultipleVotes
        maxVotes={5}
        userTotalVotes={2}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />,
    )

    expect(screen.getByText('×2')).toBeInTheDocument()
    await user.click(screen.getByTitle('Убрать голос'))
    const { toggleLike } = await import('../../api')
    expect(toggleLike).toHaveBeenCalledWith('c1', 'TestUser', 'remove')

    await user.click(screen.getByTitle('Лайк'))
    expect(toggleLike).toHaveBeenCalledWith('c1', 'TestUser', 'add')
  })

  it('supports Shift+click card selection and column move submenu', async () => {
    const user = userEvent.setup()
    const onToggleSelect = vi.fn()
    render(
      <CardWidget
        card={baseCard}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onToggleSelect={onToggleSelect}
        otherColumns={[{ id: 'col2', title: 'Сделано', color: '#10B981' }]}
      />,
    )

    const selectBtn = screen.getByTestId('card-select-c1')
    fireEvent.click(selectBtn, { shiftKey: true })
    expect(onToggleSelect).toHaveBeenCalledWith('c1', true)

    await user.click(screen.getByLabelText('Действия с карточкой'))
    expect(await screen.findByText('Переместить в колонку')).toBeInTheDocument()
  })
})

describe('SpotlightModal navigation', () => {
  it('navigates between cards via buttons, keyboard arrows, queue toggle, and create+next', async () => {
    const user = userEvent.setup()
    const card2: Card = { ...baseCard, id: 'c2', text: 'Вторая карточка', likes: ['Alice', 'Bob'] }
    const onSelectCard = vi.fn()
    const onQueueModeChange = vi.fn()
    const onCreateActionItem = vi.fn()

    render(
      <SpotlightModal
        card={baseCard}
        column={{ id: 'col1', board_id: 'b1', title: 'Что хорошо', color: '#10B981', position: 0, cards: [baseCard, card2], groups: [] }}
        anonymous={false}
        isFacilitator
        currentUser="TestUser"
        queueCards={[
          { card: baseCard, columnTitle: 'Что хорошо' },
          { card: card2, columnTitle: 'Что хорошо' },
        ]}
        queueMode="all"
        onQueueModeChange={onQueueModeChange}
        onSelectCard={onSelectCard}
        onClose={vi.fn()}
        onCreateActionItem={onCreateActionItem}
        onLike={vi.fn()}
      />,
    )

    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Следующая/i }))
    expect(onSelectCard).toHaveBeenCalledWith('c2')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onSelectCard).toHaveBeenCalledWith('c2')

    await user.click(screen.getByRole('button', { name: 'Топ по голосам' }))
    expect(onQueueModeChange).toHaveBeenCalledWith('top_votes')

    await user.click(screen.getByRole('button', { name: /В задачу и далее/i }))
    expect(onCreateActionItem).toHaveBeenCalledWith(baseCard)
    expect(onSelectCard).toHaveBeenCalledWith('c2')
  })
})

describe('BoardToolbar powerups', () => {
  it('filters by card color and toggles collapse all groups', async () => {
    const user = userEvent.setup()
    const onColorFilterChange = vi.fn()
    const onToggleCollapseAllGroups = vi.fn()

    render(
      <BoardToolbar
        searchQuery=""
        onSearchChange={vi.fn()}
        onlyMine={false}
        onOnlyMineChange={vi.fn()}
        sortBy="order"
        onSortByChange={vi.fn()}
        colorFilter={null}
        onColorFilterChange={onColorFilterChange}
        hasGroups
        allGroupsCollapsed={false}
        onToggleCollapseAllGroups={onToggleCollapseAllGroups}
        masterOpen
        onToggleMaster={vi.fn()}
        actionItemsCount={0}
        onAddColumn={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle('Свернуть все группы'))
    expect(onToggleCollapseAllGroups).toHaveBeenCalledTimes(1)

    await user.click(screen.getByTitle('Фильтр по цвету стикеров'))
    await user.click(await screen.findByLabelText('Фильтр по цвету: Тёплый песок'))
    expect(onColorFilterChange).toHaveBeenCalledWith('amber')
  })
})

describe('CommandPalette powerups', () => {
  it('renders board commands and searchable cards', async () => {
    const user = userEvent.setup()
    const actSelect = vi.fn()
    const cardSelect = vi.fn()

    render(
      <CommandPalette
        boards={[]}
        open
        onOpenChange={vi.fn()}
        onSelectBoard={vi.fn()}
        onCreateBoard={vi.fn()}
        onNavigateDashboard={vi.fn()}
        boardActions={[
          {
            id: 'search',
            label: 'Фокус на поиск',
            shortcut: 'F',
            onSelect: actSelect,
          },
        ]}
        searchableCards={[
          {
            id: 'c1',
            text: 'Починить билд CI',
            columnTitle: 'Проблемы',
            likesCount: 4,
            onSelect: cardSelect,
          },
        ]}
      />,
    )

    expect(screen.getByText('Фокус на поиск')).toBeInTheDocument()
    await user.click(screen.getByText('Починить билд CI'))
    expect(cardSelect).toHaveBeenCalledTimes(1)
  })
})
