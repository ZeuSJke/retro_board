/**
 * Изменения доски: чистые функции «колонки + изменение → колонки».
 *
 * Одно и то же изменение приходит из трёх источников — событие WebSocket, ответ REST и
 * оптимистичное обновление до ответа сервера. Все три описываются типом `BoardChange` и
 * применяются одной функцией `applyBoardChange`, поэтому результат не зависит от того,
 * что пришло первым. Порядок колонок, групп и карточек — как у сервера
 * (`backend/app/models.py`): колонки и группы по `(position, id)`, карточки по
 * `(position, created_at, id)`; после переноса карточки сервер присылает итоговый порядок
 * колонок, и он важнее локальных позиций.
 *
 * Карточки приходят в виде, собранном сервером для текущего участника (чужие до раскрытия —
 * `masked`), поэтому здесь ничего не скрывается и не раскрывается: данные кладутся как есть.
 */
import type {
  ActionItem,
  Card,
  CardGroup,
  Column,
  ColumnInfo,
  WsCardMovedData,
  WsGroupDeletedData,
  WsGroupMovedData,
} from '@/types'

// ── Порядок, как у сервера ───────────────────────────────────────────────────

function compareText(a: string | undefined, b: string | undefined): number {
  const x = a ?? ''
  const y = b ?? ''
  return x < y ? -1 : x > y ? 1 : 0
}

const byCardOrder = (a: Card, b: Card) =>
  (a.position ?? 0) - (b.position ?? 0) ||
  compareText(a.created_at, b.created_at) ||
  compareText(a.id, b.id)

const byPositionAndId = <T extends { position: number; id: string }>(a: T, b: T) =>
  (a.position ?? 0) - (b.position ?? 0) || compareText(a.id, b.id)

/** Проставить позиции по порядку в массиве, не пересоздавая объекты без нужды. */
function renumber<T extends { position: number }>(items: T[]): T[] {
  return items.map((item, idx) => (item.position === idx ? item : { ...item, position: idx }))
}

// ── Колонки ──────────────────────────────────────────────────────────────────

export function applyColumnCreated(
  columns: Column[],
  info: ColumnInfo & Partial<Pick<Column, 'cards' | 'groups'>>,
): Column[] {
  if (columns.some((c) => c.id === info.id)) return columns
  const created: Column = {
    id: info.id,
    board_id: info.board_id,
    title: info.title,
    color: info.color,
    position: info.position,
    cards: info.cards ?? [],
    groups: info.groups ?? [],
  }
  return [...columns, created].sort(byPositionAndId)
}

/**
 * `column_updated` несёт только свойства колонки. Карточки и группы колонки остаются
 * прежними — даже если в событии по ошибке окажутся `cards` или `groups`.
 *
 * Новая позиция — это место колонки в ряду: сервер вынимает колонку, вставляет её на это
 * место и перенумеровывает остальные, а событие присылает только о ней. Здесь то же самое.
 */
export function applyColumnUpdated(
  columns: Column[],
  info: Partial<ColumnInfo> & { id: string },
): Column[] {
  const index = columns.findIndex((c) => c.id === info.id)
  if (index < 0) return columns
  const current = columns[index]
  const updated: Column = {
    ...current,
    board_id: info.board_id ?? current.board_id,
    title: info.title ?? current.title,
    color: info.color ?? current.color,
  }
  const moved = typeof info.position === 'number' && info.position !== current.position
  if (!moved) {
    const same =
      updated.board_id === current.board_id &&
      updated.title === current.title &&
      updated.color === current.color
    if (same) return columns
    return columns.map((c, idx) => (idx === index ? updated : c))
  }
  const rest = columns.filter((_, idx) => idx !== index)
  const target = Math.max(0, Math.min(info.position as number, rest.length))
  rest.splice(target, 0, updated)
  return renumber(rest)
}

/**
 * Вернуть колонкам прежние позиции — откат перестановки, которую сервер не принял.
 * Позиции восстанавливаются точно: по их значениям потом распознаётся перестановка
 * в событии `column_updated`.
 */
