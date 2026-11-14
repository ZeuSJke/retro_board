'use client'

import { useEffect, useState, type ComponentProps } from 'react'
import dynamic from 'next/dynamic'
import type CommandPalette from './CommandPalette'

const loadCommandPalette = () => import('./CommandPalette')

const CommandPaletteImpl = dynamic(loadCommandPalette, { ssr: false })

type LazyCommandPaletteProps = Omit<ComponentProps<typeof CommandPalette>, 'open' | 'onOpenChange'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Палитра команд (cmdk) отдельным чанком: в первую загрузку доски она не входит.
 *
 * Чанк подтягивается в простое после загрузки страницы или при первом открытии — что случится
 * раньше. До этого Ctrl/Cmd+K слушает эта обёртка (иначе до загрузки чанка сочетание уходило бы
 * в браузер), после монтирования палитры — она сама, как и раньше.
 */
export default function LazyCommandPalette(props: LazyCommandPaletteProps) {
  const { open, onOpenChange } = props
  const [activated, setActivated] = useState(open)
  if (open && !activated) setActivated(true)

  useEffect(() => {
    if (activated) return

    const warmUp = () => void loadCommandPalette().catch(() => {})
    const idleId =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(warmUp, { timeout: 4000 })
        : undefined
    const timerId = idleId === undefined ? window.setTimeout(warmUp, 2000) : undefined

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
        e.preventDefault()
        onOpenChange(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (idleId !== undefined) window.cancelIdleCallback(idleId)
      if (timerId !== undefined) window.clearTimeout(timerId)
    }
  }, [activated, onOpenChange])

  return activated ? <CommandPaletteImpl {...props} /> : null
}
