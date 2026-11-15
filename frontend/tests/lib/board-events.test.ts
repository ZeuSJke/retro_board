import { describe, it, expect } from 'vitest'
import {
  applyActionItemDeleted,
  applyActionItemChanged,
  applyActionItemSaved,
  applyBoardChange,
  applyCardCreated,
  applyCardDeleted,
  applyCardMoved,
  applyCardPatched,
  applyCardRelocated,
  applyCardUpdated,
  applyColumnCreated,
  applyColumnDeleted,
  applyColumnRestored,
  applyColumnUpdated,
  applyColumnsArranged,
  applyGroupCreated,
  applyGroupDeleted,
  applyGroupMoved,
  applyGroupRelocated,
  applyGroupRestored,
  applyGroupUpdated,
  applyMoodUpdated,
  applyParticipantRenamed,
  applyParticipantRenamedToMoods,
  applyVotesReset,
  countMaskedCards,
  describeBoardChange,
  hasBoardEntity,
  type BoardChange,
} from '../../lib/board-events'
import type { ActionItem, BoardMood, Card, CardGroup, Column } from '../../types'

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

  it('без списков порядка (ответ REST, оптимистичный перенос) ставит карточку на её позицию, как сервер', () => {
    // Сервер вынимает карточку, вставляет на позицию и перенумеровывает колонку
    const columns = [column('col-1', [card('A', 0), card('B', 1), card('C', 2)])]

    const next = applyCardMoved(columns, { card: card('C', 0), old_column_id: 'col-1' })

    expect(ids(next[0])).toEqual(['C', 'A', 'B'])
    expect(positions(next[0])).toEqual([0, 1, 2])
  })

  it('без списков порядка перенос в другую колонку перенумеровывает обе', () => {
    const columns = [
      column('col-1', [card('A', 0), card('B', 1), card('C', 2)]),
      column('col-2', [card('X', 0, { column_id: 'col-2' }), card('Y', 1, { column_id: 'col-2' })]),
    ]

    // Колонка, откуда ушла карточка, не названа: она находится сама
    const next = applyCardMoved(columns, { card: card('A', 1, { column_id: 'col-2' }) })

    expect(ids(next[0])).toEqual(['B', 'C'])
    expect(positions(next[0])).toEqual([0, 1])
    expect(ids(next[1])).toEqual(['X', 'A', 'Y'])
    expect(positions(next[1])).toEqual([0, 1, 2])
  })

  it('оптимистичный перенос и событие сервера дают один и тот же порядок', () => {
    const columns = [column('col-1', [card('A', 0), card('B', 1), card('C', 2), card('D', 3)])]
    const moved = card('D', 1)

    const optimistic = applyCardMoved(columns, { card: moved })
    const fromServer = applyCardMoved(optimistic, {
      card: moved,
      old_column_id: 'col-1',
      column_card_ids: ['A', 'D', 'B', 'C'],
      old_column_card_ids: ['A', 'D', 'B', 'C'],
    })

    expect(ids(optimistic[0])).toEqual(['A', 'D', 'B', 'C'])
    expect(ids(fromServer[0])).toEqual(ids(optimistic[0]))
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
      position: 0,
    })

    expect(next[0]).toMatchObject({ title: 'Новое название', color: '#BA1A1A', position: 0 })
    expect(next[0].cards).toBe(cards)
    expect(next[0].groups).toBe(groups)
  })

  it('column_updated с новой позицией переставляет колонку и перенумеровывает остальные', () => {
    // Сервер вынимает колонку, вставляет на новое место и нумерует ряд заново,
    // а событие присылает только о ней
    const columns = [
      column('A', [], { position: 0 }),
      column('B', [], { position: 1 }),
      column('C', [], { position: 2 }),
    ]

    const right = applyColumnUpdated(columns, { id: 'A', position: 2 })
    expect(right.map((c) => c.id)).toEqual(['B', 'C', 'A'])
    expect(right.map((c) => c.position)).toEqual([0, 1, 2])

    const left = applyColumnUpdated(columns, { id: 'C', position: 0 })
    expect(left.map((c) => c.id)).toEqual(['C', 'A', 'B'])
    expect(left.map((c) => c.position)).toEqual([0, 1, 2])
  })

  it('column_updated с прежней позицией порядок не трогает — даже если позиции идут с пропусками', () => {
    // После удаления колонки сервер не перенумеровывает оставшиеся: позиции 0, 2, 3
    const columns = [
      column('A', [], { position: 0 }),
      column('C', [], { position: 2 }),
      column('D', [], { position: 3 }),
    ]

    const next = applyColumnUpdated(columns, { id: 'C', title: 'Переименована', position: 2 })

    expect(next.map((c) => c.id)).toEqual(['A', 'C', 'D'])
    expect(next.map((c) => c.position)).toEqual([0, 2, 3])
    expect(next[1].title).toBe('Переименована')
    // Остальные колонки — те же объекты: мемоизированные колонки не перерисуются
    expect(next[0]).toBe(columns[0])
    expect(next[2]).toBe(columns[2])
  })

  it('column_updated без изменений возвращает то же состояние', () => {
    const columns = [column('col-1', [], { title: 'Т', color: '#111111' })]
    expect(applyColumnUpdated(columns, { id: 'col-1', title: 'Т', color: '#111111', position: 0 })).toBe(
      columns,
    )
    expect(applyColumnUpdated(columns, { id: 'нет такой', title: 'Х' })).toBe(columns)
  })

  it('повтор события о перестановке ничего не меняет', () => {
    const columns = [column('A', [], { position: 0 }), column('B', [], { position: 1 })]
    const once = applyColumnUpdated(columns, { id: 'B', position: 0 })
    const twice = applyColumnUpdated(once, { id: 'B', position: 0 })
    expect(twice.map((c) => c.id)).toEqual(['B', 'A'])
    expect(twice).toBe(once)
  })

  it('новая колонка встаёт по позиции, а не в конец', () => {
    const columns = [column('A', [], { position: 0 }), column('C', [], { position: 2 })]
    const next = applyColumnCreated(columns, {
      id: 'B',
      board_id: 'b-1',
      title: 'Б',
      color: '#111111',
      position: 1,
    })
    expect(next.map((c) => c.id)).toEqual(['A', 'B', 'C'])
  })

  it('удалённая колонка возвращается на прежнее место вместе с карточками', () => {
    const removed = column('B', [card('X', 0, { column_id: 'B' })], { position: 1 })
    const columns = [column('A', [], { position: 0 }), column('C', [], { position: 2 })]

    const next = applyColumnRestored(columns, removed)

    expect(next.map((c) => c.id)).toEqual(['A', 'B', 'C'])
    expect(ids(next[1])).toEqual(['X'])
    // Колонка уже на месте (сервер прислал её заново) — второй раз не добавляется
    expect(applyColumnRestored(next, removed)).toBe(next)
  })

  it('откат перестановки возвращает колонкам точные прежние позиции', () => {
    const before = [
      column('A', [], { position: 0 }),
      column('C', [], { position: 2 }),
      column('D', [], { position: 3 }),
    ]
    const moved = applyColumnUpdated(before, { id: 'D', position: 1 })
    expect(moved.map((c) => c.id)).toEqual(['A', 'D', 'C'])

    const restored = applyColumnsArranged(moved, { A: 0, C: 2, D: 3 })

    expect(restored.map((c) => c.id)).toEqual(['A', 'C', 'D'])
    expect(restored.map((c) => c.position)).toEqual([0, 2, 3])
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

  it('card_updated внутри колонки не приносит серверную позицию — порядок остаётся локальным', () => {
    // На сервере после удаления B и C позиции идут с пропусками: A=0, D=3, E=4.
    // Клиент после предпросмотра или отмены перетаскивания перенумеровал колонку подряд.
    const columns = [column('col-1', [card('A', 0), card('D', 1), card('E', 2)])]
    // Коллега лайкнул D — событие несёт серверную позицию 3
    const next = applyCardUpdated(columns, card('D', 3, { likes: ['p-bob'] }))
    expect(next[0].cards.map((c) => [c.id, c.position])).toEqual([
      ['A', 0],
      ['D', 1],
      ['E', 2],
    ])
    expect(next[0].cards[1].likes).toEqual(['p-bob'])
    // Любая последующая сортировка по позиции даёт тот же порядок, что у остальных
    const sorted = [...next[0].cards].sort((a, b) => a.position - b.position)
    expect(sorted.map((c) => c.id)).toEqual(['A', 'D', 'E'])
  })

  it('card_updated с той же позицией отдаёт карточку как есть, без копии', () => {
    const columns = [column('col-1', [card('A', 0), card('D', 1)])]
    const updated = card('D', 1, { text: 'Новый текст' })
    expect(applyCardUpdated(columns, updated)[0].cards[1]).toBe(updated)
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

// ── Единая точка применения: оптимистичная правка, ответ REST и событие сокета ──

describe('карточки: создание, правка, откат', () => {
  it('card_created ставит карточку по позиции, времени создания и id — как сервер', () => {
    const columns = [
      column('col-1', [
        card('B', 1, { created_at: '2026-01-01T00:00:02Z' }),
        card('D', 2, { created_at: '2026-01-01T00:00:04Z' }),
      ]),
    ]
    // Та же позиция, что у B: порядок решает время создания
    const next = applyCardCreated(columns, card('A', 1, { created_at: '2026-01-01T00:00:01Z' }))
    expect(ids(next[0])).toEqual(['A', 'B', 'D'])
  })

  it('удалённая карточка возвращается на прежнее место (откат удаления)', () => {
    const removed = card('B', 1)
    const columns = [column('col-1', [card('A', 0), card('C', 2)])]

    const next = applyCardCreated(columns, removed)

    expect(ids(next[0])).toEqual(['A', 'B', 'C'])
  })

  it('card_patched меняет одно поле текущей карточки и не трогает остальное', () => {
    const columns = [
      column('col-1', [card('A', 0, { likes: ['p-bob'], text: 'Новый текст' }), card('B', 1)]),
      column('col-2'),
    ]

    const next = applyCardPatched(columns, 'A', (c) => ({ ...c, likes: [...c.likes, 'p-me'] }))

    expect(next[0].cards[0]).toMatchObject({ likes: ['p-bob', 'p-me'], text: 'Новый текст' })
    expect(next[0].cards[1]).toBe(columns[0].cards[1])
    expect(next[1]).toBe(columns[1])
  })

  it('card_patched без изменений и для неизвестной карточки возвращает то же состояние', () => {
    const columns = [column('col-1', [card('A', 0)])]
    expect(applyCardPatched(columns, 'A', (c) => c)).toBe(columns)
    expect(applyCardPatched(columns, 'нет', (c) => ({ ...c, text: 'x' }))).toBe(columns)
  })

  it('откат голоса не затирает голос, пришедший за время запроса', () => {
    // Оптимистично: мой голос. Пока шёл запрос, проголосовал Боб. Сервер мне отказал.
    let columns = [column('col-1', [card('A', 0, { likes: [] })])]
    columns = applyCardPatched(columns, 'A', (c) => ({ ...c, likes: [...c.likes, 'p-me'] }))
    columns = applyCardUpdated(columns, card('A', 0, { likes: ['p-me', 'p-bob'] }))
    columns = applyCardPatched(columns, 'A', (c) => ({
      ...c,
      likes: c.likes.filter((voter) => voter !== 'p-me'),
    }))

    expect(columns[0].cards[0].likes).toEqual(['p-bob'])
  })

  it('card_relocated переставляет карточку в её текущем состоянии', () => {
    const columns = [
      column('col-1', [card('A', 0), card('B', 1, { likes: ['p-bob'], group_id: 'g-1' })]),
      column('col-2', [card('X', 0, { column_id: 'col-2' })]),
    ]

    const next = applyCardRelocated(columns, {
      id: 'B',
      column_id: 'col-2',
      position: 0,
      group_id: null,
    })

    expect(ids(next[0])).toEqual(['A'])
    expect(ids(next[1])).toEqual(['B', 'X'])
    expect(next[1].cards[0]).toMatchObject({ column_id: 'col-2', group_id: null, likes: ['p-bob'] })
  })

  it('отмена перетаскивания возвращает карточку на место, сохраняя пришедшие изменения', () => {
    const start = [
      column('col-1', [card('A', 0), card('B', 1), card('C', 2)]),
      column('col-2', [card('X', 0, { column_id: 'col-2' })]),
    ]
    // Предпросмотр: B уехала во вторую колонку
    let columns = applyCardRelocated(start, { id: 'B', column_id: 'col-2', position: 1, group_id: null })
    expect(ids(columns[1])).toEqual(['X', 'B'])
    // Отмена: B возвращается на второе место первой колонки
    columns = applyCardRelocated(columns, { id: 'B', column_id: 'col-1', position: 1, group_id: null })

    expect(ids(columns[0])).toEqual(['A', 'B', 'C'])
    expect(ids(columns[1])).toEqual(['X'])
  })

  it('card_relocated без group_id оставляет группу карточки прежней', () => {
    const columns = [column('col-1', [card('A', 0, { group_id: 'g-1' }), card('B', 1)])]
    const next = applyCardRelocated(columns, { id: 'A', column_id: 'col-1', position: 1 })
    expect(ids(next[0])).toEqual(['B', 'A'])
    expect(next[0].cards[1].group_id).toBe('g-1')
  })

  it('card_relocated для неизвестной карточки или колонки ничего не меняет', () => {
    const columns = [column('col-1', [card('A', 0)])]
    expect(applyCardRelocated(columns, { id: 'нет', column_id: 'col-1', position: 0 })).toBe(columns)
    expect(applyCardRelocated(columns, { id: 'A', column_id: 'нет', position: 0 })).toBe(columns)
  })

  it('votes_reset снимает все голоса участника и не трогает чужие', () => {
    const columns = [
      column('col-1', [card('A', 0, { likes: ['p-me', 'p-bob', 'p-me'] }), card('B', 1, { likes: ['p-bob'] })]),
    ]
    const next = applyVotesReset(columns, 'p-me')
    expect(next[0].cards[0].likes).toEqual(['p-bob'])
    expect(next[0].cards[1]).toBe(columns[0].cards[1])
    expect(applyVotesReset(next, 'p-me')).toBe(next)
  })
})

describe('группы: создание, откат, перенос', () => {
  const group: CardGroup = { id: 'g-1', column_id: 'col-1', title: 'Группа', position: 0 }

  it('group_created с перечнем карточек кладёт их в группу', () => {
    const columns = [column('col-1', [card('A', 0), card('B', 1), card('C', 2)])]
    const next = applyGroupCreated(columns, group, ['A', 'C'])
    expect(next[0].groups).toEqual([group])
    expect(next[0].cards.map((c) => c.group_id)).toEqual(['g-1', null, 'g-1'])
  })

  it('группы стоят по позиции, как у сервера', () => {
    const columns = [
      column('col-1', [], { groups: [{ ...group, id: 'g-2', position: 2 }] }),
    ]
    const next = applyGroupCreated(columns, { ...group, id: 'g-1', position: 1 })
    expect(next[0].groups.map((g) => g.id)).toEqual(['g-1', 'g-2'])
  })

  it('group_updated не пересоздаёт колонки без этой группы', () => {
    const columns = [column('col-1', [], { groups: [group] }), column('col-2')]
    const next = applyGroupUpdated(columns, { ...group, title: 'Новое имя' })
    expect(next[0].groups[0].title).toBe('Новое имя')
    expect(next[1]).toBe(columns[1])
  })

  it('group_deleted не трогает карточку, которую уже положили в другую группу', () => {
    const columns = [
      column('col-1', [card('A', 0, { group_id: 'g-1' }), card('B', 1, { group_id: 'g-2' })], {
        groups: [group, { ...group, id: 'g-2' }],
      }),
    ]
    const next = applyGroupDeleted(columns, { id: 'g-1', column_id: 'col-1', card_ids: ['A', 'B'] })
    expect(next[0].cards.map((c) => c.group_id)).toEqual([null, 'g-2'])
    expect(next[0].groups.map((g) => g.id)).toEqual(['g-2'])
  })

  it('расформированная группа возвращается вместе с карточками (откат)', () => {
    const start = [column('col-1', [card('A', 0, { group_id: 'g-1' }), card('B', 1, { group_id: 'g-1' })], { groups: [group] })]
    // Оптимистично расформировали
    let columns = applyGroupDeleted(start, { id: 'g-1' })
    expect(columns[0].groups).toEqual([])
    // Пока шёл запрос, карточку B положили в другую группу
    columns = applyCardUpdated(columns, card('B', 1, { group_id: 'g-2' }))
    // Сервер отказал: группа возвращается, но чужую правку не затирает
    columns = applyGroupRestored(columns, group, ['A', 'B'])

    expect(columns[0].groups).toEqual([group])
    expect(columns[0].cards.map((c) => c.group_id)).toEqual(['g-1', 'g-2'])
  })

  it('group_relocated переносит группу с её текущими карточками и обратно', () => {
    const start = [
      column('col-1', [card('A', 0, { group_id: 'g-1' }), card('B', 1)], { groups: [group] }),
      column('col-2', [card('X', 0, { column_id: 'col-2' })]),
    ]

    const moved = applyGroupRelocated(start, { id: 'g-1', column_id: 'col-2' })
    expect(ids(moved[0])).toEqual(['B'])
    expect(moved[1].groups.map((g) => g.id)).toEqual(['g-1'])
    expect(moved[1].cards.find((c) => c.id === 'A')).toMatchObject({ column_id: 'col-2', group_id: 'g-1' })

    const back = applyGroupRelocated(moved, { id: 'g-1', column_id: 'col-1' })
    expect(back[0].groups.map((g) => g.id)).toEqual(['g-1'])
    expect(ids(back[0]).sort()).toEqual(['A', 'B'])
    expect(ids(back[1])).toEqual(['X'])
  })

  it('group_relocated в ту же или неизвестную колонку ничего не меняет', () => {
    const columns = [column('col-1', [], { groups: [group] })]
    expect(applyGroupRelocated(columns, { id: 'g-1', column_id: 'col-1' })).toBe(columns)
    expect(applyGroupRelocated(columns, { id: 'g-1', column_id: 'нет' })).toBe(columns)
  })
})

describe('applyBoardChange — одна функция для всех источников', () => {
  it('каждому типу изменения соответствует свой редьюсер', () => {
    const base = [column('col-1', [card('A', 0)])]
    const apply = (change: BoardChange) => applyBoardChange(base, change)

    expect(ids(apply({ type: 'card_created', card: card('B', 1) })[0])).toEqual(['A', 'B'])
    expect(apply({ type: 'card_updated', card: card('A', 0, { text: 'Т' }) })[0].cards[0].text).toBe('Т')
    expect(ids(apply({ type: 'card_deleted', id: 'A' })[0])).toEqual([])
    expect(ids(apply({ type: 'cards_deleted', ids: ['A'] })[0])).toEqual([])
    expect(apply({ type: 'column_deleted', id: 'col-1' })).toEqual([])
    expect(apply({ type: 'column_updated', column: { id: 'col-1', title: 'Н' } })[0].title).toBe('Н')
    expect(
      apply({ type: 'participant_renamed', participant_id: 'p-anna', name: 'Анна П.' })[0].cards[0].author,
    ).toBe('Анна П.')
  })

  it('событие сокета поверх оптимистичной правки и ответа REST даёт то же, что само по себе', () => {
    const base = [column('col-1', [card('A', 0), card('B', 1)])]
    const created = card('C', 2)
    const event: BoardChange = { type: 'card_created', card: created }

    const wsOnly = applyBoardChange(base, event)
    const restThenWs = applyBoardChange(applyBoardChange(base, event), event)

    expect(restThenWs).toEqual(wsOnly)
    expect(ids(restThenWs[0])).toEqual(['A', 'B', 'C'])
  })

  it('describeBoardChange называет сущность и отличает создание', () => {
    expect(describeBoardChange({ type: 'card_created', card: card('A', 0) })).toEqual({
      key: 'card:A',
      creates: true,
    })
    expect(describeBoardChange({ type: 'card_moved', card: card('A', 0) })).toEqual({
      key: 'card:A',
      creates: false,
    })
    expect(describeBoardChange({ type: 'group_deleted', id: 'g-1' }).key).toBe('group:g-1')
    expect(describeBoardChange({ type: 'column_updated', column: { id: 'c' } }).key).toBe('column:c')
    // Точечные правки и откаты к сущности не привязаны: они применяются всегда
    expect(describeBoardChange({ type: 'card_patched', id: 'A', patch: (c) => c }).key).toBeNull()
  })

  it('hasBoardEntity находит колонку, карточку и группу', () => {
    const columns = [
      column('col-1', [card('A', 0)], {
        groups: [{ id: 'g-1', column_id: 'col-1', title: 'Г', position: 0 }],
      }),
    ]
    expect(hasBoardEntity(columns, 'column:col-1')).toBe(true)
    expect(hasBoardEntity(columns, 'card:A')).toBe(true)
    expect(hasBoardEntity(columns, 'group:g-1')).toBe(true)
    expect(hasBoardEntity(columns, 'card:нет')).toBe(false)
  })
})

describe('задачи', () => {
  const item = (id: string, createdAt: string, extra: Partial<ActionItem> = {}): ActionItem => ({
    id,
    board_id: 'b-1',
    title: `Задача ${id}`,
    text: '',
    assignee: null,
    source_card_ids: [],
    status: 'open',
    completed_at: null,
    created_at: createdAt,
    ...extra,
  })

  it('новая задача добавляется, известная заменяется', () => {
    const list = [item('1', '2026-01-01T00:00:01Z')]
    const added = applyActionItemSaved(list, item('2', '2026-01-01T00:00:02Z'))
    expect(added.map((i) => i.id)).toEqual(['1', '2'])
    const updated = applyActionItemSaved(added, item('1', '2026-01-01T00:00:01Z', { status: 'done' }))
    expect(updated.map((i) => i.status)).toEqual(['done', 'open'])
  })

  it('задача, которую сервер не удалил, возвращается на своё место по времени создания', () => {
    const first = item('1', '2026-01-01T00:00:01Z')
    const list = [item('2', '2026-01-01T00:00:02Z'), item('3', '2026-01-01T00:00:03Z')]

    const restored = applyActionItemSaved(list, first)

    expect(restored.map((i) => i.id)).toEqual(['1', '2', '3'])
  })

  it('правка и её откат не возвращают задачу, которую коллега успел удалить', () => {
    const original = item('1', '2026-01-01T00:00:01Z')
    let list = [original]
    // Оптимистичная смена статуса
    list = applyActionItemChanged(list, { ...original, status: 'in_progress' })
    expect(list[0].status).toBe('in_progress')
    // Событие сокета: коллега удалил задачу
    list = applyActionItemDeleted(list, original.id)
    // Сервер ответил 404 — откат к прежнему состоянию
    const rolledBack = applyActionItemChanged(list, original)
    expect(rolledBack).toEqual([])
    expect(rolledBack).toBe(list)
  })

  it('удаление неизвестной задачи возвращает тот же список', () => {
    const list = [item('1', '2026-01-01T00:00:01Z')]
    expect(applyActionItemDeleted(list, 'нет')).toBe(list)
    expect(applyActionItemDeleted(list, '1')).toEqual([])
  })
})
