import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Column from '../../components/Column'
import { showToast } from '../../store/toastStore'
import type { Column as ColumnType } from '../../types'

// Mock dnd-kit
vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useDndContext: () => ({ active: null }),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  verticalListSortingStrategy: {},
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

// Mock store
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

// Mock API — autoClusterColumn is a resolvable mock by default
const mockAutoClusterColumn = vi.fn()

vi.mock('../../api', () => ({
  updateColumn: vi.fn(),
  deleteColumn: vi.fn(),
  createCard: vi.fn(),
  createGroup: vi.fn(),
  addCardToGroup: vi.fn(),
  toggleLike: vi.fn(),
  deleteCard: vi.fn(),
  removeCardFromGroup: vi.fn(),
  updateCard: vi.fn(),
  autoClusterColumn: (...args: unknown[]) => mockAutoClusterColumn(...args),
}))

// Mock theme
vi.mock('../../utils/theme', () => ({
  CARD_COLORS: ['#FFFFFF'],
  isLight: () => true,
  userColor: () => '#6750A4',
  initials: (name: string) => name.slice(0, 2),
}))

// Mock toastStore so we can spy on showToast
vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

// ── helpers ────────────────────────────────────────────────────────────────

function makeCard(id: string, groupId: string | null = null) {
  return {
    id,
    column_id: 'col-1',
    group_id: groupId,
    text: `Card ${id}`,
    author: 'Alice',
    color: '#FFFFFF',
    position: 0,
    likes: [],
    created_at: '2024-01-01T00:00:00Z',
  }
}

function makeColumn(overrides: Partial<ColumnType> = {}): ColumnType {
  return {
    id: 'col-1',
    board_id: 'b1',
    title: 'Тестовая колонка',
    color: '#006E1C',
    position: 0,
    cards: [],
    groups: [],
    ...overrides,
  }
}

const noop = vi.fn()

function renderColumn(column: ColumnType, extra: Record<string, unknown> = {}) {
  return render(
    <Column
      column={column}
      onUpdate={noop}
      onDelete={noop}
      onCardCreated={noop}
      onCardUpdated={noop}
      onCardDeleted={noop}
      onGroupCreated={noop}
      onGroupUpdated={noop}
      onGroupDeleted={noop}
      groupTargetId={null}
      collapsedGroups={{}}
      onToggleCollapse={noop}
      {...extra}
    />,
  )
}

const AI_BTN_TITLE = 'Сгруппировать похожие (AI)'

// ── tests ──────────────────────────────────────────────────────────────────

