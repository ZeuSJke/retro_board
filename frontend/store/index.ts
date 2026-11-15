'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppStore, Participant, Theme, WorkspaceSession } from '../types'

/** Часть состояния, которая сохраняется в localStorage под ключом `retroboard-app`. */
export type PersistedAppState = Pick<
  AppStore,
  'username' | 'currentBoardId' | 'theme' | 'dotGrid' | 'workspace' | 'participant'
>

/**
 * Версия схемы сохранённого состояния.
 *
 * 0 — до серверного участника: в `workspace` лежал токен сессии, личностью было имя (`username`).
 * 1 — токен живёт только в httpOnly-cookie, в сторе его нет; появился `participant` (`{ id, name }`).
 *     Шаг 0 → 1 физически убирает токен из localStorage. Сессии, выданные до обновления, сервер
 *     не принимает, поэтому участника у перенесённого состояния нет: человек входит заново,
 *     а имя и код команды подставляются в форму входа. Тема, сетка и текущая доска сохраняются.
 *
 * Повышать версию без изменения формы состояния нельзя: сборка без `migrate` (откат) отбросит
 * данные с незнакомой версией. Предыдущая сборка (версия 0 с `migrate`) данные версии 1 читает:
 * забирает имя, тему, сетку и доску, а сессию без токена отбрасывает — после отката нужен вход.
 *
 * При изменении формы: увеличить версию и добавить шаг в `MIGRATION_STEPS`.
 */
export const APP_STORE_VERSION = 1

const DEFAULT_PERSISTED: PersistedAppState = {
  username: 'Аноним',
  currentBoardId: null,
  theme: { primary: 'violet', dark: false },
  dotGrid: true,
  workspace: null,
  participant: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTheme(value: unknown): value is Theme {
  return isRecord(value) && typeof value.primary === 'string' && typeof value.dark === 'boolean'
}

/** Сведения о команде без лишних полей (в частности, без токена из версии 0). */
function toWorkspaceSession(value: unknown): WorkspaceSession | null {
  if (
    !isRecord(value) ||
    typeof value.workspaceId !== 'string' ||
    typeof value.workspaceSlug !== 'string' ||
    typeof value.workspaceName !== 'string'
  ) {
    return null
  }
  return {
    workspaceId: value.workspaceId,
    workspaceSlug: value.workspaceSlug,
    workspaceName: value.workspaceName,
  }
}

function toParticipant(value: unknown): Participant | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string') {
    return null
  }
  return { id: value.id, name: value.name }
}

/**
 * Шаги миграции: ключ — версия, с которой шаг переводит состояние на следующую.
 */
const MIGRATION_STEPS: Record<
  number,
  (state: Record<string, unknown>) => Record<string, unknown>
> = {
  // 0 → 1: токен уходит из стора, участника ещё нет (его выдаст сервер при входе)
  0: (state) => ({
    ...state,
    workspace: toWorkspaceSession(state.workspace),
    participant: null,
  }),
}

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

  const workspace = toWorkspaceSession(stored.workspace)
  return {
    username: typeof stored.username === 'string' ? stored.username : DEFAULT_PERSISTED.username,
    currentBoardId:
      typeof stored.currentBoardId === 'string' ? stored.currentBoardId : DEFAULT_PERSISTED.currentBoardId,
    theme: isTheme(stored.theme) ? stored.theme : DEFAULT_PERSISTED.theme,
    dotGrid: typeof stored.dotGrid === 'boolean' ? stored.dotGrid : DEFAULT_PERSISTED.dotGrid,
    workspace,
    // Участник без команды — не сессия
    participant: workspace ? toParticipant(stored.participant) : null,
  }
}

function sameWorkspace(a: WorkspaceSession | null, b: WorkspaceSession): boolean {
  return (
    a !== null &&
    a.workspaceId === b.workspaceId &&
    a.workspaceSlug === b.workspaceSlug &&
    a.workspaceName === b.workspaceName
  )
}

function sameParticipant(a: Participant | null, b: Participant): boolean {
  return a !== null && a.id === b.id && a.name === b.name
}

const STORAGE_KEY = 'retroboard-app'

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      ...DEFAULT_PERSISTED,
      aiEnabled: null,
      _hasHydrated: false,

      setUsername: (name: string) => set({ username: name }),
      setCurrentBoard: (id: string) => set({ currentBoardId: id }),
      setTheme: (theme) => set({ theme }),
      setDotGrid: (enabled: boolean) => set({ dotGrid: enabled }),
      // Объекты не пересоздаются, если данные те же: на них завязаны эффекты и селекторы
      setSession: ({ workspace, participant }) =>
        set((state) => ({
          workspace: sameWorkspace(state.workspace, workspace) ? state.workspace : workspace,
          participant: sameParticipant(state.participant, participant)
            ? state.participant
            : participant,
          username: participant.name,
        })),
      setParticipant: (participant) =>
        set((state) => ({
          participant: sameParticipant(state.participant, participant)
            ? state.participant
            : participant,
          username: participant.name,
        })),
      setAiEnabled: (enabled) => set({ aiEnabled: enabled }),
      clearSession: () => set({ workspace: null, participant: null }),
      setHasHydrated: (hydrated: boolean) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: STORAGE_KEY,
      version: APP_STORE_VERSION,
      migrate: migratePersistedState,
      partialize: (state): PersistedAppState => ({
        username: state.username,
        currentBoardId: state.currentBoardId,
        theme: state.theme,
        dotGrid: state.dotGrid,
        workspace: state.workspace,
        participant: state.participant,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated?.(true)
      },
    },
  ),
)

/**
 * Принять сессию, записанную другой вкладкой.
 *
 * Cookie сессии одна на браузер, а стор у каждой вкладки свой. Без этого вкладка, где
 * открыта форма входа или прежний участник, не узнала бы, что в соседней вошли или вышли:
 * она считала бы себя одним участником, а её запросы сервер приписывал бы другому — свои
 * новые карточки выглядели бы чужими. Переносятся только команда и участник; тема, сетка
 * и текущая доска у вкладок остаются своими.
 */
export function syncSessionFromStorage(raw: string | null): void {
  if (raw === null) return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (!isRecord(parsed)) return
  const version = typeof parsed.version === 'number' ? parsed.version : 0
  const next = migratePersistedState(parsed.state, version)
  const current = useAppStore.getState()
  const sameSession =
    (next.participant?.id ?? null) === (current.participant?.id ?? null) &&
    (next.participant?.name ?? null) === (current.participant?.name ?? null) &&
    (next.workspace?.workspaceId ?? null) === (current.workspace?.workspaceId ?? null)
  if (sameSession) return
  useAppStore.setState({
    workspace: next.workspace,
    participant: next.participant,
    ...(next.participant ? { username: next.participant.name } : {}),
  })
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) syncSessionFromStorage(event.newValue)
  })
}
