/**
 * Личность и права участника на доске.
 *
 * «Я» — это `participant.id` из сессии, а не имя: тёзки — разные участники, смена имени
 * ничего не отвязывает. Права здесь повторяют серверные (`backend/app/board_view.py`) и нужны
 * только для интерфейса — скрыть или отключить то, на что сервер всё равно ответит 403.
 */
import type { Board, Card, Column } from '@/types'

/** Чем сервер заменяет чужой голос в анонимном режиме. */
export const ANON_VOTER = 'anon'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type CardIdentity = Pick<Card, 'author_id'> & Partial<Pick<Card, 'masked'>>

/**
 * Из чего считать цвет аватара и курсора: из идентификатора участника, а не из имени —
 * так тёзки получают разные цвета, а смена имени цвет не меняет. Имя — запасной вариант
 * для данных без участника (анонимный режим, старые карточки).
 */
export function avatarSeed(participantId: string | null | undefined, name: string): string {
  return participantId || name
}

/** Моя ли карточка — по идентификатору участника. */
export function isOwnCard(card: CardIdentity, participantId: string | null | undefined): boolean {
  return Boolean(participantId) && card.author_id === participantId
}

/** Сколько моих голосов на карточке (в режиме dot voting их может быть несколько). */
export function countMyVotes(
  card: Pick<Card, 'likes'>,
  participantId: string | null | undefined,
): number {
  if (!participantId) return 0
  return (card.likes || []).filter((voter) => voter === participantId).length
}

/** Сколько голосов участник уже отдал на доске. */
export function countMyVotesOnBoard(
  columns: Pick<Column, 'cards'>[],
  participantId: string | null | undefined,
): number {
  return columns.reduce(
    (sum, col) => sum + col.cards.reduce((acc, card) => acc + countMyVotes(card, participantId), 0),
    0,
  )
}

/** Копия списка голосов с одним добавленным или снятым голосом участника. */
export function withMyVote(likes: string[], participantId: string, action: 'add' | 'remove'): string[] {
  if (action === 'add') return [...likes, participantId]
  const idx = likes.indexOf(participantId)
  return idx >= 0 ? [...likes.slice(0, idx), ...likes.slice(idx + 1)] : likes
}

/**
 * Модератор доски: её создатель или ведущий активной сессии.
 * У досок, созданных до появления участников, создателя нет — ими управляет любой.
 */
export function canModerateBoard(
  board: Pick<Board, 'created_by_id'>,
  facilitatorId: string | null | undefined,
  participantId: string | null | undefined,
): boolean {
  if (!board.created_by_id) return true
  if (!participantId) return false
  return board.created_by_id === participantId || facilitatorId === participantId
}

/**
 * Карточка без автора, созданная до появления участников: сервер разрешает править и удалять
 * её любому. В анонимном режиме автор чужой карточки тоже не передаётся, и отличить одно
 * от другого нельзя — считаем карточку чужой.
 */
function isLegacyCard(card: CardIdentity, anonymous: boolean): boolean {
  return card.author_id == null && !anonymous && !card.masked
}

/** Текст карточки правит только её автор. */
export function canEditCardText(
  card: CardIdentity,
  participantId: string | null | undefined,
  options: { anonymous?: boolean } = {},
): boolean {
  if (card.masked) return false
  return isOwnCard(card, participantId) || isLegacyCard(card, Boolean(options.anonymous))
}

/** Карточку удаляет её автор или модератор доски. */
export function canDeleteCard(
  card: CardIdentity,
  participantId: string | null | undefined,
  options: { anonymous?: boolean; moderator?: boolean } = {},
): boolean {
  if (options.moderator) return true
  if (card.masked) return false
  return isOwnCard(card, participantId) || isLegacyCard(card, Boolean(options.anonymous))
}

/**
 * Почему выбранные карточки нельзя объединить; `null` — можно.
 *
 * Объединение переписывает текст первой карточки и удаляет остальные, поэтому сервер
 * разрешает его модератору, а участнику — только со своими карточками, и никому — пока
 * карточки скрыты (иначе чужой скрытый текст склеился бы в карточку вызывающего).
 */
export function mergeBlockedReason(
  cards: CardIdentity[],
  participantId: string | null | undefined,
  options: { anonymous?: boolean; moderator?: boolean; cardsHidden?: boolean } = {},
): string | null {
  if (options.cardsHidden) return CANNOT_MERGE_HIDDEN_HINT
  if (options.moderator) return null
  const allMine = cards.every((card) =>
    canEditCardText(card, participantId, { anonymous: options.anonymous }),
  )
  return allMine ? null : CANNOT_MERGE_FOREIGN_HINT
}

export const CANNOT_MERGE_HIDDEN_HINT = 'Объединять карточки можно после раскрытия'
export const CANNOT_MERGE_FOREIGN_HINT =
  'Объединять чужие карточки может создатель доски или ведущий'
export const PRIVACY_SETTINGS_HINT =
  'Скрытый сбор и анонимный режим меняет создатель доски или ведущий'
export const NOT_YOUR_CARD_HINT = 'Текст может менять только автор карточки'
export const CANNOT_DELETE_CARD_HINT = 'Удалить чужую карточку может создатель доски или ведущий'
export const CANNOT_DELETE_COLUMN_HINT =
  'Удалить колонку с карточками может создатель доски или ведущий'
export const CANNOT_DELETE_BOARD_HINT = 'Удалить доску может её создатель или ведущий'

export interface VotersSummary {
  /** Известные голосовавшие: «Вы», имена участников, имена из старых карточек. */
  labels: string[]
  /** Голоса, чьих авторов назвать нельзя: анонимные и участники, которых клиент не знает. */
  others: number
}

/**
 * Кто голосовал за карточку. `likes` — идентификаторы участников; имя известно для тех,
 * кто сейчас на доске или автор какой-нибудь карточки (`names`). Несколько голосов одного
 * участника сворачиваются в «Имя ×N».
 */
export function summarizeVoters(
  likes: string[],
  names: Record<string, string>,
  participantId: string | null | undefined,
): VotersSummary {
  const counts = new Map<string, number>()
  let others = 0
  for (const voter of likes) {
    let label: string | null
    if (participantId && voter === participantId) label = 'Вы'
    else if (voter === ANON_VOTER) label = null
    else if (names[voter]) label = names[voter]
    else if (UUID_RE.test(voter)) label = null
    // У карточек, созданных до появления участников, в голосах лежат имена
    else label = voter
    if (label === null) others += 1
    else counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return {
    labels: Array.from(counts, ([label, count]) => (count > 1 ? `${label} ×${count}` : label)),
    others,
  }
}

function pluralVotes(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'голос'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'голоса'
  return 'голосов'
}

/** Строка для подсказки у счётчика голосов. */
export function formatVoters(summary: VotersSummary): string {
  const { labels, others } = summary
  if (labels.length === 0) return others > 0 ? `${others} ${pluralVotes(others)}` : ''
  return others > 0 ? `${labels.join(', ')} и ещё ${others}` : labels.join(', ')
}

/** Подпись «N голосов» с правильным окончанием. */
export function formatVotesCount(n: number): string {
  return `${n} ${pluralVotes(n)}`
}
