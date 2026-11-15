'use client'

import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Событие окна, по которому доска открывает health check. Кнопка стоит в шапке, а состояние
 * опроса живёт на странице доски (`useHealthCheck`): так шапке не нужны новые пропсы.
 */
export const HEALTH_CHECK_OPEN_EVENT = 'retroboard:open-health-check'

/** Открыть окно health check из любого места доски. */
export function openHealthCheck(): void {
  window.dispatchEvent(new Event(HEALTH_CHECK_OPEN_EVENT))
}

/**
 * Кнопка «Health check» для шапки доски. Окно опроса открывается у нажавшего; запустить опрос
 * у всей команды можно из самого окна («Запустить у всех» — ведущему, а вне сессии любому).
 *
 * На телефоне кнопки шапки, которые не помещаются, живут в её меню: там кнопка скрыта,
 * а опрос открывает пункт `HealthCheckMenuItem`.
 */
export default function HealthCheckButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openHealthCheck}
          aria-label="Health check команды"
          className="hidden h-8 gap-1.5 rounded-full px-2.5 text-xs sm:inline-flex"
          data-testid="health-check-btn"
        >
          <Activity className="h-3.5 w-3.5 text-emerald-500" />
          <span className="hidden xl:inline">Health check</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Health check команды: короткий опрос о спринте</TooltipContent>
    </Tooltip>
  )
}

/** Пункт «Health check» для меню шапки: виден на телефоне, где кнопка скрыта. */
export function HealthCheckMenuItem() {
  return (
    <DropdownMenuItem
      className="sm:hidden"
      onClick={openHealthCheck}
      data-testid="menu-health-check-item"
    >
      <Activity className="h-4 w-4 text-emerald-500" />
      Health check команды
    </DropdownMenuItem>
  )
}
