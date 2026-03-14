'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAppStore = create(
  persist(
    (set) => ({
      username: 'Аноним',
      currentBoardId: null,
      theme: { primary: '#6750A4', dark: false },

      setUsername: (name) => set({ username: name }),
      setCurrentBoard: (id) => set({ currentBoardId: id }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'retroboard-app' },
  ),
)
