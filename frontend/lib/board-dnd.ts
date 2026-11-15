/**
 * Перетаскивание на доске с клавиатуры: куда попадает карточка по стрелкам.
 *
 * Вверх и вниз — штатная логика сортируемого списка. Влево и вправо — в соседнюю колонку:
 * штатная логика ищет «ближайший элемент правее», а взятая карточка рисуется в оверлее
 * с лёгким поворотом, и её рамка оказывается чуть левее соседей по колонке — стрелка
 * вправо выбирала бы карточку из той же колонки.
 */
import {
  closestCenter,
  pointerWithin,
  rectIntersection,
  type ClientRect,
  type CollisionDetection,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

// Коды клавиш из KeyboardEvent.code (те же значения, что в KeyboardCode у dnd-kit)
const KEY_LEFT = 'ArrowLeft'
const KEY_RIGHT = 'ArrowRight'

const COLUMN_PREFIX = 'col-'
const GROUP_PREFIX = 'group-'
const MASTER_ID = 'master-col'

const isColumnId = (id: UniqueIdentifier) => String(id).startsWith(COLUMN_PREFIX)
const isCardId = (id: UniqueIdentifier) => !isColumnId(id) && String(id) !== MASTER_ID

interface ColumnRect {
  /** Идентификатор колонки (без префикса зоны сброса). */
  columnId: string
  rect: ClientRect
}

/** Колонки слева направо — по зонам сброса `col-<id>`. */
function columnRects(
  containers: Iterable<DroppableContainer>,
  rects: Map<UniqueIdentifier, ClientRect>,
): ColumnRect[] {
  const result: ColumnRect[] = []
  for (const container of containers) {
    if (!isColumnId(container.id)) continue
    const rect = rects.get(container.id)
    if (rect) result.push({ columnId: String(container.id).slice(COLUMN_PREFIX.length), rect })
  }
  return result.sort((a, b) => a.rect.left - b.rect.left)
}

/** В какой колонке сейчас находится взятый элемент — по центру его рамки. */
function currentColumnIndex(columns: ColumnRect[], rect: ClientRect): number {
  const center = rect.left + rect.width / 2
  let best = -1
  let bestDistance = Infinity
  columns.forEach((column, index) => {
    const inside = center >= column.rect.left && center <= column.rect.left + column.rect.width
    const distance = inside ? 0 : Math.abs(center - (column.rect.left + column.rect.width / 2))
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

function columnOfCard(container: DroppableContainer): string | null {
  const data = container.data.current as { type?: string; card?: { column_id?: string } } | undefined
  return data?.type === 'card' && typeof data.card?.column_id === 'string'
    ? data.card.column_id
    : null
}

/**
 * Координаты для перетаскивания с клавиатуры. Влево/вправо — к карточке соседней колонки
 * на той же высоте, а если колонка пуста — в её начало. Вверх/вниз — как в сортируемом списке.
 */
export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const horizontal = event.code === KEY_LEFT || event.code === KEY_RIGHT
  if (!horizontal) return sortableKeyboardCoordinates(event, args)

  const { active, collisionRect, droppableRects, droppableContainers } = args.context
  if (!active || !collisionRect) return undefined
  event.preventDefault()

  const enabled = droppableContainers.getEnabled()
  const columns = columnRects(enabled, droppableRects)
  const from = currentColumnIndex(columns, collisionRect)
  const target = columns[from + (event.code === KEY_RIGHT ? 1 : -1)]
  if (from < 0 || !target) return undefined

  // Группа переезжает в колонку целиком: место внутри колонки для неё не выбирается
  if (!String(active.id).startsWith(GROUP_PREFIX)) {
    let closest: ClientRect | null = null
    for (const container of enabled) {
      if (container.id === active.id || columnOfCard(container) !== target.columnId) continue
      const rect = droppableRects.get(container.id)
      if (!rect) continue
      if (!closest || Math.abs(rect.top - collisionRect.top) < Math.abs(closest.top - collisionRect.top)) {
        closest = rect
      }
    }
    if (closest) return { x: closest.left, y: closest.top }
  }
  return { x: target.rect.left, y: target.rect.top }
}

/**
 * Над чем находится перетаскиваемый элемент. Мышью и пальцем — по указателю; с клавиатуры
 * указателя нет, и цель определяется по пересечению рамок: карточка под взятой карточкой,
 * а если карточек нет — колонка.
 */
export const boardCollisionDetection: CollisionDetection = (args) => {
  const draggingGroup = String(args.active?.id || '').startsWith(GROUP_PREFIX)

  if (!args.pointerCoordinates) {
    const hits = rectIntersection(args)
    if (!draggingGroup) {
      const cards = hits.filter((c) => isCardId(c.id))
      const others = cards.filter((c) => c.id !== args.active.id)
      if (others.length > 0) return others
      // Под взятой карточкой только она сама: её ещё никуда не сдвинули
      if (cards.length > 0) return cards
    }
    const columns = hits.filter((c) => isColumnId(c.id))
    if (columns.length > 0) return columns
    return closestCenter(args)
  }

  const pointer = pointerWithin(args)
  if (draggingGroup) {
    const master = pointer.filter((c) => String(c.id) === MASTER_ID)
    if (master.length > 0) return master
    const columns = pointer.filter((c) => isColumnId(c.id))
    if (columns.length > 0) return columns
    return closestCenter(args)
  }
  const cards = pointer.filter((c) => !isColumnId(c.id))
  if (cards.length > 0) return cards
  if (pointer.length > 0) return pointer
  return closestCenter(args)
}