export function applyColumnsArranged(
  columns: Column[],
  positions: Record<string, number>,
): Column[] {
  const next = columns.map((c) => {
    const position = positions[c.id]
    return position === undefined || position === c.position ? c : { ...c, position }
  })
  return next.sort(byPositionAndId)
}

export function applyColumnDeleted(columns: Column[], columnId: string): Column[] {
  return columns.some((c) => c.id === columnId) ? columns.filter((c) => c.id !== columnId) : columns
}

/** Вернуть колонку, которую сервер не удалил: на прежнее место, с тем, что в ней было. */
export function applyColumnRestored(columns: Column[], column: Column): Column[] {
  if (columns.some((c) => c.id === column.id)) return columns
  return [...columns, column].sort(byPositionAndId)
}

// ── Карточки ─────────────────────────────────────────────────────────────────

function hasCard(columns: Column[], cardId: string): boolean {
  return columns.some((c) => c.cards.some((x) => x.id === cardId))
}

/** Новая карточка встаёт по своей позиции; уже известная — заменяется пришедшей. */
export function applyCardCreated(columns: Column[], card: Card): Column[] {
  return columns.map((c) => {
    if (c.id === card.column_id) {
      return { ...c, cards: [...c.cards.filter((x) => x.id !== card.id), card].sort(byCardOrder) }
    }
    // Карточка не может числиться в двух колонках сразу
    return c.cards.some((x) => x.id === card.id)
      ? { ...c, cards: c.cards.filter((x) => x.id !== card.id) }
      : c
  })
}

/**
 * Обновить карточку. Если она сменила колонку (массовый перенос приходит как
 * `card_updated`), карточка уходит из прежней колонки и встаёт в новую.
 */
export function applyCardUpdated(columns: Column[], card: Card): Column[] {
  const inPlace = columns.some(
    (c) => c.id === card.column_id && c.cards.some((x) => x.id === card.id),
  )
  if (inPlace) {
    // Внутри колонки порядок меняет только `card_moved` (оно несёт порядок целиком), поэтому
    // место карточки остаётся локальным. Позиция из события — серверная нумерация: после
    // удалений она идёт с пропусками, а локальная после предпросмотра перетаскивания — подряд.
    // Смешать их значило бы при следующей сортировке уронить карточку ниже соседей.
    return columns.map((c) =>
      c.id === card.column_id
        ? {
            ...c,
            cards: c.cards.map((x) => {
              if (x.id !== card.id) return x
              return x.position === card.position ? card : { ...card, position: x.position }
            }),
          }
        : c,
    )
  }
  if (!hasCard(columns, card.id)) return columns
  return columns.map((c) => {
    const rest = c.cards.filter((x) => x.id !== card.id)
    if (c.id === card.column_id) return { ...c, cards: [...rest, card].sort(byCardOrder) }
    return rest.length === c.cards.length ? c : { ...c, cards: rest }
  })
}

/**
 * Точечно изменить карточку в её текущем состоянии. Так делаются оптимистичные обновления
 * и их откаты: правится одно поле, а всё, что успело прийти с сервера, остаётся.
 */
export function applyCardPatched(
  columns: Column[],
  cardId: string,
  patch: (card: Card) => Card,
): Column[] {
  let changed = false
  const next = columns.map((c) => {
    const index = c.cards.findIndex((x) => x.id === cardId)
    if (index < 0) return c
    const patched = patch(c.cards[index])
    if (patched === c.cards[index]) return c
    changed = true
    return { ...c, cards: c.cards.map((x, idx) => (idx === index ? patched : x)) }
  })
  return changed ? next : columns
}

/**
 * Выстроить карточки колонки в порядке, присланном сервером, и проставить им позиции.
 * Сервер при переносе перенумеровывает соседей, а в событии присылает одну карточку —
 * сортировка по локальным (устаревшим) позициям дала бы другой порядок, чем у остальных.
 * Карточки, которых в списке нет (событие о них ещё в пути), остаются в конце.
 */
