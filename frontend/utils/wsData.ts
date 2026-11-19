/**
 * Type-safe runtime validators for WebSocket messages and payloads.
 * WS messages arrive from JSON.parse at runtime — these guards validate
 * structure without unsafe `as unknown as T` assertions.
 */
import type {
  ActionItem,
  BoardListItem,
  Card,
  CardGroup,
  Column,
  Participant,
  TypingUser,
  WsBoardUpdatedData,
  WsCardMovedData,
  WsDeletedData,
  WsGroupCollapseData,
  WsGroupDeletedData,
  WsGroupMovedData,
  WsGroupsCollapsedData,
  WsMessage,
  WsSummaryFailedData,
} from '../types'

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function hasId(d: Record<string, unknown>): boolean {
  return typeof d.id === 'string' && d.id.length > 0
}

export function isParticipant(value: unknown): value is Participant {
  return isRecord(value) && hasId(value) && typeof value.name === 'string'
}

export function isTypingUser(value: unknown): value is TypingUser {
  return (
    isRecord(value) &&
    typeof value.participant_id === 'string' &&
    typeof value.username === 'string' &&
    typeof value.column_id === 'string'
  )
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

export function isDeletedData(d: unknown): d is WsDeletedData {
  return isRecord(d) && hasId(d)
}

export function isGroupCollapseData(d: unknown): d is WsGroupCollapseData {
  return (
    isRecord(d) &&
    typeof d.group_id === 'string' &&
    d.group_id.length > 0 &&
    typeof d.collapsed === 'boolean'
  )
}

export function isGroupsCollapsedData(d: unknown): d is WsGroupsCollapsedData {
  return isRecord(d) && Array.isArray(d.group_ids) && d.group_ids.every((id) => typeof id === 'string')
}

export function isSummaryFailedData(d: unknown): d is WsSummaryFailedData {
  return isRecord(d) && typeof d.message === 'string'
}

export function isBoardListItem(d: unknown): d is BoardListItem {
  return (
    isRecord(d) &&
    hasId(d) &&
    typeof d.name === 'string' &&
    (typeof d.slug === 'string' || d.slug === null)
  )
}

export function isBoardUpdatedData(d: unknown): d is WsBoardUpdatedData {
  return isRecord(d) && hasId(d)
}

export function isCardMovedData(d: unknown): d is WsCardMovedData {
  return (
    isRecord(d) &&
    isCard(d.card) &&
    typeof d.old_column_id === 'string' &&
    d.old_column_id.length > 0
  )
}

export function isGroupDeletedData(d: unknown): d is WsGroupDeletedData {
  return isRecord(d) && hasId(d) && typeof d.column_id === 'string'
}

export function isGroupMovedData(d: unknown): d is WsGroupMovedData {
  return (
    isRecord(d) &&
    isGroup(d.group) &&
    typeof d.old_column_id === 'string' &&
    Array.isArray(d.cards)
  )
}

function isWsMessageEnvelope(v: unknown): v is WsMessage {
  return (
    isRecord(v) &&
    typeof v.event === 'string' &&
    v.event.length > 0 &&
    (v.data === undefined || isRecord(v.data))
  )
}

/** Разобрать декодированный JSON кадра WebSocket в envelope события или вернуть `null`. */
export function parseWsMessage(raw: unknown): WsMessage | null {
  if (!isWsMessageEnvelope(raw)) return null
  return raw
}

export const asCard = (d: unknown): Card => {
  if (!isCard(d)) throw new Error('Invalid WS card payload: expected id/column_id')
  return d
}

export const asColumn = (d: unknown): Column => {
  if (!isColumn(d)) throw new Error('Invalid WS column payload: expected id/title')
  return d
}

export const asGroup = (d: unknown): CardGroup => {
  if (!isGroup(d)) throw new Error('Invalid WS group payload: expected id/column_id')
  return d
}

export const asActionItem = (d: unknown): ActionItem => {
  if (!isActionItem(d)) throw new Error('Invalid WS action-item payload: expected id/board_id')
  return d
}
