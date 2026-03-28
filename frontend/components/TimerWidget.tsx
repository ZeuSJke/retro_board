'use client'

import { useState, useEffect, useRef } from 'react'
import type { TimerState } from '../types'
import styles from './TimerWidget.module.css'

const PRESETS = [
  { label: '2 мин', value: 120 },
  { label: '5 мин', value: 300 },
  { label: '10 мин', value: 600 },
  { label: '15 мин', value: 900 },
]

const PHASE_LABELS: Record<string, string> = {
  brainstorm: 'Мозговой штурм',
  reveal: 'Обсуждение',
  discuss: 'Дискуссия',
  vote: 'Голосование',
}

const PHASE_ORDER = ['brainstorm', 'reveal', 'discuss', 'vote']

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function parseTime(str: string): number | null {
  const parts = str.split(':')
  if (parts.length !== 2) return null
  const m = parseInt(parts[0], 10)
  const s = parseInt(parts[1], 10)
  if (isNaN(m) || isNaN(s) || m < 0 || s < 0 || s > 59) return null
  const total = m * 60 + s
  return total > 0 ? total : null
}

interface TimerWidgetProps {
  timerState: TimerState
  onStart: (duration: number, remaining: number) => void
  onPause: () => void
  onReset: (duration: number) => void
  readOnly?: boolean
  phase?: string | null
  autoAdvance?: boolean
  onAutoAdvanceChange?: (value: boolean) => void
  onNextPhase?: () => void
}

