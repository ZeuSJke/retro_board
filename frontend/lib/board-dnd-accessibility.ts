import {
  defaultDropAnimationSideEffects,
  type Announcements,
  type DropAnimation,
  type ScreenReaderInstructions,
} from '@dnd-kit/core'
import type { Card, CardGroup } from '../types'

export interface ColumnMeta {
  id: string
  title: string
  color: string
}

export function sameColumnsMeta(a: ColumnMeta[], b: ColumnMeta[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => c.id === b[i].id && c.title === b[i].title && c.color === b[i].color)
  )
}

export const BOARD_DROP_ANIMATION: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.45',
      },
    },
  }),
}

/** Как назвать то, что тащат или над чем оказались, в объявлениях для экранного диктора. */
function describeDragItem(data: Record<string, unknown> | undefined): string {
  if (data?.type === 'card') {
    const text = (data.card as Card | undefined)?.text?.trim()
    return text ? `карточка «${text.slice(0, 60)}»` : 'карточка'
  }
  if (data?.type === 'group') {
    return `группа «${(data.group as CardGroup | undefined)?.title ?? ''}»`
  }
  if (data?.type === 'column') return `колонка «${typeof data.title === 'string' ? data.title : ''}»`
  if (data?.type === 'master') return 'панель задач'
  return 'элемент доски'
}

// Перетаскивание с клавиатуры: подсказка и объявления для экранного диктора
const DND_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Чтобы взять элемент, нажмите пробел или Enter. Стрелками переместите его, пробелом или Enter отпустите, клавишей Escape отмените перенос.',
}

const DND_ANNOUNCEMENTS: Announcements = {
  onDragStart: ({ active }) => `Взято: ${describeDragItem(active.data.current)}.`,
  onDragOver: ({ active, over }) =>
    over
      ? `${describeDragItem(active.data.current)} — над: ${describeDragItem(over.data.current)}.`
      : `${describeDragItem(active.data.current)} — вне доски.`,
  onDragEnd: ({ active, over }) =>
    over
      ? `Перенесено: ${describeDragItem(active.data.current)} — ${describeDragItem(over.data.current)}.`
      : `Перенос отменён: ${describeDragItem(active.data.current)} возвращается на место.`,
  onDragCancel: ({ active }) =>
    `Перенос отменён: ${describeDragItem(active.data.current)} возвращается на место.`,
}

export const DND_ACCESSIBILITY = {
  announcements: DND_ANNOUNCEMENTS,
  screenReaderInstructions: DND_INSTRUCTIONS,
}
