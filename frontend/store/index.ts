'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppStore, Theme, WorkspaceSession } from '../types'

/** Часть состояния, которая сохраняется в localStorage под ключом `retroboard-app`. */
export type PersistedAppState = Pick<
  AppStore,
  'username' | 'currentBoardId' | 'theme' | 'dotGrid' | 'workspace'
>

/**
 * Версия схемы сохранённого состояния.
 *
 * 0 — текущая и единственная: до появления явной версии persist писал `version: 0` по умолчанию,
 * поэтому всё, что уже лежит у пользователей в localStorage, читается как есть, без миграции.
 * Повышать версию без изменения формы состояния нельзя: сборка без `migrate` (откат) отбросит
 * данные с незнакомой версией, и людям придётся заново входить в пространство.
 *
 * При изменении формы: увеличить версию и добавить шаг в `migratePersistedState`.
 */
export const APP_STORE_VERSION = 0

const DEFAULT_PERSISTED: PersistedAppState = {
  username: 'Аноним',
  currentBoardId: null,
  theme: { primary: 'violet', dark: false },
  dotGrid: true,
  workspace: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTheme(value: unknown): value is Theme {
  return isRecord(value) && typeof value.primary === 'string' && typeof value.dark === 'boolean'
}

function isWorkspaceSession(value: unknown): value is WorkspaceSession {
  return (
    isRecord(value) &&
    typeof value.token === 'string' &&
    typeof value.workspaceId === 'string' &&
    typeof value.workspaceSlug === 'string' &&
    typeof value.workspaceName === 'string'
  )
}

/**
 * Шаги миграции: ключ — версия, с которой шаг переводит состояние на следующую.
 * Пример для будущей версии 1: `0: (state) => ({ ...state, новоеПоле: значение })`.
 */
const MIGRATION_STEPS: Record<
  number,
  (state: Record<string, unknown>) => Record<string, unknown>
> = {}

/**
 * Приводит сохранённое состояние версии `fromVersion` к текущей схеме.
 *
 * persist вызывает функцию только когда версия в localStorage не совпадает с `APP_STORE_VERSION`:
 * для старых версий по очереди применяются шаги из `MIGRATION_STEPS`; данные, записанные более
 * новой сборкой (например, после отката), шагов не имеют. В обоих случаях знакомые поля забираем,
 * если их форма понятна, остальное остаётся по умолчанию.
 */
export function migratePersistedState(persisted: unknown, fromVersion: number): PersistedAppState {
  let stored = isRecord(persisted) ? persisted : {}
  for (let version = fromVersion; version < APP_STORE_VERSION; version++) {
    stored = MIGRATION_STEPS[version]?.(stored) ?? stored
  }

  return {
    username: typeof stored.username === 'string' ? stored.username : DEFAULT_PERSISTED.username,
    currentBoardId:
      typeof stored.currentBoardId === 'string' ? stored.currentBoardId : DEFAULT_PERSISTED.currentBoardId,
    theme: isTheme(stored.theme) ? stored.theme : DEFAULT_PERSISTED.theme,
    dotGrid: typeof stored.dotGrid === 'boolean' ? stored.dotGrid : DEFAULT_PERSISTED.dotGrid,
    workspace: isWorkspaceSession(stored.workspace) ? stored.workspace : DEFAULT_PERSISTED.workspace,
  }
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      ...DEFAULT_PERSISTED,
      _hasHydrated: false,

      setUsername: (name: string) => set({ username: name }),
      setCurrentBoard: (id: string) => set({ currentBoardId: id }),
      setTheme: (theme) => set({ theme }),
      setDotGrid: (enabled: boolean) => set({ dotGrid: enabled }),
      setWorkspace: (ws: WorkspaceSession | null) => set({ workspace: ws }),
      setHasHydrated: (hydrated: boolean) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: 'retroboard-app',
      version: APP_STORE_VERSION,
      migrate: migratePersistedState,
      partialize: (state): PersistedAppState => ({
        username: state.username,
        currentBoardId: state.currentBoardId,
        theme: state.theme,
        dotGrid: state.dotGrid,
        workspace: state.workspace,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated?.(true)
      },
    },
  ),
)
