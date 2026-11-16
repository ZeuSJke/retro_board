import { describe, it, expect } from 'vitest'
import {
  isRecord,
  isParticipant,
  isTypingUser,
  isCard,
  isColumn,
  isGroup,
  isActionItem,
  isDeletedData,
  isGroupCollapseData,
  isGroupsCollapsedData,
  isBoardMood,
  isSummaryFailedData,
  isBoardListItem,
  isBoardUpdatedData,
  isCardMovedData,
  isGroupDeletedData,
  isGroupMovedData,
  parseWsMessage,
  asCard,
  asColumn,
  asGroup,
  asActionItem,
} from '../../utils/wsData'

describe('wsData runtime guards', () => {
  it('isRecord distinguishes plain objects from primitives, null, and arrays', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord('str')).toBe(false)
    expect(isRecord(42)).toBe(false)
  })

  it('validates entities: Participant, TypingUser, Card, Column, Group, ActionItem', () => {
    expect(isParticipant({ id: 'p-1', name: 'Алиса' })).toBe(true)
    expect(isParticipant({ id: '', name: 'Алиса' })).toBe(false)
    expect(isParticipant({ id: 'p-1', name: 123 })).toBe(false)

    expect(isTypingUser({ participant_id: 'p-1', username: 'Алиса', column_id: 'col-1' })).toBe(true)
    expect(isTypingUser({ participant_id: 'p-1', username: 'Алиса' })).toBe(false)

    expect(isCard({ id: 'c-1', column_id: 'col-1' })).toBe(true)
    expect(isCard({ id: '', column_id: 'col-1' })).toBe(false)
    expect(isCard({ id: 'c-1' })).toBe(false)

    expect(isColumn({ id: 'col-1', title: 'Хорошо' })).toBe(true)
    expect(isColumn({ id: 'col-1', title: 10 })).toBe(false)

    expect(isGroup({ id: 'g-1', column_id: 'col-1' })).toBe(true)
    expect(isGroup({ id: 'g-1' })).toBe(false)

    expect(isActionItem({ id: 'a-1', board_id: 'b-1' })).toBe(true)
    expect(isActionItem({ id: 'a-1' })).toBe(false)
  })

  it('validates control and snapshot payloads', () => {
    expect(isDeletedData({ id: 'x-1' })).toBe(true)
    expect(isDeletedData({ id: '' })).toBe(false)

    expect(isGroupCollapseData({ group_id: 'g-1', collapsed: true })).toBe(true)
    expect(isGroupCollapseData({ group_id: '', collapsed: true })).toBe(false)
    expect(isGroupCollapseData({ group_id: 'g-1', collapsed: 'yes' })).toBe(false)

    expect(isGroupsCollapsedData({ group_ids: ['g-1', 'g-2'] })).toBe(true)
    expect(isGroupsCollapsedData({ group_ids: [] })).toBe(true)
    expect(isGroupsCollapsedData({ group_ids: ['g-1', 2] })).toBe(false)
    expect(isGroupsCollapsedData({ group_ids: 'g-1' })).toBe(false)

    expect(isBoardMood({ id: 'm-1', score: 4 })).toBe(true)
    expect(isBoardMood({ id: 'm-1', score: Number.NaN })).toBe(false)
    expect(isBoardMood({ id: 'm-1', score: '4' })).toBe(false)

    expect(isSummaryFailedData({ message: 'Ошибка AI' })).toBe(true)
    expect(isSummaryFailedData({ message: 500 })).toBe(false)
  })

  it('validates board list and move payloads', () => {
    expect(isBoardListItem({ id: 'b-1', name: 'Retro', slug: 'retro' })).toBe(true)
    expect(isBoardListItem({ id: 'b-1', name: 'Retro' })).toBe(false)

    expect(isBoardUpdatedData({ id: 'b-1', name: 'New' })).toBe(true)
    expect(isBoardUpdatedData({ id: '' })).toBe(false)

    expect(
      isCardMovedData({ card: { id: 'c-1', column_id: 'col-2' }, old_column_id: 'col-1' }),
    ).toBe(true)
    expect(isCardMovedData({ card: { id: 'c-1', column_id: 'col-2' }, old_column_id: '' })).toBe(
      false,
    )

    expect(isGroupDeletedData({ id: 'g-1', column_id: 'col-1' })).toBe(true)
    expect(isGroupDeletedData({ id: 'g-1' })).toBe(false)

    expect(
      isGroupMovedData({
        group: { id: 'g-1', column_id: 'col-2' },
        old_column_id: 'col-1',
        cards: [],
      }),
    ).toBe(true)
    expect(
      isGroupMovedData({
        group: { id: 'g-1', column_id: 'col-2' },
        old_column_id: 'col-1',
        cards: 'invalid',
      }),
    ).toBe(false)
  })

  it('parseWsMessage validates top-level envelope', () => {
    expect(parseWsMessage({ event: 'pong' })).toEqual({ event: 'pong' })
    expect(parseWsMessage({ event: 'groups_collapsed', data: { group_ids: ['g-1'] } })).toEqual({
      event: 'groups_collapsed',
      data: { group_ids: ['g-1'] },
    })
    expect(parseWsMessage(null)).toBeNull()
    expect(parseWsMessage({})).toBeNull()
    expect(parseWsMessage({ event: '' })).toBeNull()
    expect(parseWsMessage({ event: 'card_created', data: ['bad'] })).toBeNull()
  })

  it('as* helpers return typed entity or throw descriptive error', () => {
    const card = { id: 'c-1', column_id: 'col-1' }
    const col = { id: 'col-1', title: 'Col' }
    const grp = { id: 'g-1', column_id: 'col-1' }
    const item = { id: 'a-1', board_id: 'b-1' }

    expect(asCard(card)).toBe(card)
    expect(asColumn(col)).toBe(col)
    expect(asGroup(grp)).toBe(grp)
    expect(asActionItem(item)).toBe(item)

    expect(() => asCard({ id: 'c-1' })).toThrow(/card/i)
    expect(() => asColumn({ id: 'col-1' })).toThrow(/column/i)
    expect(() => asGroup({ id: 'g-1' })).toThrow(/group/i)
    expect(() => asActionItem({ id: 'a-1' })).toThrow(/action-item/i)
  })
})
