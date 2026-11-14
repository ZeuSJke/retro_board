import { describe, it, expect } from 'vitest'
import { formatBoardMarkdown } from '../../lib/export-markdown'
import { buildBoardPDFHtml } from '../../utils/exportPDF'
import type { Board, Card, Column } from '../../types'

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    column_id: 'col-1',
    group_id: null,
    text: `Текст ${id}`,
    author: 'Анна',
    author_id: 'p-anna',
    color: '#FFFFFF',
    position: 0,
    likes: [],
    masked: false,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

/** Чужая карточка до раскрытия — такой её присылает сервер. */
const maskedCard = (id: string, extra: Partial<Card> = {}): Card =>
  card(id, { text: '', author: '', author_id: null, likes: [], masked: true, ...extra })

function board(columns: Column[], extra: Partial<Board> = {}): Board {
  return {
    id: 'b-1',
    name: 'Спринт 42',
    slug: 'sprint-42',
    max_votes: 5,
    created_at: '2026-03-01T10:00:00Z',
    cards_hidden: true,
    columns,
    ...extra,
  }
}

const hiddenColumn: Column = {
  id: 'col-1',
  board_id: 'b-1',
  title: 'Что улучшить',
  color: '#BA1A1A',
  position: 0,
  cards: [card('mine', { text: 'Моя мысль', author: 'Я', author_id: 'p-me' }), maskedCard('h1'), maskedCard('h2')],
  groups: [],
}

describe('экспорт до раскрытия карточек', () => {
  it('Markdown: своя карточка есть, чужие — только числом, без пустых строк', () => {
    const md = formatBoardMarkdown(board([hiddenColumn]))

    expect(md).toContain('- Моя мысль — *Я*')
    expect(md).toContain('Скрыто до раскрытия карточек других участников: 2')
    // Пустых пунктов от карточек без текста быть не должно
    expect(md).not.toMatch(/^- {1,2}— \*\*$/m)
    expect(md).not.toMatch(/^-\s*$/m)
  })

  it('Markdown: скрытая карточка в группе не создаёт пустую группу', () => {
    const column: Column = {
      ...hiddenColumn,
      cards: [maskedCard('h1', { group_id: 'g-1' }), card('mine', { group_id: null, text: 'Вне группы' })],
      groups: [{ id: 'g-1', column_id: 'col-1', title: 'Чужая группа', position: 0 }],
    }

    const md = formatBoardMarkdown(board([column]))

    expect(md).not.toContain('### Чужая группа')
    expect(md).toContain('- Вне группы')
    expect(md).toContain('Скрыто до раскрытия карточек других участников: 1')
  })

  it('Markdown: после раскрытия пометки о скрытых нет', () => {
    const column: Column = { ...hiddenColumn, cards: [card('a', { text: 'Раскрыто' })] }
    const md = formatBoardMarkdown(board([column], { cards_hidden: false }))
    expect(md).toContain('- Раскрыто')
    expect(md).not.toContain('Скрыто до раскрытия')
  })

  it('PDF: скрытые карточки не попадают в отчёт карточками', () => {
    const html = buildBoardPDFHtml(board([hiddenColumn]), [hiddenColumn])

    expect(html).toContain('Моя мысль')
    expect(html).toContain('Скрыто до раскрытия карточек других участников: 2')
    // Одна видимая карточка — один блок карточки в отчёте
    expect(html.match(/<article/g) ?? []).toHaveLength(1)
  })

  it('PDF: колонка только со скрытыми карточками не называется пустой', () => {
    const column: Column = { ...hiddenColumn, cards: [maskedCard('h1')] }
    const html = buildBoardPDFHtml(board([column]), [column])

    expect(html).toContain('Скрыто до раскрытия карточек других участников: 1')
    expect(html).not.toContain('В этой колонке пока нет карточек')
  })
})

describe('экспорт в анонимном режиме', () => {
  it('Markdown не содержит имён авторов', () => {
    const column: Column = {
      ...hiddenColumn,
      cards: [
        card('mine', { text: 'Моя', author: 'Я Сам', author_id: 'p-me' }),
        card('other', { text: 'Чужая', author: 'Участник', author_id: null }),
      ],
    }
    const md = formatBoardMarkdown(board([column], { anonymous_votes: true, cards_hidden: false }))

    expect(md).toContain('- Моя')
    expect(md).toContain('- Чужая')
    expect(md).not.toContain('Я Сам')
  })
})
