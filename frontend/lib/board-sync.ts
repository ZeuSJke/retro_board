/**
 * Порядок событий доски: по номерам `seq` клиент узнаёт, что пропустил событие.
 *
 * Сервер нумерует события, меняющие данные доски (`seq` в рамках поколения `epoch`),
 * а снимок доски (`GET /api/boards/{id}`) несёт номер последнего вошедшего в него события.
 * Правило: событие с номером не больше текущего пропускается, следующее по порядку
 * применяется, любой пропуск или другое поколение — повод перечитать доску.
 *
 * Здесь только учёт номеров, без сети и React: что делать с событием, решает `accept`,
 * а события, пришедшие не вовремя (идёт чтение снимка, участник тащит карточку),
 * копятся и возвращаются, когда их можно применить.
 */

/** Сообщение сокета: у событий данных доски есть номер и поколение нумерации. */
export interface SequencedMessage {
  seq?: unknown
  epoch?: unknown
}

/** Позиция в потоке событий доски. */
export interface SyncPosition {
  /** Поколение нумерации; `null` — сервер его не прислал, сверять нечем. */
  epoch: string | null
  seq: number
}

/**
 * Что делать с событием:
 * - `apply` — применить сейчас;
 * - `skip` — уже учтено в состоянии (номер не больше текущего);
 * - `hold` — отложено до конца чтения снимка или перетаскивания;
 * - `resync` — обнаружен пропуск или другое поколение: нужно перечитать доску.
 */
export type SeqVerdict = 'apply' | 'skip' | 'hold' | 'resync'

export interface DrainResult<T> {
  /** Отложенные события, которые пора применить, в порядке прихода. */
  replay: T[]
  /** В отложенных событиях пропуск: доску нужно перечитать ещё раз. */
  resync: boolean
}

export interface SnapshotResult<T> extends DrainResult<T> {
  /** Снимок не старше текущего состояния: его данные нужно применить. */
  fresh: boolean
  /**
   * Пока шло чтение, пришли события, которые сервер посчитал вошедшими в снимок.
   * Снимок мог быть собран чуть раньше, чем сервер взял его номер, — тогда такое событие
   * потеряно. Вызывающий код перечитывает доску ещё раз.
   */
  overlap: boolean
}

/** Больше событий, чем разумно копить: проще перечитать доску. */
const MAX_HELD_EVENTS = 500

interface Held<T> {
  msg: T
  seq: number
  epoch: string
  /** Событие пришло, пока читался снимок. */
  duringRead: boolean
}

function position(msg: SequencedMessage): { seq: number; epoch: string } | null {
  if (typeof msg.seq !== 'number' || !Number.isFinite(msg.seq)) return null
  if (typeof msg.epoch !== 'string' || !msg.epoch) return null
  return { seq: msg.seq, epoch: msg.epoch }
}

export class BoardEventSequencer<T extends SequencedMessage> {
  private epoch: string | null = null
  private lastSeq = 0
  /** Идёт чтение снимка. */
  private reading = false
  /** Состояние могло разойтись с сервером: события копятся, пока не придёт снимок. */
  private stale = false
  /** Участник что-то тащит: чужие изменения применятся, когда он отпустит. */
  private paused = false
  private held: Held<T>[] = []

  /** Начать с позиции снимка (или с неизвестной, если сервер её не прислал). */
  reset(start?: Partial<SyncPosition> | null): void {
    this.epoch = typeof start?.epoch === 'string' && start.epoch ? start.epoch : null
    this.lastSeq = typeof start?.seq === 'number' && Number.isFinite(start.seq) ? start.seq : 0
    this.reading = false
    this.stale = false
    this.paused = false
    this.held = []
  }

  get current(): SyncPosition {
    return { epoch: this.epoch, seq: this.lastSeq }
  }

  /** Нужен снимок: обнаружен пропуск, а чтение ещё не началось или не удалось. */
  get needsSnapshot(): boolean {
    return this.stale && !this.reading
  }

  get isPaused(): boolean {
    return this.paused
  }

  /** Решить, что делать с пришедшим сообщением. События без номера применяются сразу. */
  accept(msg: T): SeqVerdict {
    const pos = position(msg)
    if (!pos) return 'apply'
    if (this.reading || this.stale || this.paused) {
      this.hold(msg, pos)
      return 'hold'
    }
    const verdict = this.judge(pos)
    if (verdict === 'resync') {
      this.stale = true
      this.hold(msg, pos)
    }
    return verdict
  }

