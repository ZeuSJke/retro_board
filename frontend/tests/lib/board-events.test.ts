import { describe, it, expect } from 'vitest'
import {
  applyCardCreated,
  applyCardDeleted,
  applyCardMoved,
  applyCardUpdated,
  applyColumnCreated,
  applyColumnDeleted,
  applyColumnUpdated,
  applyGroupDeleted,
  applyGroupMoved,
  applyMoodUpdated,
  applyParticipantRenamed,
  applyParticipantRenamedToMoods,
  countMaskedCards,
} from '../../lib/board-events'
import type { BoardMood, Card, Column } from '../../types'

function card(id: string, position: number, extra: Partial<Card> = {}): Card {
  return {
    id,
    column_id: 'col-1',
    group_id: null,
    text: `Карточка ${id}`,
    author: 'Анна',
    author_id: 'p-anna',
    color: '#FFFFFF',
    position,
    likes: [],
    masked: false,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

function column(id: string, cards: Card[] = [], extra: Partial<Column> = {}): Column {
  return {
    id,
    board_id: 'b-1',
    title: `Колонка ${id}`,
    color: '#6750A4',
    position: 0,
    cards,
    groups: [],
    ...extra,
  }
}

const ids = (col: Column) => col.cards.map((c) => c.id)
const positions = (col: Column) => col.cards.map((c) => c.position)

describe('card_moved', () => {
  it('ставит карточки в порядке из column_card_ids, а не по локальным позициям', () => {
    // Сервер: A, D, B, C. Локально B и C ещё на позициях 1 и 2 — как у D
    const columns = [column('col-1', [card('A', 0), card('B', 1), card('C', 2), card('D', 3)])]

    const next = applyCardMoved(columns, {
      card: card('D', 1),
      old_column_id: 'col-1',
      column_card_ids: ['A', 'D', 'B', 'C'],
      old_column_card_ids: ['A', 'D', 'B', 'C'],
    })

    expect(ids(next[0])).toEqual(['A', 'D', 'B', 'C'])
    expect(positions(next[0])).toEqual([0, 1, 2, 3])
  })

  it('перенос в другую колонку упорядочивает обе колонки', () => {
    const columns = [
      column('col-1', [card('A', 0), card('B', 1), card('C', 2)]),
      column('col-2', [card('X', 0, { column_id: 'col-2' }), card('Y', 1, { column_id: 'col-2' })]),
    ]

    const next = applyCardMoved(columns, {
      card: card('B', 0, { column_id: 'col-2' }),
      old_column_id: 'col-1',
      column_card_ids: ['B', 'X', 'Y'],
      old_column_card_ids: ['A', 'C'],
    })

    expect(ids(next[0])).toEqual(['A', 'C'])
    expect(positions(next[0])).toEqual([0, 1])
    expect(ids(next[1])).toEqual(['B', 'X', 'Y'])
    expect(positions(next[1])).toEqual([0, 1, 2])
    expect(next[1].cards[0].column_id).toBe('col-2')
  })

  it('карточка, о которой клиент ещё не знает, пропускается; незнакомая серверу остаётся в конце', () => {
    // «Z» есть в порядке сервера, но событие о её создании ещё не пришло;
    // «N» создана локально, сервер о ней в этом событии не сообщил
    const columns = [column('col-1', [card('A', 0), card('B', 1), card('N', 2)])]

    const next = applyCardMoved(columns, {
      card: card('B', 0),
      old_column_id: 'col-1',
      column_card_ids: ['B', 'Z', 'A'],
      old_column_card_ids: ['B', 'Z', 'A'],
    })

    expect(ids(next[0])).toEqual(['B', 'A', 'N'])
    expect(positions(next[0])).toEqual([0, 1, 2])
  })

  it('без списков порядка (старый сервер) сортирует по позициям', () => {
    const columns = [column('col-1', [card('A', 0), card('B', 1), card('C', 2)])]

    const next = applyCardMoved(columns, {
      card: card('C', 0),
      old_column_id: 'col-1',
    } as never)

    expect(ids(next[0])[0]).toBe('A')
    expect(ids(next[0])).toContain('C')
  })

  it('не оставляет дубль, если карточка числилась в третьей колонке', () => {
    const columns = [
      column('col-1', []),
      column('col-2', []),
      column('col-3', [card('A', 0, { column_id: 'col-3' })]),
    ]

    const next = applyCardMoved(columns, {
      card: card('A', 0, { column_id: 'col-2' }),
      old_column_id: 'col-1',
      column_card_ids: ['A'],
      old_column_card_ids: [],
    })

    expect(ids(next[1])).toEqual(['A'])
    expect(ids(next[2])).toEqual([])
  })

  it('не мутирует исходное состояние', () => {
    const original = [column('col-1', [card('A', 0), card('B', 1)])]
    const snapshot = JSON.stringify(original)

    applyCardMoved(original, {
      card: card('B', 0),
      old_column_id: 'col-1',
      column_card_ids: ['B', 'A'],
      old_column_card_ids: ['B', 'A'],
    })

    expect(JSON.stringify(original)).toBe(snapshot)
  })
})

describe('column_created / column_updated / column_deleted', () => {
  it('новая колонка добавляется пустой и не дублируется', () => {
    const info = { id: 'col-2', board_id: 'b-1', title: 'Идеи', color: '#E8760A', position: 1 }
    const once = applyColumnCreated([column('col-1')], info)
    expect(once).toHaveLength(2)
    expect(once[1]).toMatchObject({ id: 'col-2', cards: [], groups: [] })
    expect(applyColumnCreated(once, info)).toBe(once)
  })

  it('column_updated меняет только свойства колонки и сохраняет карточки и группы', () => {
    const cards = [card('A', 0), card('B', 1)]
    const groups = [{ id: 'g-1', column_id: 'col-1', title: 'Группа', position: 0 }]
    const columns = [column('col-1', cards, { groups })]

    const next = applyColumnUpdated(columns, {
      id: 'col-1',
      board_id: 'b-1',
      title: 'Новое название',
      color: '#BA1A1A',
      position: 2,
    })

    expect(next[0]).toMatchObject({ title: 'Новое название', color: '#BA1A1A', position: 2 })
    expect(next[0].cards).toBe(cards)
    expect(next[0].groups).toBe(groups)
  })

  it('column_updated игнорирует cards и groups в событии', () => {
    const columns = [column('col-1', [card('A', 0)])]
    const payload = { id: 'col-1', title: 'Т', cards: [], groups: [] } as never

    const next = applyColumnUpdated(columns, payload)

    expect(ids(next[0])).toEqual(['A'])
  })

  it('частичное событие не стирает остальные свойства', () => {
    const next = applyColumnUpdated([column('col-1', [], { color: '#006E1C' })], {
      id: 'col-1',
      title: 'Только название',
    })
    expect(next[0].color).toBe('#006E1C')
    expect(next[0].title).toBe('Только название')
  })

  it('column_deleted убирает колонку', () => {
    expect(applyColumnDeleted([column('col-1'), column('col-2')], 'col-1').map((c) => c.id)).toEqual([
      'col-2',
    ])
  })
})

describe('card_created / card_updated / card_deleted', () => {
  it('card_created вставляет по позиции и не дублирует', () => {
    const columns = [column('col-1', [card('A', 0), card('C', 2)])]
    const next = applyCardCreated(columns, card('B', 1))
    expect(ids(next[0])).toEqual(['A', 'B', 'C'])
    expect(ids(applyCardCreated(next, card('B', 1))[0])).toEqual(['A', 'B', 'C'])
  })

  it('masked-карточка хранится как пришла — без текста и автора', () => {
    const masked = card('H', 0, { text: '', author: '', author_id: null, masked: true })
    const next = applyCardCreated([column('col-1')], masked)
    expect(next[0].cards[0]).toEqual(masked)
  })

  it('card_updated заменяет карточку на месте (раскрытие: masked → текст)', () => {
    const columns = [
      column('col-1', [card('A', 0), card('H', 1, { text: '', author: '', author_id: null, masked: true })]),
    ]
    const next = applyCardUpdated(columns, card('H', 1, { text: 'Раскрыто' }))
    expect(ids(next[0])).toEqual(['A', 'H'])
    expect(next[0].cards[1]).toMatchObject({ masked: false, text: 'Раскрыто' })
  })

  it('card_updated со сменой колонки (массовый перенос) переносит карточку', () => {
    const columns = [
      column('col-1', [card('A', 0), card('B', 1)]),
      column('col-2', [card('X', 0, { column_id: 'col-2' })]),
    ]
    const next = applyCardUpdated(columns, card('B', 1, { column_id: 'col-2' }))
    expect(ids(next[0])).toEqual(['A'])
    expect(ids(next[1])).toEqual(['X', 'B'])
  })

  it('card_updated для неизвестной карточки ничего не меняет', () => {
    const columns = [column('col-1', [card('A', 0)])]
    expect(applyCardUpdated(columns, card('Z', 5))).toBe(columns)
  })

  it('card_deleted убирает карточку', () => {
    const next = applyCardDeleted([column('col-1', [card('A', 0), card('B', 1)])], 'A')
    expect(ids(next[0])).toEqual(['B'])
  })
})

describe('группы', () => {
  it('group_deleted снимает группу с её карточек', () => {
    const columns = [
      column('col-1', [card('A', 0, { group_id: 'g-1' }), card('B', 1)], {
        groups: [{ id: 'g-1', column_id: 'col-1', title: 'Группа', position: 0 }],
      }),
    ]
    const next = applyGroupDeleted(columns, { id: 'g-1', column_id: 'col-1', card_ids: ['A'] })
    expect(next[0].groups).toEqual([])
    expect(next[0].cards[0].group_id).toBeNull()
  })

  it('group_moved переносит группу вместе с карточками', () => {
    const group = { id: 'g-1', column_id: 'col-2', title: 'Группа', position: 0 }
    const columns = [
      column('col-1', [card('A', 0, { group_id: 'g-1' }), card('B', 1)], {
        groups: [{ ...group, column_id: 'col-1' }],
      }),
      column('col-2'),
    ]
    const next = applyGroupMoved(columns, {
      group,
      old_column_id: 'col-1',
      cards: [card('A', 0, { group_id: 'g-1', column_id: 'col-2' })],
    })
    expect(ids(next[0])).toEqual(['B'])
    expect(next[0].groups).toEqual([])
    expect(ids(next[1])).toEqual(['A'])
    expect(next[1].groups).toEqual([group])
  })
})

describe('participant_renamed', () => {
  it('меняет подпись только у карточек с этим author_id', () => {
    const columns = [
      column('col-1', [
        card('mine', 0, { author: 'Анна', author_id: 'p-1' }),
        card('namesake', 1, { author: 'Анна', author_id: 'p-2' }),
        card('anon', 2, { author: 'Участник', author_id: null }),
        card('legacy', 3, { author: 'Анна', author_id: null }),
      ]),
      column('col-2', [card('other', 0, { column_id: 'col-2', author: 'Анна', author_id: 'p-1' })]),
    ]

    const next = applyParticipantRenamed(columns, 'p-1', 'Анна Петрова')

    expect(next[0].cards.map((c) => c.author)).toEqual(['Анна Петрова', 'Анна', 'Участник', 'Анна'])
    expect(next[1].cards[0].author).toBe('Анна Петрова')
  })

  it('не пересоздаёт колонки, которых переименование не касается', () => {
    const untouched = column('col-2', [card('X', 0, { column_id: 'col-2', author_id: 'p-9' })])
    const columns = [column('col-1', [card('A', 0, { author_id: 'p-1' })]), untouched]

    const next = applyParticipantRenamed(columns, 'p-1', 'Новое имя')

    expect(next[1]).toBe(untouched)
  })

  it('обновляет автора оценки настроения по participant_id', () => {
    const moods: BoardMood[] = [
      { id: 'm-1', board_id: 'b-1', author: 'Анна', participant_id: 'p-1', score: 4, note: null, created_at: '' },
      { id: 'm-2', board_id: 'b-1', author: 'Анна', participant_id: 'p-2', score: 5, note: null, created_at: '' },
      { id: 'm-3', board_id: 'b-1', author: 'Участник', participant_id: null, score: 3, note: null, created_at: '' },
    ]
    const next = applyParticipantRenamedToMoods(moods, 'p-1', 'Анна Петрова')
    expect(next.map((m) => m.author)).toEqual(['Анна Петрова', 'Анна', 'Участник'])
  })
})

describe('mood_updated', () => {
  const mood = (id: string, extra: Partial<BoardMood> = {}): BoardMood => ({
    id,
    board_id: 'b-1',
    author: 'Участник',
    participant_id: null,
    score: 3,
    note: null,
    created_at: '',
    ...extra,
  })

  it('обновляет запись по id — имена в анонимном режиме одинаковые', () => {
    const moods = [mood('m-1', { score: 2 }), mood('m-2', { score: 5 })]
    const next = applyMoodUpdated(moods, mood('m-2', { score: 1 }))
    expect(next.map((m) => m.score)).toEqual([2, 1])
  })

  it('добавляет новую оценку', () => {
    const next = applyMoodUpdated([mood('m-1')], mood('m-2', { mine: true }))
    expect(next).toHaveLength(2)
    expect(next[1].mine).toBe(true)
  })
})

describe('countMaskedCards', () => {
  it('считает чужие карточки, скрытые до раскрытия', () => {
    const columns = [
      column('col-1', [card('A', 0), card('B', 1, { masked: true }), card('C', 2, { masked: true })]),
      column('col-2', [card('D', 0, { masked: true })]),
    ]
    expect(countMaskedCards(columns)).toBe(3)
    expect(countMaskedCards([column('col-1', [card('A', 0)])])).toBe(0)
  })
})
