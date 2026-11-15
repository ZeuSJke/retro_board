'use client'

import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { ThemeProvider, useTheme } from 'next-themes'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { applyAccent, resolveInitialAccent } from '@/lib/board-themes'

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
  useEffect(() => {
    applyAccent(resolveInitialAccent())
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
        storageKey="retro_theme_mode"
      >
        <TooltipProvider delayDuration={250}>
          {children}
          <ThemedToaster />
        </TooltipProvider>
      </ThemeProvider>
    </MotionConfig>
  )
}
