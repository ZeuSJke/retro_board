import { describe, expect, it, vi, beforeAll } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ActionItemsKanban from '../../components/action-items/ActionItemsKanban'
import type { DashboardActionItem } from '../../types'

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

const makeItem = (
  id: string,
  status: DashboardActionItem['status'],
  extra: Partial<DashboardActionItem> = {},
): DashboardActionItem => ({
  id,
  board_id: 'b-1',
  board_name: 'Спринт 1',
  title: `Задача ${id}`,
  text: `Описание ${id}`,
  assignee: 'Анна',
  status,
  source_card_ids: [],
  completed_at: null,
  created_at: '2026-03-01T10:00:00Z',
  ...extra,
})

describe('ActionItemsKanban', () => {
  it('рендерит 3 колонки, сворачивает колонку и показывает лимит 6 задач', async () => {
    const user = userEvent.setup()
    const openItems = Array.from({ length: 8 }, (_, idx) => makeItem(`o-${idx + 1}`, 'open'))
    const items: DashboardActionItem[] = [
      ...openItems,
      makeItem('p-1', 'in_progress'),
      makeItem('d-1', 'done', { source_card_ids: ['c-1', 'c-2'] }),
    ]

    render(<ActionItemsKanban items={items} onStatusChange={vi.fn()} />)

    const openCol = screen.getByTestId('kanban-column-open')
    const inProgressCol = screen.getByTestId('kanban-column-in_progress')
    const doneCol = screen.getByTestId('kanban-column-done')

    expect(within(openCol).getByText('Задача o-6')).toBeInTheDocument()
    expect(within(openCol).queryByText('Задача o-7')).not.toBeInTheDocument()

    await user.click(within(openCol).getByRole('button', { name: 'Показать ещё 2' }))
    expect(within(openCol).getByText('Задача o-8')).toBeInTheDocument()

    await user.click(within(inProgressCol).getByRole('button', { name: 'Свернуть колонку В работе' }))
    expect(within(inProgressCol).getByText(/Колонка свёрнута \(1\)/)).toBeInTheDocument()
    await user.click(within(inProgressCol).getByRole('button', { name: 'Развернуть колонку В работе' }))
    expect(within(inProgressCol).getByText('Задача p-1')).toBeInTheDocument()

    expect(within(doneCol).getByTestId('action-item-source-cards-chip-d-1')).toHaveTextContent(
      '2 карт.',
    )
  })

  it('цикл статусов и выбор задач для переноса (done отключён)', async () => {
    const user = userEvent.setup()
    const onStatusChange = vi.fn()
    const onToggleSelect = vi.fn()
    const items = [makeItem('o-1', 'open'), makeItem('d-1', 'done')]

    render(
      <ActionItemsKanban
        items={items}
        selectable
        selectedIds={new Set(['o-1'])}
        onToggleSelect={onToggleSelect}
        onStatusChange={onStatusChange}
      />,
    )

    await user.click(screen.getByTitle('Открыто → В работе'))
    expect(onStatusChange).toHaveBeenCalledWith(items[0], 'in_progress')

    expect(screen.getByTestId('carry-select-d-1')).toBeDisabled()
    await user.click(screen.getByTestId('carry-select-o-1'))
    expect(onToggleSelect).toHaveBeenCalledWith('o-1')
  })

  it('ручка перетаскивания — кнопка с aria-label, а внешняя карточка без role=button', () => {
    render(<ActionItemsKanban items={[makeItem('o-1', 'open')]} onStatusChange={vi.fn()} onDelete={vi.fn()} />)

    const card = screen.getByTestId('action-item-card-o-1')
    expect(card).not.toHaveAttribute('role', 'button')

    const handle = screen.getByTestId('kanban-drag-handle-o-1')
    expect(handle.tagName).toBe('BUTTON')
    expect(handle).toHaveAttribute('aria-label', 'Перетащить задачу в другую колонку')

    expect(screen.getByRole('button', { name: 'Удалить задачу' })).toBeInTheDocument()
  })
})
