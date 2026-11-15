import { describe, it, expect } from 'vitest'
import { BoardEventSequencer } from '../../lib/board-sync'

interface Msg {
  event: string
  seq?: number
  epoch?: string
}

const ev = (seq: number, epoch = 'e1', event = 'card_updated'): Msg => ({ event, seq, epoch })

function started(seq = 5, epoch = 'e1') {
  const sequencer = new BoardEventSequencer<Msg>()
  sequencer.reset({ epoch, seq })
  return sequencer
}

describe('BoardEventSequencer — номера событий', () => {
  it('следующее по порядку событие применяется, позиция сдвигается', () => {
    const s = started(5)
    expect(s.accept(ev(6))).toBe('apply')
    expect(s.accept(ev(7))).toBe('apply')
    expect(s.current).toEqual({ epoch: 'e1', seq: 7 })
  })

  it('событие с номером не больше текущего пропускается: оно уже вошло в снимок', () => {
    const s = started(5)
    expect(s.accept(ev(5))).toBe('skip')
    expect(s.accept(ev(3))).toBe('skip')
    expect(s.current.seq).toBe(5)
  })

  it('пропуск в номерах — перечитать доску; событие не теряется', () => {
    const s = started(5)
    expect(s.accept(ev(8))).toBe('resync')
    expect(s.needsSnapshot).toBe(true)
    // Пока снимка нет, новые события копятся
    expect(s.accept(ev(9))).toBe('hold')

    s.beginSnapshot()
    // Снимок включает события до 7: восьмое и девятое применяются поверх него
    const result = s.completeSnapshot({ epoch: 'e1', seq: 7 })

    expect(result.fresh).toBe(true)
    expect(result.replay.map((m) => m.seq)).toEqual([8, 9])
    expect(result.resync).toBe(false)
    expect(s.current.seq).toBe(9)
    expect(s.needsSnapshot).toBe(false)
  })

  it('другое поколение нумерации (рестарт сервера) — перечитать доску', () => {
    const s = started(5, 'e1')
    expect(s.accept(ev(1, 'e2'))).toBe('resync')

    s.beginSnapshot()
    const result = s.completeSnapshot({ epoch: 'e2', seq: 1 })

    // Событие из нового поколения уже в снимке
    expect(result.fresh).toBe(true)
    expect(result.replay).toEqual([])
    expect(s.current).toEqual({ epoch: 'e2', seq: 1 })
  })

  it('события без номера (курсоры, таймер, присутствие) применяются сразу и позицию не трогают', () => {
    const s = started(5)
    expect(s.accept({ event: 'cursor_move' })).toBe('apply')
    s.beginSnapshot()
    // Даже во время чтения снимка
    expect(s.accept({ event: 'timer_start' })).toBe('apply')
    expect(s.current.seq).toBe(5)
  })

  it('событие с номером, но без поколения нумерованным не считается', () => {
    const s = started(5)
    expect(s.accept({ event: 'card_updated', seq: 99 })).toBe('apply')
    expect(s.current.seq).toBe(5)
  })
})

