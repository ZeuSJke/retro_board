'use client'

import { useState, useEffect, useRef } from 'react'
import type { TimerState } from '../types'
import styles from './TimerWidget.module.css'

const PRESETS = [
  { label: '5 мин', value: 300 },
  { label: '10 мин', value: 600 },
  { label: '15 мин', value: 900 },
  { label: '20 мин', value: 1200 },
]

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

interface TimerWidgetProps {
  timerState: TimerState
  onStart: (duration: number, remaining: number) => void
  onPause: () => void
  onReset: (duration: number) => void
}

export default function TimerWidget({ timerState, onStart, onPause, onReset }: TimerWidgetProps) {
  const { duration, remaining, running } = timerState
  const [expanded, setExpanded] = useState(false)
  const [selectedDuration, setSelectedDuration] = useState(duration)
  const pillRef = useRef<HTMLButtonElement>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null)
  const finished = remaining <= 0 && !running && duration > 0

  const [flash, setFlash] = useState(false)
  const prevRunning = useRef(running)
  useEffect(() => {
    if (prevRunning.current && !running && remaining <= 0) {
      setFlash(true)
      setTimeout(() => setFlash(false), 2000)
    }
    prevRunning.current = running
  }, [running, remaining])

  const progress = duration > 0 ? remaining / duration : 1
  const pct = Math.round(progress * 100)

  const color =
    pct > 50
      ? `hsl(${120 * ((pct - 50) / 50)}, 70%, 42%)`
      : `hsl(${(pct / 50) * 60}, 80%, 42%)`

  const handleStart = () => {
    const dur = running ? duration : selectedDuration
    const rem = running ? remaining : selectedDuration
    onStart(dur, rem)
  }

  const handleReset = () => {
    onReset(selectedDuration)
    setExpanded(true)
  }

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.pill}
        style={{
          background: running
            ? `color-mix(in srgb, ${color} 15%, var(--md-surface-variant))`
            : finished
              ? 'color-mix(in srgb, #BA1A1A 12%, var(--md-surface-variant))'
              : 'var(--md-surface-variant)',
          color: running ? color : 'var(--md-on-surface-variant)',
          animation: flash ? 'pillGlow 0.45s ease-in-out 4' : 'none',
        }}
        ref={pillRef}
        onClick={() => {
          if (!expanded && pillRef.current) {
            const rect = pillRef.current.getBoundingClientRect()
            setPanelPos({
              top: rect.bottom + 8,
              right: Math.max(8, window.innerWidth - rect.right),
            })
          }
          setExpanded((v) => !v)
        }}
        title="Таймер"
      >
        <span
          className="material-symbols-rounded"
          style={{
            fontSize: 16,
            animation: flash ? 'iconRing 0.45s ease-in-out 4' : 'none',
            display: 'inline-block',
          }}
        >
          {running ? 'timer' : finished ? 'alarm_on' : 'timer'}
        </span>
        <span className={styles.pillTime}>{fmt(remaining)}</span>
        {running && (
          <span
            className={styles.dot}
            style={{
              background: color,
              animation: 'blink 1s step-start infinite',
            }}
          />
        )}
      </button>

      {expanded && panelPos && (
        <div
          className={styles.panel}
          style={{ position: 'fixed', top: panelPos.top, right: panelPos.right }}
        >
          <div className={styles.panelHeader}>
            <span
              className="material-symbols-rounded"
              style={{ fontSize: 18, color: 'var(--md-primary)' }}
            >
              timer
            </span>
            <span className={styles.panelTitle}>Таймер</span>
            <button className={styles.closeBtn} onClick={() => setExpanded(false)}>
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                close
              </span>
            </button>
          </div>

          <div className={styles.countdown}>
            <svg width="120" height="120" style={{ transform: 'rotate(-90deg)' }}>
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="var(--md-outline-variant)"
                strokeWidth="6"
              />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke={finished ? '#BA1A1A' : running ? color : 'var(--md-outline-variant)'}
                strokeWidth="6"
                strokeDasharray={`${2 * Math.PI * 52}`}
                strokeDashoffset={`${2 * Math.PI * 52 * (1 - progress)}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.5s' }}
              />
            </svg>
            <div className={styles.countdownText}>
              <span
                className={styles.countdownTime}
                style={{
                  color: finished ? '#BA1A1A' : running ? color : 'var(--md-on-surface)',
                }}
              >
                {fmt(remaining)}
              </span>
              {finished && <span className={styles.finishedLabel}>Время вышло!</span>}
            </div>
          </div>

          {!running && (
            <div className={styles.presets}>
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  className={styles.presetBtn}
                  style={{
                    background:
                      selectedDuration === p.value
                        ? 'var(--md-primary-container)'
                        : 'var(--md-surface-variant)',
                    color:
                      selectedDuration === p.value
                        ? 'var(--md-on-primary-container)'
                        : 'var(--md-on-surface-variant)',
                    fontWeight: selectedDuration === p.value ? 700 : 500,
                  }}
                  onClick={() => {
                    setSelectedDuration(p.value)
                    onReset(p.value)
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          <div className={styles.controls}>
            <button
              className={styles.primaryBtn}
              style={{
                background: running ? 'var(--md-secondary-container)' : 'var(--md-primary)',
                color: running
                  ? 'var(--md-on-secondary-container)'
                  : 'var(--md-on-primary)',
              }}
              onClick={running ? onPause : handleStart}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                {running ? 'pause' : 'play_arrow'}
              </span>
              {running ? 'Пауза' : 'Старт'}
            </button>
            <button className={styles.secondaryBtn} onClick={handleReset}>
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                restart_alt
              </span>
              Сброс
            </button>
          </div>

          {running && (
            <div className={styles.syncNote}>
              <span className="material-symbols-rounded" style={{ fontSize: 12 }}>
                sync
              </span>
              Синхронизован для всех
            </div>
          )}
        </div>
      )}
    </div>
  )
}
