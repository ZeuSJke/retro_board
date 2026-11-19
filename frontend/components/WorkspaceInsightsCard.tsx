'use client'

import { BarChart3, Lightbulb, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import type { WorkspaceInsights } from '../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { plainText } from './dashboard/format'

interface WorkspaceInsightsCardProps {
  insights: WorkspaceInsights | null
  loading: boolean
  onRefresh: () => void
  /** Настроен ли AI на сервере (`ai_enabled`); `null` — ещё не знаем. */
  aiEnabled?: boolean | null
  className?: string
}

/**
 * Вывод и рекомендации по последним доскам команды.
 * Повторяющиеся темы здесь не показываются: их источник — список тем команды
 * (блок «Повторяющиеся темы»), а не ответ модели и не тексты карточек.
 */
export default function WorkspaceInsightsCard({
  insights,
  loading,
  onRefresh,
  aiEnabled = null,
  className,
}: WorkspaceInsightsCardProps) {
  // Без AI сервер отдаёт посчитанную статистику — так блок и называется
  const aiOff = aiEnabled === false
  const TitleIcon = aiOff ? BarChart3 : Sparkles
  const recommendations = insights?.recommendations.map(plainText).filter(Boolean) ?? []

  return (
    <Card
      className={cn(
        'border-primary/20 bg-transparent bg-linear-to-br/srgb from-primary/4 via-card to-card',
        className,
      )}
      data-testid="workspace-insights-card"
    >
      {/* На телефоне кнопка уходит под заголовок, иначе заголовок сжимается в столбик */}
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="inline-flex items-center gap-2">
              <TitleIcon className="h-4 w-4 shrink-0 text-primary" />
              {aiOff ? 'Сводка по спринтам' : 'Аналитика по спринтам'}
            </span>
            {insights && (
              <Badge variant={insights.generated_by_ai ? 'default' : 'secondary'} className="text-[10px]">
                {insights.generated_by_ai ? 'AI' : 'Статистика'}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {aiOff
              ? 'AI на сервере не настроен: сводка считается по данным досок, без выводов модели'
              : 'Выводы и рекомендации по последним доскам команды'}
          </CardDescription>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 self-start text-xs"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {aiOff
            ? insights
              ? 'Обновить сводку'
              : 'Собрать сводку'
            : insights
              ? 'Обновить анализ'
              : 'Собрать инсайты'}
        </Button>
      </CardHeader>

      <CardContent>
        {!insights ? (
          <p className="text-sm text-muted-foreground">
            {aiOff
              ? 'Нажмите «Собрать сводку», чтобы посчитать карточки, задачи, здоровье команды и ROTI по последним доскам.'
              : 'Нажмите «Собрать инсайты», чтобы проанализировать карточки, задачи, здоровье команды и ROTI по последним доскам.'}
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-foreground">{plainText(insights.summary_text)}</p>

            {!aiOff && !insights.generated_by_ai && (
              <p className="text-xs text-muted-foreground">
                AI сейчас недоступен — показана посчитанная статистика без выводов модели.
              </p>
            )}

            {recommendations.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                  Рекомендации
                </div>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {recommendations.map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
