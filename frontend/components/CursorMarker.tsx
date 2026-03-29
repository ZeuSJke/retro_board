'use client'

import { memo, useRef, useEffect } from 'react'
import { userColor } from '../utils/theme'
import type { CursorPos } from '../hooks/useBoardWebSocket'

interface CursorMarkerProps {
  username: string
  posRef: React.RefObject<Record<string, CursorPos>>
}

export default memo(function CursorMarker({ username, posRef }: CursorMarkerProps) {
  const color = userColor(username)
  const nodeRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    let running = true

    function tick() {
      if (!running) return
      const pos = posRef.current?.[username]
      const el = nodeRef.current
      if (el && pos) {
        el.style.transform = `translate(${pos.x}px, ${pos.y}px)`
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [username, posRef])

  return (
    <div
      ref={nodeRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        zIndex: 500,
        willChange: 'transform',
        userSelect: 'none',
      }}
    >
      <svg
        width="20"
        height="24"
        viewBox="0 0 20 24"
        fill="none"
        style={{
          display: 'block',
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))',
        }}
      >
        <path
          d="M2 2L2 18L6.5 13L11 22L13.5 20.8L9 12L15 12L2 2Z"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 18,
          left: 14,
          background: color,
          color: 'white',
          borderRadius: 10,
          padding: '2px 8px',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "'Roboto', sans-serif",
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
          letterSpacing: 0.2,
        }}
      >
        {username}
      </div>
    </div>
  )
})