describe('BoardEventSequencer — чтение снимка', () => {
  it('пока идёт чтение, события копятся; после — применяются только те, что новее снимка', () => {
    const s = started(5)
    s.beginSnapshot()
    expect(s.accept(ev(6))).toBe('hold')
    expect(s.accept(ev(7))).toBe('hold')
    expect(s.accept(ev(8))).toBe('hold')

    const result = s.completeSnapshot({ epoch: 'e1', seq: 6 })

    expect(result.replay.map((m) => m.seq)).toEqual([7, 8])
    expect(s.current.seq).toBe(8)
  })

  it('событие, пришедшее во время чтения и посчитанное вошедшим в снимок, — повод перечитать ещё раз', () => {
    // Снимок мог быть собран раньше, чем сервер взял его номер: такое событие в нём могло не оказаться
    const s = started(5)
    s.beginSnapshot()
    s.accept(ev(6))

    const result = s.completeSnapshot({ epoch: 'e1', seq: 6 })

    expect(result.overlap).toBe(true)
    expect(result.replay).toEqual([])
  })

  it('событие, из-за которого началось чтение, перекрытием не считается: запрос ушёл после него', () => {
    const s = started(5)
    expect(s.accept(ev(8))).toBe('resync')
    s.beginSnapshot()

    const result = s.completeSnapshot({ epoch: 'e1', seq: 8 })

    expect(result.overlap).toBe(false)
    expect(result.replay).toEqual([])
    expect(s.current.seq).toBe(8)
  })

  it('пропуск среди отложенных событий — применить что можно и перечитать снова', () => {
    const s = started(5)
    s.beginSnapshot()
    s.accept(ev(7))
    s.accept(ev(9))
    s.accept(ev(10))

    const first = s.completeSnapshot({ epoch: 'e1', seq: 6 })

    expect(first.replay.map((m) => m.seq)).toEqual([7])
    expect(first.resync).toBe(true)
    expect(s.needsSnapshot).toBe(true)

    // Второй снимок закрывает пропуск; оставшиеся события применяются поверх него
    s.beginSnapshot()
    const second = s.completeSnapshot({ epoch: 'e1', seq: 9 })
    expect(second.replay.map((m) => m.seq)).toEqual([10])
    expect(second.resync).toBe(false)
  })

  it('неудачное чтение оставляет события отложенными до следующей попытки', () => {
    const s = started(5)
    s.beginSnapshot()
    s.accept(ev(6))
    s.abortSnapshot()

    expect(s.needsSnapshot).toBe(true)
    expect(s.accept(ev(7))).toBe('hold')

    s.beginSnapshot()
    const result = s.completeSnapshot({ epoch: 'e1', seq: 5 })
    expect(result.replay.map((m) => m.seq)).toEqual([6, 7])
  })

  it('снимок старше текущего состояния не применяется', () => {
    const s = started(10)
    s.beginSnapshot()

    const result = s.completeSnapshot({ epoch: 'e1', seq: 8 })

    expect(result.fresh).toBe(false)
    expect(s.current.seq).toBe(10)
  })

  it('после переподключения события копятся до снимка, даже если идут по порядку', () => {
    // Пока сокета не было, события могли пройти мимо — по первому же событию этого не понять
    const s = started(5)
    s.markStale()
    expect(s.accept(ev(6))).toBe('hold')

    s.beginSnapshot()
    const result = s.completeSnapshot({ epoch: 'e1', seq: 9 })
    expect(result.replay).toEqual([])
    expect(s.current.seq).toBe(9)
  })

  it('сервер без нумерации: снимок всегда свежий, отложенные события применяются', () => {
    const s = new BoardEventSequencer<Msg>()
    s.reset(null)
    s.beginSnapshot()
    s.accept(ev(3))

    const result = s.completeSnapshot({})

    expect(result.fresh).toBe(true)
    expect(result.replay.map((m) => m.seq)).toEqual([3])
  })

  it('позиция неизвестна: отсчёт начинается с первого пронумерованного события', () => {
    const s = new BoardEventSequencer<Msg>()
    s.reset(null)
    expect(s.accept(ev(41))).toBe('apply')
    expect(s.accept(ev(42))).toBe('apply')
    expect(s.accept(ev(44))).toBe('resync')
  })

  it('слишком длинная очередь отложенных событий сбрасывается: пропуск покажет следующее событие', () => {
    const s = started(0)
    s.beginSnapshot()
    for (let seq = 1; seq <= 600; seq += 1) s.accept(ev(seq))

    const result = s.completeSnapshot({ epoch: 'e1', seq: 0 })

    // Начало очереди потеряно: то, что осталось, не продолжает позицию снимка
    expect(result.replay).toEqual([])
    expect(result.resync).toBe(true)
  })
})

describe('BoardEventSequencer — перетаскивание', () => {
  it('пока участник тащит карточку, события копятся и применяются, когда он отпустит', () => {
    const s = started(5)
    s.pause()
    expect(s.isPaused).toBe(true)
    expect(s.accept(ev(6))).toBe('hold')
    expect(s.accept(ev(7))).toBe('hold')
    expect(s.current.seq).toBe(5)

    const result = s.resume()

    expect(result.replay.map((m) => m.seq)).toEqual([6, 7])
    expect(result.resync).toBe(false)
    expect(s.current.seq).toBe(7)
  })

  it('пропуск, накопленный за время перетаскивания, обнаруживается при отпускании', () => {
    const s = started(5)
    s.pause()
    s.accept(ev(6))
    s.accept(ev(9))

    const result = s.resume()

    expect(result.replay.map((m) => m.seq)).toEqual([6])
    expect(result.resync).toBe(true)
    expect(s.needsSnapshot).toBe(true)
  })

  it('если во время перетаскивания шло чтение снимка, отложенное ждёт его окончания', () => {
    const s = started(5)
    s.beginSnapshot()
    s.pause()
    s.accept(ev(6))

    expect(s.resume()).toEqual({ replay: [], resync: false })

    const result = s.completeSnapshot({ epoch: 'e1', seq: 5 })
    expect(result.replay.map((m) => m.seq)).toEqual([6])
  })
})
