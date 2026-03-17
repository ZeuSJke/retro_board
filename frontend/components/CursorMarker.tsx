'use client'

import { userColor } from '../utils/theme'

interface CursorMarkerProps {
  username: string
  x: number
  y: number
}

export default function CursorMarker({ username, x, y }: CursorMarkerProps) {
  const color = userColor(username)
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        pointerEvents: 'none',
        zIndex: 500,
        transition: 'left 0.08s linear, top 0.08s linear',
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
}
