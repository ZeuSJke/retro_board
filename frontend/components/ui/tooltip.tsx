'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const InsideTooltipProviderContext = React.createContext(false)

function TooltipProvider({
  children,
  delayDuration = 250,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) {
  return (
    <InsideTooltipProviderContext.Provider value={true}>
      <TooltipPrimitive.Provider delayDuration={delayDuration} {...props}>
        {children}
      </TooltipPrimitive.Provider>
    </InsideTooltipProviderContext.Provider>
  )
}

function Tooltip({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>) {
  const hasProvider = React.useContext(InsideTooltipProviderContext)
  const root = <TooltipPrimitive.Root {...props}>{children}</TooltipPrimitive.Root>

  // Fallback for isolated component tests rendered outside <TooltipProvider>
  if (hasProvider) return root
  return <TooltipPrimitive.Provider delayDuration={250}>{root}</TooltipPrimitive.Provider>
}

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding = 12, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        'z-50 max-w-[260px] whitespace-normal break-words overflow-hidden rounded-lg bg-foreground px-2.5 py-1.5 text-left text-xs leading-snug text-background shadow-md animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
