'use client'

import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { applyAccent, resolveInitialAccent } from '@/lib/board-themes'

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
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{
              className: 'font-sans',
            }}
          />
        </TooltipProvider>
      </ThemeProvider>
    </MotionConfig>
  )
}
