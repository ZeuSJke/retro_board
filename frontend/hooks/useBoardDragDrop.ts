'use client'

import { useState, useRef, useEffect } from 'react'
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { boardCollisionDetection, boardKeyboardCoordinates } from '../lib/board-dnd'
import { bulkUpdateCards, moveCard, moveGroup, removeCardFromGroup } from '../api'
import { showToast } from '../store/toastStore'
import { getApiErrorMessage } from '../utils/apiError'
import type { BoardChange } from '../lib/board-events'
import type { Card, CardGroup, Column } from '../types'

/** Название группы, созданной перетаскиванием карточки на карточку. */
const NEW_GROUP_TITLE = 'Группа'

interface UseBoardDragDropParams {
  columns: Column[]
  /** Применить изменение доски (см. `useBoardWebSocket.applyChange`). */
  applyChange: (change: BoardChange, source?: 'ws' | 'rest' | 'local') => void
  /**
   * Перетаскивание началось (`true`) или закончилось (`false`). Пока оно идёт, чужие
   * изменения откладываются: карточки не должны прыгать под указателем.
   */
  onDragActiveChange?: (active: boolean) => void
  /**
   * Сервер не принял перенос; локальное состояние уже возвращено. `resync` — запрос состоял
   * из нескольких шагов и мог выполниться частично: доску нужно сверить с сервером.
   */
  onRejected?: (error: unknown, options?: { resync?: boolean }) => void
}

/** Где карточка была, когда её взяли: сюда она возвращается при отмене и отказе сервера. */
interface DragOrigin {
  cardId: string
  columnId: string
  index: number
  groupId: string | null
}

