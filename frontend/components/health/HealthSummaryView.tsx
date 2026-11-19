'use client'

import { Star, Users } from 'lucide-react'
import type { HealthAnswerValue, HealthQuestionSummary, HealthSummary, RotiValue } from '@/types/health'
import { cn } from '@/lib/utils'
import { formatAverage, pluralRu } from '@/components/dashboard/format'
import { Button } from '@/components/ui/button'
import { HEALTH_OPTIONS, ROTI_MAX, TONE_CLASSES } from './scale'

function QuestionRow({
  question,
  mine,
}: {
  question: HealthQuestionSummary
  mine: HealthAnswerValue | undefined
}) {
  const counts = HEALTH_OPTIONS.map((option) => ({
    option,
    // Поля сводки названы цветами светофора: red / yellow / green
    count: question[option.tone] ?? 0,
  }))
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  const myOption = HEALTH_OPTIONS.find((option) => option.value === mine)
  const description =
    total === 0
      ? `${question.title}: ответов нет`
      : `${question.title}: ${counts
          .map((item) => `${item.option.label.toLowerCase()} — ${item.count}`)
          .join(', ')}`

  return (
    <li className="space-y-1.5" data-testid={`health-summary-${question.key}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-sm font-medium">{question.title}</span>
        {myOption && (
          <span className="shrink-0 text-xs text-muted-foreground">
            ваш ответ: <span className="font-medium text-foreground">{myOption.label}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-3" role="img" aria-label={description}>
        {/* Сегменты разделены зазором, а не рамкой: доля ответа читается по длине */}
        <div className="flex h-2.5 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-full bg-muted">
          {total > 0 &&
            counts.map(
              ({ option, count }) =>
                count > 0 && (
                  <span
                    key={option.tone}
                    className={cn('h-full rounded-full', TONE_CLASSES[option.tone].dot)}
                    style={{ flexGrow: count, flexBasis: 0 }}
                  />
                ),
            )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5 font-mono text-xs tabular-nums">
          {counts.map(({ option, count }) => (
            <span
              key={option.tone}
              className={cn('inline-flex items-center gap-1', count === 0 && 'text-muted-foreground/60')}
              title={option.label}
            >
              <span
                className={cn('h-2 w-2 rounded-full', TONE_CLASSES[option.tone].dot)}
                aria-hidden="true"
              />
              {count}
            </span>
          ))}
        </div>
      </div>
    </li>
  )
}

interface HealthSummaryViewProps {
  summary: HealthSummary
  myAnswers: Record<string, HealthAnswerValue>
  myRoti?: RotiValue | null
  onRateRoti?: () => void
}

/** Сводка здоровья команды: распределение ответов по вопросам, без имён. */
export default function HealthSummaryView({
  summary,
  myAnswers,
  myRoti,
  onRateRoti,
}: HealthSummaryViewProps) {
  const { participants, roti } = summary
  return (
    <div className="space-y-4" data-testid="health-summary">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="h-4 w-4" aria-hidden="true" />
          {participants === 0 ? (
            'Пока никто не ответил'
          ) : (
            <span data-testid="health-participants">
              {pluralRu(participants, ['Ответил', 'Ответили', 'Ответили'])}{' '}
              <span className="font-semibold text-foreground">{participants}</span>{' '}
              {pluralRu(participants, ['участник', 'участника', 'участников'])}
            </span>
          )}
        </p>
        <ul className="flex items-center gap-3 text-xs text-muted-foreground" aria-label="Обозначения">
          {HEALTH_OPTIONS.map((option) => (
            <li key={option.tone} className="inline-flex items-center gap-1">
              <span
                className={cn('h-2 w-2 rounded-full', TONE_CLASSES[option.tone].dot)}
                aria-hidden="true"
              />
              {option.label}
            </li>
          ))}
        </ul>
      </div>

      <ul className="space-y-3.5">
        {summary.questions.map((question) => (
          <QuestionRow key={question.key} question={question} mine={myAnswers[question.key]} />
        ))}
      </ul>

      {(roti.answers > 0 && roti.average !== null) || onRateRoti ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 px-3.5 py-2.5 text-sm"
          data-testid={roti.answers > 0 && roti.average !== null ? 'health-summary-roti' : undefined}
        >
          <div>
            <span className="font-medium">Оценка встречи</span>
            {roti.answers > 0 && roti.average !== null ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-mono font-semibold text-foreground">
                  {formatAverage(roti.average)}
                </span>{' '}
                из {ROTI_MAX} · {roti.answers} {pluralRu(roti.answers, ['оценка', 'оценки', 'оценок'])}
                {myRoti ? ` · ваша: ${myRoti}` : ''}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Оценок встречи пока нет</p>
            )}
          </div>
          {onRateRoti && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={onRateRoti}
              data-testid="rate-roti-btn"
            >
              <Star className="h-3.5 w-3.5 text-amber-500" />
              {myRoti ? 'Изменить оценку (ROTI)' : 'Оценить встречу (ROTI)'}
            </Button>
          )}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Команда видит только общее распределение ответов, без имён.
      </p>
    </div>
  )
}
