import { describe, it, expect, beforeEach } from 'vitest'
import {
  APP_STORE_VERSION,
  migratePersistedState,
  syncSessionFromStorage,
  useAppStore,
} from '../../store'

const STORAGE_KEY = 'retroboard-app'

const workspace = {
  workspaceId: 'ws-1',
  workspaceSlug: 'team',
  workspaceName: 'Команда',
}
const participant = { id: 'p-1', name: 'Анна' }

/** Сессия в том виде, в каком её писала версия 0: токен лежал прямо в сторе. */
const legacyWorkspace = { token: 'jwt-token', ...workspace }

function resetStore() {
  useAppStore.setState({
    username: 'Аноним',
    currentBoardId: null,
    theme: { primary: '#6750A4', dark: false },
    dotGrid: true,
    workspace: null,
    participant: null,
    aiEnabled: null,
  })
}

function readStored(): { state: Record<string, unknown>; version: number } {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
    state: Record<string, unknown>
    version: number
  }
}

describe('useAppStore', () => {
  beforeEach(resetStore)

  it('has correct default values', () => {
    const state = useAppStore.getState()
    expect(state.username).toBe('Аноним')
    expect(state.currentBoardId).toBeNull()
    expect(state.theme).toEqual({ primary: '#6750A4', dark: false })
    expect(state.workspace).toBeNull()
    expect(state.participant).toBeNull()
    expect(state.aiEnabled).toBeNull()
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

describe('useAppStore — сессия', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStore()
  })

  it('setSession записывает команду и участника, имя для входа берёт у участника', () => {
    useAppStore.getState().setSession({ workspace, participant })

    const state = useAppStore.getState()
    expect(state.workspace).toEqual(workspace)
    expect(state.participant).toEqual(participant)
    expect(state.username).toBe('Анна')
  })

  it('setSession с теми же данными не пересоздаёт объекты', () => {
    useAppStore.getState().setSession({ workspace, participant })
    const before = useAppStore.getState()

    useAppStore.getState().setSession({ workspace: { ...workspace }, participant: { ...participant } })

    const after = useAppStore.getState()
    expect(after.workspace).toBe(before.workspace)
    expect(after.participant).toBe(before.participant)
  })

  it('setParticipant меняет имя, не трогая идентификатор и команду', () => {
    useAppStore.getState().setSession({ workspace, participant })
    useAppStore.getState().setParticipant({ id: 'p-1', name: 'Анна Петрова' })

    const state = useAppStore.getState()
    expect(state.participant).toEqual({ id: 'p-1', name: 'Анна Петрова' })
    expect(state.username).toBe('Анна Петрова')
    expect(state.workspace).toEqual(workspace)
  })

  it('clearSession забывает команду и участника, но оставляет имя, тему и доску', () => {
    useAppStore.getState().setSession({ workspace, participant })
    useAppStore.getState().setCurrentBoard('board-9')
    useAppStore.getState().setTheme({ primary: 'emerald', dark: true })

    useAppStore.getState().clearSession()

    const state = useAppStore.getState()
    expect(state.workspace).toBeNull()
    expect(state.participant).toBeNull()
    expect(state.username).toBe('Анна')
    expect(state.currentBoardId).toBe('board-9')
    expect(state.theme).toEqual({ primary: 'emerald', dark: true })
  })

  it('в localStorage попадает участник, но не токен и не признак AI', () => {
    useAppStore.getState().setSession({ workspace, participant })
    useAppStore.getState().setAiEnabled(true)

    const stored = readStored()
    expect(stored.state.participant).toEqual(participant)
    expect(stored.state.workspace).toEqual(workspace)
    expect(stored.state).not.toHaveProperty('aiEnabled')
    expect(JSON.stringify(stored)).not.toContain('token')
  })
})

describe('useAppStore — сохранённое состояние', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStore()
  })

  it('пишет в localStorage текущую версию схемы', () => {
    useAppStore.getState().setUsername('Alice')
    expect(readStored().version).toBe(APP_STORE_VERSION)
  })

  it('читает состояние текущей версии как есть', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          username: 'Анна',
          currentBoardId: 'board-42',
          theme: { primary: 'emerald', dark: true },
          dotGrid: false,
          workspace,
          participant,
        },
        version: APP_STORE_VERSION,
      }),
    )

    await useAppStore.persist.rehydrate()

    const state = useAppStore.getState()
    expect(state.workspace).toEqual(workspace)
    expect(state.participant).toEqual(participant)
    expect(state.currentBoardId).toBe('board-42')
    expect(state._hasHydrated).toBe(true)
  })

  it('версия 0: убирает токен из localStorage, сохраняет тему, сетку, доску и имя', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          username: 'Анна',
          currentBoardId: 'board-42',
          theme: { primary: 'emerald', dark: true },
          dotGrid: false,
          workspace: legacyWorkspace,
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
    // Команда известна (код подставится в форму входа), участника нет — нужен вход
    expect(state.workspace).toEqual(workspace)
    expect(state.participant).toBeNull()
    expect(state._hasHydrated).toBe(true)

    // Перенесённое состояние записано обратно уже без токена
    const stored = readStored()
    expect(stored.version).toBe(APP_STORE_VERSION)
    expect(JSON.stringify(stored)).not.toContain('jwt-token')
    expect(stored.state.workspace).toEqual(workspace)
  })

  it('версия 0: читает самые старые записи без dotGrid и с hex-цветом темы', async () => {
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
    expect(state.participant).toBeNull()
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
          participant: { id: 42 },
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
    expect(state.participant).toBeNull()
    expect(state).not.toHaveProperty('somethingNew')
  })
})

