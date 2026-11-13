'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCenter,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  type CollisionDetection,
} from '@dnd-kit/core'
import {
  moveCard,
  createGroup,
  addCardToGroup,
  removeCardFromGroup,
  moveGroup,
} from '../api'
import { showToast } from '../store/toastStore'
import type { Card, CardGroup, Column } from '../types'

interface UseBoardDragDropParams {
  columns: Column[]
  setColumns: React.Dispatch<React.SetStateAction<Column[]>>
}

export function useBoardDragDrop({ columns, setColumns }: UseBoardDragDropParams) {
  const [activeCard, setActiveCard] = useState<Card | null>(null)
  const [activeGroup, setActiveGroup] = useState<CardGroup | null>(null)
  const [groupTargetId, setGroupTargetId] = useState<string | null>(null)
  const savedColumnsRef = useRef<Column[] | null>(null)
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
  )

  const collisionDetection: CollisionDetection = useCallback((args) => {
    if (String(args.active?.id || '').startsWith('group-')) {
      const pointer = pointerWithin(args)
      const master = pointer.filter((c) => String(c.id) === 'master-col')
      if (master.length > 0) return master
      const cols = pointer.filter((c) => String(c.id).startsWith('col-'))
      if (cols.length > 0) return cols
      return closestCenter(args)
    }
    const pointer = pointerWithin(args)
    const cards = pointer.filter((c) => !String(c.id).startsWith('col-'))
    if (cards.length > 0) return cards
    if (pointer.length > 0) return pointer
    return closestCenter(args)
  }, [])

  const findCard = (id: string) => {
    for (const col of columns) {
      const card = col.cards.find((c) => c.id === id)
      if (card) return { card, colId: col.id }
    }
    return null
  }

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    savedColumnsRef.current = columns
    isDraggingRef.current = true
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
    if (found) setActiveCard(found.card)
  }

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) {
      setGroupTargetId(null)
      return
    }
    if (String(active.id).startsWith('group-')) return

    const activeFound = findCard(String(active.id))
    if (!activeFound) return
    const overId = String(over.id)
    const isOverCol = overId.startsWith('col-')
    const overColId = isOverCol ? overId.slice(4) : findCard(overId)?.colId

    const overCard = !isOverCol
      ? (() => {
          for (const col of columns) {
            const c = col.cards.find((x) => x.id === overId)
            if (c) return c
          }
          return null
        })()
      : null
    const targetGroupId = overCard?.group_id
    const activeGroupId = activeFound.card.group_id

    const canJoinExisting = Boolean(targetGroupId) && targetGroupId !== activeGroupId
    const canCreateNew = !targetGroupId && !activeGroupId && groupModifierRef.current

    if (
      !isOverCol &&
      overId !== String(active.id) &&
      overColId &&
      (canJoinExisting || canCreateNew)
    ) {
      setGroupTargetId(overId)
      if (overColId !== activeFound.colId) {
        setColumns((prev) => {
          const srcCol = prev.find((c) => c.id === activeFound.colId)
          const dstCol = prev.find((c) => c.id === overColId)
          if (!srcCol || !dstCol) return prev
          const card = srcCol.cards.find((c) => c.id === String(active.id))
          if (!card) return prev
          const newSrc = {
            ...srcCol,
            cards: srcCol.cards.filter((c) => c.id !== String(active.id)),
          }
          const overCardIdx = dstCol.cards.findIndex((c) => c.id === overId)
          const newCards = [...dstCol.cards]
          newCards.splice(overCardIdx >= 0 ? overCardIdx : newCards.length, 0, {
            ...card,
            column_id: overColId,
            group_id: null,
          })
          return prev.map((c) => {
            if (c.id === activeFound.colId) return newSrc
            if (c.id === overColId) return { ...dstCol, cards: newCards }
            return c
          })
        })
      }
      return
    }
    setGroupTargetId(null)

    if (!overColId || overColId === activeFound.colId) return

    setColumns((prev) => {
      const srcCol = prev.find((c) => c.id === activeFound.colId)
      const dstCol = prev.find((c) => c.id === overColId)
      if (!srcCol || !dstCol) return prev
      const card = srcCol.cards.find((c) => c.id === String(active.id))
      if (!card) return prev
      const newSrc = {
        ...srcCol,
        cards: srcCol.cards.filter((c) => c.id !== String(active.id)),
      }
      const newCards = [
        ...dstCol.cards,
        { ...card, column_id: overColId, group_id: null },
      ]
      return prev.map((c) => {
        if (c.id === activeFound.colId) return newSrc
        if (c.id === overColId) return { ...dstCol, cards: newCards }
        return c
      })
    })
  }

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const wantsNewGroup = groupModifierRef.current
    const saved = savedColumnsRef.current
    isDraggingRef.current = false
    groupModifierRef.current = false
    setActiveCard(null)
    setActiveGroup(null)
    setGroupTargetId(null)

    if (!over) {
      if (saved) setColumns(saved)
      savedColumnsRef.current = null
      return
    }

    // ── Group drag ────────────────────────────────────────────────────────
    if (String(active.id).startsWith('group-')) {
      const groupId = String(active.id).slice(6)
      const overId = String(over.id)
      const isOverCol = overId.startsWith('col-')
      const targetColId = isOverCol ? overId.slice(4) : findCard(overId)?.colId
      if (!targetColId) {
        savedColumnsRef.current = null
        return
      }

      let srcColId: string | null = null
      let groupData: CardGroup | null = null
      for (const col of saved || []) {
        const g = (col.groups || []).find((g) => g.id === groupId)
        if (g) {
          srcColId = col.id
          groupData = g
          break
        }
      }
      if (!groupData || targetColId === srcColId) {
        savedColumnsRef.current = null
        return
      }
      // groupData сужен до CardGroup — const для использования в замыкании ниже
      const group = groupData

      const groupCards =
        (saved || [])
          .find((c) => c.id === srcColId)
          ?.cards.filter((card) => card.group_id === groupId) || []
      setColumns((prev) =>
        prev.map((c) => {
          if (c.id === srcColId) {
            return {
              ...c,
              groups: (c.groups || []).filter((g) => g.id !== groupId),
              cards: c.cards.filter((card) => card.group_id !== groupId),
            }
          }
          if (c.id === targetColId) {
            return {
              ...c,
              groups: [
                ...(c.groups || []).filter((g) => g.id !== groupId),
                { ...group, column_id: targetColId },
              ],
              cards: [
                ...c.cards,
                ...groupCards.map((card) => ({
                  ...card,
                  column_id: targetColId,
                })),
              ],
            }
          }
          return c
        }),
      )

      try {
        await moveGroup(groupId, { column_id: targetColId })
      } catch {
        showToast('Не удалось переместить группу', 'error')
        if (saved) setColumns(saved)
      } finally {
        savedColumnsRef.current = null
      }
      return
    }

    // ── Card drag ────────────────────────────────────────────────────────
    const activeFound = findCard(String(active.id))
    if (!activeFound) {
      savedColumnsRef.current = null
      return
    }
    const overId = String(over.id)
    const isOverCol = overId.startsWith('col-')
    const overColId = isOverCol ? overId.slice(4) : findCard(overId)?.colId
    if (!overColId) {
      savedColumnsRef.current = null
      return
    }

    let origColId: string | null = null
    let origCard: Card | null = null
    for (const col of saved || []) {
      const c = col.cards.find((card) => card.id === String(active.id))
      if (c) {
        origColId = col.id
        origCard = c
        break
      }
    }

    if (!isOverCol && overId !== String(active.id)) {
      const targetCard = (() => {
        for (const col of columns) {
          const c = col.cards.find((x) => x.id === overId)
          if (c) return c
        }
        return null
      })()
      const targetGroupId = targetCard?.group_id
      const activeGroupId = origCard?.group_id ?? activeFound.card.group_id

      if (targetGroupId && targetGroupId !== activeGroupId) {
        try {
          if (origColId && origColId !== overColId) {
            const dstCards =
              (saved || []).find((c) => c.id === overColId)?.cards || []
            await moveCard(String(active.id), { column_id: overColId, position: dstCards.length })
          } else if (activeGroupId) {
            await removeCardFromGroup(activeGroupId, String(active.id))
          }
          const updatedActive = await addCardToGroup(targetGroupId, String(active.id))
          setColumns((prev) =>
            prev.map((c) => ({
              ...c,
              cards: c.cards.map((card) =>
                card.id === String(active.id) ? updatedActive : card,
              ),
            })),
          )
        } catch {
          showToast('Не удалось добавить в группу', 'error')
          if (saved) setColumns(saved)
        } finally {
          savedColumnsRef.current = null
        }
        return
      }

      if (!targetGroupId && !activeGroupId && wantsNewGroup) {
        try {
          if (origColId && origColId !== overColId) {
            const dstCards =
              (saved || []).find((c) => c.id === overColId)?.cards || []
            await moveCard(String(active.id), { column_id: overColId, position: dstCards.length })
          }
          const group = await createGroup({ column_id: overColId, title: 'Группа' })
          setColumns((prev) =>
            prev.map((c) =>
              c.id === overColId
                ? {
                    ...c,
                    groups: [
                      ...(c.groups || []).filter((g) => g.id !== group.id),
                      group,
                    ],
                  }
                : c,
            ),
          )
          const [updatedOver, updatedActive] = await Promise.all([
            addCardToGroup(group.id, overId),
            addCardToGroup(group.id, String(active.id)),
          ])
          setColumns((prev) =>
            prev.map((c) =>
              c.id === overColId
                ? {
                    ...c,
                    cards: c.cards.map((card) => {
                      if (card.id === overId) return updatedOver
                      if (card.id === String(active.id)) return updatedActive
                      return card
                    }),
                  }
                : c,
            ),
          )
        } catch {
          showToast('Не удалось создать группу', 'error')
          if (saved) setColumns(saved)
        } finally {
          savedColumnsRef.current = null
        }
        return
      }
    }

    // Normal card move / reorder
    const dstCol = columns.find((c) => c.id === overColId)
    if (!dstCol) {
      savedColumnsRef.current = null
      return
    }
    const activeIdx = dstCol.cards.findIndex((c) => c.id === String(active.id))
    const overIdx = !isOverCol ? dstCol.cards.findIndex((c) => c.id === overId) : -1
    let finalCards = dstCol.cards
    if (activeIdx >= 0 && overIdx >= 0 && activeIdx !== overIdx) {
      finalCards = [...dstCol.cards]
      const [moved] = finalCards.splice(activeIdx, 1)
      finalCards.splice(overIdx, 0, moved)
    }
    const computedIdx = finalCards.findIndex((c) => c.id === String(active.id))
    const newPos = computedIdx >= 0 ? computedIdx : finalCards.length

    setColumns((prev) =>
      prev.map((c) => {
        if (c.id !== overColId) return c
        return {
          ...c,
          cards: finalCards.map((card, idx) =>
            card.id === String(active.id)
              ? { ...card, group_id: origColId !== overColId ? null : origCard?.group_id ? null : card.group_id, position: idx }
              : { ...card, position: idx },
          ),
        }
      }),
    )

    try {
      if (origCard?.group_id && origColId === overColId) {
        await removeCardFromGroup(origCard.group_id, String(active.id))
      }
      await moveCard(String(active.id), { column_id: overColId, position: newPos })
    } catch {
      showToast('Не удалось переместить карточку', 'error')
      if (saved) setColumns(saved)
    } finally {
      savedColumnsRef.current = null
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
    onDragEnd,
  }
}
