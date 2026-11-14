'use client'

import { useMemo } from 'react'
import { encode } from 'uqr'

export interface QrCodeSvgProps {
  /** Текст, зашитый в код (ссылка). */
  value: string
  /** Что это за код — для экранных дикторов. */
  label: string
  className?: string
}

/** Тихая зона вокруг кода в модулях: по стандарту QR — четыре. */
const QUIET_ZONE = 4

/**
 * Контур тёмных модулей одной SVG-линией: соседние по строке модули сливаются
 * в один прямоугольник, поэтому между ними нет щелей при любом масштабе.
 */
export function buildQrPath(value: string): { size: number; path: string } | null {
  let matrix: boolean[][]
  try {
    // Уровень M восстанавливает до 15% потерь — достаточно для экрана и проектора
    matrix = encode(value, { ecc: 'M', border: QUIET_ZONE }).data
  } catch {
    // Текст не помещается в QR-код
    return null
  }

  const segments: string[] = []
  matrix.forEach((row, y) => {
    let runStart = -1
    for (let x = 0; x <= row.length; x++) {
      const dark = x < row.length && row[x]
      if (dark && runStart < 0) runStart = x
      if (!dark && runStart >= 0) {
        segments.push(`M${runStart} ${y}h${x - runStart}v1h${runStart - x}z`)
        runStart = -1
      }
    }
  })
  return { size: matrix.length, path: segments.join('') }
}

/**
 * QR-код как встроенный SVG: рисуется в браузере, без картинок и внешних сервисов
 * (CSP `img-src 'self' data:`). Всегда чёрный на белом — так его читает любая камера
 * и в тёмной теме.
 *
 * Подключайте через `QrCode`: он подгружает этот модуль вместе с библиотекой по требованию.
 */
export default function QrCodeSvg({ value, label, className }: QrCodeSvgProps) {
  const qr = useMemo(() => buildQrPath(value), [value])

  if (!qr) {
    return (
      <div
        role="img"
        aria-label={label}
        className="flex h-full w-full items-center justify-center p-4 text-center text-xs text-zinc-600"
      >
        Ссылка слишком длинная для QR-кода
      </div>
    )
  }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      className={className}
      data-testid="qr-code"
    >
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <path d={qr.path} fill="#000000" />
    </svg>
  )
}