describe('migratePersistedState', () => {
  const defaults = {
    username: 'Аноним',
    currentBoardId: null,
    theme: { primary: 'violet', dark: false },
    dotGrid: true,
    workspace: null,
    participant: null,
  }

  it('возвращает значения по умолчанию для мусора', () => {
    expect(migratePersistedState(null, 0)).toEqual(defaults)
    expect(migratePersistedState('oops', 3)).toEqual(defaults)
    expect(migratePersistedState([], 1)).toEqual(defaults)
  })

  it('шаг 0 → 1 отбрасывает токен и не выдумывает участника', () => {
    const migrated = migratePersistedState(
      { username: 'Анна', workspace: legacyWorkspace, participant },
      0,
    )
    expect(migrated.workspace).toEqual(workspace)
    expect(migrated.workspace).not.toHaveProperty('token')
    // Участника в версии 0 не было: даже если поле есть, сессии старого образца сервер не примет
    expect(migrated.participant).toBeNull()
    expect(migrated.username).toBe('Анна')
  })

  it('сохраняет корректную сессию из записи более новой версии', () => {
    const migrated = migratePersistedState({ workspace, participant }, APP_STORE_VERSION + 2)
    expect(migrated.workspace).toEqual(workspace)
    expect(migrated.participant).toEqual(participant)
  })

  it('участник без команды — не сессия', () => {
    expect(migratePersistedState({ participant }, APP_STORE_VERSION + 1).participant).toBeNull()
  })
})

describe('сессия между вкладками', () => {
  const stored = (state: Record<string, unknown>, version = APP_STORE_VERSION) =>
    JSON.stringify({ state, version })

  beforeEach(() => {
    localStorage.clear()
    resetStore()
  })

  it('вход в другой вкладке приходит и в эту: форма входа больше не нужна', () => {
    syncSessionFromStorage(stored({ workspace, participant, username: 'Анна' }))
    expect(useAppStore.getState().participant).toEqual(participant)
    expect(useAppStore.getState().workspace).toEqual(workspace)
    expect(useAppStore.getState().username).toBe('Анна')
  })

  it('повторный вход в другой вкладке меняет участника и здесь', () => {
    useAppStore.setState({ workspace, participant })
    syncSessionFromStorage(stored({ workspace, participant: { id: 'p-2', name: 'Анна' } }))
    // Cookie общая: запросы этой вкладки уже идут от p-2, и стор должен знать об этом
    expect(useAppStore.getState().participant?.id).toBe('p-2')
  })

  it('выход в другой вкладке завершает сессию и здесь', () => {
    useAppStore.setState({ workspace, participant })
    syncSessionFromStorage(stored({ workspace: null, participant: null }))
    expect(useAppStore.getState().participant).toBeNull()
    expect(useAppStore.getState().workspace).toBeNull()
  })

  it('тема, сетка и текущая доска у вкладок остаются своими', () => {
    useAppStore.setState({
      workspace,
      participant,
      currentBoardId: 'board-here',
      theme: { primary: '#006E1C', dark: true },
    })
    syncSessionFromStorage(
      stored({
        workspace,
        participant: { id: 'p-2', name: 'Борис' },
        currentBoardId: 'board-there',
        theme: { primary: '#6750A4', dark: false },
      }),
    )
    const state = useAppStore.getState()
    expect(state.currentBoardId).toBe('board-here')
    expect(state.theme).toEqual({ primary: '#006E1C', dark: true })
  })

  it('та же сессия не трогает стор, мусор и очистка хранилища игнорируются', () => {
    useAppStore.setState({ workspace, participant })
    const before = useAppStore.getState()
    syncSessionFromStorage(stored({ workspace, participant }))
    syncSessionFromStorage('не json')
    syncSessionFromStorage('[1, 2]')
    syncSessionFromStorage(null)
    expect(useAppStore.getState()).toBe(before)
  })

  it('событие storage от другой вкладки доходит до стора', () => {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: STORAGE_KEY,
        newValue: stored({ workspace, participant }),
      }),
    )
    expect(useAppStore.getState().participant).toEqual(participant)
    // Чужой ключ хранилища сессию не меняет
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'retro_theme_mode',
        newValue: stored({ workspace: null, participant: null }),
      }),
    )
    expect(useAppStore.getState().participant).toEqual(participant)
  })
})