describe('Column — auto-cluster button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAutoClusterColumn.mockResolvedValue({})
  })

  // ── visibility ────────────────────────────────────────────────────────────

  describe('visibility', () => {
    it('is visible when there are >= 2 ungrouped cards and readOnly is false', () => {
      const column = makeColumn({
        cards: [makeCard('c1'), makeCard('c2')],
      })
      renderColumn(column)
      expect(screen.getByTitle(AI_BTN_TITLE)).toBeInTheDocument()
    })

    it('is visible when there are more than 2 ungrouped cards', () => {
      const column = makeColumn({
        cards: [makeCard('c1'), makeCard('c2'), makeCard('c3')],
      })
      renderColumn(column)
      expect(screen.getByTitle(AI_BTN_TITLE)).toBeInTheDocument()
    })

    it('is hidden when there is only 1 ungrouped card', () => {
      const column = makeColumn({ cards: [makeCard('c1')] })
      renderColumn(column)
      expect(screen.queryByTitle(AI_BTN_TITLE)).not.toBeInTheDocument()
    })

    it('is hidden when there are no cards', () => {
      const column = makeColumn({ cards: [] })
      renderColumn(column)
      expect(screen.queryByTitle(AI_BTN_TITLE)).not.toBeInTheDocument()
    })

    it('is hidden when all cards are grouped (< 2 ungrouped)', () => {
      // Both cards belong to a group — ungroupedCards.length === 0
      const column = makeColumn({
        cards: [makeCard('c1', 'g1'), makeCard('c2', 'g1')],
        groups: [{ id: 'g1', column_id: 'col-1', title: 'Group', position: 0, cards: [] }],
      })
      renderColumn(column)
      expect(screen.queryByTitle(AI_BTN_TITLE)).not.toBeInTheDocument()
    })

    it('is hidden when readOnly is true even with >= 2 ungrouped cards', () => {
      const column = makeColumn({
        cards: [makeCard('c1'), makeCard('c2')],
      })
      renderColumn(column, { readOnly: true })
      expect(screen.queryByTitle(AI_BTN_TITLE)).not.toBeInTheDocument()
    })
  })

  // ── button click ──────────────────────────────────────────────────────────

  describe('button click', () => {
    it('calls autoClusterColumn with the correct column id on click', async () => {
      const user = userEvent.setup()
      const column = makeColumn({ cards: [makeCard('c1'), makeCard('c2')] })
      renderColumn(column)

      await user.click(screen.getByTitle(AI_BTN_TITLE))

      expect(mockAutoClusterColumn).toHaveBeenCalledTimes(1)
      expect(mockAutoClusterColumn).toHaveBeenCalledWith('col-1', 'TestUser')
    })

    it('shows success toast when clustering creates groups', async () => {
      const user = userEvent.setup()
      mockAutoClusterColumn.mockResolvedValue({
        created_groups: [{ group: { id: 'g1', title: 'Test' }, card_ids: ['c1', 'c2'] }],
        ungrouped_card_ids: [],
      })

      const column = makeColumn({ cards: [makeCard('c1'), makeCard('c2')] })
      renderColumn(column)

      await user.click(screen.getByTitle(AI_BTN_TITLE))

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith('Карточки сгруппированы', 'info')
      })
    })

    it('shows info toast when AI finds no similar cards', async () => {
      const user = userEvent.setup()
      mockAutoClusterColumn.mockResolvedValue({
        created_groups: [],
        ungrouped_card_ids: ['c1', 'c2'],
      })

      const column = makeColumn({ cards: [makeCard('c1'), makeCard('c2')] })
      renderColumn(column)

      await user.click(screen.getByTitle(AI_BTN_TITLE))

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith('AI не нашёл похожих карточек для группировки', 'info')
      })
    })

    it('shows generic error toast on unknown failure', async () => {
      const user = userEvent.setup()
      mockAutoClusterColumn.mockRejectedValue(new Error('network error'))

      const column = makeColumn({ cards: [makeCard('c1'), makeCard('c2')] })
      renderColumn(column)

      await user.click(screen.getByTitle(AI_BTN_TITLE))

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith('Не удалось сгруппировать карточки', 'error')
      })
    })

    it('shows AI unavailable toast on HTTP 503', async () => {
      const user = userEvent.setup()
      mockAutoClusterColumn.mockRejectedValue({ response: { status: 503 } })

      const column = makeColumn({ cards: [makeCard('c1'), makeCard('c2')] })
      renderColumn(column)

      await user.click(screen.getByTitle(AI_BTN_TITLE))

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith('AI-сервис временно недоступен', 'error')
      })
    })

    it('shows detail message from response on HTTP 400', async () => {
      const user = userEvent.setup()
      mockAutoClusterColumn.mockRejectedValue({
        response: { status: 400, data: { detail: 'Недостаточно карточек' } },
      })

      const column = makeColumn({ cards: [makeCard('c1'), makeCard('c2')] })
      renderColumn(column)

      await user.click(screen.getByTitle(AI_BTN_TITLE))

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith('Недостаточно карточек', 'error')
      })
    })
  })

  // ── loading state ─────────────────────────────────────────────────────────

  describe('loading state', () => {
    it('button is disabled while clustering is in progress', async () => {
      const user = userEvent.setup()

      // Never resolves during the test — keeps the button in loading state
      mockAutoClusterColumn.mockReturnValue(new Promise(() => {}))

      const column = makeColumn({ cards: [makeCard('c1'), makeCard('c2')] })
      renderColumn(column)

      const btn = screen.getByTitle(AI_BTN_TITLE)
      await user.click(btn)

      // After the click the button should be disabled
      expect(btn).toBeDisabled()
    })

    it('button is re-enabled after clustering completes', async () => {
      const user = userEvent.setup()
      mockAutoClusterColumn.mockResolvedValue({})

      const column = makeColumn({ cards: [makeCard('c1'), makeCard('c2')] })
      renderColumn(column)

      const btn = screen.getByTitle(AI_BTN_TITLE)
      await user.click(btn)

      await waitFor(() => {
        expect(btn).not.toBeDisabled()
      })
    })

    it('button is re-enabled after clustering fails', async () => {
      const user = userEvent.setup()
      mockAutoClusterColumn.mockRejectedValue(new Error('fail'))

      const column = makeColumn({ cards: [makeCard('c1'), makeCard('c2')] })
      renderColumn(column)

      const btn = screen.getByTitle(AI_BTN_TITLE)
      await user.click(btn)

      await waitFor(() => {
        expect(btn).not.toBeDisabled()
      })
    })
  })
})
