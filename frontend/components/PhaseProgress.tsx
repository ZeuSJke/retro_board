'use client'

import { CheckCircle2, Eye, Lightbulb, MessageSquare, Sparkles, Vote } from 'lucide-react'
import { motion } from 'motion/react'
import { PHASE_ORDER, type PhaseKey } from '@/hooks/useFacilitator'
import { cn } from '@/lib/utils'

const PHASE_META: Record<
  PhaseKey,
  { label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }> }
> = {
  brainstorm: { label: 'Штурм', shortLabel: 'Штурм', icon: Lightbulb },
  reveal: { label: 'Раскрытие', shortLabel: 'Показ', icon: Eye },
  discuss: { label: 'Обсуждение', shortLabel: 'Обсуж.', icon: MessageSquare },
  vote: { label: 'Голосование', shortLabel: 'Голос.', icon: Vote },
  summary: { label: 'Итоги', shortLabel: 'Итоги', icon: Sparkles },
}

interface PhaseProgressProps {
  phase: string | null
  isFacilitator: boolean
  onPhaseChange: (phase: string) => void
  className?: string
}

/**
 * Этапы сессии ведущего. Блок сам подстраивается под доступную ширину (container query):
 * когда места мало, подписи остаются только у текущего этапа, остальные сжимаются до значков —
 * панель сессии при этом не переносится на вторую строку.
 */
export default function PhaseProgress({
  phase,
  isFacilitator,
  onPhaseChange,
  className,
}: PhaseProgressProps) {
  const currentIdx = phase ? PHASE_ORDER.indexOf(phase as PhaseKey) : -1

  return (
    <nav aria-label="Этапы ретроспективы" className={cn('@container min-w-0', className)}>
      <div className="relative isolate flex items-center gap-1 overflow-x-auto">
        {PHASE_ORDER.map((key, idx) => {
          const meta = PHASE_META[key]
          const Icon = meta.icon
          const isCurrent = idx === currentIdx
          const isDone = currentIdx >= 0 && idx < currentIdx

          return (
            <button
              key={key}
              type="button"
              disabled={!isFacilitator}
              onClick={() => isFacilitator && onPhaseChange(key)}
              data-testid={`phase-step-${key}`}
              // Подпись может быть скрыта вёрсткой — название этапа остаётся в подсказке
              title={meta.label}
              aria-label={meta.label}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium transition-colors @[32rem]:px-2.5',
                isCurrent
                  ? 'text-primary-foreground'
                  : isDone
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-muted/70 text-muted-foreground',
                isFacilitator && !isCurrent && 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
                !isFacilitator && 'cursor-default',
              )}
            >
              {isCurrent && (
                <motion.span
                  layoutId="phase-active-pill"
                  transition={{ type: 'spring', stiffness: 430, damping: 32 }}
                  className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-primary shadow-xs"
                  aria-hidden="true"
                />
              )}
              {isDone ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Icon className="h-3.5 w-3.5 shrink-0" />
              )}
              {!isCurrent ? (
                <span className="hidden @[32rem]:inline">{meta.label}</span>
              ) : meta.shortLabel === meta.label ? (
                <span>{meta.label}</span>
              ) : (
                <>
                  <span className="hidden @[18rem]:inline">{meta.label}</span>
                  <span className="@[18rem]:hidden">{meta.shortLabel}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
