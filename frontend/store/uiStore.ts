'use client'

import { create } from 'zustand'

interface UiState {
  boardsRefreshTick: number
  ownBoardDeletions: Set<string>
  healthCheckOpenTick: number
  shareDialogOpen: boolean
  requestBoardsRefresh: () => void
  markOwnBoardDeletion: (boardId: string) => void
  unmarkOwnBoardDeletion: (boardId: string) => void
  openHealthCheck: () => void
  setShareDialogOpen: (open: boolean) => void
}

/**
 * Единый стор UI-сигналов между несвязанными компонентами:
 * обновление списка досок, пометка собственного удаления, открытие окон здоровья и шаринга.
 */
export const useUiStore = create<UiState>()((set) => ({
  boardsRefreshTick: 0,
  ownBoardDeletions: new Set<string>(),
  healthCheckOpenTick: 0,
  shareDialogOpen: false,
  requestBoardsRefresh: () => set((s) => ({ boardsRefreshTick: s.boardsRefreshTick + 1 })),
  markOwnBoardDeletion: (boardId) =>
    set((s) => {
      const next = new Set(s.ownBoardDeletions)
      next.add(boardId)
      return { ownBoardDeletions: next }
    }),
  unmarkOwnBoardDeletion: (boardId) =>
    set((s) => {
      if (!s.ownBoardDeletions.has(boardId)) return s
      const next = new Set(s.ownBoardDeletions)
      next.delete(boardId)
      return { ownBoardDeletions: next }
    }),
  openHealthCheck: () => set((s) => ({ healthCheckOpenTick: s.healthCheckOpenTick + 1 })),
  setShareDialogOpen: (open) => set({ shareDialogOpen: open }),
}))

export function isOwnBoardDeletionInUiStore(boardId: string): boolean {
  return useUiStore.getState().ownBoardDeletions.has(boardId)
}
