import { describe, it, expect } from 'vitest'
import {
  avatarSeed,
  canDeleteCard,
  canEditCardText,
  canModerateBoard,
  countMyVotes,
  countMyVotesOnBoard,
  formatVoters,
  formatVotesCount,
  isOwnCard,
  summarizeVoters,
  withMyVote,
} from '../../lib/participants'

const ME = 'p-me'

describe('своя карточка и свои голоса — по идентификатору участника', () => {
  it('isOwnCard сравнивает author_id, имя не участвует', () => {
    expect(isOwnCard({ author_id: ME }, ME)).toBe(true)
    expect(isOwnCard({ author_id: 'p-namesake' }, ME)).toBe(false)
    expect(isOwnCard({ author_id: null }, ME)).toBe(false)
  })

  it('без участника (сессии нет) своих карточек нет — даже у карточек без автора', () => {
    expect(isOwnCard({ author_id: null }, null)).toBe(false)
    expect(isOwnCard({ author_id: null }, '')).toBe(false)
    expect(isOwnCard({ author_id: 'p-1' }, undefined)).toBe(false)
  })

  it('countMyVotes считает только голоса с моим идентификатором', () => {
    expect(countMyVotes({ likes: [ME, 'p-2', ME, 'anon', 'Старое Имя'] }, ME)).toBe(2)
    expect(countMyVotes({ likes: ['anon', 'p-2'] }, ME)).toBe(0)
    expect(countMyVotes({ likes: [ME] }, '')).toBe(0)
  })

  it('countMyVotesOnBoard суммирует по всем колонкам', () => {
    const columns = [
      { cards: [{ likes: [ME, 'p-2'] }, { likes: [ME, ME] }] },
      { cards: [{ likes: ['anon'] }, { likes: [ME] }] },
    ]
    expect(countMyVotesOnBoard(columns as never, ME)).toBe(4)
  })

  it('withMyVote добавляет один голос или снимает один свой', () => {
    expect(withMyVote(['p-2'], ME, 'add')).toEqual(['p-2', ME])
    expect(withMyVote([ME, 'p-2', ME], ME, 'remove')).toEqual(['p-2', ME])
    expect(withMyVote(['p-2'], ME, 'remove')).toEqual(['p-2'])
  })
})

describe('модератор доски', () => {
  it('создатель доски — модератор', () => {
    expect(canModerateBoard({ created_by_id: ME }, null, ME)).toBe(true)
  })

  it('ведущий сессии — модератор', () => {
    expect(canModerateBoard({ created_by_id: 'p-creator' }, ME, ME)).toBe(true)
  })

  it('обычный участник — не модератор', () => {
    expect(canModerateBoard({ created_by_id: 'p-creator' }, 'p-fac', ME)).toBe(false)
    expect(canModerateBoard({ created_by_id: 'p-creator' }, null, ME)).toBe(false)
  })

  it('доской без создателя (до появления участников) управляет любой', () => {
    expect(canModerateBoard({ created_by_id: null }, null, ME)).toBe(true)
    expect(canModerateBoard({}, null, ME)).toBe(true)
  })

  it('без участника модератором не считаемся', () => {
    expect(canModerateBoard({ created_by_id: 'p-creator' }, null, '')).toBe(false)
    // Пустой идентификатор не должен «совпасть» с отсутствующим ведущим
    expect(canModerateBoard({ created_by_id: 'p-creator' }, '', '')).toBe(false)
  })
})

