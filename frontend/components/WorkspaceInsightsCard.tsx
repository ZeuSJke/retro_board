'use client'

import { Lightbulb, Loader2, RefreshCw, Sparkles, Tag } from 'lucide-react'
import type { WorkspaceInsights } from '../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface WorkspaceInsightsCardProps {
  insights: WorkspaceInsights | null
  loading: boolean
  onRefresh: () => void
}

export default function WorkspaceInsightsCard({
  insights,
  loading,
  onRefresh,
}: WorkspaceInsightsCardProps) {
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/[0.04] via-card to-card">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Кросс-спринт AI-аналитика
            {insights && (
              <Badge variant={insights.generated_by_ai ? 'default' : 'secondary'} className="text-[10px]">
                {insights.generated_by_ai ? 'AI' : 'Статистика'}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Повторяющиеся паттерны, темы и рекомендации по последним доскам команды
          </CardDescription>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {insights ? 'Обновить анализ' : 'Собрать инсайты'}
        </Button>
      </CardHeader>

      <CardContent>
        {!insights ? (
          <p className="text-sm text-muted-foreground">
            Нажмите «Собрать инсайты», чтобы проанализировать карточки, Action Items и оценки настроения по всем спринтам команды.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-foreground">{insights.summary_text}</p>

            {insights.recurring_themes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Tag className="h-3.5 w-3.5" />
                  Повторяющиеся темы ({insights.boards_analyzed} досок)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {insights.recurring_themes.map((theme, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs font-medium">
                      {theme}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {insights.recommendations.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                  Рекомендации
                </div>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {insights.recommendations.map((rec, idx) => (
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
