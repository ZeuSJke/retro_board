'use client'

import { memo } from 'react'
import styles from './PhaseProgress.module.css'

const PHASES = [
  { key: 'brainstorm', label: 'Штурм', icon: 'edit_note' },
  { key: 'reveal', label: 'Обзор', icon: 'visibility' },
  { key: 'discuss', label: 'Дискуссия', icon: 'forum' },
  { key: 'vote', label: 'Голосование', icon: 'how_to_vote' },
  { key: 'summary', label: 'Итоги', icon: 'summarize' },
]

interface PhaseProgressProps {
  phase: string | null
  isFacilitator: boolean
  onPhaseChange?: (phase: string) => void
}

export default memo(function PhaseProgress({ phase, isFacilitator, onPhaseChange }: PhaseProgressProps) {
  if (!phase) return null

  const currentIdx = PHASES.findIndex((p) => p.key === phase)

  return (
    <div className={styles.container}>
      {PHASES.map((p, idx) => {
        const isDone = idx < currentIdx
        const isCurrent = idx === currentIdx
        const isFuture = idx > currentIdx
        const clickable = isFacilitator && !isCurrent

        return (
          <div key={p.key} className={styles.step}>
            {/* Connector line before step (not for first) */}
            {idx > 0 && (
              <div
                className={`${styles.connector} ${isDone || isCurrent ? styles.connectorDone : ''}`}
              />
            )}

            <button
              className={`${styles.node} ${
                isCurrent
                  ? styles.nodeCurrent
                  : isDone
                    ? styles.nodeDone
                    : styles.nodeFuture
              } ${clickable ? styles.nodeClickable : ''}`}
              onClick={clickable ? () => onPhaseChange?.(p.key) : undefined}
              disabled={!clickable}
              title={
                clickable
                  ? `Переключить на: ${p.label}`
                  : isCurrent
                    ? `Текущая фаза: ${p.label}`
                    : p.label
              }
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                {isDone ? 'check' : p.icon}
              </span>
            </button>

            <span
              className={`${styles.label} ${
                isCurrent
                  ? styles.labelCurrent
                  : isDone
                    ? styles.labelDone
                    : styles.labelFuture
              }`}
            >
              {p.label}
            </span>
          </div>
        )
      })}
    </div>
  )
})
