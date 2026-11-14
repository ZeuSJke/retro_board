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
}

export default function PhaseProgress({
  phase,
  isFacilitator,
  onPhaseChange,
}: PhaseProgressProps) {
  const currentIdx = phase ? PHASE_ORDER.indexOf(phase as PhaseKey) : -1

  return (
    <nav aria-label="Этапы ретроспективы" className="relative isolate flex items-center gap-1 overflow-x-auto">
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
            className={cn(
              'relative inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap',
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
            <span className="hidden sm:inline">{meta.label}</span>
            <span className="sm:hidden">{meta.shortLabel}</span>
          </button>
        )
      })}
    </nav>
  )
}