export function useBoardDragDrop({
  columns,
  applyChange,
  onDragActiveChange,
  onRejected,
}: UseBoardDragDropParams) {
  const [activeCard, setActiveCard] = useState<Card | null>(null)
  const [activeGroup, setActiveGroup] = useState<CardGroup | null>(null)
  const [groupTargetId, setGroupTargetId] = useState<string | null>(null)
  const originRef = useRef<DragOrigin | null>(null)
  const isDraggingRef = useRef(false)
  const groupModifierRef = useRef(false)

  useEffect(() => {
    const updateModifier = (e: KeyboardEvent) => {
      if (isDraggingRef.current) {
        groupModifierRef.current = e.altKey || e.shiftKey
      }
    }
    window.addEventListener('keydown', updateModifier)
    window.addEventListener('keyup', updateModifier)
    return () => {
      window.removeEventListener('keydown', updateModifier)
      window.removeEventListener('keyup', updateModifier)
    }
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    // С клавиатуры: пробел на ручке — взять, стрелки вверх/вниз — место в колонке,
    // влево/вправо — соседняя колонка, пробел — отпустить, Escape — отменить
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  )

  const collisionDetection = boardCollisionDetection

  const findCard = (id: string) => {
    for (const col of columns) {
      const index = col.cards.findIndex((c) => c.id === id)
      if (index >= 0) return { card: col.cards[index], colId: col.id, index }
    }
    return null
  }

  const finishDrag = () => {
    isDraggingRef.current = false
    groupModifierRef.current = false
    originRef.current = null
    setActiveCard(null)
    setActiveGroup(null)
    setGroupTargetId(null)
  }

  /** Вернуть карточку туда, откуда её взяли. Содержимое карточки не трогается. */
  const restoreOrigin = (origin: DragOrigin | null) => {
    if (!origin) return
    applyChange({
      type: 'card_relocated',
      id: origin.cardId,
      column_id: origin.columnId,
      position: origin.index,
      group_id: origin.groupId,
    })
  }

  const release = () => onDragActiveChange?.(false)

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    isDraggingRef.current = true
    originRef.current = null
    onDragActiveChange?.(true)
    const ev = activatorEvent as KeyboardEvent | MouseEvent | undefined
    groupModifierRef.current = Boolean(ev?.altKey || ev?.shiftKey)
    if (String(active.id).startsWith('group-')) {
      const groupId = String(active.id).slice(6)
      for (const col of columns) {
        const g = (col.groups || []).find((g) => g.id === groupId)
        if (g) {
          setActiveGroup(g)
          break
        }
      }
      return
    }
    const found = findCard(String(active.id))
    if (found) {
      setActiveCard(found.card)
      originRef.current = {
        cardId: found.card.id,
        columnId: found.colId,
        index: found.index,
        groupId: found.card.group_id,
      }
    }
  }

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) {
      setGroupTargetId(null)
      return
    }
    if (String(active.id).startsWith('group-')) return

    const cardId = String(active.id)
    const activeFound = findCard(cardId)
    if (!activeFound) return
    const overId = String(over.id)
    const isOverCol = overId.startsWith('col-')
    const overFound = isOverCol ? null : findCard(overId)
    const overColId = isOverCol ? overId.slice(4) : overFound?.colId

    const targetGroupId = overFound?.card.group_id
    const activeGroupId = activeFound.card.group_id

    const canJoinExisting = Boolean(targetGroupId) && targetGroupId !== activeGroupId
    const canCreateNew = !targetGroupId && !activeGroupId && groupModifierRef.current
    const overAnotherCard = !isOverCol && overId !== cardId && Boolean(overColId)

    if (overAnotherCard && (canJoinExisting || canCreateNew)) {
      setGroupTargetId(overId)
    } else {
      setGroupTargetId(null)
    }

    if (!overColId || overColId === activeFound.colId) return
    const dstCol = columns.find((c) => c.id === overColId)
    if (!dstCol) return

    // Предпросмотр: карточка переезжает в колонку под указателем. Над карточкой, с которой
    // её предлагается сгруппировать, — на её место, иначе в конец.
    const groupingIndex =
      overAnotherCard && (canJoinExisting || canCreateNew) && overFound ? overFound.index : -1
    applyChange({
      type: 'card_relocated',
      id: cardId,
      column_id: overColId,
      position: groupingIndex >= 0 ? groupingIndex : dstCol.cards.length,
      group_id: null,
    })
  }

  /** Перетаскивание отменено (Escape, потеря указателя): карточка возвращается на место. */
  const onDragCancel = () => {
    const origin = originRef.current
    finishDrag()
    restoreOrigin(origin)
    release()
  }

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const wantsNewGroup = groupModifierRef.current
    const origin = originRef.current
    finishDrag()

    if (!over) {
      restoreOrigin(origin)
      release()
      return
    }

    // ── Группа ───────────────────────────────────────────────────────────
    if (String(active.id).startsWith('group-')) {
      const groupId = String(active.id).slice(6)
      const overId = String(over.id)
      const targetColId = overId.startsWith('col-') ? overId.slice(4) : findCard(overId)?.colId
      const srcCol = columns.find((c) => (c.groups || []).some((g) => g.id === groupId))
      if (!targetColId || !srcCol || targetColId === srcCol.id) {
        release()
        return
      }
      const srcColId = srcCol.id
      applyChange({ type: 'group_relocated', id: groupId, column_id: targetColId })
      release()
      try {
        await moveGroup(groupId, { column_id: targetColId })
      } catch (err) {
        showToast(getApiErrorMessage(err, 'Не удалось переместить группу'), 'error')
        applyChange({ type: 'group_relocated', id: groupId, column_id: srcColId })
        onRejected?.(err)
      }
      return
    }

    // ── Карточка ─────────────────────────────────────────────────────────
    const cardId = String(active.id)
    const activeFound = findCard(cardId)
    const overId = String(over.id)
    const isOverCol = overId.startsWith('col-')
    const overFound = isOverCol ? null : findCard(overId)
    const overColId = isOverCol ? overId.slice(4) : overFound?.colId
    const dstCol = overColId ? columns.find((c) => c.id === overColId) : undefined
    if (!origin || !activeFound || !overColId || !dstCol) {
      restoreOrigin(origin)
      release()
      return
    }

    const crossColumn = origin.columnId !== overColId
    const targetCard = overFound && overId !== cardId ? overFound.card : null
    const targetGroupId = targetCard?.group_id ?? null
    const othersInTarget = dstCol.cards.filter((c) => c.id !== cardId).length

    const rollback = (err: unknown, fallback: string, resync = false) => {
      showToast(getApiErrorMessage(err, fallback), 'error')
      restoreOrigin(origin)
      onRejected?.(err, { resync })
    }

    // Карточку бросили на карточку из другой группы — она вступает в эту группу.
    // Перенос в колонку и смена группы уходят одним запросом: частичного результата нет.
    if (targetCard && targetGroupId && targetGroupId !== origin.groupId) {
      if (crossColumn) {
        applyChange({
          type: 'card_relocated',
          id: cardId,
          column_id: overColId,
          position: othersInTarget,
          group_id: targetGroupId,
        })
      } else {
        applyChange({
          type: 'card_patched',
          id: cardId,
          patch: (card) => ({ ...card, group_id: targetGroupId }),
        })
      }
      release()
      try {
        const updated = await bulkUpdateCards({
          card_ids: [cardId],
          ...(crossColumn ? { column_id: overColId } : {}),
          group_id: targetGroupId,
        })
        for (const card of updated) applyChange({ type: 'card_updated', card }, 'rest')
      } catch (err) {
        rollback(err, 'Не удалось добавить в группу')
      }
      return
    }

    // Карточку с Alt или Shift бросили на карточку без группы — из двух получается группа.
    // Сервер создаёт группу и кладёт в неё обе карточки одной транзакцией, поэтому
    // пустая группа остаться не может.
    if (targetCard && !targetGroupId && !origin.groupId && wantsNewGroup) {
      if (crossColumn) {
        applyChange({
          type: 'card_relocated',
          id: cardId,
          column_id: overColId,
          position: othersInTarget,
          group_id: null,
        })
      }
      release()
      try {
        const updated = await bulkUpdateCards({
          card_ids: [overId, cardId],
          ...(crossColumn ? { column_id: overColId } : {}),
          group_title: NEW_GROUP_TITLE,
        })
        const groupId = updated[0]?.group_id
        if (groupId) {
          const lastPosition = (dstCol.groups || []).reduce((max, g) => Math.max(max, g.position), -1)
          applyChange(
            {
              type: 'group_created',
              group: {
                id: groupId,
                column_id: overColId,
                title: NEW_GROUP_TITLE,
                position: lastPosition + 1,
              },
            },
            'rest',
          )
        }
        for (const card of updated) applyChange({ type: 'card_updated', card }, 'rest')
      } catch (err) {
        rollback(err, 'Не удалось создать группу')
      }
      return
    }

    // Обычный перенос или перестановка
    const order = dstCol.cards.map((c) => c.id)
    const activeIdx = order.indexOf(cardId)
    const overIdx = isOverCol ? -1 : order.indexOf(overId)
    if (activeIdx >= 0 && overIdx >= 0 && activeIdx !== overIdx) {
      order.splice(activeIdx, 1)
      order.splice(overIdx, 0, cardId)
    }
    const placed = order.indexOf(cardId)
    const newPos = placed >= 0 ? placed : order.length
    // Карточка, вынутая из группы перетаскиванием, остаётся без группы
    const leavesGroup = Boolean(origin.groupId)

    if (!crossColumn && newPos === origin.index && (!leavesGroup || overId === cardId)) {
      // Бросили туда же, где взяли: запрос не нужен. Карточка из группы, отпущенная на самой
      // себе (взяли с клавиатуры и сразу отпустили), из группы не выходит. Предпросмотр мог
      // увести карточку в другую колонку и обратно — возвращаем её точно на прежнее место.
      restoreOrigin(origin)
      release()
      return
    }

    applyChange({
      type: 'card_relocated',
      id: cardId,
      column_id: overColId,
      position: newPos,
      group_id: crossColumn || leavesGroup ? null : undefined,
    })
    release()

    const ungroupFirst = leavesGroup && !crossColumn
    try {
      if (ungroupFirst && origin.groupId) {
        await removeCardFromGroup(origin.groupId, cardId)
      }
      const moved = await moveCard(cardId, { column_id: overColId, position: newPos })
      applyChange({ type: 'card_moved', card: moved }, 'rest')
    } catch (err) {
      // Два шага могли выполниться наполовину (из группы вынули, но не переставили)
      rollback(err, 'Не удалось переместить карточку', ungroupFirst)
    }
  }

  return {
    sensors,
    collisionDetection,
    activeCard,
    activeGroup,
    groupTargetId,
    onDragStart,
    onDragOver,
    onDragCancel,
    onDragEnd,
  }
}
