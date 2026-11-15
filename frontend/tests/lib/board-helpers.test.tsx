import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { blockingOverlay } from '../../lib/hotkeys'
import { sameExceptVoteCount } from '../../lib/memo'
import { shallowEqualRecords, useStableValue } from '../../hooks/useStableValue'

describe('blockingOverlay — что отнимает горячие клавиши у доски', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const mount = (html: string) => {
    document.body.innerHTML = html
  }

  it('ничего не открыто — клавиши доски свободны', () => {
    mount('<main><button>Кнопка</button></main>')
    expect(blockingOverlay()).toBeNull()
  })

  it('окно (Dialog) забирает клавиатуру целиком', () => {
    mount('<div role="dialog" data-state="open">Настройки</div>')
    expect(blockingOverlay()).toBe('modal')
  })

  it('подтверждение (AlertDialog) — тоже окно', () => {
    mount('<div role="alertdialog" data-state="open">Удалить?</div>')
    expect(blockingOverlay()).toBe('modal')
  })

  it('поповер (таймер, реакции, участники) отнимает только Escape', () => {
    // Radix кладёт содержимое поповера в обёртку позиционирования
    mount('<div data-radix-popper-content-wrapper><div role="dialog" data-state="open">Таймер</div></div>')
    expect(blockingOverlay()).toBe('popover')
  })

  it('открытое меню или список выбора: буквы — поиск по пунктам', () => {
    mount('<div data-radix-popper-content-wrapper><div role="menu" data-state="open">Меню</div></div>')
    expect(blockingOverlay()).toBe('menu')
    mount('<div role="listbox" data-state="open">Список</div>')
    expect(blockingOverlay()).toBe('menu')
  })

  it('окно важнее поповера, открытого вместе с ним', () => {
    mount(
      '<div data-radix-popper-content-wrapper><div role="dialog" data-state="open">Поповер</div></div>' +
        '<div role="dialog" data-state="open">Окно</div>',
    )
    expect(blockingOverlay()).toBe('modal')
  })

  it('закрывающиеся окна (data-state="closed") не мешают', () => {
    mount('<div role="dialog" data-state="closed">Закрывается</div>')
    expect(blockingOverlay()).toBeNull()
  })
})

describe('sameExceptVoteCount — мемоизация карточек', () => {
  const fn = vi.fn()
  const card = { id: 'c' }
  const base = { card, onUpdated: fn, maxVotes: 5, userTotalVotes: 1, selected: false }

  it('те же пропсы — перерисовка не нужна', () => {
    expect(sameExceptVoteCount(base, { ...base })).toBe(true)
  })

  it('изменился объект карточки или обработчик — перерисовать', () => {
    expect(sameExceptVoteCount(base, { ...base, card: { id: 'c' } })).toBe(false)
    expect(sameExceptVoteCount(base, { ...base, onUpdated: vi.fn() })).toBe(false)
    expect(sameExceptVoteCount(base, { ...base, selected: true })).toBe(false)
  })

  it('свой лайк на другой карточке (счётчик вырос, лимит не достигнут) карточку не трогает', () => {
    expect(sameExceptVoteCount(base, { ...base, userTotalVotes: 2 })).toBe(true)
    expect(sameExceptVoteCount(base, { ...base, userTotalVotes: 4 })).toBe(true)
  })

  it('лимит голосов достигнут или снова свободен — перерисовать: кнопка голоса меняет состояние', () => {
    expect(sameExceptVoteCount(base, { ...base, userTotalVotes: 5 })).toBe(false)
    expect(sameExceptVoteCount({ ...base, userTotalVotes: 5 }, { ...base, userTotalVotes: 4 })).toBe(false)
  })

  it('пока лимит исчерпан, число голосов показано в подсказке и должно быть точным', () => {
    expect(sameExceptVoteCount({ ...base, userTotalVotes: 5 }, { ...base, userTotalVotes: 6 })).toBe(false)
    expect(sameExceptVoteCount({ ...base, userTotalVotes: 5 }, { ...base, userTotalVotes: 5 })).toBe(true)
  })

  it('без лимита (maxVotes = 0) счётчик не важен', () => {
    const unlimited = { ...base, maxVotes: 0 }
    expect(sameExceptVoteCount(unlimited, { ...unlimited, userTotalVotes: 99 })).toBe(true)
  })

  it('появился или пропал проп — перерисовать', () => {
    expect(sameExceptVoteCount(base, { ...base, extra: 1 } as typeof base)).toBe(false)
  })
})

describe('useStableValue', () => {
  it('возвращает прежний объект, пока новое значение равно ему по содержимому', () => {
    const first: Record<string, string> = { a: 'Анна' }
    const { result, rerender } = renderHook(
      ({ value }: { value: Record<string, string> }) => useStableValue(value, shallowEqualRecords),
      { initialProps: { value: first } },
    )
    expect(result.current).toBe(first)

    rerender({ value: { a: 'Анна' } })
    expect(result.current).toBe(first)

    const changed = { a: 'Анна', b: 'Борис' }
    rerender({ value: changed })
    expect(result.current).toBe(changed)

    rerender({ value: { a: 'Анна', b: 'Борис' } })
    expect(result.current).toBe(changed)
  })

  it('shallowEqualRecords сравнивает ключи и значения', () => {
    expect(shallowEqualRecords({ a: 1 }, { a: 1 })).toBe(true)
    expect(shallowEqualRecords({ a: 1 }, { a: 2 })).toBe(false)
    expect(shallowEqualRecords({ a: 1 }, { b: 1 })).toBe(false)
    expect(shallowEqualRecords({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})
