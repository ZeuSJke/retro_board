'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '../store'
import { getBoards, createBoard } from '../api'

export default function HomePage() {
  const router = useRouter()
  const { currentBoardId } = useAppStore()

  useEffect(() => {
    ;(async () => {
      try {
        let list = await getBoards()
        if (list.length === 0) {
          const board = await createBoard('Моя первая ретро-доска')
          list = [board as unknown as (typeof list)[0]]
        }
        const target =
          currentBoardId && list.find((b) => b.id === currentBoardId)
            ? list.find((b) => b.id === currentBoardId)!
            : list[0]
        router.replace(`/board/${target.slug || target.id}`)
      } catch {
        // backend not available — stay on loading screen
      }
    })()
  }, [])

  return (
    <div style={centeredStyle}>
      <div style={spinnerStyle} />
      <p style={{ color: 'var(--md-on-surface-variant)', fontSize: 14 }}>
        Загрузка...
      </p>
    </div>
  )
}

const centeredStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  gap: 12,
}

const spinnerStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  border: '3px solid var(--md-outline-variant)',
  borderTopColor: 'var(--md-primary)',
  animation: 'spin 0.8s linear infinite',
}
