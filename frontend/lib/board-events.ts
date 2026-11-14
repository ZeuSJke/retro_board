/**
 * Редьюсеры WebSocket-событий доски: чистые функции «колонки + событие → колонки».
 *
 * Хук `useBoardWebSocket` только маршрутизирует события сюда. Карточки приходят в виде,
 * собранном сервером для текущего участника (чужие до раскрытия — `masked`), поэтому здесь
 * ничего не скрывается и не раскрывается: данные кладутся как есть.
 */
import type {
  BoardMood,
  Card,
  CardGroup,
  Column,
  ColumnInfo,
  WsCardMovedData,
  WsGroupDeletedData,
  WsGroupMovedData,
} from '@/types'

const byPosition = (a: Card, b: Card) => (a.position ?? 0) - (b.position ?? 0)

// ── Колонки ──────────────────────────────────────────────────────────────────

export function applyColumnCreated(columns: Column[], info: ColumnInfo): Column[] {
  if (columns.some((c) => c.id === info.id)) return columns
  return [...columns, { ...info, cards: [], groups: [] }]
}

/**
 * `column_updated` несёт только свойства колонки. Карточки и группы колонки остаются
 * прежними — даже если в событии по ошибке окажутся `cards` или `groups`.
 */
export function applyColumnUpdated(
  columns: Column[],
  info: Partial<ColumnInfo> & { id: string },
): Column[] {
  return columns.map((c) => {
    if (c.id !== info.id) return c
    return {
      ...c,
      board_id: info.board_id ?? c.board_id,
      title: info.title ?? c.title,
      color: info.color ?? c.color,
      position: info.position ?? c.position,
    }
  })
}

export function applyColumnDeleted(columns: Column[], columnId: string): Column[] {
  return columns.filter((c) => c.id !== columnId)
}

// ── Карточки ─────────────────────────────────────────────────────────────────

export function applyCardCreated(columns: Column[], card: Card): Column[] {
  return columns.map((c) =>
    c.id === card.column_id
      ? { ...c, cards: [...c.cards.filter((x) => x.id !== card.id), card].sort(byPosition) }
      : c,
  )
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
    return columns.map((c) =>
      c.id === card.column_id
        ? { ...c, cards: c.cards.map((x) => (x.id === card.id ? card : x)) }
        : c,
    )
  }
  const known = columns.some((c) => c.cards.some((x) => x.id === card.id))
  if (!known) return columns
  return columns.map((c) => {
    const rest = c.cards.filter((x) => x.id !== card.id)
    if (c.id === card.column_id) return { ...c, cards: [...rest, card].sort(byPosition) }
    return rest.length === c.cards.length ? c : { ...c, cards: rest }
  })
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
  const rest = Array.from(byId.values()).sort(byPosition)
  return [
    ...ordered,
    ...rest.map((card, idx) => ({ ...card, position: ordered.length + idx })),
  ]
}

export function applyCardMoved(columns: Column[], data: WsCardMovedData): Column[] {
  const { card, old_column_id } = data
  const targetIds = Array.isArray(data.column_card_ids) ? data.column_card_ids : null
  const sourceIds = Array.isArray(data.old_column_card_ids) ? data.old_column_card_ids : null

  return columns.map((c) => {
    if (c.id === card.column_id) {
      const cards = [...c.cards.filter((x) => x.id !== card.id), card]
      // Без списка порядка (старый сервер) остаётся прежнее поведение — по позициям
      return { ...c, cards: targetIds ? orderCards(cards, targetIds) : cards.sort(byPosition) }
    }
    if (c.id === old_column_id) {
      const cards = c.cards.filter((x) => x.id !== card.id)
      return { ...c, cards: sourceIds ? orderCards(cards, sourceIds) : cards }
    }
    // Карточка могла числиться в третьей колонке, если прошлое событие потерялось
    return c.cards.some((x) => x.id === card.id)
      ? { ...c, cards: c.cards.filter((x) => x.id !== card.id) }
      : c
  })
}

export function applyCardDeleted(columns: Column[], cardId: string): Column[] {
  return columns.map((c) =>
    c.cards.some((x) => x.id === cardId)
      ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) }
      : c,
  )
}

// ── Группы ───────────────────────────────────────────────────────────────────

export function applyGroupCreated(columns: Column[], group: CardGroup): Column[] {
  return columns.map((c) =>
    c.id === group.column_id
      ? { ...c, groups: [...(c.groups || []).filter((x) => x.id !== group.id), group] }
      : c,
  )
}

export function applyGroupUpdated(columns: Column[], group: CardGroup): Column[] {
  return columns.map((c) => ({
    ...c,
    groups: (c.groups || []).map((x) => (x.id === group.id ? group : x)),
  }))
}

export function applyGroupDeleted(columns: Column[], data: WsGroupDeletedData): Column[] {
  const cardIds = data.card_ids || []
  return columns.map((c) =>
    c.id === data.column_id
      ? {
          ...c,
          groups: (c.groups || []).filter((x) => x.id !== data.id),
          cards: c.cards.map((card) =>
            cardIds.includes(card.id) ? { ...card, group_id: null } : card,
          ),
        }
      : c,
  )
}

export function applyGroupMoved(columns: Column[], data: WsGroupMovedData): Column[] {
  const { group, old_column_id, cards } = data
  const movedIds = new Set(cards.map((card) => card.id))
  return columns.map((c) => {
    if (c.id === old_column_id) {
      return {
        ...c,
        groups: (c.groups || []).filter((x) => x.id !== group.id),
        cards: c.cards.filter((card) => !movedIds.has(card.id)),
      }
    }
    if (c.id === group.column_id) {
      return {
        ...c,
        groups: [...(c.groups || []).filter((x) => x.id !== group.id), group],
        cards: [...c.cards.filter((card) => !movedIds.has(card.id)), ...cards],
      }
    }
    return c
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

export function applyParticipantRenamedToMoods(
  moods: BoardMood[],
  participantId: string,
  name: string,
): BoardMood[] {
  if (!participantId) return moods
  return moods.map((m) =>
    m.participant_id === participantId && m.author !== name ? { ...m, author: name } : m,
  )
}

/**
 * Оценка настроения сохранена или обновлена. Запись у участника на доске одна, её `id`
 * не меняется — по нему и сопоставляем (имена в анонимном режиме скрыты и не уникальны).
 */
export function applyMoodUpdated(moods: BoardMood[], mood: BoardMood): BoardMood[] {
  return moods.some((m) => m.id === mood.id)
    ? moods.map((m) => (m.id === mood.id ? mood : m))
    : [...moods, mood]
}

/** Сколько на доске чужих карточек, скрытых до раскрытия. */
export function countMaskedCards(columns: Pick<Column, 'cards'>[]): number {
  return columns.reduce((sum, c) => sum + c.cards.filter((card) => card.masked).length, 0)
}
