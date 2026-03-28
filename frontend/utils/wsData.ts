/**
 * Type-safe accessors for WebSocket message data.
 * WS data arrives as Record<string, unknown> — these helpers
 * provide clean casts trusted from the backend schema.
 */
import type { ActionItem, Card, CardGroup, Column } from '../types'

type WsData = Record<string, unknown>

export const asCard = (d: WsData): Card => d as unknown as Card
export const asColumn = (d: WsData): Column => d as unknown as Column
export const asGroup = (d: WsData): CardGroup => d as unknown as CardGroup
export const asActionItem = (d: WsData): ActionItem => d as unknown as ActionItem
