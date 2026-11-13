'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'

interface BrandMarkProps {
  size?: number
  className?: string
}

/**
 * Geometric SVG brand mark for RetroBoard ("Веер цветных карточек").
 * Crisp at favicon, toolbar, and hero scales across both light and dark themes.
 */
export function BrandMark({ size = 32, className }: BrandMarkProps) {
  const uid = useId().replace(/:/g, '')
  const bgId = `rb-bg-${uid}`
  const shadowId = `rb-shadow-${uid}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0 select-none drop-shadow-sm', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bgId} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1B1E5E" />
          <stop offset="100%" stopColor="#11133E" />
        </linearGradient>
        <filter id={shadowId} x="-15%" y="-15%" width="135%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.6" floodColor="#090A24" floodOpacity="0.35" />
        </filter>
      </defs>
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="16"
        fill={`url(#${bgId})`}
        stroke="#FFFFFF"
        strokeOpacity="0.14"
        strokeWidth="1.2"
      />
      <g transform="translate(1, 0.5)">
        <rect x="19" y="19" width="24" height="22" rx="4.2" transform="rotate(-31 28 41)" fill="#10B981" />
        <rect
          x="22"
          y="21"
          width="24"
          height="22"
          rx="4.2"
          transform="rotate(-15 28 41)"
          fill="#F59E0B"
          filter={`url(#${shadowId})`}
        />
        <rect x="25" y="25" width="26" height="23" rx="4.5" fill="#FFFFFF" filter={`url(#${shadowId})`} />
      </g>
    </svg>
  )
}

interface BrandLogoProps {
  markSize?: number
  subtitle?: string
  className?: string
}

export function BrandLogo({ markSize = 36, subtitle, className }: BrandLogoProps) {
  return (
    <div className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <BrandMark size={markSize} />
      <div className="flex flex-col leading-tight">
        <span className="text-base font-bold tracking-tight text-foreground">RetroBoard</span>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
      </div>
    </div>
  )
}