function orderCards(cards: Card[], orderedIds: string[]): Card[] {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const ordered: Card[] = []
  for (const id of orderedIds) {
    const card = byId.get(id)
    if (!card) continue
    byId.delete(id)
    ordered.push(card.position === ordered.length ? card : { ...card, position: ordered.length })
  }
  const rest = Array.from(byId.values()).sort(byCardOrder)
  return [
    ...ordered,
    ...rest.map((card, idx) => ({ ...card, position: ordered.length + idx })),
  ]
}

/** Вставить карточку на её позицию и перенумеровать колонку — как это делает сервер. */
function insertAtPosition(cards: Card[], card: Card): Card[] {
  const rest = cards.filter((x) => x.id !== card.id)
  const target = Math.max(0, Math.min(card.position ?? rest.length, rest.length))
  rest.splice(target, 0, card)
  return renumber(rest)
}

/**
 * Карточка перенесена. Событие сервера несёт итоговый порядок обеих колонок
 * (`column_card_ids`, `old_column_card_ids`); у ответа REST и оптимистичного переноса списков
 * нет — тогда карточка встаёт на свою позицию, а соседи перенумеровываются, как на сервере.
 */
export function applyCardMoved(
  columns: Column[],
  data: Pick<WsCardMovedData, 'card'> & Partial<Omit<WsCardMovedData, 'card'>>,
): Column[] {
  const { card } = data
  const targetIds = Array.isArray(data.column_card_ids) ? data.column_card_ids : null
  const sourceIds = Array.isArray(data.old_column_card_ids) ? data.old_column_card_ids : null
  const sourceColumnId =
    data.old_column_id ?? columns.find((c) => c.cards.some((x) => x.id === card.id))?.id

  return columns.map((c) => {
    if (c.id === card.column_id) {
      return {
        ...c,
        cards: targetIds
          ? orderCards([...c.cards.filter((x) => x.id !== card.id), card], targetIds)
          : insertAtPosition(c.cards, card),
      }
    }
    if (c.id === sourceColumnId) {
      const cards = c.cards.filter((x) => x.id !== card.id)
      return { ...c, cards: sourceIds ? orderCards(cards, sourceIds) : renumber(cards) }
    }
    // Карточка могла числиться в третьей колонке, если прошлое событие потерялось
    return c.cards.some((x) => x.id === card.id)
      ? { ...c, cards: c.cards.filter((x) => x.id !== card.id) }
      : c
  })
}

/**
 * Переставить карточку, не трогая её содержимого: предпросмотр и итог перетаскивания,
 * отмена и откат. Берётся карточка в её текущем состоянии — всё, что пришло с сервера,
 * пока её тащили или шёл запрос, остаётся.
 */
export function applyCardRelocated(
  columns: Column[],
  target: { id: string; column_id: string; position: number; group_id?: string | null },
): Column[] {
  for (const column of columns) {
    const card = column.cards.find((x) => x.id === target.id)
    if (!card) continue
    if (!columns.some((c) => c.id === target.column_id)) return columns
    return applyCardMoved(columns, {
      card: {
        ...card,
        column_id: target.column_id,
        position: target.position,
        group_id: target.group_id === undefined ? card.group_id : target.group_id,
      },
      old_column_id: column.id,
    })
  }
  return columns
}

export function applyCardDeleted(columns: Column[], cardId: string): Column[] {
  return applyCardsDeleted(columns, [cardId])
}

export function applyCardsDeleted(columns: Column[], cardIds: string[]): Column[] {
  if (cardIds.length === 0) return columns
  const removed = new Set(cardIds)
  let changed = false
  const next = columns.map((c) => {
    if (!c.cards.some((x) => removed.has(x.id))) return c
    changed = true
    return { ...c, cards: c.cards.filter((x) => !removed.has(x.id)) }
  })
  return changed ? next : columns
}

/** Снять все голоса участника (ответ на «Сбросить мои голоса»). */
export function applyVotesReset(columns: Column[], participantId: string): Column[] {
  if (!participantId) return columns
  let changed = false
  const next = columns.map((c) => {
    if (!c.cards.some((card) => (card.likes || []).includes(participantId))) return c
    changed = true
    return {
      ...c,
      cards: c.cards.map((card) =>
        (card.likes || []).includes(participantId)
          ? { ...card, likes: card.likes.filter((voter) => voter !== participantId) }
          : card,
      ),
    }
  })
  return changed ? next : columns
}

