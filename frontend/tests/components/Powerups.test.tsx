import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RichCardText } from '../../components/RichCardText'
import CardWidget from '../../components/CardWidget'
import CardGroupWidget from '../../components/CardGroupWidget'
import SpotlightModal from '../../components/SpotlightModal'
import SuggestActionItemsDialog from '../../components/SuggestActionItemsDialog'
import AutoClusterPreviewDialog from '../../components/AutoClusterPreviewDialog'
import SummaryModal from '../../components/SummaryModal'
import BoardToolbar from '../../components/BoardToolbar'
import CommandPalette from '../../components/CommandPalette'
import { buildBoardPDFHtml } from '../../utils/exportPDF'
import type { Board, Card, CardGroup } from '../../types'

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

  it('renders markdown links, www URLs without trailing punctuation, and blocks javascript URIs', () => {
    render(
      <RichCardText text="См. [док](https://docs.example.com/guide) и www.example.org/wiki. Плохо: [xss](javascript:alert(1))" />,
    )

    const mdLink = screen.getByRole('link', { name: 'док' })
    expect(mdLink).toHaveAttribute('href', 'https://docs.example.com/guide')

    const wwwLink = screen.getByRole('link', { name: 'www.example.org/wiki' })
    expect(wwwLink).toHaveAttribute('href', 'https://www.example.org/wiki')

    expect(screen.queryByRole('link', { name: 'xss' })).toBeNull()
  })
})

