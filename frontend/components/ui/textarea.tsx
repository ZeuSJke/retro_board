'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Автоматически подстраивает высоту под содержимое без внутреннего скролла */
  autoResize?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoResize = false, onChange, onInput, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null)

    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      },
      [forwardedRef],
    )

    const syncHeight = React.useCallback(() => {
      const el = innerRef.current
      if (!el || !autoResize) return
      el.style.height = 'auto'
      if (el.scrollHeight > 0) {
        el.style.height = `${el.scrollHeight}px`
      }
    }, [autoResize])

    React.useLayoutEffect(() => {
      syncHeight()
    }, [syncHeight, props.value, props.defaultValue])

    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          autoResize && 'resize-none overflow-hidden',
          className,
        )}
        ref={setRefs}
        onChange={(e) => {
          syncHeight()
          onChange?.(e)
        }}
        onInput={(e) => {
          syncHeight()
          onInput?.(e)
        }}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }
