'use client'

import { useState, useCallback, useRef } from 'react'
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

  const onDragStart = ({ active }: DragStartEvent) => {
    savedColumnsRef.current = columns
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

    if (
      !isOverCol &&
      overId !== String(active.id) &&
      overColId &&
      (targetGroupId || !activeGroupId)
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
    setActiveCard(null)
    setActiveGroup(null)
    setGroupTargetId(null)

    if (!over) {
      if (savedColumnsRef.current) setColumns(savedColumnsRef.current)
      return
    }

    // ── Group drag ────────────────────────────────────────────────────────
    if (String(active.id).startsWith('group-')) {
      const groupId = String(active.id).slice(6)
      const overId = String(over.id)
      const isOverCol = overId.startsWith('col-')
      const targetColId = isOverCol ? overId.slice(4) : findCard(overId)?.colId
      if (!targetColId) return

      let srcColId: string | null = null
      let groupData: CardGroup | null = null
      for (const col of savedColumnsRef.current || []) {
        const g = (col.groups || []).find((g) => g.id === groupId)
        if (g) {
          srcColId = col.id
          groupData = g
          break
        }
      }
      if (!groupData || targetColId === srcColId) return

      const groupCards =
        (savedColumnsRef.current || [])
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
                { ...groupData!, column_id: targetColId },
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
      } catch (e) {
        showToast('Не удалось переместить группу', 'error')
        if (savedColumnsRef.current) setColumns(savedColumnsRef.current)
      }
      return
    }

    // ── Card drag ────────────────────────────────────────────────────────
    const activeFound = findCard(String(active.id))
    if (!activeFound) return
    const overId = String(over.id)
    const isOverCol = overId.startsWith('col-')
    const overColId = isOverCol ? overId.slice(4) : findCard(overId)?.colId
    if (!overColId) return

    if (!isOverCol && overId !== String(active.id)) {
      const targetCard = (() => {
        for (const col of columns) {
          const c = col.cards.find((x) => x.id === overId)
          if (c) return c
        }
        return null
      })()
      const targetGroupId = targetCard?.group_id
      const activeGroupId = activeFound.card.group_id

      let origColId: string | null = null
      for (const col of savedColumnsRef.current || []) {
        if (col.cards.find((c) => c.id === String(active.id))) {
          origColId = col.id
          break
        }
      }

      if (targetGroupId) {
        try {
          if (origColId && origColId !== overColId) {
            const dstCards =
              (savedColumnsRef.current || []).find((c) => c.id === overColId)?.cards || []
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
        } catch (e) {
          showToast('Не удалось добавить в группу', 'error')
          if (savedColumnsRef.current) setColumns(savedColumnsRef.current)
        }
        return
      }

      if (!activeGroupId) {
        try {
          if (origColId && origColId !== overColId) {
            const dstCards =
              (savedColumnsRef.current || []).find((c) => c.id === overColId)?.cards || []
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
        } catch (e) {
          showToast('Не удалось создать группу', 'error')
          if (savedColumnsRef.current) setColumns(savedColumnsRef.current)
        }
        return
      }
    }

    // Normal card move
    const dstCol = columns.find((c) => c.id === overColId)
    if (!dstCol) return
    const overIdx = dstCol.cards.findIndex((c) => c.id === overId)
    const newPos = overIdx >= 0 ? overIdx : dstCol.cards.length
    try {
      if (activeFound.card.group_id && overColId === activeFound.colId) {
        await removeCardFromGroup(activeFound.card.group_id, String(active.id))
      }
      await moveCard(String(active.id), { column_id: overColId, position: newPos })
    } catch (e) {
      showToast('Не удалось переместить карточку', 'error')
      if (savedColumnsRef.current) setColumns(savedColumnsRef.current)
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
