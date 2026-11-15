import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import {
  applyAutoClusters,
  autoClusterPreview,
  bulkDeleteCards,
  bulkUpdateCards,
  mergeCards,
} from '../api'
import { showToast } from '../store/toastStore'
import { canDeleteCard, mergeBlockedReason } from '@/lib/participants'
import type { BoardChange } from '../lib/board-events'
import type { ChangeSource } from './useBoardWebSocket'
import { getApiErrorMessage } from '../utils/apiError'
import type {
  AutoClusterPreviewResult,
  Card,
  CardGroup,
  Column as ColumnType,
} from '../types'

interface UseBoardBulkActionsOptions {
  columns: ColumnType[]
  columnsRef: RefObject<ColumnType[]>
  myId: string
  anonymousMode: boolean
  isModerator: boolean
  cardsHidden: boolean
  readOnly: boolean
  applyChange: (change: BoardChange, source?: ChangeSource) => void
  createActionItemFromCards: (
    text: string,
    sourceCardIds: string[],
    authorHint?: string | null,
  ) => Promise<void>
  onGroupCreated: (group: CardGroup, cardIds: string[]) => void
}

/** Выделение нескольких карточек, массовые операции и предпросмотр AI-кластеризации. */
export function useBoardBulkActions({
  columns,
  columnsRef,
  myId,
  anonymousMode,
  isModerator,
  cardsHidden,
  readOnly,
  applyChange,
  createActionItemFromCards,
  onGroupCreated,
}: UseBoardBulkActionsOptions) {
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(() => new Set())
  const lastSelectedCardIdRef = useRef<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [clusterPreviewState, setClusterPreviewState] = useState<{
    column: ColumnType
    preview: AutoClusterPreviewResult
  } | null>(null)
  const [applyingClusters, setApplyingClusters] = useState(false)

  // Сбрасываем выделение при переходе доски в режим «только чтение» прямо в рендере
  const [prevReadOnly, setPrevReadOnly] = useState(readOnly)
  if (readOnly !== prevReadOnly) {
    setPrevReadOnly(readOnly)
    if (readOnly) {
      setSelectedCardIds(new Set())
    }
  }

  const allCardsMap = useMemo(() => {
    const map = new Map<string, Card>()
    columns.forEach((col) => col.cards.forEach((card) => map.set(card.id, card)))
    return map
  }, [columns])

  const selectedCards = useMemo(
    () =>
      Array.from(selectedCardIds)
        .map((id) => allCardsMap.get(id))
        .filter((card): card is Card => Boolean(card)),
    [selectedCardIds, allCardsMap],
  )

  const clearSelection = useCallback(() => {
    setSelectedCardIds(new Set())
  }, [])

  const removeDeletedCard = useCallback((cardId: string) => {
    setSelectedCardIds((prev) => {
      if (!prev.has(cardId)) return prev
      const next = new Set(prev)
      next.delete(cardId)
      return next
    })
  }, [])

  const resetBulkState = useCallback(() => {
    setSelectedCardIds(new Set())
    lastSelectedCardIdRef.current = null
    setClusterPreviewState(null)
  }, [])

  const handleToggleSelectCard = useCallback(
    (cardId: string, shiftKey = false) => {
      if (readOnly) return
      // Скрытые до раскрытия чужие карточки в диапазон не попадают: выбрать их нельзя
      const orderedIds = columnsRef.current.flatMap((c) =>
        c.cards.filter((card) => !card.masked).map((card) => card.id),
      )
      setSelectedCardIds((prev) => {
        const next = new Set(prev)
        if (shiftKey && lastSelectedCardIdRef.current) {
          const startIdx = orderedIds.indexOf(lastSelectedCardIdRef.current)
          const endIdx = orderedIds.indexOf(cardId)
          if (startIdx !== -1 && endIdx !== -1) {
            const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
            for (let i = lo; i <= hi; i += 1) {
              next.add(orderedIds[i])
            }
            return next
          }
        }
        if (next.has(cardId)) {
          next.delete(cardId)
        } else {
          next.add(cardId)
        }
        return next
      })
      lastSelectedCardIdRef.current = cardId
    },
    [columnsRef, readOnly],
  )

  // Ответ массовой операции: карточки с новыми колонкой, группой или цветом
  const applyBulkUpdatedCards = useCallback(
    (updatedCards: Card[], extraGroup?: CardGroup) => {
      if (extraGroup) applyChange({ type: 'group_created', group: extraGroup }, 'rest')
      for (const card of updatedCards) applyChange({ type: 'card_updated', card }, 'rest')
    },
    [applyChange],
  )

  const runBulkAction = useCallback(
    async (fallbackError: string, fn: (cardIds: string[]) => Promise<void>) => {
      if (readOnly || bulkBusy || selectedCards.length === 0) return
      setBulkBusy(true)
      try {
        await fn(selectedCards.map((c) => c.id))
      } catch (err) {
        showToast(getApiErrorMessage(err, fallbackError), 'error')
      } finally {
        setBulkBusy(false)
      }
    },
    [bulkBusy, readOnly, selectedCards],
  )

  const handleBulkGroup = useCallback(
    (title: string) =>
      runBulkAction('Не удалось сгруппировать карточки', async (ids) => {
        const updated = await bulkUpdateCards({ card_ids: ids, group_title: title })
        const newGroupId = updated[0]?.group_id
        const targetColId = updated[0]?.column_id
        // Группу ответ не содержит (она придёт событием): пока собираем её сами — в конец колонки
        const lastGroupPosition = (
          columnsRef.current.find((c) => c.id === targetColId)?.groups || []
        ).reduce((max, g) => Math.max(max, g.position), -1)
        const syntheticGroup: CardGroup | undefined =
          newGroupId && targetColId
            ? {
                id: newGroupId,
                column_id: targetColId,
                title: title.trim() || 'Новая группа',
                position: lastGroupPosition + 1,
              }
            : undefined
        applyBulkUpdatedCards(updated, syntheticGroup)
        setSelectedCardIds(new Set())
        showToast('Карточки объединены в группу', 'success')
      }),
    [applyBulkUpdatedCards, columnsRef, runBulkAction],
  )

  const handleBulkColor = useCallback(
    (hex: string) =>
      runBulkAction('Не удалось изменить цвет карточек', async (ids) => {
        const updated = await bulkUpdateCards({ card_ids: ids, color: hex })
        applyBulkUpdatedCards(updated)
        setSelectedCardIds(new Set())
      }),
    [applyBulkUpdatedCards, runBulkAction],
  )

  const handleBulkMove = useCallback(
    (columnId: string) =>
      runBulkAction('Не удалось переместить карточки', async (ids) => {
        const updated = await bulkUpdateCards({ card_ids: ids, column_id: columnId })
        applyBulkUpdatedCards(updated)
        setSelectedCardIds(new Set())
        showToast('Карточки перемещены', 'success')
      }),
    [applyBulkUpdatedCards, runBulkAction],
  )

  const handleBulkCreateActionItem = useCallback(
    () =>
      runBulkAction('Не удалось создать задачу', async (ids) => {
        const combinedText = selectedCards
          .map((c) => c.text.trim())
          .filter(Boolean)
          .join('\n')
        const firstAuthor = selectedCards[0]?.author ?? null
        await createActionItemFromCards(combinedText, ids, firstAuthor)
        setSelectedCardIds(new Set())
      }),
    [createActionItemFromCards, runBulkAction, selectedCards],
  )

  const handleBulkDelete = useCallback(
    () =>
      runBulkAction('Не удалось удалить карточки', async (ids) => {
        await bulkDeleteCards(ids)
        applyChange({ type: 'cards_deleted', ids })
        setSelectedCardIds(new Set())
        showToast(`Удалено карточек: ${ids.length}`, 'success')
      }),
    [applyChange, runBulkAction],
  )

  const handleMergeCards = useCallback(
    (targetText: string) =>
      runBulkAction('Не удалось объединить карточки', async (ids) => {
        const merged = await mergeCards(ids, targetText)
        applyChange({ type: 'cards_deleted', ids: ids.filter((id) => id !== merged.id) })
        applyChange({ type: 'card_updated', card: merged }, 'rest')
        setSelectedCardIds(new Set())
        showToast('Дубли объединены, голоса суммированы', 'success')
      }),
    [applyChange, runBulkAction],
  )

  const handleOpenClusterPreview = useCallback(
    async (col: ColumnType) => {
      if (readOnly) return
      try {
        const preview = await autoClusterPreview(col.id)
        if (!preview.groups || preview.groups.length === 0) {
          showToast('AI не нашёл похожих карточек для группировки', 'info')
          return
        }
        setClusterPreviewState({ column: col, preview })
      } catch (err: unknown) {
        // Одно сообщение по делу: причину («AI не настроен», «временно недоступен»,
        // «карточки ещё скрыты») сообщает сервер
        showToast(getApiErrorMessage(err, 'Не удалось выполнить AI-кластеризацию'), 'error')
      }
    },
    [readOnly],
  )

  const handleApplyClusterPreview = useCallback(
    async (groupsToApply: { title: string; card_ids: string[] }[]) => {
      if (!clusterPreviewState || applyingClusters || readOnly) return
      setApplyingClusters(true)
      try {
        const colId = clusterPreviewState.column.id
        const result = await applyAutoClusters({
          column_id: colId,
          groups: groupsToApply,
        })
        for (const entry of result.created_groups || []) {
          if (entry?.group) {
            onGroupCreated(entry.group, entry.card_ids || [])
          }
        }
        setClusterPreviewState(null)
        showToast(
          `Создано групп: ${(result.created_groups || []).length}`,
          'success',
        )
      } catch (err) {
        showToast(getApiErrorMessage(err, 'Не удалось применить группы'), 'error')
      } finally {
        setApplyingClusters(false)
      }
    },
    [applyingClusters, clusterPreviewState, onGroupCreated, readOnly],
  )

  // Удалять выбранные карточки можно, если каждая из них своя, либо я модератор
  const canDeleteSelection = selectedCards.every((card) =>
    canDeleteCard(card, myId, { anonymous: anonymousMode, moderator: isModerator }),
  )
  // Объединение — и правка, и удаление: чужие карточки объединяет только модератор
  const mergeBlocked = mergeBlockedReason(selectedCards, myId, {
    anonymous: anonymousMode,
    moderator: isModerator,
    cardsHidden,
  })

  return {
    selectedCardIds,
    selectedCards,
    bulkBusy,
    clearSelection,
    removeDeletedCard,
    resetBulkState,
    handleToggleSelectCard,
    handleBulkGroup,
    handleBulkColor,
    handleBulkMove,
    handleBulkCreateActionItem,
    handleBulkDelete,
    handleMergeCards,
    canDeleteSelection,
    mergeBlocked,
    clusterPreviewState,
    setClusterPreviewState,
    applyingClusters,
    handleOpenClusterPreview,
    handleApplyClusterPreview,
  }
}
