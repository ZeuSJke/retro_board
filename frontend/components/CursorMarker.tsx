'use client'

import { memo, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
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
  const arrowRef = useRef<SVGSVGElement>(null)
  const smoothRef = useRef<{ x: number; y: number; initialized: boolean; tilt: number }>({
    x: 0,
    y: 0,
    initialized: false,
    tilt: 0,
  })
  const rafRef = useRef<number>(0)

  useEffect(() => {
    let running = true

    function tick() {
      if (!running) return
      const pos = posRef.current?.[username]
      const el = nodeRef.current
      if (el && pos) {
        const s = smoothRef.current
        if (!s.initialized) {
          s.x = pos.x
          s.y = pos.y
          s.initialized = true
        } else {
          const dx = pos.x - s.x
          const dy = pos.y - s.y
          s.x += dx * 0.28
          s.y += dy * 0.28
          // Лёгкий естественный наклон стрелки по горизонтальной скорости
          const targetTilt = Math.max(-10, Math.min(10, dx * 0.35))
          s.tilt += (targetTilt - s.tilt) * 0.2
        }
        el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`
        if (arrowRef.current) {
          arrowRef.current.style.transform = `rotate(${s.tilt.toFixed(1)}deg)`
        }
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
      <motion.div
        initial={{ opacity: 0, scale: 0.65 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.7 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <svg
          ref={arrowRef}
          width="20"
          height="24"
          viewBox="0 0 20 24"
          fill="none"
          className="block origin-top-left drop-shadow-xs"
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
      </motion.div>
    </div>
  )
})
