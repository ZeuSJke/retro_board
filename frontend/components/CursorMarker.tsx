'use client'

import { memo, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { userColor } from '@/utils/theme'
import type { CursorPos } from '@/hooks/useBoardWebSocket'

interface CursorMarkerProps {
  /** Идентификатор участника: ключ курсора в `posRef` и зерно цвета (у тёзок цвета разные). */
  cursorId: string
  /** Подпись курсора — имя участника. */
  username: string
  posRef: React.RefObject<Record<string, CursorPos>>
  subscribeCursors?: (cb: () => void) => () => void
}

export default memo(function CursorMarker({
  cursorId,
  username,
  posRef,
  subscribeCursors,
}: CursorMarkerProps) {
  const color = userColor(cursorId)
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

    function scheduleTick() {
      if (!running || rafRef.current !== 0) return
      rafRef.current = requestAnimationFrame(tick)
    }

    function tick() {
      rafRef.current = 0
      if (!running) return
      const pos = posRef.current?.[cursorId]
      const el = nodeRef.current
      let needsAnotherFrame = false
      if (el && pos) {
        const s = smoothRef.current
        if (!s.initialized) {
          s.x = pos.x
          s.y = pos.y
          s.initialized = true
          s.tilt = 0
        } else {
          const dx = pos.x - s.x
          const dy = pos.y - s.y
          if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25 && Math.abs(s.tilt) < 0.25) {
            s.x = pos.x
            s.y = pos.y
            s.tilt = 0
          } else {
            s.x += dx * 0.28
            s.y += dy * 0.28
            const targetTilt = Math.max(-10, Math.min(10, dx * 0.35))
            s.tilt += (targetTilt - s.tilt) * 0.2
            needsAnotherFrame = true
          }
        }
        el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`
        if (arrowRef.current) {
          arrowRef.current.style.transform = `rotate(${s.tilt.toFixed(1)}deg)`
        }
      }
      if (needsAnotherFrame || !subscribeCursors) {
        scheduleTick()
      }
    }

    scheduleTick()
    const unsubscribe = subscribeCursors?.(() => scheduleTick())
    return () => {
      running = false
      unsubscribe?.()
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [cursorId, posRef, subscribeCursors])

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
          className="absolute left-3.5 top-4 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-md ring-1 ring-black/20"
          // Подпись того же цвета, что и стрелка: по нему различаются курсоры тёзок
          style={{ backgroundColor: color, textShadow: '0 1px 2px rgb(0 0 0 / 0.45)' }}
        >
          {username}
        </div>
      </motion.div>
    </div>
  )
})
