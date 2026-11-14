'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Repeat2, Tags } from 'lucide-react'
import type { TeamTheme } from '@/types/themes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBoardDate } from './chartLabels'
import { boardsCountLabel, plainText, pluralRu, streakLabel } from './format'

/** Тема повторяющаяся, если названа в итогах хотя бы двух досок. */
const RECURRING_MIN_BOARDS = 2
/** Сколько тем видно сразу; остальные — по кнопке. */
const VISIBLE_LIMIT = 4

interface TeamThemesCardProps {
  themes: TeamTheme[]
  /** Список не загрузился: вместо пустого состояния — сообщение и «Повторить». */
  error?: boolean
  onRetry?: () => void
  /** Настроен ли AI на сервере (`ai_enabled`); `null` — ещё не знаем. */
  aiEnabled: boolean | null
  className?: string
}

function ThemeItem({ theme }: { theme: TeamTheme }) {
  const streak = streakLabel(theme.streak)
  const description = plainText(theme.description || '')
  const board = theme.last_board
  return (
    <li className="rounded-xl border bg-background/60 p-3" data-testid="team-theme">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <p className="min-w-0 wrap-break-word text-sm font-semibold leading-snug">
          {plainText(theme.name)}
        </p>
        {streak && (
          <Badge variant={theme.streak >= 3 ? 'warning' : 'secondary'} className="shrink-0">
            <Repeat2 className="h-3 w-3" aria-hidden="true" />
            {streak}
          </Badge>
        )}
      </div>
      {description && (
        <p className="mt-1 wrap-break-word text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        <span>Встречалась {boardsCountLabel(theme.boards_count)}</span>
        <span aria-hidden="true">·</span>
        <span>последняя:</span>
        <Link
          href={`/board/${board.slug || board.id}`}
          title={formatBoardDate(board.created_at)}
          className="inline-flex min-w-0 items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
        >
          <span className="truncate">{board.name}</span>
          <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        </Link>
      </p>
      {theme.streak === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">В последних итогах не названа</p>
      )}
    </li>
  )
}

/**
 * Блок «Повторяющиеся темы»: темы команды из итогов досок со счётчиком повторов и серией.
 * Источник — список тем команды (`GET /api/boards/themes`), а не тексты карточек.
 */
export default function TeamThemesCard({
  themes,
  error = false,
  onRetry,
  aiEnabled,
  className,
}: TeamThemesCardProps) {
  const [showAll, setShowAll] = useState(false)

  const recurring = themes.filter((t) => t.boards_count >= RECURRING_MIN_BOARDS)
  const single = themes.filter((t) => t.boards_count < RECURRING_MIN_BOARDS)
  // Пока ничего не повторилось, показываем темы последних итогов — с честной подписью
  const primary = recurring.length > 0 ? recurring : single
  // Темы, названные один раз, при наличии повторяющихся убраны под кнопку
  const secondary = recurring.length > 0 ? single : []
  const shownPrimary = showAll ? primary : primary.slice(0, VISIBLE_LIMIT)
  const shownSecondary = showAll ? secondary : []
  const hiddenCount =
    primary.length + secondary.length - shownPrimary.length - shownSecondary.length
  const canToggle = primary.length > VISIBLE_LIMIT || secondary.length > 0
  const onlySingleHidden = primary.length <= VISIBLE_LIMIT && secondary.length > 0

  return (
    <Card className={className} data-testid="team-themes-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Tags className="h-4 w-4 text-primary" aria-hidden="true" />
          Повторяющиеся темы
          {recurring.length > 0 && (
            <Badge variant="secondary" className="font-mono text-[10px]">
              {recurring.length}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Темы из итогов досок: на скольких досках поднимались и сколько спринтов подряд
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-3">
            <p className="text-sm text-muted-foreground">Не удалось загрузить темы команды</p>
            {onRetry && (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                Повторить
              </Button>
            )}
          </div>
        ) : themes.length === 0 ? (
          <div className="space-y-2 rounded-xl border border-dashed p-3.5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Тем пока нет</p>
            <p>
              Темы берутся из итогов досок. Когда ретро доходит до этапа «Итоги», AI называет
              ключевые темы и узнаёт те, что команда уже поднимала. Тема, названная в итогах
              нескольких досок, появится здесь со счётчиком повторов.
            </p>
            {aiEnabled === false && (
              <p data-testid="team-themes-ai-off">
                Сейчас AI на сервере не настроен, поэтому итоги и темы не формируются.
              </p>
            )}
          </div>
        ) : (
          <>
            {recurring.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Пока ни одна тема не повторилась: каждая названа в итогах только одной доски.
              </p>
            )}
            <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {shownPrimary.map((theme) => (
                <ThemeItem key={theme.id} theme={theme} />
              ))}
            </ul>
            {shownSecondary.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Встречались один раз
                </p>
                <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  {shownSecondary.map((theme) => (
                    <ThemeItem key={theme.id} theme={theme} />
                  ))}
                </ul>
              </div>
            )}
            {canToggle && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto min-h-8 w-full whitespace-normal py-1.5 text-xs text-muted-foreground hover:text-foreground"
                aria-expanded={showAll}
                onClick={() => setShowAll((prev) => !prev)}
              >
                {showAll
                  ? 'Свернуть список'
                  : `Показать ещё ${hiddenCount} ${pluralRu(hiddenCount, ['тему', 'темы', 'тем'])}${
                      onlySingleHidden ? ' — встречались один раз' : ''
                    }`}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
