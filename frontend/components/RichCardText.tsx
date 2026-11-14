'use client'

import React from 'react'
import { parseRichTextTokens } from '@/lib/rich-text'

interface RichCardTextProps {
  text: string
  className?: string
  onDoubleClick?: (e: React.MouseEvent) => void
}

export function RichCardText({ text, className, onDoubleClick }: RichCardTextProps) {
  const tokens = parseRichTextTokens(text)

  return (
    <span className={className} onDoubleClick={onDoubleClick}>
      {tokens.map((tok, idx) => {
        if (tok.type === 'code') {
          return (
            <code
              key={`c-${idx}`}
              className="rounded bg-muted/85 px-1 py-0.5 font-mono text-[0.88em] text-foreground"
            >
              {tok.value}
            </code>
          )
        }
        if (tok.type === 'bold') {
          return (
            <strong key={`b-${idx}`} className="font-semibold">
              {tok.value}
            </strong>
          )
        }
        if (tok.type === 'link') {
          return (
            <a
              key={`u-${idx}`}
              href={tok.href}
              target="_blank"
              rel="noopener noreferrer"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className="cursor-pointer break-all font-medium text-primary underline decoration-primary/60 decoration-[1.5px] underline-offset-2 transition-colors hover:decoration-primary"
            >
              {tok.label}
            </a>
          )
        }
        return <React.Fragment key={`t-${idx}`}>{tok.value}</React.Fragment>
      })}
    </span>
  )
}
