'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppStore } from '../types'

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      username: 'Аноним',
      currentBoardId: null,
      theme: { primary: '#6750A4', dark: false },

      setUsername: (name: string) => set({ username: name }),
      setCurrentBoard: (id: string) => set({ currentBoardId: id }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'retroboard-app' },
  ),
)
