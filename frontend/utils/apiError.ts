/**
 * Сообщения об ошибках API и защита от двойных уведомлений.
 *
 * Перехватчик ответов (`api/index.ts`) показывает общий тост только для ошибок, о которых
 * никто не сообщил сам. Вызов `getApiErrorMessage` означает «это сообщение сейчас увидит
 * пользователь» и помечает ошибку — второго тоста от перехватчика не будет.
 */

const reportedErrors = new WeakSet<object>()

/** Пометить ошибку как показанную пользователю (или намеренно обработанную без сообщения). */
export function markApiErrorReported(error: unknown): void {
  if (error != null && typeof error === 'object') {
    reportedErrors.add(error)
  }
}

export function isApiErrorReported(error: unknown): boolean {
  return error != null && typeof error === 'object' && reportedErrors.has(error)
}

/** HTTP-статус ответа, если ошибка пришла от сервера. */
export function getApiErrorStatus(error: unknown): number | undefined {
  if (error != null && typeof error === 'object') {
    const status = (error as { response?: { status?: unknown } }).response?.status
    if (typeof status === 'number') return status
  }
  return undefined
}

export const SESSION_EXPIRED_MESSAGE = 'Сессия завершилась — войдите снова'
export const RATE_LIMIT_MESSAGE = 'Слишком много запросов. Подождите немного.'

/**
 * Подписи полей запроса для сообщений о проверке (ответ 422): имя поля в теле → как оно
 * называется в интерфейсе. Экран может уточнить или дополнить их третьим аргументом
 * `getApiErrorMessage` — например, `name` у команды это «Название команды», а при входе «Имя».
 */
export type FieldLabels = Record<string, string>

const DEFAULT_FIELD_LABELS: FieldLabels = {
  access_key: 'Ключ доступа',
  slug: 'Код команды',
  workspace_slug: 'Код команды',
  invite_token: 'Ссылка-приглашение',
  name: 'Название',
  title: 'Заголовок',
  text: 'Текст',
  login: 'Логин',
  password: 'Пароль',
}

/** Что означает шаблон из схемы сервера, человеческими словами. */
const PATTERN_HINTS: Record<string, string> = {
  '^[a-z0-9-]+$': 'только строчные латинские буквы, цифры и дефис',
  '^#[0-9a-fA-F]{6}$': 'цвет в формате #RRGGBB',
}

/** Сколько сообщений о проверке показываем разом: остальные пользователь увидит после правки. */
const MAX_VALIDATION_MESSAGES = 3

/** «не короче 1 символа», «не короче 4 символов», «не длиннее 21 символа». */
function charsGenitive(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? 'символа' : 'символов'
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Имя поля из `loc`: последний строковый элемент после раздела запроса (`body`, `query`, `path`). */
function fieldFromLoc(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null
  const names = loc.slice(1).filter((part): part is string => typeof part === 'string')
  return names.length > 0 ? names[names.length - 1] : null
}

/** Текст для одной ошибки проверки; `null` — запись не похожа на ошибку pydantic. */
function describeValidationIssue(issue: unknown, labels: FieldLabels): string | null {
  if (issue == null || typeof issue !== 'object') return null
  const { type, loc, msg, ctx } = issue as {
    type?: unknown
    loc?: unknown
    msg?: unknown
    ctx?: Record<string, unknown> | null
  }
  if (typeof type !== 'string') return null

  // Свои проверки сервера (`ValueError` в схеме) уже написаны по-русски и называют поле сами
  if (type === 'value_error' && typeof msg === 'string') {
    const text = msg.replace(/^Value error,\s*/i, '').trim()
    if (text) return text
  }
  if (type === 'json_invalid') return 'Сервер не смог прочитать запрос'

  const field = fieldFromLoc(loc)
  const label = field ? (labels[field] ?? `Поле «${field}»`) : 'Значение'
  const minLength = toFiniteNumber(ctx?.min_length)
  const maxLength = toFiniteNumber(ctx?.max_length)

  switch (type) {
    case 'missing':
      return `${label}: поле не заполнено`
    case 'string_too_short':
      if (minLength === null || minLength <= 1) return `${label}: поле не заполнено`
      return `${label}: не короче ${minLength} ${charsGenitive(minLength)}`
    case 'string_too_long':
      return maxLength === null
        ? `${label}: слишком длинное значение`
        : `${label}: не длиннее ${maxLength} ${charsGenitive(maxLength)}`
    case 'string_pattern_mismatch': {
      const hint = typeof ctx?.pattern === 'string' ? PATTERN_HINTS[ctx.pattern] : undefined
      return `${label}: ${hint ?? 'недопустимый формат'}`
    }
    case 'too_short':
      return minLength === null ? `${label}: слишком мало значений` : `${label}: не меньше ${minLength}`
    case 'too_long':
      return maxLength === null ? `${label}: слишком много значений` : `${label}: не больше ${maxLength}`
    case 'greater_than_equal':
    case 'greater_than': {
      const bound = toFiniteNumber(ctx?.ge ?? ctx?.gt)
      if (bound === null) break
      return `${label}: ${type === 'greater_than' ? 'больше' : 'не меньше'} ${bound}`
    }
    case 'less_than_equal':
    case 'less_than': {
      const bound = toFiniteNumber(ctx?.le ?? ctx?.lt)
      if (bound === null) break
      return `${label}: ${type === 'less_than' ? 'меньше' : 'не больше'} ${bound}`
    }
  }
  return `${label}: недопустимое значение`
}

/**
 * Сообщения для ответа 422: `detail` — список ошибок проверки от FastAPI
 * (`[{ type, loc, msg, ctx }]`, поле `input` сервер убирает). Пустой список — формат не распознан.
 */
export function getValidationMessages(detail: unknown, fieldLabels: FieldLabels = {}): string[] {
  if (!Array.isArray(detail)) return []
  const labels = { ...DEFAULT_FIELD_LABELS, ...fieldLabels }
  const messages: string[] = []
  for (const issue of detail) {
    const message = describeValidationIssue(issue, labels)?.replace(/[.\s]+$/, '')
    if (message && !messages.includes(message)) messages.push(message)
  }
  return messages
}

/**
 * Понятный текст ошибки API (обычно Axios) для показа пользователю.
 * Помечает ошибку как показанную — см. описание модуля.
 *
 * Ответ 422 разбирается по полям: «Ключ доступа: не короче 4 символов». Подписи полей
 * конкретной формы передавайте в `fieldLabels`.
 */
export function getApiErrorMessage(
  error: unknown,
  fallback = 'Произошла ошибка',
  fieldLabels?: FieldLabels,
): string {
  markApiErrorReported(error)
  const status = getApiErrorStatus(error)
  // У этих статусов текст сервера служебный и на английском — заменяем своим
  if (status === 401) return SESSION_EXPIRED_MESSAGE
  if (status === 429) return RATE_LIMIT_MESSAGE
  if (error != null && typeof error === 'object') {
    const err = error as { response?: { data?: { detail?: unknown } } }
    const detail = err.response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }
    const messages = getValidationMessages(detail, fieldLabels)
    if (messages.length > 0) {
      return messages.slice(0, MAX_VALIDATION_MESSAGES).join('. ')
    }
  }
  return fallback
}