// ── Группы ───────────────────────────────────────────────────────────────────

/** Новая группа; `cardIds` — карточки колонки, которые в неё вошли (ответ REST их перечисляет). */
export function applyGroupCreated(
  columns: Column[],
  group: CardGroup,
  cardIds: string[] = [],
): Column[] {
  const members = new Set(cardIds)
  return columns.map((c) => {
    if (c.id !== group.column_id) {
      // Группа живёт в одной колонке
      return (c.groups || []).some((x) => x.id === group.id)
        ? { ...c, groups: c.groups.filter((x) => x.id !== group.id) }
        : c
    }
    const groups = [...(c.groups || []).filter((x) => x.id !== group.id), group].sort(
      byPositionAndId,
    )
    const cards =
      members.size > 0 && c.cards.some((card) => members.has(card.id) && card.group_id !== group.id)
        ? c.cards.map((card) =>
            members.has(card.id) && card.group_id !== group.id
              ? { ...card, group_id: group.id }
              : card,
          )
        : c.cards
    return { ...c, groups, cards }
  })
}

export function applyGroupUpdated(columns: Column[], group: CardGroup): Column[] {
  return columns.map((c) =>
    (c.groups || []).some((x) => x.id === group.id)
      ? { ...c, groups: c.groups.map((x) => (x.id === group.id ? group : x)) }
      : c,
  )
}

/** Группа расформирована: её карточки остаются в колонке без группы. */
export function applyGroupDeleted(
  columns: Column[],
  data: Pick<WsGroupDeletedData, 'id'> & Partial<WsGroupDeletedData>,
): Column[] {
  return columns.map((c) => {
    const hasGroup = (c.groups || []).some((x) => x.id === data.id)
    const hasMembers = c.cards.some((card) => card.group_id === data.id)
    if (!hasGroup && !hasMembers) return c
    return {
      ...c,
      groups: hasGroup ? c.groups.filter((x) => x.id !== data.id) : c.groups,
      // Карточку, которую уже положили в другую группу, расформирование не касается
      cards: hasMembers
        ? c.cards.map((card) => (card.group_id === data.id ? { ...card, group_id: null } : card))
        : c.cards,
    }
  })
}

/** Вернуть группу, которую сервер не расформировал, вместе с её карточками. */
export function applyGroupRestored(
  columns: Column[],
  group: CardGroup,
  cardIds: string[],
): Column[] {
  const members = new Set(cardIds)
  return columns.map((c) => {
    if (c.id !== group.column_id) return c
    const groups = (c.groups || []).some((x) => x.id === group.id)
      ? c.groups
      : [...(c.groups || []), group].sort(byPositionAndId)
    return {
      ...c,
      groups,
      // Карточку, которую за это время положили в другую группу, не трогаем
      cards: c.cards.map((card) =>
        members.has(card.id) && card.group_id === null ? { ...card, group_id: group.id } : card,
      ),
    }
  })
}

export function applyGroupMoved(columns: Column[], data: WsGroupMovedData): Column[] {
  const { group, old_column_id, cards } = data
  const movedIds = new Set(cards.map((card) => card.id))
  return columns.map((c) => {
    if (c.id === group.column_id) {
      return {
        ...c,
        groups: [...(c.groups || []).filter((x) => x.id !== group.id), group].sort(
          byPositionAndId,
        ),
        cards: [...c.cards.filter((card) => !movedIds.has(card.id)), ...cards].sort(byCardOrder),
      }
    }
    if (c.id === old_column_id || (c.groups || []).some((x) => x.id === group.id)) {
      return {
        ...c,
        groups: (c.groups || []).filter((x) => x.id !== group.id),
        cards: c.cards.filter((card) => !movedIds.has(card.id)),
      }
    }
    return c
  })
}

/**
 * Перенести группу с её карточками в другую колонку — оптимистично или откатом.
 * Группа и карточки берутся в текущем состоянии.
 */
