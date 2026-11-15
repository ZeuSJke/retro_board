/**
 * Адреса досок на клиенте.
 *
 * `/board/start` — служебный адрес «открыть первую доску команды»: на него ведут главная
 * страница без выбранной доски и кнопка «К первой доске». Сервер такой slug доскам не выдаёт
 * (доска «Start» получает `start-xxxxxx`), но у старых данных он возможен — поэтому, если доска
 * с таким slug есть, по этому адресу открывается именно она (см. `resolveStartBoard`).
 */
export const FIRST_BOARD_REF = 'start'
export const FIRST_BOARD_ROUTE = `/board/${FIRST_BOARD_REF}`

interface BoardRef {
  id: string
  slug?: string | null
}

/** Адрес доски: по slug, а если его нет — по идентификатору. */
export function boardPath(board: BoardRef): string {
  return `/board/${board.slug || board.id}`
}

/**
 * Какую доску открыть по адресу `/board/start`: доску с таким slug, если она существует,
 * иначе первую в списке. `null` — досок нет.
 */
export function resolveStartBoard<T extends BoardRef>(boards: T[]): T | null {
  return boards.find((b) => b.slug === FIRST_BOARD_REF) ?? boards[0] ?? null
}