describe('Polished dialogs, collapsed group & PDF export', () => {
  it('collapsed group does not render bottom arc stub and AI dialogs keep footer spacing without sm:gap-0', async () => {
    const group: CardGroup = {
      id: 'g1',
      column_id: 'col1',
      title: 'База знаний',
      position: 0,
    }
    const cards = [
      { ...baseCard, id: 'c1', group_id: 'g1' },
      { ...baseCard, id: 'c2', group_id: 'g1', text: 'Вторая' },
    ]

    const { container, unmount } = render(
      <CardGroupWidget
        group={group}
        cards={cards}
        collapsed
        onToggleCollapse={vi.fn()}
        onUpdated={vi.fn()}
        onDeleted={vi.fn()}
        onCardUpdated={vi.fn()}
        onCardDeleted={vi.fn()}
        groupTargetId={null}
      />,
    )
    expect(container.querySelector('.rounded-b-lg')).toBeNull()
    unmount()

    const suggestView = render(
      <SuggestActionItemsDialog
        open
        onOpenChange={vi.fn()}
        loading={false}
        suggestions={[
          { title: 'Задача 1', text: 'Сделать документацию', assignee_hint: 'Alice', source_card_ids: ['c1'] },
        ]}
        onCreateSelected={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(screen.getByText('AI-подбор задач')).toBeInTheDocument()
    const suggestCancel = screen.getByRole('button', { name: 'Отмена' })
    expect(suggestCancel.parentElement?.className).not.toContain('sm:gap-0')
    expect(screen.getByRole('dialog').className).toContain('sm:max-w-3xl')
    expect(document.querySelector('.max-h-\\[58vh\\]')).toBeNull()
    const suggestTextarea = screen.getByPlaceholderText('Описание задачи и ожидаемый результат')
    expect(suggestTextarea.className).toContain('overflow-hidden')
    Object.defineProperty(suggestTextarea, 'scrollHeight', { configurable: true, value: 132 })
    await userEvent.type(suggestTextarea, '!')
    expect((suggestTextarea as HTMLTextAreaElement).style.height).toBe('132px')
    suggestView.unmount()

    const clusterView = render(
      <AutoClusterPreviewDialog
        open
        onOpenChange={vi.fn()}
        columnTitle="Идеи"
        preview={{ groups: [{ title: 'Инфра', card_ids: ['c1', 'c2'] }] }}
        cards={cards}
        onApply={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    const clusterCancel = screen.getByRole('button', { name: 'Отмена' })
    expect(clusterCancel.parentElement?.className).not.toContain('sm:gap-0')
    expect(screen.getByRole('dialog').className).toContain('sm:max-w-3xl')
    expect(document.querySelector('.max-h-\\[58vh\\]')).toBeNull()
    expect(document.querySelector('.line-clamp-2')).toBeNull()
    clusterView.unmount()
  })

  it('SummaryModal and SpotlightModal keep fixed stage heights and Russian task labels', () => {
    const board: Board = {
      id: 'b1',
      name: 'Спринт 42',
      slug: 'sprint-42',
      created_at: '2026-03-01T10:00:00Z',
      max_votes: 5,
      anonymous_votes: false,
      columns: [],
    }
    const summaryView = render(
      <SummaryModal
        open
        onOpenChange={vi.fn()}
        board={board}
        actionItems={[]}
        summary={{
          id: 'sum1',
          board_id: 'b1',
          summary_text: 'Команда ускорила релизы.',
          key_themes: ['Релизы'],
          recommendations: ['Продолжать автоматизацию'],
          created_at: '2026-03-01T12:00:00Z',
        }}
        loading={false}
        error={null}
        onSummaryUpdated={vi.fn()}
      />,
    )
    const tablist = screen.getByRole('tablist')
    expect(tablist.className).toContain('grid-cols-2')
    expect(screen.getByText('AI-резюме и темы')).toBeInTheDocument()
    expect(screen.getByText('Markdown и Slack')).toBeInTheDocument()
    const summaryDialog = screen.getByRole('dialog')
    expect(summaryDialog.className).toContain('h-[min(86vh,760px)]')
    expect(summaryDialog.className).toContain('max-w-3xl')
    expect(document.querySelector('.h-\\[420px\\]')).toBeNull()
    const themesContainer = screen.getByText('Ключевые темы').parentElement?.parentElement
    expect(themesContainer?.className).toContain('md:grid-cols-2')
    const activePanel = screen.getByRole('tabpanel')
    expect(activePanel.className).toContain('data-[state=inactive]:hidden')
    summaryView.unmount()

    const singleColSummary = render(
      <SummaryModal
        open
        onOpenChange={vi.fn()}
        board={board}
        actionItems={[]}
        summary={{
          id: 'sum2',
          board_id: 'b1',
          summary_text: 'Только темы без рекомендаций.',
          key_themes: ['Релизы'],
          recommendations: [],
          created_at: '2026-03-01T12:00:00Z',
        }}
        loading={false}
        error={null}
        onSummaryUpdated={vi.fn()}
      />,
    )
    const singleThemesContainer = screen.getByText('Ключевые темы').parentElement?.parentElement
    expect(singleThemesContainer?.className).toContain('grid-cols-1')
    expect(singleThemesContainer?.className).not.toContain('md:grid-cols-2')
    singleColSummary.unmount()

    const spotlightView = render(
      <SpotlightModal
        card={baseCard}
        anonymous={false}
        isFacilitator
        currentUser="Alice"
        queueCards={[
          { card: baseCard, columnTitle: 'Идеи' },
          { card: { ...baseCard, id: 'c2', text: 'Вторая карточка' }, columnTitle: 'Идеи' },
        ]}
        onClose={vi.fn()}
        onCreateActionItem={vi.fn()}
        onLike={vi.fn()}
        onSelectCard={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /Создать задачу/i })).toBeInTheDocument()
    expect(screen.queryByText(/Action Item/i)).toBeNull()
    expect(screen.getByText('RETRO-12').closest('.h-\\[280px\\]')).not.toBeNull()
    spotlightView.unmount()
  })

  it('builds modern RetroBoard PDF HTML with links, statuses, summary and respects anonymous mode', () => {
    const board: Board = {
      id: 'b1',
      name: 'Ретро Спринт 42',
      slug: 'retro-42',
      created_at: '2026-03-01T10:00:00Z',
      max_votes: 5,
      anonymous_votes: true,
      columns: [],
    }
    const html = buildBoardPDFHtml(
      board,
      [
        {
          id: 'col1',
          board_id: 'b1',
          title: 'Идеи',
          color: '#0EA5E9',
          position: 0,
          cards: [
            { ...baseCard, text: 'Проверить [трекер](https://tracker.local/1)' },
          ],
          groups: [],
        },
      ],
      [
        {
          id: 'ai1',
          board_id: 'b1',
          title: 'Починить CI',
          text: 'Ссылка https://ci.local/job/1',
          assignee: 'Alice',
          status: 'in_progress',
          source_card_ids: ['c1'],
          created_at: '2026-03-01T11:00:00Z',
        },
      ],
      {
        id: 'sum1',
        board_id: 'b1',
        summary_text: 'Хороший спринт с фокусом на стабильность.',
        key_themes: ['Автоматизация CI'],
        recommendations: ['Сократить время ревью'],
        created_at: '2026-03-01T12:00:00Z',
      },
    )

    expect(html).not.toContain('#6750A4')
    expect(html).toContain('Отчёт командной ретроспективы')
    expect(html).toContain('Итоги и AI-анализ')
    expect(html).toContain('Автоматизация CI')
    expect(html).toContain('href="https://tracker.local/1"')
    expect(html).toContain('В работе')
    expect(html).not.toContain('>Alice<')
    expect(html).toContain('Участник')
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

    expect(screen.getByRole('dialog').className).toContain('max-w-xl')
    expect(screen.getByRole('dialog').className).not.toContain('p-6')
    expect(document.querySelector('[cmdk-separator]')).not.toBeNull()
    expect(screen.getByText('выбор')).toBeInTheDocument()
    expect(screen.getByText('открыть')).toBeInTheDocument()
    expect(screen.getByText('закрыть')).toBeInTheDocument()
    expect(screen.getByText('Фокус на поиск')).toBeInTheDocument()
    await user.click(screen.getByText('Починить билд CI'))
    expect(cardSelect).toHaveBeenCalledTimes(1)
  })
})
