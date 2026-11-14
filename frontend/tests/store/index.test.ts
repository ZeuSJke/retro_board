import { describe, it, expect, beforeEach } from 'vitest'
import { APP_STORE_VERSION, migratePersistedState, useAppStore } from '../../store'

const STORAGE_KEY = 'retroboard-app'

const workspace = {
  token: 'jwt-token',
  workspaceId: 'ws-1',
  workspaceSlug: 'team',
  workspaceName: 'Команда',
}

function resetStore() {
  useAppStore.setState({
    username: 'Аноним',
    currentBoardId: null,
    theme: { primary: '#6750A4', dark: false },
    dotGrid: true,
    workspace: null,
  })
}

describe('useAppStore', () => {
  beforeEach(resetStore)

  it('has correct default values', () => {
    const state = useAppStore.getState()
    expect(state.username).toBe('Аноним')
    expect(state.currentBoardId).toBeNull()
    expect(state.theme).toEqual({ primary: '#6750A4', dark: false })
  })

  it('setUsername updates username', () => {
    useAppStore.getState().setUsername('Alice')
    expect(useAppStore.getState().username).toBe('Alice')
  })

  it('setCurrentBoard updates currentBoardId', () => {
    useAppStore.getState().setCurrentBoard('board-123')
    expect(useAppStore.getState().currentBoardId).toBe('board-123')
  })

  it('setTheme updates theme', () => {
    useAppStore.getState().setTheme({ primary: '#FF0000', dark: true })
    expect(useAppStore.getState().theme).toEqual({ primary: '#FF0000', dark: true })
  })
})

describe('useAppStore — сохранённое состояние', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStore()
  })

  it('пишет в localStorage текущую версию схемы', () => {
    useAppStore.getState().setUsername('Alice')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { version?: number }
    expect(stored.version).toBe(APP_STORE_VERSION)
  })

  it('читает без потерь данные, записанные сборками до появления явной версии', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          username: 'Анна',
          currentBoardId: 'board-42',
          theme: { primary: 'emerald', dark: true },
          dotGrid: false,
          workspace,
        },
        version: 0,
      }),
    )

    await useAppStore.persist.rehydrate()

    const state = useAppStore.getState()
    expect(state.username).toBe('Анна')
    expect(state.currentBoardId).toBe('board-42')
    expect(state.theme).toEqual({ primary: 'emerald', dark: true })
    expect(state.dotGrid).toBe(false)
    expect(state.workspace).toEqual(workspace)
    expect(state._hasHydrated).toBe(true)
  })

  it('читает самые старые записи без dotGrid и с hex-цветом темы', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          username: 'E2E Тестер',
          currentBoardId: null,
          theme: { primary: '#6750A4', dark: false },
          workspace: null,
        },
        version: 0,
      }),
    )

    await useAppStore.persist.rehydrate()

    const state = useAppStore.getState()
    expect(state.username).toBe('E2E Тестер')
    expect(state.theme).toEqual({ primary: '#6750A4', dark: false })
    expect(state.dotGrid).toBe(true)
    expect(state.workspace).toBeNull()
  })

  it('из записи с незнакомой версией забирает понятные поля и не ломается на остальных', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          username: 'Из будущего',
          currentBoardId: 'board-7',
          theme: 'dark',
          dotGrid: 'yes',
          workspace: { token: 'jwt-token' },
          somethingNew: [1, 2, 3],
        },
        version: APP_STORE_VERSION + 5,
      }),
    )

    await useAppStore.persist.rehydrate()

    const state = useAppStore.getState()
    expect(state.username).toBe('Из будущего')
    expect(state.currentBoardId).toBe('board-7')
    expect(state.theme).toEqual({ primary: 'violet', dark: false })
    expect(state.dotGrid).toBe(true)
    expect(state.workspace).toBeNull()
    expect(state).not.toHaveProperty('somethingNew')
  })
})

describe('migratePersistedState', () => {
  it('возвращает значения по умолчанию для мусора', () => {
    const defaults = {
      username: 'Аноним',
      currentBoardId: null,
      theme: { primary: 'violet', dark: false },
      dotGrid: true,
      workspace: null,
    }
    expect(migratePersistedState(null, 0)).toEqual(defaults)
    expect(migratePersistedState('oops', 3)).toEqual(defaults)
    expect(migratePersistedState([], 1)).toEqual(defaults)
  })

  it('сохраняет корректную сессию пространства', () => {
    expect(migratePersistedState({ workspace }, 3).workspace).toEqual(workspace)
  })
})