describe('права на карточку', () => {
  const own = { author_id: ME, masked: false }
  const foreign = { author_id: 'p-other', masked: false }
  const legacy = { author_id: null, masked: false }
  const masked = { author_id: null, masked: true }

  it('текст правит только автор', () => {
    expect(canEditCardText(own, ME)).toBe(true)
    expect(canEditCardText(foreign, ME)).toBe(false)
  })

  it('модератор текст чужой карточки не правит, но удалить её может', () => {
    expect(canEditCardText(foreign, ME)).toBe(false)
    expect(canDeleteCard(foreign, ME, { moderator: true })).toBe(true)
    expect(canDeleteCard(foreign, ME, { moderator: false })).toBe(false)
  })

  it('свою карточку автор удаляет сам', () => {
    expect(canDeleteCard(own, ME)).toBe(true)
  })

  it('карточку без автора вне анонимного режима правит и удаляет любой', () => {
    expect(canEditCardText(legacy, ME)).toBe(true)
    expect(canDeleteCard(legacy, ME)).toBe(true)
  })

  it('в анонимном режиме карточка без автора — чужая', () => {
    expect(canEditCardText(legacy, ME, { anonymous: true })).toBe(false)
    expect(canDeleteCard(legacy, ME, { anonymous: true })).toBe(false)
    expect(canDeleteCard(legacy, ME, { anonymous: true, moderator: true })).toBe(true)
    // Своя карточка и в анонимном режиме остаётся своей
    expect(canEditCardText(own, ME, { anonymous: true })).toBe(true)
  })

  it('скрытую до раскрытия карточку нельзя ни править, ни удалить (кроме модератора)', () => {
    expect(canEditCardText(masked, ME)).toBe(false)
    expect(canDeleteCard(masked, ME)).toBe(false)
    expect(canDeleteCard(masked, ME, { moderator: true })).toBe(true)
  })
})

describe('подпись голосовавших', () => {
  const names = { 'p-2': 'Борис', 'p-3': 'Вика' }
  const unknownId = '0f8fad5b-d9cb-469f-a165-70867728950e'

  it('свой голос — «Вы», известные участники — по именам', () => {
    expect(summarizeVoters([ME, 'p-2', 'p-3'], names, ME)).toEqual({
      labels: ['Вы', 'Борис', 'Вика'],
      others: 0,
    })
  })

  it('несколько голосов одного участника сворачиваются', () => {
    expect(summarizeVoters([ME, ME, 'p-2', 'p-2', 'p-2'], names, ME).labels).toEqual([
      'Вы ×2',
      'Борис ×3',
    ])
  })

  it('анонимные и неизвестные участники считаются числом', () => {
    expect(summarizeVoters(['anon', 'anon', unknownId, 'p-2'], names, ME)).toEqual({
      labels: ['Борис'],
      others: 3,
    })
  })

  it('имена из старых карточек показываются как есть и не считаются моим голосом', () => {
    const summary = summarizeVoters(['Старое Имя', 'TestUser'], names, ME)
    expect(summary).toEqual({ labels: ['Старое Имя', 'TestUser'], others: 0 })
  })

  it('formatVoters склеивает имена и остаток', () => {
    expect(formatVoters({ labels: ['Вы', 'Борис'], others: 0 })).toBe('Вы, Борис')
    expect(formatVoters({ labels: ['Вы'], others: 2 })).toBe('Вы и ещё 2')
    expect(formatVoters({ labels: [], others: 3 })).toBe('3 голоса')
    expect(formatVoters({ labels: [], others: 0 })).toBe('')
  })

  it('formatVotesCount склоняет слово «голос»', () => {
    expect(formatVotesCount(1)).toBe('1 голос')
    expect(formatVotesCount(2)).toBe('2 голоса')
    expect(formatVotesCount(5)).toBe('5 голосов')
    expect(formatVotesCount(11)).toBe('11 голосов')
    expect(formatVotesCount(21)).toBe('21 голос')
    expect(formatVotesCount(112)).toBe('112 голосов')
  })
})

describe('avatarSeed', () => {
  it('цвет считается от идентификатора: у тёзок он разный, смена имени его не меняет', () => {
    expect(avatarSeed('p-1', 'Анна')).not.toBe(avatarSeed('p-2', 'Анна'))
    expect(avatarSeed('p-1', 'Анна')).toBe(avatarSeed('p-1', 'Анна Петрова'))
  })

  it('без участника (анонимный режим, старые данные) берётся имя', () => {
    expect(avatarSeed(null, 'Анна')).toBe('Анна')
    expect(avatarSeed(undefined, 'Анна')).toBe('Анна')
  })
})