  /** Состояние под сомнением (сокет переподключился): копить события до снимка. */
  markStale(): void {
    this.stale = true
  }

  /** Начато чтение снимка. */
  beginSnapshot(): void {
    this.reading = true
    this.stale = true
  }

  /** Чтение не удалось: события продолжают копиться до следующей попытки. */
  abortSnapshot(): void {
    this.reading = false
  }

  /**
   * Снимок прочитан. Его позиция становится текущей, если он не старше состояния;
   * отложенные события новее снимка возвращаются для применения.
   */
  completeSnapshot(snapshot?: Partial<SyncPosition> | null): SnapshotResult<T> {
    this.reading = false
    this.stale = false
    const { fresh, overlap } = this.take(snapshot, true)
    return { fresh, overlap, ...this.drain() }
  }

  /**
   * Снимок пришёл попутно — в ответе REST (сохранение настроек, раскрытие карточек).
   * Позиция обновляется, но сомнение в состоянии остаётся: такой ответ не заменяет
   * полного перечитывания (в нём нет задач).
   */
  adoptSnapshot(snapshot?: Partial<SyncPosition> | null): { fresh: boolean } {
    return { fresh: this.take(snapshot, false).fresh }
  }

  /** Участник начал перетаскивание: чужие изменения откладываются. */
  pause(): void {
    this.paused = true
  }

  /** Перетаскивание закончилось: вернуть отложенное. */
  resume(): DrainResult<T> {
    this.paused = false
    return this.drain()
  }

  private take(
    snapshot: Partial<SyncPosition> | null | undefined,
    fromRead: boolean,
  ): { fresh: boolean; overlap: boolean } {
    const epoch = typeof snapshot?.epoch === 'string' && snapshot.epoch ? snapshot.epoch : null
    const seq =
      typeof snapshot?.seq === 'number' && Number.isFinite(snapshot.seq) ? snapshot.seq : 0
    if (epoch === null) {
      // Сервер без нумерации: сверять нечем, снимок считается свежим
      this.epoch = null
      this.lastSeq = 0
      return { fresh: true, overlap: false }
    }
    const fresh = epoch !== this.epoch || seq >= this.lastSeq
    if (!fresh) return { fresh: false, overlap: false }
    this.epoch = epoch
    this.lastSeq = seq
    const overlap =
      fromRead && this.held.some((h) => h.duringRead && h.epoch === epoch && h.seq <= seq)
    return { fresh: true, overlap }
  }

  private judge(pos: { seq: number; epoch: string }): SeqVerdict {
    if (this.epoch === null) {
      // Позиция неизвестна — начинаем отсчёт с первого пронумерованного события
      this.epoch = pos.epoch
      this.lastSeq = pos.seq
      return 'apply'
    }
    if (pos.epoch !== this.epoch) return 'resync'
    if (pos.seq <= this.lastSeq) return 'skip'
    if (pos.seq === this.lastSeq + 1) {
      this.lastSeq = pos.seq
      return 'apply'
    }
    return 'resync'
  }

  private hold(msg: T, pos: { seq: number; epoch: string }): void {
    if (this.held.length >= MAX_HELD_EVENTS) {
      // Копить дальше бессмысленно: после снимка следующее событие покажет пропуск
      this.held = []
      this.stale = true
    }
    this.held.push({ msg, seq: pos.seq, epoch: pos.epoch, duringRead: this.reading })
  }

  private drain(): DrainResult<T> {
    if (this.reading || this.stale || this.paused) return { replay: [], resync: false }
    const pending = this.held
    this.held = []
    const replay: T[] = []
    for (let i = 0; i < pending.length; i += 1) {
      const item = pending[i]
      const verdict = this.judge(item)
      if (verdict === 'apply') {
        replay.push(item.msg)
      } else if (verdict === 'resync') {
        // Остальное остаётся отложенным до следующего снимка
        this.stale = true
        this.held = pending.slice(i).map((h) => ({ ...h, duringRead: false }))
        return { replay, resync: true }
      }
    }
    return { replay, resync: false }
  }
}
