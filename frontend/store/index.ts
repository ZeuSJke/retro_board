'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppStore, WorkspaceSession } from '../types'

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      username: 'Аноним',
      currentBoardId: null,
      theme: { primary: '#6750A4', dark: false },
      workspace: null,

      setUsername: (name: string) => set({ username: name }),
      setCurrentBoard: (id: string) => set({ currentBoardId: id }),
      setTheme: (theme) => set({ theme }),
      setWorkspace: (ws: WorkspaceSession | null) => set({ workspace: ws }),
    }),
    { name: 'retroboard-app' },
  ),
)
