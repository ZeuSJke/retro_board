'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppStore, WorkspaceSession } from '../types'

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      username: 'Аноним',
      currentBoardId: null,
      theme: { primary: 'violet', dark: false },
      dotGrid: true,
      workspace: null,
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
      partialize: (state) => ({
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
