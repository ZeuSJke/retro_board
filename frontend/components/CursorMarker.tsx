'use client'

import { memo, useEffect, useRef } from 'react'
import { getUserAvatarGradient } from '@/lib/board-themes'
import { userColor } from '@/utils/theme'
import type { CursorPos } from '@/hooks/useBoardWebSocket'

interface CursorMarkerProps {
  username: string
  posRef: React.RefObject<Record<string, CursorPos>>
}

export default memo(function CursorMarker({ username, posRef }: CursorMarkerProps) {
  const color = userColor(username)
  const gradient = getUserAvatarGradient(username)
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
      className="pointer-events-none absolute left-0 top-0 z-40 select-none will-change-transform"
    >
      <svg
        width="20"
        height="24"
        viewBox="0 0 20 24"
        fill="none"
        className="block drop-shadow-sm"
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
        className="absolute left-3.5 top-4 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-md"
        style={{ background: gradient }}
      >
        {username}
      </div>
    </div>
  )
})
