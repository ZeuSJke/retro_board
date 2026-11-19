import { CheckCircle2, Circle, Clock } from 'lucide-react'
import { createActionItem } from '@/api'
import type { ActionItem, ActionItemStatus, DashboardActionItem } from '@/types'
import { getApiErrorStatus } from '@/utils/apiError'

/** Задача с признаком переноса: оригинал, перенесённый на другую доску, открытым не считается. */
export type CarriedAwareItem = DashboardActionItem & { superseded_by_id?: string | null }

/** Одна реальная задача — одна запись: перенесённые оригиналы представлены своими копиями. */
export function withoutCarriedOriginals(list: CarriedAwareItem[]): DashboardActionItem[] {
  return list.filter((item) => !item.superseded_by_id)
}

/** Восстановить удалённую задачу: при 400 (удалена исходная карточка) повторяет запрос без source_card_ids. */
export async function restoreDeletedActionItem(
  target: Pick<
    ActionItem,
    'board_id' | 'title' | 'text' | 'assignee' | 'external_url' | 'source_card_ids' | 'status'
  >,
  fallbackBoardId?: string,
): Promise<ActionItem> {
  const basePayload = {
    board_id: target.board_id || fallbackBoardId || '',
    title: target.title || undefined,
    text: target.text,
    assignee: target.assignee || undefined,
    external_url: target.external_url || undefined,
    status: target.status,
  }
  const sourceIds = target.source_card_ids
  try {
    return await createActionItem({
      ...basePayload,
      source_card_ids: sourceIds,
    })
  } catch (err) {
    if (getApiErrorStatus(err) === 400 && sourceIds?.length) {
      return await createActionItem(basePayload)
    }
    throw err
  }
}

export const KANBAN_VISIBLE_LIMIT = 6

export const ACTION_ITEM_STATUS_ORDER: ActionItemStatus[] = ['open', 'in_progress', 'done']

export const ACTION_ITEM_NEXT_STATUS: Record<ActionItemStatus, ActionItemStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
}

export const ACTION_ITEM_STATUS_META: Record<
  ActionItemStatus,
  {
    label: string
    colorClass: string
    badgeVariant: 'warning' | 'secondary' | 'success'
    Icon: typeof Circle
  }
> = {
  open: {
    label: 'Открыто',
    colorClass: 'text-amber-600 dark:text-amber-400',
    badgeVariant: 'warning',
    Icon: Circle,
  },
  in_progress: {
    label: 'В работе',
    colorClass: 'text-sky-600 dark:text-sky-400',
    badgeVariant: 'secondary',
    Icon: Clock,
  },
  done: {
    label: 'Выполнено',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    badgeVariant: 'success',
    Icon: CheckCircle2,
  },
}