export function applyGroupRelocated(
  columns: Column[],
  target: { id: string; column_id: string },
): Column[] {
  const source = columns.find((c) => (c.groups || []).some((g) => g.id === target.id))
  if (!source || source.id === target.column_id) return columns
  if (!columns.some((c) => c.id === target.column_id)) return columns
  const group = source.groups.find((g) => g.id === target.id)
  if (!group) return columns
  return applyGroupMoved(columns, {
    group: { ...group, column_id: target.column_id },
    old_column_id: source.id,
    cards: source.cards
      .filter((card) => card.group_id === target.id)
      .map((card) => ({ ...card, column_id: target.column_id })),
  })
}

// ── Участники ────────────────────────────────────────────────────────────────

/**
 * Участник сменил имя: обновить подпись у его карточек. Карточки связаны с участником
 * по `author_id`, поэтому тёзки и анонимные карточки (`author_id: null`) не затрагиваются.
 */
export function applyParticipantRenamed(
  columns: Column[],
  participantId: string,
  name: string,
): Column[] {
  if (!participantId) return columns
  return columns.map((c) => {
    if (!c.cards.some((card) => card.author_id === participantId && card.author !== name)) return c
    return {
      ...c,
      cards: c.cards.map((card) =>
        card.author_id === participantId ? { ...card, author: name } : card,
      ),
    }
  })
}

// ── Задачи ───────────────────────────────────────────────────────────────────

/**
 * Задача создана, изменена или возвращена после неудачного удаления: известная заменяется,
 * новая встаёт по времени создания — в том же порядке список отдаёт сервер.
 */
export function applyActionItemSaved(items: ActionItem[], item: ActionItem): ActionItem[] {
  if (items.some((i) => i.id === item.id)) {
    return items.map((i) => (i.id === item.id ? item : i))
  }
  const next = [...items, item]
  const ordered = next.every(
    (i, idx) => idx === 0 || compareText(next[idx - 1].created_at, i.created_at) <= 0,
  )
  return ordered ? next : next.sort((a, b) => compareText(a.created_at, b.created_at))
}

/**
 * Правка задачи — оптимистичная, подтверждённая сервером или её откат: меняется только
 * задача, которая есть в списке. Если коллега успел её удалить, правка (и откат после 404)
 * не возвращает её на экран.
 */
export function applyActionItemChanged(items: ActionItem[], item: ActionItem): ActionItem[] {
  return items.some((i) => i.id === item.id)
    ? items.map((i) => (i.id === item.id ? item : i))
    : items
}

export function applyActionItemDeleted(items: ActionItem[], itemId: string): ActionItem[] {
  return items.some((i) => i.id === itemId) ? items.filter((i) => i.id !== itemId) : items
}

/** Сколько на доске чужих карточек, скрытых до раскрытия. */
export function countMaskedCards(columns: Pick<Column, 'cards'>[]): number {
  return columns.reduce((sum, c) => sum + c.cards.filter((card) => card.masked).length, 0)
}

// ── Единая точка применения ──────────────────────────────────────────────────

/**
 * Изменение состояния доски. Названия совпадают с событиями сервера; `*_restored`,
 * `*_relocated`, `card_patched` и `votes_reset` есть только у клиента — это оптимистичные
 * правки и их откаты.
 */
export type BoardChange =
  | { type: 'column_created'; column: ColumnInfo & Partial<Pick<Column, 'cards' | 'groups'>> }
  | { type: 'column_updated'; column: Partial<ColumnInfo> & { id: string } }
  | { type: 'column_deleted'; id: string }
  | { type: 'column_restored'; column: Column }
  | { type: 'columns_arranged'; positions: Record<string, number> }
  | { type: 'card_created'; card: Card }
  | { type: 'card_updated'; card: Card }
  | { type: 'card_patched'; id: string; patch: (card: Card) => Card }
  | ({ type: 'card_moved' } & Pick<WsCardMovedData, 'card'> & Partial<Omit<WsCardMovedData, 'card'>>)
  | {
      type: 'card_relocated'
      id: string
      column_id: string
      position: number
      group_id?: string | null
    }
  | { type: 'card_deleted'; id: string }
  | { type: 'cards_deleted'; ids: string[] }
  | { type: 'votes_reset'; participant_id: string }
  | { type: 'group_created'; group: CardGroup; card_ids?: string[] }
  | { type: 'group_updated'; group: CardGroup }
  | ({ type: 'group_deleted' } & Pick<WsGroupDeletedData, 'id'> & Partial<WsGroupDeletedData>)
  | { type: 'group_restored'; group: CardGroup; card_ids: string[] }
  | ({ type: 'group_moved' } & WsGroupMovedData)
  | { type: 'group_relocated'; id: string; column_id: string }
  | { type: 'participant_renamed'; participant_id: string; name: string }

