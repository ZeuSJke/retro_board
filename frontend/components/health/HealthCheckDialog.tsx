'use client'

import { useId, useState } from 'react'
import { Activity, Loader2, Megaphone, Pencil } from 'lucide-react'
import type { HealthAnswerValue, HealthSummary } from '@/types/health'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import HealthSummaryView from './HealthSummaryView'
import { HEALTH_OPTIONS, TONE_CLASSES } from './scale'
import type { HealthCheckController } from './useHealthCheck'

interface HealthCheckDialogProps {
  /** Состояние опроса из `useHealthCheck(boardId)`. */
  health: HealthCheckController
  /**
   * Запустить опрос у всех на доске: `() => sendMessage(HEALTH_CHECK_START)`.
   * Передавайте только тому, кто вправе запускать (во время сессии — ведущему,
   * вне сессии — любому): без обработчика кнопки «Запустить у всех» в окне нет.
   */
  onStartForTeam?: () => void
}

function StartForTeamButton({ onStartForTeam }: { onStartForTeam?: () => void }) {
  if (!onStartForTeam) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-1.5 text-muted-foreground hover:text-foreground"
      title="Окно опроса откроется у всех, кто сейчас на доске"
      onClick={onStartForTeam}
      data-testid="health-start-for-team"
    >
      <Megaphone className="h-4 w-4" />
      Запустить у всех
    </Button>
  )
}

/**
 * Содержимое окна после загрузки сводки. Монтируется заново при каждом открытии,
 * поэтому черновик ответов начинается с того, что участник уже отвечал.
 */
function HealthCheckBody({
  health,
  summary,
  onStartForTeam,
}: {
  health: HealthCheckController
  summary: HealthSummary
  onStartForTeam?: () => void
}) {
  const idPrefix = useId()
  const [view, setView] = useState<'form' | 'summary'>(health.hasAnswered ? 'summary' : 'form')
  const [draft, setDraft] = useState<Record<string, HealthAnswerValue>>(health.myAnswers)

  const questions = summary.questions
  const answered = questions.filter((q) => draft[q.key] !== undefined).length

  const handleSubmit = async () => {
    if (answered === 0 || health.submitting) return
    const ok = await health.submitAnswers(draft)
    if (ok) setView('summary')
  }

  if (view === 'summary') {
    return (
      <>
        <DialogBody>
          <HealthSummaryView summary={summary} myAnswers={health.myAnswers} />
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setDraft(health.myAnswers)
                setView('form')
              }}
              data-testid="health-edit-answers"
            >
              <Pencil className="h-3.5 w-3.5" />
              Изменить ответы
            </Button>
            <StartForTeamButton onStartForTeam={onStartForTeam} />
          </div>
          <Button type="button" onClick={health.closeDialog}>
            Готово
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogBody>
        <ul className="space-y-2.5">
          {questions.map((question) => {
            const labelId = `${idPrefix}-${question.key}`
            return (
              <li
                key={question.key}
                className="rounded-xl border p-3 sm:flex sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p id={labelId} className="text-sm font-semibold leading-snug">
                    {question.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{question.hint}</p>
                </div>
                <div
                  role="group"
                  aria-labelledby={labelId}
                  className="mt-2.5 grid grid-cols-3 gap-1.5 sm:mt-0 sm:flex sm:shrink-0"
                >
                  {HEALTH_OPTIONS.map((option) => {
                    const selected = draft[question.key] === option.value
                    const tone = TONE_CLASSES[option.tone]
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        data-testid={`health-answer-${question.key}-${option.value}`}
                        onClick={() =>
                          setDraft((prev) => ({ ...prev, [question.key]: option.value }))
                        }
                        className={cn(
                          'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                          selected ? tone.selected : tone.idle,
                        )}
                      >
                        <option.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className={selected ? undefined : 'text-foreground'}>{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Команда видит только общую сводку, без имён.
          {summary.participants > 0 && ` Уже ответили: ${summary.participants}.`}
        </p>
      </DialogBody>
      <DialogFooter className="sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground" data-testid="health-progress">
            Отвечено {answered} из {questions.length}
          </span>
          <StartForTeamButton onStartForTeam={onStartForTeam} />
        </div>
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center">
          {health.hasAnswered && (
            <Button type="button" variant="outline" onClick={() => setView('summary')}>
              К сводке
            </Button>
          )}
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={answered === 0 || health.submitting}
            data-testid="health-submit"
          >
            {health.submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {health.hasAnswered ? 'Сохранить ответы' : 'Отправить ответы'}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

/**
 * Окно «Здоровье команды»: вопросы со светофором (1 — красный, 2 — жёлтый, 3 — зелёный),
 * после ответа — сводка по команде без имён. Сводка обновляется по событию `health_updated`.
 */
export default function HealthCheckDialog({ health, onStartForTeam }: HealthCheckDialogProps) {
  return (
    <Dialog
      open={health.dialogOpen}
      onOpenChange={(open) => {
        if (!open) health.closeDialog()
      }}
    >
      <DialogContent layout="structured" className="max-w-xl" data-testid="health-check-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
            Здоровье команды
          </DialogTitle>
          <DialogDescription>
            {health.requestedBy ? `${health.requestedBy} приглашает пройти опрос. ` : ''}
            Короткие вопросы о спринте: на каждый — один ответ, это займёт несколько секунд.
          </DialogDescription>
        </DialogHeader>

        {health.summary ? (
          <HealthCheckBody
            health={health}
            summary={health.summary}
            onStartForTeam={onStartForTeam}
          />
        ) : (
          <DialogBody>
            {health.loading ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <p className="text-sm">Загружаем опрос…</p>
              </div>
            ) : (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-destructive">
                  {health.loadError || 'Не удалось загрузить опрос'}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={health.refresh}>
                  Повторить
                </Button>
              </div>
            )}
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  )
}
