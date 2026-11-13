'use client'

import * as React from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

interface TabsMotionContextValue {
  activeValue?: string
  layoutId: string
}

const TabsMotionContext = React.createContext<TabsMotionContextValue | null>(null)

export const Tabs = React.forwardRef<
  React.ElementRef<typeof RadixTabs.Root>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Root>
>(function Tabs({ value, defaultValue, onValueChange, ...props }, ref) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue)
  const activeValue = value !== undefined ? value : uncontrolled
  const layoutId = React.useId()

  const handleValueChange = (next: string) => {
    if (value === undefined) setUncontrolled(next)
    onValueChange?.(next)
  }

  return (
    <TabsMotionContext.Provider value={{ activeValue, layoutId }}>
      <RadixTabs.Root
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        onValueChange={handleValueChange}
        {...props}
      />
    </TabsMotionContext.Provider>
  )
})

export const TabsList = React.forwardRef<
  React.ElementRef<typeof RadixTabs.List>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <RadixTabs.List
      ref={ref}
      className={cn(
        'relative isolate inline-flex h-9 items-center gap-1 rounded-xl bg-muted/80 p-1 text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
})

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof RadixTabs.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(function TabsTrigger({ className, children, value, ...props }, ref) {
  const ctx = React.useContext(TabsMotionContext)
  const hasMotionTracking = ctx?.activeValue !== undefined
  const isActive = hasMotionTracking && ctx.activeValue === value

  return (
    <RadixTabs.Trigger
      ref={ref}
      value={value}
      className={cn(
        'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground',
        !hasMotionTracking && 'data-[state=active]:bg-background data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    >
      {isActive && ctx && (
        <motion.span
          layoutId={`tabs-pill-${ctx.layoutId}`}
          transition={{ type: 'spring', stiffness: 450, damping: 34 }}
          className="pointer-events-none absolute inset-0 -z-10 rounded-lg bg-background shadow-sm"
          aria-hidden="true"
        />
      )}
      {children}
    </RadixTabs.Trigger>
  )
})

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof RadixTabs.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <RadixTabs.Content
      ref={ref}
      className={cn('mt-3 outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      {...props}
    />
  )
})
