import { describe, expect, it } from 'vitest'
import {
  getApiErrorMessage,
  getValidationMessages,
  isApiErrorReported,
  RATE_LIMIT_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
} from '../../utils/apiError'

/** Ошибка в том виде, в каком её отдаёт Axios: статус и тело ответа сервера. */
function apiError(status: number, detail: unknown) {
  return { response: { status, data: { detail } } }
}

// Тела ответов 422 сняты с настоящего сервера (FastAPI без поля `input`)
const TEAM_CREATE_ISSUES = [
  {
    type: 'string_pattern_mismatch',
    loc: ['body', 'slug'],
    msg: "String should match pattern '^[a-z0-9-]+$'",
    ctx: { pattern: '^[a-z0-9-]+$' },
  },
  {
    type: 'string_too_long',
    loc: ['body', 'name'],
    msg: 'String should have at most 120 characters',
    ctx: { max_length: 120 },
  },
  {
    type: 'string_too_short',
    loc: ['body', 'access_key'],
    msg: 'String should have at least 4 characters',
    ctx: { min_length: 4 },
  },
]

const TEAM_LABELS = { name: 'Название команды' }

describe('getValidationMessages — разбор ответа 422', () => {
  it('называет поле и причину: код команды, длина названия, длина ключа', () => {
    expect(getValidationMessages(TEAM_CREATE_ISSUES, TEAM_LABELS)).toEqual([
      'Код команды: только строчные латинские буквы, цифры и дефис',
      'Название команды: не длиннее 120 символов',
      'Ключ доступа: не короче 4 символов',
    ])
  })

  it('склоняет «символ» по числу', () => {
    const issue = (type: string, ctx: Record<string, number>) => [{ type, loc: ['body', 'name'], ctx }]
    expect(getValidationMessages(issue('string_too_long', { max_length: 21 }))).toEqual([
      'Название: не длиннее 21 символа',
    ])
    expect(getValidationMessages(issue('string_too_long', { max_length: 11 }))).toEqual([
      'Название: не длиннее 11 символов',
    ])
    expect(getValidationMessages(issue('string_too_short', { min_length: 2 }))).toEqual([
      'Название: не короче 2 символов',
    ])
  })

  it('пустое и пропущенное поле — «поле не заполнено»', () => {
    expect(
      getValidationMessages([
        { type: 'string_too_short', loc: ['body', 'login'], ctx: { min_length: 1 } },
        { type: 'missing', loc: ['body', 'password'], msg: 'Field required' },
      ]),
    ).toEqual(['Логин: поле не заполнено', 'Пароль: поле не заполнено'])
  })

  it('собственные проверки сервера показывает его же русским текстом', () => {
    expect(
      getValidationMessages([
        {
          type: 'value_error',
          loc: ['body', 'name'],
          msg: 'Value error, Имя не должно содержать HTML-теги',
          ctx: { error: {} },
        },
      ]),
    ).toEqual(['Имя не должно содержать HTML-теги'])
  })

  it('числовые границы и незнакомые поля', () => {
    expect(
      getValidationMessages([
        { type: 'greater_than_equal', loc: ['body', 'max_votes'], ctx: { ge: 1 } },
        { type: 'less_than_equal', loc: ['body', 'score'], ctx: { le: 5 } },
        { type: 'int_parsing', loc: ['query', 'limit'], msg: 'Input should be a valid integer' },
      ]),
    ).toEqual([
      'Поле «max_votes»: не меньше 1',
      'Поле «score»: не больше 5',
      'Поле «limit»: недопустимое значение',
    ])
  })

  it('вложенное поле называет по последнему имени, одинаковые сообщения не повторяет', () => {
    const issue = {
      type: 'string_too_long',
      loc: ['body', 'custom_columns', 0, 'title'],
      ctx: { max_length: 80 },
    }
    expect(getValidationMessages([issue, { ...issue, loc: ['body', 'custom_columns', 1, 'title'] }])).toEqual([
      'Заголовок: не длиннее 80 символов',
    ])
  })

  it('не список или мусор внутри — пустой результат', () => {
    expect(getValidationMessages('Ошибка')).toEqual([])
    expect(getValidationMessages(undefined)).toEqual([])
    expect(getValidationMessages([null, 'строка', { loc: ['body', 'name'] }])).toEqual([])
  })
})

describe('getApiErrorMessage', () => {
  it('422 превращает в сообщение по полям вместо безликого запасного текста', () => {
    const error = apiError(422, TEAM_CREATE_ISSUES)

    expect(getApiErrorMessage(error, 'Не удалось создать команду', TEAM_LABELS)).toBe(
      'Код команды: только строчные латинские буквы, цифры и дефис. ' +
        'Название команды: не длиннее 120 символов. ' +
        'Ключ доступа: не короче 4 символов',
    )
    expect(isApiErrorReported(error)).toBe(true)
  })

  it('показывает не больше трёх сообщений о проверке за раз', () => {
    const issues = ['a', 'b', 'c', 'd'].map((field) => ({ type: 'missing', loc: ['body', field] }))

    expect(getApiErrorMessage(apiError(422, issues), 'Ошибка')).toBe(
      'Поле «a»: поле не заполнено. Поле «b»: поле не заполнено. Поле «c»: поле не заполнено',
    )
  })

  it('422 с нераспознанным телом — запасной текст', () => {
    expect(getApiErrorMessage(apiError(422, [{ foo: 'bar' }]), 'Не удалось создать команду')).toBe(
      'Не удалось создать команду',
    )
  })

  it('строковый detail (409, 404) показывает как есть', () => {
    expect(getApiErrorMessage(apiError(409, 'Команда с таким кодом уже существует'), 'Ошибка')).toBe(
      'Команда с таким кодом уже существует',
    )
  })

  it('401 и 429 заменяет своими текстами, без ответа сервера — запасной текст', () => {
    expect(getApiErrorMessage(apiError(401, 'Not authenticated'), 'Ошибка')).toBe(SESSION_EXPIRED_MESSAGE)
    expect(getApiErrorMessage(apiError(429, 'Too Many Requests'), 'Ошибка')).toBe(RATE_LIMIT_MESSAGE)
    expect(getApiErrorMessage(new Error('Network Error'), 'Нет связи')).toBe('Нет связи')
  })
})
