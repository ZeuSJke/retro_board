'use client'

import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'

const QrPlaceholder = () => (
  <div className="h-full w-full animate-pulse bg-zinc-200" data-testid="qr-code-loading" />
)

// Кодировщик QR — отдельный чанк: он нужен только тем, кто открыл «Поделиться»
const QrCodeSvg = dynamic(() => import('./QrCodeSvg'), { ssr: false, loading: QrPlaceholder })

interface QrCodeProps {
  /** Ссылка для кода; пустая строка — ещё загружается, вместо кода показывается заглушка. */
  value: string
  label: string
  /** Размер задаёт вызывающий код шириной блока; блок всегда квадратный. */
  className?: string
}

/** QR-код ссылки в белой рамке — фон остаётся белым в обеих темах, чтобы код читался. */
export default function QrCode({ value, label, className }: QrCodeProps) {
  return (
    <div className={cn('aspect-square overflow-hidden rounded-xl border bg-white', className)}>
      {value ? <QrCodeSvg value={value} label={label} className="h-full w-full" /> : <QrPlaceholder />}
    </div>
  )
}
