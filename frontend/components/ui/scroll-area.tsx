'use client'

import * as React from 'react'
import * as RadixScrollArea from '@radix-ui/react-scroll-area'
import { cn } from '@/lib/utils'

export const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof RadixScrollArea.Root>,
  React.ComponentPropsWithoutRef<typeof RadixScrollArea.Root>
>(function ScrollArea({ className, children, ...props }, ref) {
  return (
    <RadixScrollArea.Root
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <RadixScrollArea.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </RadixScrollArea.Viewport>
      <RadixScrollArea.Scrollbar
        orientation="vertical"
        className="flex touch-none select-none p-0.5 transition-colors w-2"
      >
        <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
      </RadixScrollArea.Scrollbar>
      <RadixScrollArea.Scrollbar
        orientation="horizontal"
        className="flex touch-none select-none p-0.5 transition-colors h-2 flex-col"
      >
        <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
      </RadixScrollArea.Scrollbar>
      <RadixScrollArea.Corner />
    </RadixScrollArea.Root>
  )
})
