/**
 * Ссылки-приглашения: `/join/<токен>` ведёт в команду, `/join/<токен>?board=<доска>` —
 * сразу на доску. Человеку без сессии по такой ссылке остаётся ввести только имя.
 */

/** Токен приглашения: сервер выдаёт `token_urlsafe` и принимает от 8 до 64 символов. */
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/

/** Адрес доски в ссылке: её slug (латиница, цифры, дефис) или идентификатор. */
const BOARD_REF_RE = /^[A-Za-z0-9-]{1,100}$/

export function isInviteTokenShape(token: string): boolean {
  return INVITE_TOKEN_RE.test(token)
}

/** Значение параметра `board` из ссылки; всё, что не похоже на адрес доски, отбрасывается. */
export function normalizeBoardRef(value: string | string[] | null | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' && BOARD_REF_RE.test(raw) ? raw : null
}

/** Куда вести после входа по приглашению: на доску из ссылки или на стартовую страницу. */
export function inviteDestination(boardRef: string | null): string {
  return boardRef ? `/board/${boardRef}` : '/'
}

/** Ссылка-приглашение в команду; с `boardRef` — ссылка на конкретную доску. */
export function buildInviteLink(origin: string, token: string, boardRef?: string | null): string {
  const base = `${origin.replace(/\/$/, '')}/join/${encodeURIComponent(token)}`
  return boardRef ? `${base}?board=${encodeURIComponent(boardRef)}` : base
}