export default function TimerWidget({
  timerState,
  onStart,
  onPause,
  onReset,
  readOnly = false,
  phase,
  autoAdvance = false,
  onAutoAdvanceChange,
  onNextPhase,
}: TimerWidgetProps) {
  const { duration, remaining, running } = timerState
  const [expanded, setExpanded] = useState(false)
  const [selectedDuration, setSelectedDuration] = useState(duration)
  const [customTime, setCustomTime] = useState('')
  const [editingTime, setEditingTime] = useState(false)
  const pillRef = useRef<HTMLButtonElement>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null)
  const paused = !running && remaining > 0 && remaining < duration
  const finished = remaining <= 0 && !running && duration > 0

  const [flash, setFlash] = useState(false)
  const prevRunning = useRef(running)
  const autoAdvanceFired = useRef(false)

  useEffect(() => {
    if (prevRunning.current && !running && remaining <= 0) {
      setFlash(true)
      setTimeout(() => setFlash(false), 2000)

      // Auto-advance to next phase
      if (autoAdvance && onNextPhase && !autoAdvanceFired.current) {
        autoAdvanceFired.current = true
        // Small delay so user sees "Время вышло!" before phase switch
        setTimeout(() => {
          onNextPhase()
          autoAdvanceFired.current = false
        }, 1500)
      }
    }
    prevRunning.current = running
  }, [running, remaining, autoAdvance, onNextPhase])

  // Reset autoAdvanceFired when timer starts again
  useEffect(() => {
    if (running) autoAdvanceFired.current = false
  }, [running])

  const progress = duration > 0 ? remaining / duration : 1
  const pct = Math.round(progress * 100)

  const color =
    pct > 50
      ? `hsl(${120 * ((pct - 50) / 50)}, 70%, 42%)`
      : `hsl(${(pct / 50) * 60}, 80%, 42%)`

  const handleStart = () => {
    if (paused) {
      // Resume from current remaining time
      onStart(duration, remaining)
    } else {
      onStart(selectedDuration, selectedDuration)
    }
  }

  const handleReset = () => {
    onReset(selectedDuration)
    setExpanded(true)
  }

  const commitCustomTime = () => {
    setEditingTime(false)
    const secs = parseTime(customTime)
    if (secs) {
      setSelectedDuration(secs)
      onReset(secs)
    }
  }

  const nextPhaseLabel = phase
    ? PHASE_LABELS[PHASE_ORDER[PHASE_ORDER.indexOf(phase) + 1]] || null
    : null
  const isLastPhase = phase ? PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.length - 1 : true

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.pill}
        style={{
          background: running
            ? `color-mix(in srgb, ${color} 15%, var(--md-surface-variant))`
            : paused
              ? `color-mix(in srgb, ${color} 10%, var(--md-surface-variant))`
              : finished
                ? 'color-mix(in srgb, #BA1A1A 12%, var(--md-surface-variant))'
                : 'var(--md-surface-variant)',
          color: running || paused ? color : 'var(--md-on-surface-variant)',
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
          {running ? 'timer' : paused ? 'pause_circle' : finished ? 'alarm_on' : 'timer'}
        </span>
        <span className={`${styles.pillTime} ${paused ? styles.pillTimePaused : ''}`}>{fmt(remaining)}</span>
        {paused && (
          <span
            className={styles.dot}
            style={{
              background: color,
              animation: 'blink 1.5s ease-in-out infinite',
            }}
          />
        )}
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
            <span className={styles.panelTitle}>
              Таймер
              {phase && (
                <span className={styles.phaseLabel}>
                  {' · '}{PHASE_LABELS[phase] || phase}
                </span>
              )}
            </span>
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
                stroke={finished ? '#BA1A1A' : running || paused ? color : 'var(--md-outline-variant)'}
                opacity={paused ? 0.5 : 1}
                strokeWidth="6"
                strokeDasharray={`${2 * Math.PI * 52}`}
                strokeDashoffset={`${2 * Math.PI * 52 * (1 - progress)}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.5s' }}
              />
            </svg>
            <div className={styles.countdownText}>
              <span
                className={`${styles.countdownTime} ${paused ? styles.countdownTimePaused : ''}`}
                style={{
                  color: finished ? '#BA1A1A' : running || paused ? color : 'var(--md-on-surface)',
                }}
              >
                {fmt(remaining)}
              </span>
              {paused && <span className={styles.pausedLabel}>Пауза</span>}
              {finished && <span className={styles.finishedLabel}>Время вышло!</span>}
            </div>
          </div>

          {!readOnly && !running && !paused && (
            <>
              <div className={styles.presets}>
                {PRESETS.map((p) => (
                  <button
                    key={p.value}
                    className={styles.presetBtn}
                    style={{
                      background:
                        selectedDuration === p.value && !editingTime
                          ? 'var(--md-primary-container)'
                          : 'var(--md-surface-variant)',
                      color:
                        selectedDuration === p.value && !editingTime
                          ? 'var(--md-on-primary-container)'
                          : 'var(--md-on-surface-variant)',
                      fontWeight: selectedDuration === p.value && !editingTime ? 700 : 500,
                    }}
                    onClick={() => {
                      setSelectedDuration(p.value)
                      setEditingTime(false)
                      onReset(p.value)
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Custom time input */}
              <div className={styles.customTime}>
                {editingTime ? (
                  <input
                    className={styles.timeInput}
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    onBlur={commitCustomTime}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitCustomTime()
                      if (e.key === 'Escape') setEditingTime(false)
                    }}
                    placeholder="MM:SS"
                    maxLength={5}
                    autoFocus
                  />
                ) : (
                  <button
                    className={styles.customTimeBtn}
                    onClick={() => {
                      setCustomTime(fmt(selectedDuration))
                      setEditingTime(true)
                    }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                      edit
                    </span>
                    {fmt(selectedDuration)}
                  </button>
                )}
              </div>
            </>
          )}

          {!readOnly && (
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
          )}

          {/* Auto-advance toggle (only for facilitator with active phase) */}
          {!readOnly && phase && !isLastPhase && (
            <label className={styles.autoAdvance}>
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={(e) => onAutoAdvanceChange?.(e.target.checked)}
                className={styles.checkbox}
              />
              <span className={styles.autoAdvanceText}>
                Автопереход
                {nextPhaseLabel && (
                  <span className={styles.nextPhase}> → {nextPhaseLabel}</span>
                )}
              </span>
            </label>
          )}

          {(running || paused) && (
            <div className={styles.syncNote}>
              <span className="material-symbols-rounded" style={{ fontSize: 12 }}>
                {paused ? 'pause' : 'sync'}
              </span>
              {paused
                ? 'На паузе · нажмите Старт для продолжения'
                : readOnly ? 'Управляет ведущий' : 'Синхронизован для всех'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
