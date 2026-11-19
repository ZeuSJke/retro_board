'use client'

import { useEffect, useRef, useState } from 'react'
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { ThemeProvider, useTheme } from 'next-themes'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { applyAccent, resolveInitialAccent } from '@/lib/board-themes'
import { makeQueryClient } from '@/lib/query-client'
import { useAppStore } from '@/store'

/** Сбрасывает кэш React Query при выходе или переключении команды, чтобы данные разных команд не смешивались. */
function QueryCacheSessionSync() {
  const queryClient = useQueryClient()
  const workspaceId = useAppStore((s) => s.workspace?.workspaceId ?? null)
  const prevWorkspaceRef = useRef<string | null>(workspaceId)

  useEffect(() => {
    if (prevWorkspaceRef.current !== workspaceId) {
      prevWorkspaceRef.current = workspaceId
      queryClient.clear()
    }
  }, [workspaceId, queryClient])

  return null
}

/** Уведомления в цветах текущей темы: без этого в тёмной теме они оставались светлыми. */
function ThemedToaster() {
  const { resolvedTheme } = useTheme()
  return (
    <Toaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        className: 'font-sans',
      }}
    />
  )
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient())

  useEffect(() => {
    applyAccent(resolveInitialAccent())
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <QueryCacheSessionSync />
      <MotionConfig reducedMotion="user">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="retro_theme_mode"
        >
          <TooltipProvider delayDuration={250}>
            {children}
            <ThemedToaster />
          </TooltipProvider>
        </ThemeProvider>
      </MotionConfig>
    </QueryClientProvider>
  )
}