/** Применить изменение — одинаково для события WebSocket, ответа REST и оптимистичной правки. */
export function applyBoardChange(columns: Column[], change: BoardChange): Column[] {
  switch (change.type) {
    case 'column_created':
      return applyColumnCreated(columns, change.column)
    case 'column_updated':
      return applyColumnUpdated(columns, change.column)
    case 'column_deleted':
      return applyColumnDeleted(columns, change.id)
    case 'column_restored':
      return applyColumnRestored(columns, change.column)
    case 'columns_arranged':
      return applyColumnsArranged(columns, change.positions)
    case 'card_created':
      return applyCardCreated(columns, change.card)
    case 'card_updated':
      return applyCardUpdated(columns, change.card)
    case 'card_patched':
      return applyCardPatched(columns, change.id, change.patch)
    case 'card_moved':
      return applyCardMoved(columns, change)
    case 'card_relocated':
      return applyCardRelocated(columns, change)
    case 'card_deleted':
      return applyCardDeleted(columns, change.id)
    case 'cards_deleted':
      return applyCardsDeleted(columns, change.ids)
    case 'votes_reset':
      return applyVotesReset(columns, change.participant_id)
    case 'group_created':
      return applyGroupCreated(columns, change.group, change.card_ids)
    case 'group_updated':
      return applyGroupUpdated(columns, change.group)
    case 'group_deleted':
      return applyGroupDeleted(columns, change)
    case 'group_restored':
      return applyGroupRestored(columns, change.group, change.card_ids)
    case 'group_moved':
      return applyGroupMoved(columns, change)
    case 'group_relocated':
      return applyGroupRelocated(columns, change)
    case 'participant_renamed':
      return applyParticipantRenamed(columns, change.participant_id, change.name)
    default:
      return columns
  }
}

/**
 * Сущность, которой касается изменение (`card:<id>`, `group:<id>`, `column:<id>`), и создаёт
 * ли оно её. Нужно, чтобы запоздавший ответ REST не затёр более свежее событие сокета
 * (см. `useBoardWebSocket.applyChange`).
 */
export function describeBoardChange(change: BoardChange): { key: string | null; creates: boolean } {
  switch (change.type) {
    case 'column_created':
      return { key: `column:${change.column.id}`, creates: true }
    case 'column_updated':
      return { key: `column:${change.column.id}`, creates: false }
    case 'column_deleted':
      return { key: `column:${change.id}`, creates: false }
    case 'card_created':
      return { key: `card:${change.card.id}`, creates: true }
    case 'card_updated':
    case 'card_moved':
      return { key: `card:${change.card.id}`, creates: false }
    case 'card_deleted':
      return { key: `card:${change.id}`, creates: false }
    case 'group_created':
      return { key: `group:${change.group.id}`, creates: true }
    case 'group_updated':
    case 'group_moved':
      return { key: `group:${change.group.id}`, creates: false }
    case 'group_deleted':
      return { key: `group:${change.id}`, creates: false }
    default:
      return { key: null, creates: false }
  }
}

/** Есть ли сущность с таким ключом на доске. */
export function hasBoardEntity(columns: Column[], key: string): boolean {
  const separator = key.indexOf(':')
  const kind = key.slice(0, separator)
  const id = key.slice(separator + 1)
  if (kind === 'column') return columns.some((c) => c.id === id)
  if (kind === 'card') return hasCard(columns, id)
  if (kind === 'group') return columns.some((c) => (c.groups || []).some((g) => g.id === id))
  return false
}
