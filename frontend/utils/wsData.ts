/**
 * Type-safe accessors for WebSocket message data.
 * WS data arrives as Record<string, unknown> — these helpers
 * validate key fields via type-guards before returning the payload,
 * instead of blind `as unknown as T` casts.
 */
import type { ActionItem, Card, CardGroup, Column } from '../types'

type WsData = Record<string, unknown>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function hasId(d: Record<string, unknown>): boolean {
  return typeof d.id === 'string' && d.id.length > 0
}

export function isCard(d: unknown): d is Card {
  return isRecord(d) && hasId(d) && typeof d.column_id === 'string'
}

export function isColumn(d: unknown): d is Column {
  return isRecord(d) && hasId(d) && typeof d.title === 'string'
}

export function isGroup(d: unknown): d is CardGroup {
  return isRecord(d) && hasId(d) && typeof d.column_id === 'string'
}

export function isActionItem(d: unknown): d is ActionItem {
  return isRecord(d) && hasId(d) && typeof d.board_id === 'string'
}

export const asCard = (d: WsData): Card => {
  if (!isCard(d)) throw new Error('Invalid WS card payload: expected id/column_id')
  return d
}

export const asColumn = (d: WsData): Column => {
  if (!isColumn(d)) throw new Error('Invalid WS column payload: expected id/title')
  return d
}

export const asGroup = (d: WsData): CardGroup => {
  if (!isGroup(d)) throw new Error('Invalid WS group payload: expected id/column_id')
  return d
}

export const asActionItem = (d: WsData): ActionItem => {
  if (!isActionItem(d)) throw new Error('Invalid WS action-item payload: expected id/board_id')
  return d
}
