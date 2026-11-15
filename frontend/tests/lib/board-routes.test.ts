import { describe, it, expect, vi } from 'vitest'
import {
  FIRST_BOARD_REF,
  FIRST_BOARD_ROUTE,
  boardPath,
  resolveStartBoard,
} from '../../lib/board-routes'
import {
  isOwnBoardDeletion,
  markOwnBoardDeletion,
  onBoardsRefreshRequested,
  requestBoardsRefresh,
  unmarkOwnBoardDeletion,
} from '../../lib/board-list-signals'

describe('адреса досок', () => {
  it('адрес доски — по slug, без него по идентификатору', () => {
    expect(boardPath({ id: 'b-1', slug: 'sprint-42' })).toBe('/board/sprint-42')
    expect(boardPath({ id: 'b-1', slug: null })).toBe('/board/b-1')
    expect(boardPath({ id: 'b-1' })).toBe('/board/b-1')
  })

  it('служебный адрес первой доски — /board/start', () => {
    expect(FIRST_BOARD_REF).toBe('start')
    expect(FIRST_BOARD_ROUTE).toBe('/board/start')
  })

  it('/board/start открывает первую доску списка', () => {
    const boards = [
      { id: 'b-2', slug: 'sprint-2' },
      { id: 'b-1', slug: 'sprint-1' },
    ]
    expect(resolveStartBoard(boards)).toBe(boards[0])
  })

  it('доска «Start» с адресом start-xxxxxx не путается со служебным адресом', () => {
    // Так сервер называет доску «Start»: служебный slug он не выдаёт
    const boards = [
      { id: 'b-2', slug: 'sprint-2' },
      { id: 'b-1', slug: 'start-299b72' },
    ]
    expect(boardPath(boards[1])).toBe('/board/start-299b72')
    expect(resolveStartBoard(boards)).toBe(boards[0])
  })

  it('доска со slug «start» из старых данных открывается по адресу /board/start', () => {
    const boards = [
      { id: 'b-2', slug: 'sprint-2' },
      { id: 'b-1', slug: 'start' },
    ]
    expect(resolveStartBoard(boards)).toBe(boards[1])
  })

  it('без досок открывать нечего', () => {
    expect(resolveStartBoard([])).toBeNull()
  })
})

describe('сигналы о списке досок', () => {
  it('просьба перечитать список доходит до подписчика, пока он подписан', () => {
    const listener = vi.fn()
    const unsubscribe = onBoardsRefreshRequested(listener)

    requestBoardsRefresh()
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    requestBoardsRefresh()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('без подписчиков просьба никому не мешает', () => {
    expect(() => requestBoardsRefresh()).not.toThrow()
  })

  it('своё удаление доски помечается до запроса и снимается при неудаче', () => {
    expect(isOwnBoardDeletion('b-own')).toBe(false)

    markOwnBoardDeletion('b-own')
    expect(isOwnBoardDeletion('b-own')).toBe(true)
    expect(isOwnBoardDeletion('b-other')).toBe(false)

    unmarkOwnBoardDeletion('b-own')
    expect(isOwnBoardDeletion('b-own')).toBe(false)
  })
})
