import { describe, it, expect, vi } from 'vitest'
import type { ClientRect, DroppableContainer, UniqueIdentifier } from '@dnd-kit/core'
import { boardCollisionDetection, boardKeyboardCoordinates } from '../../lib/board-dnd'

// ── Раскладка: три колонки по 300 px, карточки высотой 80 px ─────────────────

function rect(left: number, top: number, width: number, height: number): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

function container(id: string, data?: Record<string, unknown>): DroppableContainer {
  return {
    id,
    key: id,
    data: { current: data },
    disabled: false,
    node: { current: null },
    rect: { current: null },
  }
}

const cardContainer = (id: string, columnId: string) =>
  container(id, { type: 'card', card: { id, column_id: columnId } })

interface Layout {
  containers: DroppableContainer[]
  rects: Map<UniqueIdentifier, ClientRect>
}

function layout(): Layout {
  const rects = new Map<UniqueIdentifier, ClientRect>()
  const containers: DroppableContainer[] = []
  const add = (c: DroppableContainer, r: ClientRect) => {
    containers.push(c)
    rects.set(c.id, r)
  }
  add(container('col-A', { type: 'column', title: 'А' }), rect(0, 100, 300, 600))
  add(container('col-B', { type: 'column', title: 'Б' }), rect(320, 100, 300, 600))
  add(container('col-C', { type: 'column', title: 'В' }), rect(640, 100, 300, 600))
  add(cardContainer('a1', 'A'), rect(10, 110, 280, 80))
  add(cardContainer('a2', 'A'), rect(10, 200, 280, 80))
  add(cardContainer('b1', 'B'), rect(330, 110, 280, 80))
  add(cardContainer('b2', 'B'), rect(330, 200, 280, 80))
  add(cardContainer('b3', 'B'), rect(330, 290, 280, 80))
  // Колонка В пуста
  add(container('master-col', { type: 'master' }), rect(960, 0, 300, 800))
  return { containers, rects }
}

function keyArgs(code: string, activeId: string, collisionRect: ClientRect, l = layout()) {
  const event = { code, preventDefault: vi.fn() } as unknown as KeyboardEvent
  const args = {
    active: activeId,
    currentCoordinates: { x: collisionRect.left, y: collisionRect.top },
    context: {
      active: { id: activeId },
      collisionRect,
      droppableRects: l.rects,
      droppableContainers: { getEnabled: () => l.containers, get: (id: string) => l.containers.find((c) => c.id === id) },
      over: null,
      scrollableAncestors: [],
    },
  }
  return { event, args: args as unknown as Parameters<typeof boardKeyboardCoordinates>[1] }
}

describe('перетаскивание с клавиатуры: стрелки влево и вправо', () => {
  // Оверлей взятой карточки слегка повёрнут: его рамка на несколько пикселей левее и шире
  const overlayOf = (r: ClientRect) => rect(r.left - 6, r.top - 3, r.width + 12, r.height + 6)

  it('вправо — к карточке соседней колонки на той же высоте, а не к соседке по своей колонке', () => {
    const l = layout()
    const { event, args } = keyArgs('ArrowRight', 'a2', overlayOf(l.rects.get('a2')!), l)

    const next = boardKeyboardCoordinates(event, args)

    // b2 стоит на той же высоте, что и a2
    expect(next).toEqual({ x: 330, y: 200 })
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('вправо в пустую колонку — в её начало', () => {
    const l = layout()
    // Карточка уже во второй колонке
    const { event, args } = keyArgs('ArrowRight', 'b1', overlayOf(l.rects.get('b1')!), l)

    expect(boardKeyboardCoordinates(event, args)).toEqual({ x: 640, y: 100 })
  })

  it('влево — в предыдущую колонку', () => {
    const l = layout()
    const { event, args } = keyArgs('ArrowLeft', 'b3', overlayOf(l.rects.get('b3')!), l)

    // Ближайшая по высоте карточка первой колонки — a2
    expect(boardKeyboardCoordinates(event, args)).toEqual({ x: 10, y: 200 })
  })

  it('у края доски двигаться некуда', () => {
    const l = layout()
    const left = keyArgs('ArrowLeft', 'a1', overlayOf(l.rects.get('a1')!), l)
    expect(boardKeyboardCoordinates(left.event, left.args)).toBeUndefined()

    // Панель задач колонкой не считается: правее третьей колонки хода нет
    const right = keyArgs('ArrowRight', 'x', rect(650, 110, 280, 80), l)
    expect(boardKeyboardCoordinates(right.event, right.args)).toBeUndefined()
  })

  it('группа переезжает в соседнюю колонку целиком — в её начало', () => {
    const l = layout()
    const { event, args } = keyArgs('ArrowRight', 'group-g1', rect(10, 110, 280, 40), l)

    expect(boardKeyboardCoordinates(event, args)).toEqual({ x: 320, y: 100 })
  })
})

describe('над чем находится перетаскиваемый элемент', () => {
  function collisionArgs(activeId: string, collisionRect: ClientRect, pointer: { x: number; y: number } | null) {
    const l = layout()
    return {
      active: { id: activeId },
      collisionRect,
      droppableRects: l.rects,
      droppableContainers: l.containers,
      pointerCoordinates: pointer,
    } as unknown as Parameters<typeof boardCollisionDetection>[0]
  }
  const first = (args: Parameters<typeof boardCollisionDetection>[0]) => boardCollisionDetection(args)[0]?.id

  it('с клавиатуры: карточка, на место которой встала взятая', () => {
    expect(first(collisionArgs('a1', rect(330, 200, 280, 80), null))).toBe('b2')
  })

  it('с клавиатуры: в пустой колонке — сама колонка', () => {
    expect(first(collisionArgs('a1', rect(640, 100, 280, 80), null))).toBe('col-C')
  })

  it('с клавиатуры: карточку ещё не сдвинули — она над самой собой', () => {
    expect(first(collisionArgs('a1', rect(10, 110, 280, 80), null))).toBe('a1')
  })

  it('с клавиатуры: группа видит только колонки', () => {
    expect(first(collisionArgs('group-g1', rect(330, 110, 280, 40), null))).toBe('col-B')
  })

  it('мышью: карточка под указателем важнее колонки', () => {
    expect(first(collisionArgs('a1', rect(0, 0, 10, 10), { x: 400, y: 230 }))).toBe('b2')
  })

  it('мышью: на пустом месте колонки — колонка', () => {
    expect(first(collisionArgs('a1', rect(0, 0, 10, 10), { x: 700, y: 400 }))).toBe('col-C')
  })

  it('мышью: группа над панелью задач — панель, над колонкой — колонка', () => {
    expect(first(collisionArgs('group-g1', rect(0, 0, 10, 10), { x: 1000, y: 300 }))).toBe('master-col')
    expect(first(collisionArgs('group-g1', rect(0, 0, 10, 10), { x: 400, y: 230 }))).toBe('col-B')
  })
})
