'use client'

import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface HiddenCollectBannerProps {
  /** Идёт сессия ведущего (фаза «Штурм»): карточки раскроет переход к следующей фазе. */
  inSession: boolean
  /** Сколько чужих карточек сейчас скрыто от участника. */
  maskedCount: number
  /** Участник — модератор доски и может раскрыть карточки вне сессии. */
  canReveal: boolean
  /** Доска заблокирована: раскрыть нельзя, пока её не разблокируют. */
  locked?: boolean
  revealing?: boolean
  onReveal: () => void
}

/**
 * Состояние скрытого сбора на доске: участник видит только свои карточки, чужие приходят
 * с сервера без текста и автора. Показывается, пока сервер сообщает `board.cards_hidden`.
 */
export default function HiddenCollectBanner({
  inSession,
  maskedCount,
  canReveal,
  locked = false,
  revealing = false,
  onReveal,
}: HiddenCollectBannerProps) {
  return (
    <div
      role="status"
      data-testid="hidden-collect-banner"
      className="no-print flex flex-col gap-1.5 border-b bg-primary/5 px-3 py-2 text-xs sm:flex-row sm:items-center sm:gap-3 sm:px-4"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <EyeOff className="h-3.5 w-3.5" />
        </span>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-foreground">
            {inSession ? 'Идёт штурм' : 'Скрытый сбор идёт'} — вы видите только свои карточки
          </span>
          <Badge
            variant="secondary"
            className="h-5 shrink-0 px-2 text-[11px] font-medium"
            data-testid="hidden-cards-count"
          >
            {maskedCount > 0 ? `Скрыто чужих: ${maskedCount}` : 'Чужих карточек пока нет'}
          </Badge>
        </div>
      </div>

      {/* На узком экране действие встаёт отдельной строкой под текстом */}
      {inSession ? (
        <span className="pl-8 text-muted-foreground sm:shrink-0 sm:pl-0">
          Карточки откроются всем на этапе «Раскрытие»
        </span>
      ) : canReveal ? (
        <Button
          type="button"
          size="sm"
          className="ml-8 h-7 gap-1.5 self-start px-2.5 text-xs sm:ml-0 sm:shrink-0 sm:self-auto"
          disabled={revealing || locked}
          title={
            locked
              ? 'Доска заблокирована: разблокируйте её в настройках, чтобы раскрыть карточки'
              : 'Показать все карточки всей команде'
          }
          onClick={onReveal}
          data-testid="reveal-cards-btn"
        >
          {revealing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          Раскрыть карточки
        </Button>
      ) : (
        <span className="pl-8 text-muted-foreground sm:shrink-0 sm:pl-0">
          Раскрыть может создатель доски
        </span>
      )}
    </div>
  )
}
