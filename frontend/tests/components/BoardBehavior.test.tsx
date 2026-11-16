import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BoardToolbar from '../../components/BoardToolbar'
import CardGroupWidget from '../../components/CardGroupWidget'
import CardWidget from '../../components/CardWidget'
import Column from '../../components/Column'
import ConnectionBanner from '../../components/ConnectionBanner'
import HealthCheckButton, {
  HEALTH_CHECK_OPEN_EVENT,
  HealthCheckMenuItem,
} from '../../components/HealthCheckButton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import TimerWidget from '../../components/TimerWidget'
import { TooltipProvider } from '../../components/ui/tooltip'
import { runningTimer, stoppedTimer } from '../../lib/timer'
import type { Card, CardGroup, Column as ColumnType } from '../../types'

// ── dnd-kit: обработчики сенсоров — шпионы, чтобы видеть, куда они навешаны ──

const dnd = vi.hoisted(() => ({
  onPointerDown: vi.fn(),
  onKeyDown: vi.fn(),
}))

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useDraggable: () => ({
    attributes: { role: 'button', tabIndex: 0 },
    listeners: { onPointerDown: dnd.onPointerDown, onKeyDown: dnd.onKeyDown },
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  verticalListSortingStrategy: {},
  useSortable: ({ disabled }: { disabled?: boolean }) => ({
    attributes: { role: 'button', tabIndex: 0, 'aria-disabled': Boolean(disabled) },
    listeners: disabled
      ? undefined
      : { onPointerDown: dnd.onPointerDown, onKeyDown: dnd.onKeyDown },
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
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
    selector({ username: 'Я', participant: { id: 'p-me', name: 'Я' }, aiEnabled: false }),
}))

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

const api = vi.hoisted(() => ({
  toggleLike: vi.fn(),
  deleteCard: vi.fn(),
  updateCard: vi.fn(),
  moveCard: vi.fn(),
  updateColumn: vi.fn(),
  deleteColumn: vi.fn(),
  createCard: vi.fn(),
  autoClusterColumn: vi.fn(),
  deleteGroup: vi.fn(),
  updateGroup: vi.fn(),
  removeCardFromGroup: vi.fn(),
}))

vi.mock('../../api', () => api)

// Сколько раз отрисован текст каждой карточки — так видно, какие карточки перерисовались
const textRenders = vi.hoisted((): { counts: Record<string, number> } => ({ counts: {} }))

vi.mock('../../components/RichCardText', () => ({
  RichCardText: ({ text }: { text: string }) => {
    textRenders.counts[text] = (textRenders.counts[text] ?? 0) + 1
    return <>{text}</>
  },
}))

function makeCard(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    column_id: 'col-1',
    group_id: null,
    text: `Карточка ${id}`,
    author: 'Анна',
    author_id: 'p-anna',
    color: '#FFFFFF',
    position: 0,
    likes: [],
    masked: false,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

const serverRefusal = () => ({ response: { status: 403, data: { detail: 'Нельзя' } } })

beforeEach(() => {
  vi.clearAllMocks()
  textRenders.counts = {}
})

// ── Карточка ─────────────────────────────────────────────────────────────────

describe('CardWidget — перетаскивание и доступность', () => {
  it('у карточки нет роли кнопки: кнопки внутри неё не вложены в кнопку', () => {
    render(<CardWidget card={makeCard('1')} onUpdated={vi.fn()} onDeleted={vi.fn()} />)
    const root = screen.getByTestId('card-widget')
    expect(root).not.toHaveAttribute('role')
    expect(root).not.toHaveAttribute('tabindex')
    expect(root.closest('[role="button"]')).toBeNull()
  })

  it('ручка — настоящая кнопка с подписью; с клавиатуры карточку берут за неё', () => {
    render(<CardWidget card={makeCard('1')} onUpdated={vi.fn()} onDeleted={vi.fn()} />)
    const root = screen.getByTestId('card-widget')
    const handle = screen.getByRole('button', { name: 'Перетащить карточку' })
    expect(handle.tagName).toBe('BUTTON')
    expect(handle).toHaveAttribute('data-testid', 'card-drag-handle')

    // Указателем карточку тащат за любое место
    fireEvent.pointerDown(root)
    expect(dnd.onPointerDown).toHaveBeenCalledTimes(1)

    // Клавиши на самой карточке перетаскивание не начинают — только на ручке
    fireEvent.keyDown(root, { code: 'Space' })
    expect(dnd.onKeyDown).not.toHaveBeenCalled()
    fireEvent.keyDown(handle, { code: 'Space' })
    expect(dnd.onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('перетаскивание отключено: ручка остаётся и объясняет причину', () => {
    render(
      <CardWidget
        card={makeCard('1')}
        dragDisabled
        dragDisabledReason="Перетаскивание отключено, пока включён поиск или фильтр"
        onUpdated={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )
    const handle = screen.getByTestId('card-drag-handle')
    expect(handle).toHaveAccessibleName('Перетаскивание отключено, пока включён поиск или фильтр')
    expect(handle).toHaveAttribute('title', 'Перетаскивание отключено, пока включён поиск или фильтр')
    expect(handle).toHaveAttribute('aria-disabled', 'true')
    expect(handle.className).toContain('cursor-not-allowed')
    expect(handle.className).not.toContain('cursor-grab')
  })

  it('на заблокированной доске ручки нет', () => {
    render(<CardWidget card={makeCard('1')} readOnly onUpdated={vi.fn()} onDeleted={vi.fn()} />)
    expect(screen.queryByTestId('card-drag-handle')).not.toBeInTheDocument()
  })

  it('кружок выбора виден и на сенсорном экране, где наведения нет', () => {
    render(
      <CardWidget card={makeCard('1')} onToggleSelect={vi.fn()} onUpdated={vi.fn()} onDeleted={vi.fn()} />,
    )
    const checkbox = screen.getByRole('button', { name: 'Выбрать карточку' })
    expect(checkbox.className).toContain('[@media(hover:none)]:opacity-100')
  })

  it('образцы цвета в режиме редактирования подписаны', async () => {
    const user = userEvent.setup()
    render(
      <CardWidget card={makeCard('1', { author_id: 'p-me' })} onUpdated={vi.fn()} onDeleted={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: 'Действия с карточкой' }))
    await user.click(await screen.findByTestId('card-edit-item'))

    expect(screen.getByRole('button', { name: 'Цвет карточки: Базовый' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Цвет карточки: Мята' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('CardWidget — точечные откаты', () => {
  /** Применить все правки, которые карточка отправила владельцу, к состоянию `state`. */
  const applyPatches = (onPatched: ReturnType<typeof vi.fn>, state: Card) =>
    onPatched.mock.calls.reduce<Card>((card, [, patch]) => (patch as (c: Card) => Card)(card), state)

  it('лайк: сервер отказал — снимается только свой голос, чужой, пришедший за это время, остаётся', async () => {
    const user = userEvent.setup()
    api.toggleLike.mockRejectedValueOnce(serverRefusal())
    const onPatched = vi.fn()
    const onUpdated = vi.fn()
    const onRejected = vi.fn()
    const card = makeCard('1')
    render(
      <TooltipProvider>
        <CardWidget card={card} onPatched={onPatched} onUpdated={onUpdated} onRejected={onRejected} onDeleted={vi.fn()} />
      </TooltipProvider>,
    )

    await user.click(screen.getByTitle('Лайк'))
    await waitFor(() => expect(onRejected).toHaveBeenCalledTimes(1))

    expect(onPatched).toHaveBeenCalledTimes(2)
    expect(onPatched.mock.calls[0][0]).toBe('1')
    // Оптимистично: мой голос добавлен
    const optimistic = (onPatched.mock.calls[0][1] as (c: Card) => Card)(card)
    expect(optimistic.likes).toEqual(['p-me'])
    // Пока шёл запрос, проголосовал Боб; откат снимает только мой голос
    const withBob = { ...optimistic, likes: ['p-me', 'p-bob'], text: 'Отредактировано' }
    const rolledBack = (onPatched.mock.calls[1][1] as (c: Card) => Card)(withBob)
    expect(rolledBack.likes).toEqual(['p-bob'])
    expect(rolledBack.text).toBe('Отредактировано')
    // Целой карточкой состояние не перезаписывается
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('снятие лайка: сервер отказал — свой голос возвращается', async () => {
    const user = userEvent.setup()
    api.toggleLike.mockRejectedValueOnce(serverRefusal())
    const onPatched = vi.fn()
    const card = makeCard('1', { likes: ['p-bob', 'p-me'] })
    render(
      <TooltipProvider>
        <CardWidget card={card} onPatched={onPatched} onUpdated={vi.fn()} onDeleted={vi.fn()} />
      </TooltipProvider>,
    )

    await user.click(screen.getByTitle('Убрать лайк'))
    await waitFor(() => expect(onPatched).toHaveBeenCalledTimes(2))

    expect((onPatched.mock.calls[0][1] as (c: Card) => Card)(card).likes).toEqual(['p-bob'])
    expect(applyPatches(onPatched, card).likes.sort()).toEqual(['p-bob', 'p-me'])
  })

  it('несколько голосов на карточку: откат убирает ровно один добавленный голос', async () => {
    const user = userEvent.setup()
    api.toggleLike.mockRejectedValueOnce(serverRefusal())
    const onPatched = vi.fn()
    const card = makeCard('1', { likes: ['p-me'] })
    render(
      <TooltipProvider>
        <CardWidget card={card} allowMultipleVotes maxVotes={5} userTotalVotes={1} onPatched={onPatched} onUpdated={vi.fn()} onDeleted={vi.fn()} />
      </TooltipProvider>,
    )

    await user.click(screen.getByTitle('Лайк'))
    await waitFor(() => expect(onPatched).toHaveBeenCalledTimes(2))

    expect((onPatched.mock.calls[0][1] as (c: Card) => Card)(card).likes).toEqual(['p-me', 'p-me'])
    expect(applyPatches(onPatched, card).likes).toEqual(['p-me'])
  })

  it('успешный лайк: приходит карточка из ответа сервера', async () => {
    const user = userEvent.setup()
    const saved = makeCard('1', { likes: ['p-me'] })
    api.toggleLike.mockResolvedValueOnce(saved)
    const onPatched = vi.fn()
    const onUpdated = vi.fn()
    render(
      <TooltipProvider>
        <CardWidget card={makeCard('1')} onPatched={onPatched} onUpdated={onUpdated} onDeleted={vi.fn()} />
      </TooltipProvider>,
    )

    await user.click(screen.getByTitle('Лайк'))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(saved))
    expect(onPatched).toHaveBeenCalledTimes(1)
  })

  it('цвет: сервер отказал — возвращается прежний цвет, но не поверх новой смены цвета', async () => {
    const user = userEvent.setup()
    api.updateCard.mockRejectedValueOnce(serverRefusal())
    const onPatched = vi.fn()
    const onRejected = vi.fn()
    const card = makeCard('1', { color: '#FFFFFF' })
    render(
      <CardWidget card={card} onPatched={onPatched} onUpdated={vi.fn()} onRejected={onRejected} onDeleted={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Действия с карточкой' }))
    await user.click(await screen.findByTestId('card-color-option-emerald'))
    await waitFor(() => expect(onRejected).toHaveBeenCalledTimes(1))

    const optimistic = (onPatched.mock.calls[0][1] as (c: Card) => Card)(card)
    expect(optimistic.color).toBe('#E8F5E9')
    const rollback = onPatched.mock.calls[1][1] as (c: Card) => Card
    expect(rollback(optimistic).color).toBe('#FFFFFF')
    // Цвет за это время сменил кто-то ещё — откат его не трогает
    const changedByOther = { ...optimistic, color: '#E3F2FD' }
    expect(rollback(changedByOther)).toBe(changedByOther)
  })

  it('удаление: сервер отказал — карточка возвращается', async () => {
    const user = userEvent.setup()
    const error = serverRefusal()
    api.deleteCard.mockRejectedValueOnce(error)
    const onDeleted = vi.fn()
    const onRestored = vi.fn()
    const card = makeCard('1', { author_id: 'p-me' })
    render(<CardWidget card={card} onUpdated={vi.fn()} onDeleted={onDeleted} onRestored={onRestored} />)

    await user.click(screen.getByRole('button', { name: 'Действия с карточкой' }))
    await user.click(await screen.findByTestId('card-delete-item'))
    await user.click(await screen.findByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(card, error))
    expect(onDeleted).toHaveBeenCalledWith('1')
  })

  it('успешное удаление карточку не возвращает', async () => {
    const user = userEvent.setup()
    api.deleteCard.mockResolvedValueOnce(undefined)
    const onRestored = vi.fn()
    render(
      <CardWidget card={makeCard('1', { author_id: 'p-me' })} onUpdated={vi.fn()} onDeleted={vi.fn()} onRestored={onRestored} />,
    )

    await user.click(screen.getByRole('button', { name: 'Действия с карточкой' }))
    await user.click(await screen.findByTestId('card-delete-item'))
    await user.click(await screen.findByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(api.deleteCard).toHaveBeenCalledWith('1'))
    expect(onRestored).not.toHaveBeenCalled()
  })
})

describe('CardWidget — мемоизация', () => {
  it('карточка не перерисовывается, пока не изменилась она сама', () => {
    const card = makeCard('1')
    const onUpdated = vi.fn()
    const onDeleted = vi.fn()
    const { rerender } = render(
      <CardWidget card={card} maxVotes={5} userTotalVotes={0} onUpdated={onUpdated} onDeleted={onDeleted} />,
    )
    expect(textRenders.counts['Карточка 1']).toBe(1)

    // Родитель перерисовался с теми же пропсами
    rerender(<CardWidget card={card} maxVotes={5} userTotalVotes={0} onUpdated={onUpdated} onDeleted={onDeleted} />)
    // Участник поставил лайк на другой карточке: счётчик вырос, лимит не достигнут
    rerender(<CardWidget card={card} maxVotes={5} userTotalVotes={1} onUpdated={onUpdated} onDeleted={onDeleted} />)
    expect(textRenders.counts['Карточка 1']).toBe(1)

    // Изменилась сама карточка
    rerender(
      <CardWidget card={{ ...card, likes: ['p-bob'] }} maxVotes={5} userTotalVotes={1} onUpdated={onUpdated} onDeleted={onDeleted} />,
    )
    expect(textRenders.counts['Карточка 1']).toBe(2)

    // Лимит голосов исчерпан: кнопка голоса меняет состояние
    rerender(
      <CardWidget card={{ ...card, likes: ['p-bob'] }} maxVotes={5} userTotalVotes={5} onUpdated={onUpdated} onDeleted={onDeleted} />,
    )
    expect(textRenders.counts['Карточка 1']).toBe(2 + 1)
  })
})

// ── Колонка ──────────────────────────────────────────────────────────────────

const noop = () => {}

function makeColumn(extra: Partial<ColumnType> = {}): ColumnType {
  return {
    id: 'col-1',
    board_id: 'b-1',
    title: 'Что хорошо',
    color: '#10B981',
    position: 0,
    cards: [makeCard('1'), makeCard('2', { position: 1 })],
    groups: [],
    ...extra,
  }
}

function renderColumn(props: Partial<React.ComponentProps<typeof Column>> = {}) {
  const defaults: React.ComponentProps<typeof Column> = {
    column: makeColumn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onCardCreated: noop,
    onCardUpdated: noop,
    onCardDeleted: noop,
    onGroupCreated: noop,
    onGroupUpdated: noop,
    onGroupDeleted: noop,
    groupTargetId: null,
    collapsedGroups: {},
    onToggleCollapse: noop,
  }
  const merged = { ...defaults, ...props }
  const view = render(
    <TooltipProvider>
      <Column {...merged} />
    </TooltipProvider>,
  )
  return { ...view, props: merged }
}

describe('Column — меню колонки', () => {
  it('название редактируется из меню, а не только двойным кликом', async () => {
    const user = userEvent.setup()
    api.updateColumn.mockResolvedValueOnce({ id: 'col-1', board_id: 'b-1', title: 'Радует', color: '#10B981', position: 0 })
    const onUpdate = vi.fn()
    renderColumn({ onUpdate })

    await user.click(screen.getByTestId('column-menu-btn'))
    await user.click(await screen.findByTestId('column-rename-item'))

    const input = await screen.findByRole('textbox', { name: 'Название колонки' })
    await waitFor(() => expect(input).toHaveFocus())
    await user.clear(input)
    await user.type(input, 'Радует{Enter}')

    await waitFor(() => expect(api.updateColumn).toHaveBeenCalledWith('col-1', { title: 'Радует' }))
    // Оптимистично — только изменённое поле; затем ответ сервера с пометкой источника
    expect(onUpdate).toHaveBeenNthCalledWith(1, { id: 'col-1', title: 'Радует' })
    await waitFor(() =>
      expect(onUpdate).toHaveBeenNthCalledWith(
        2,
        { id: 'col-1', board_id: 'b-1', title: 'Радует', color: '#10B981', position: 0 },
        'rest',
      ),
    )
  })

  it('переименование не удалось — возвращается только прежнее название', async () => {
    const user = userEvent.setup()
    api.updateColumn.mockRejectedValueOnce(serverRefusal())
    const onUpdate = vi.fn()
    renderColumn({ onUpdate })

    await user.dblClick(screen.getByRole('heading', { name: 'Что хорошо' }))
    const input = await screen.findByRole('textbox', { name: 'Название колонки' })
    await user.clear(input)
    await user.type(input, 'Новое{Enter}')

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2))
    expect(onUpdate).toHaveBeenNthCalledWith(1, { id: 'col-1', title: 'Новое' })
    // Ни позиции, ни карточек в откате нет: их могли изменить за это время
    expect(onUpdate).toHaveBeenNthCalledWith(2, { id: 'col-1', title: 'Что хорошо' })
  })

  it('модератор сдвигает колонку из меню; на краю доски направление отключено', async () => {
    const user = userEvent.setup()
    const onMove = vi.fn()
    renderColumn({ onMove, canMoveLeft: false, canMoveRight: true })

    await user.click(screen.getByTestId('column-menu-btn'))
    expect(await screen.findByTestId('column-move-left-item')).toHaveAttribute('data-disabled')
    await user.click(screen.getByTestId('column-move-right-item'))

    expect(onMove).toHaveBeenCalledWith('col-1', 1)
  })

  it('без прав модератора пунктов перестановки нет, переименование остаётся', async () => {
    const user = userEvent.setup()
    renderColumn()

    await user.click(screen.getByTestId('column-menu-btn'))
    expect(await screen.findByTestId('column-rename-item')).toBeInTheDocument()
    expect(screen.queryByTestId('column-move-left-item')).not.toBeInTheDocument()
    expect(screen.queryByTestId('column-move-right-item')).not.toBeInTheDocument()
  })

  it('на заблокированной доске меню колонки нет', () => {
    renderColumn({ readOnly: true, onMove: vi.fn() })
    expect(screen.queryByTestId('column-menu-btn')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Двойной клик или меню колонки — переименовать')).not.toBeInTheDocument()
  })

  it('образцы цвета колонки подписаны', async () => {
    const user = userEvent.setup()
    renderColumn()

    const trigger = screen.getByTitle('Изменить цвет')
    expect(trigger).toHaveAccessibleName('Цвет колонки: Изумруд. Изменить')
    await user.click(trigger)

    expect(await screen.findByRole('button', { name: 'Цвет колонки: Изумруд' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Цвет колонки: Красный' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Цвет колонки: Графит' })).toBeInTheDocument()
  })

  it('удаление не удалось — колонка возвращается вместе с карточками', async () => {
    const user = userEvent.setup()
    const error = { response: { status: 500 } }
    api.deleteColumn.mockRejectedValueOnce(error)
    const onDelete = vi.fn()
    const onRestore = vi.fn()
    const { props } = renderColumn({ onDelete, onRestore, isModerator: true })

    await user.click(screen.getByTestId('delete-column-btn'))
    await user.click(await screen.findByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(props.column, error))
    expect(onDelete).toHaveBeenCalledWith('col-1')
    expect(onRestore.mock.calls[0][0].cards).toHaveLength(2)
  })
})

describe('Column — композер карточки', () => {
  it('раскрывается на месте кнопки и закрывается по Escape', async () => {
    const user = userEvent.setup()
    renderColumn()

    await user.click(screen.getByRole('button', { name: 'Добавить карточку' }))
    const textarea = await screen.findByPlaceholderText('Опишите мысль... (Enter — добавить)')
    await waitFor(() => expect(textarea).toHaveFocus())

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByTestId('card-composer')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Добавить карточку' })).toBeInTheDocument()
  })

  it('создаёт карточку по Enter и оставляет композер открытым для следующей', async () => {
    const user = userEvent.setup()
    const created = makeCard('3', { text: 'Новая мысль' })
    api.createCard.mockResolvedValueOnce(created)
    const onCardCreated = vi.fn()
    renderColumn({ onCardCreated })

    await user.click(screen.getByRole('button', { name: 'Добавить карточку' }))
    const textarea = await screen.findByPlaceholderText('Опишите мысль... (Enter — добавить)')
    await user.type(textarea, 'Новая мысль{Enter}')

    await waitFor(() =>
      expect(api.createCard).toHaveBeenCalledWith({
        column_id: 'col-1',
        text: 'Новая мысль',
        color: '#FFFFFF',
      }),
    )
    expect(onCardCreated).toHaveBeenCalledWith(created)
    expect(screen.getByTestId('card-composer')).toBeInTheDocument()
    await waitFor(() => expect(textarea).toHaveValue(''))
  })
})

describe('Column — мемоизация', () => {
  it('изменение другой колонки эту колонку и её карточки не перерисовывает', () => {
    const column = makeColumn()
    const props = {
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onCardCreated: vi.fn(),
      onCardUpdated: vi.fn(),
      onCardDeleted: vi.fn(),
      onGroupCreated: vi.fn(),
      onGroupUpdated: vi.fn(),
      onGroupDeleted: vi.fn(),
      groupTargetId: null,
      collapsedGroups: {},
      onToggleCollapse: vi.fn(),
      voterNames: {},
      maxVotes: 5,
    }
    const { rerender } = render(
      <TooltipProvider>
        <Column column={column} userTotalVotes={0} {...props} />
      </TooltipProvider>,
    )
    expect(textRenders.counts).toEqual({ 'Карточка 1': 1, 'Карточка 2': 1 })

    // Доска перерисовалась: чужой лайк в соседней колонке, свой лайк там же
    rerender(
      <TooltipProvider>
        <Column column={column} userTotalVotes={0} {...props} />
      </TooltipProvider>,
    )
    rerender(
      <TooltipProvider>
        <Column column={column} userTotalVotes={1} {...props} />
      </TooltipProvider>,
    )
    expect(textRenders.counts).toEqual({ 'Карточка 1': 1, 'Карточка 2': 1 })

    // Лайк на одной карточке этой колонки перерисовывает только её
    const liked = { ...column, cards: [{ ...column.cards[0], likes: ['p-bob'] }, column.cards[1]] }
    rerender(
      <TooltipProvider>
        <Column column={liked} userTotalVotes={1} {...props} />
      </TooltipProvider>,
    )
    expect(textRenders.counts).toEqual({ 'Карточка 1': 2, 'Карточка 2': 1 })
  })
})

// ── Группа ───────────────────────────────────────────────────────────────────

describe('CardGroupWidget', () => {
  const group: CardGroup = { id: 'g-1', column_id: 'col-1', title: 'Процессы', position: 0 }
  const cards = [makeCard('1', { group_id: 'g-1' }), makeCard('2', { group_id: 'g-1', position: 1 })]

  function renderGroup(props: Partial<React.ComponentProps<typeof CardGroupWidget>> = {}) {
    return render(
      <TooltipProvider>
        <CardGroupWidget
          group={group}
          cards={cards}
          collapsed={false}
          onToggleCollapse={vi.fn()}
          currentUserId="p-me"
          maxVotes={5}
          userTotalVotes={0}
          onUpdated={vi.fn()}
          onDeleted={vi.fn()}
          onCardUpdated={vi.fn()}
          onCardDeleted={vi.fn()}
          groupTargetId={null}
          {...props}
        />
      </TooltipProvider>,
    )
  }

  it('расформирование не удалось — группа возвращается вместе с карточками', async () => {
    const user = userEvent.setup()
    const error = serverRefusal()
    api.deleteGroup.mockRejectedValueOnce(error)
    const onDeleted = vi.fn()
    const onRestored = vi.fn()
    renderGroup({ onDeleted, onRestored })

    await user.click(screen.getByRole('button', { name: 'Расформировать группу' }))
    await user.click(await screen.findByRole('button', { name: 'Расформировать' }))

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(group, ['1', '2'], error))
    expect(onDeleted).toHaveBeenCalledWith('g-1')
  })

  it('действия группы видны на сенсорном экране, где наведения нет', () => {
    renderGroup()
    const actions = screen.getByRole('button', { name: 'Переименовать группу' }).parentElement
    expect(actions?.className).toContain('[@media(hover:none)]:opacity-100')
  })

  it('ручка группы — кнопка; у шапки нет роли кнопки', () => {
    renderGroup()
    const handle = screen.getByRole('button', { name: 'Перетащить группу «Процессы»' })
    expect(handle.tagName).toBe('BUTTON')
    expect(handle.parentElement).not.toHaveAttribute('role')

    fireEvent.keyDown(handle, { code: 'Space' })
    expect(dnd.onKeyDown).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(handle.parentElement as HTMLElement)
    expect(dnd.onPointerDown).toHaveBeenCalledTimes(1)
  })

  it('сворачивание сообщает идентификатор группы и озвучивает состояние', async () => {
    const user = userEvent.setup()
    const onToggleCollapse = vi.fn()
    renderGroup({ onToggleCollapse })

    const toggle = screen.getByRole('button', { name: 'Свернуть группу' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)

    expect(onToggleCollapse).toHaveBeenCalledWith('g-1')
  })
})

// ── Таймер ───────────────────────────────────────────────────────────────────

describe('TimerWidget — тик внутри виджета', () => {
  const handlers = {
    canControl: true,
    autoAdvance: false,
    soundMuted: false,
    onToggleSoundMuted: vi.fn(),
    onAutoAdvanceChange: vi.fn(),
    onStart: vi.fn(),
    onPause: vi.fn(),
    onReset: vi.fn(),
    onAddTime: vi.fn(),
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('идущий таймер отсчитывает время сам, при неизменном состоянии у владельца', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
    const timer = runningTimer(300, 90)
    render(<TimerWidget timer={timer} {...handlers} />)
    expect(screen.getByTestId('timer-display')).toHaveTextContent('01:30')

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByTestId('timer-display')).toHaveTextContent('01:28')

    act(() => {
      vi.advanceTimersByTime(88_000)
    })
    expect(screen.getByTestId('timer-display')).toHaveTextContent('00:00')
  })

  it('после возврата на вкладку показывает верное время сразу', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
    render(<TimerWidget timer={runningTimer(300, 120)} {...handlers} />)

    // Вкладка была в фоне: часы ушли на минуту, тики не срабатывали
    vi.setSystemTime(new Date('2026-11-15T10:01:00Z'))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00')
  })

  it('остановленный таймер показывает остаток и не тикает', () => {
    vi.useFakeTimers()
    render(<TimerWidget timer={stoppedTimer(300, 47)} {...handlers} />)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.getByTestId('timer-display')).toHaveTextContent('00:47')
  })

  it('новый запуск сразу показывает новое время, без остатка от прошлого отсчёта', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
    const { rerender } = render(<TimerWidget timer={runningTimer(60, 5)} {...handlers} />)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByTestId('timer-display')).toHaveTextContent('00:02')

    rerender(<TimerWidget timer={runningTimer(300, 300)} {...handlers} />)
    expect(screen.getByTestId('timer-display')).toHaveTextContent('05:00')
  })
})

// ── Панель доски, шапка, баннер связи ────────────────────────────────────────

describe('BoardToolbar', () => {
  const toolbarProps = {
    searchQuery: '',
    onSearchChange: vi.fn(),
    onlyMine: false,
    onOnlyMineChange: vi.fn(),
    sortBy: 'order' as const,
    onSortByChange: vi.fn(),
    masterOpen: true,
    onToggleMaster: vi.fn(),
    actionItemsCount: 0,
    onAddColumn: vi.fn().mockResolvedValue(undefined),
  }

  it('объясняет, почему перетаскивание отключено', () => {
    const { rerender } = render(<BoardToolbar {...toolbarProps} />)
    expect(screen.queryByTestId('drag-disabled-hint')).not.toBeInTheDocument()

    rerender(
      <BoardToolbar
        {...toolbarProps}
        sortBy="votes"
        dragDisabledReason="Перетаскивание отключено, пока карточки отсортированы по голосам"
      />,
    )
    expect(screen.getByTestId('drag-disabled-hint')).toHaveTextContent(
      'Перетаскивание отключено, пока карточки отсортированы по голосам',
    )
  })

  it('открывает форму новой колонки по запросу с пустого холста', () => {
    const props = { ...toolbarProps, addColumnOpen: false, onAddColumnOpenChange: vi.fn() }
    const { rerender } = render(<BoardToolbar {...props} />)
    expect(screen.queryByText('Новая колонка')).not.toBeInTheDocument()

    rerender(<BoardToolbar {...props} addColumnOpen />)
    expect(screen.getByText('Новая колонка')).toBeInTheDocument()
  })

  it('образцы цвета новой колонки подписаны', async () => {
    const user = userEvent.setup()
    render(<BoardToolbar {...toolbarProps} />)

    await user.click(screen.getByRole('button', { name: /Колонка/ }))

    expect(await screen.findByRole('button', { name: 'Цвет колонки: Изумруд' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Цвет колонки: Синий' }))
    expect(screen.getByRole('button', { name: 'Цвет колонки: Синий' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('HealthCheckButton', () => {
  it('по нажатию просит доску открыть health check', async () => {
    const user = userEvent.setup()
    const listener = vi.fn()
    window.addEventListener(HEALTH_CHECK_OPEN_EVENT, listener)
    render(
      <TooltipProvider>
        <HealthCheckButton />
      </TooltipProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Здоровье команды' }))

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(HEALTH_CHECK_OPEN_EVENT, listener)
  })

  it('на телефоне кнопка скрыта, а опрос открывает пункт меню шапки', async () => {
    const user = userEvent.setup()
    const listener = vi.fn()
    window.addEventListener(HEALTH_CHECK_OPEN_EVENT, listener)
    render(
      <TooltipProvider>
        <HealthCheckButton />
        <DropdownMenu>
          <DropdownMenuTrigger>Меню</DropdownMenuTrigger>
          <DropdownMenuContent>
            <HealthCheckMenuItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>,
    )

    // Кнопка видна от ширины sm, пункт меню — только до неё
    expect(screen.getByTestId('health-check-btn').className).toContain('hidden')
    expect(screen.getByTestId('health-check-btn').className).toContain('sm:inline-flex')
    await user.click(screen.getByText('Меню'))
    const item = await screen.findByTestId('menu-health-check-item')
    expect(item.className).toContain('sm:hidden')
    await user.click(item)

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(HEALTH_CHECK_OPEN_EVENT, listener)
  })
})

describe('ConnectionBanner', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('пока связь есть, баннера нет', () => {
    render(<ConnectionBanner connection="online" onReconnect={vi.fn()} />)
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument()
  })

  it('связь потеряна — «переподключаемся»; вернулась — «обновляем доску»; сверено — баннер исчезает', () => {
    const { rerender } = render(<ConnectionBanner connection="reconnecting" onReconnect={vi.fn()} />)
    const banner = screen.getByTestId('connection-banner')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveTextContent('Связь с сервером потеряна. Переподключаемся…')
    expect(banner).toHaveTextContent('Изменения других участников пока не видны')

    rerender(<ConnectionBanner connection="syncing" onReconnect={vi.fn()} />)
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('Связь восстановлена. Обновляем доску…')

    rerender(<ConnectionBanner connection="online" onReconnect={vi.fn()} />)
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument()
  })

  it('браузер не в сети — говорит об этом прямо', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<ConnectionBanner connection="reconnecting" onReconnect={vi.fn()} />)
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('Нет подключения к интернету')
  })

  it('первое подключение показывается, только если оно затянулось', () => {
    vi.useFakeTimers()
    render(<ConnectionBanner connection="connecting" onReconnect={vi.fn()} />)
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('Подключаемся к доске…')
  })

  it('сервер закрыл соединение — кнопка «Подключиться снова»', async () => {
    const user = userEvent.setup()
    const onReconnect = vi.fn()
    render(<ConnectionBanner connection="closed" onReconnect={onReconnect} />)

    expect(screen.getByTestId('connection-banner')).toHaveTextContent('Соединение с доской закрыто')
    await user.click(screen.getByRole('button', { name: 'Подключиться снова' }))
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('доску не удаётся перечитать — сообщает и продолжает попытки', () => {
    render(<ConnectionBanner connection="sync-failed" onReconnect={vi.fn()} />)
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('Не удаётся обновить доску. Повторяем попытку…')
  })
})
