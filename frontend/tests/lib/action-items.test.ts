import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreDeletedActionItem } from '../../lib/action-items'
import type { ActionItem } from '../../types'

const mockCreateActionItem = vi.fn()

vi.mock('../../api', () => ({
  createActionItem: (...args: unknown[]) => mockCreateActionItem(...args),
}))

const sampleTarget: ActionItem = {
  id: 'ai-1',
  board_id: 'b-2',
  title: 'Починить тесты',
  text: 'Обновить фикстуру',
  assignee: 'Анна',
  external_url: null,
  source_card_ids: ['card-deleted'],
  status: 'open',
  completed_at: null,
  created_at: '2026-03-01T10:00:00Z',
}

describe('restoreDeletedActionItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('при 400 (удалена исходная карточка) повторяет запрос без source_card_ids', async () => {
    const err400 = { response: { status: 400, data: { detail: 'Некорректные source_card_ids' } } }
    const restoredItem: ActionItem = { ...sampleTarget, id: 'ai-2', source_card_ids: [] }
    mockCreateActionItem.mockRejectedValueOnce(err400).mockResolvedValueOnce(restoredItem)

    const result = await restoreDeletedActionItem(sampleTarget)

    expect(result).toEqual(restoredItem)
    expect(mockCreateActionItem).toHaveBeenCalledTimes(2)
    expect(mockCreateActionItem).toHaveBeenNthCalledWith(1, {
      board_id: 'b-2',
      title: 'Починить тесты',
      text: 'Обновить фикстуру',
      assignee: 'Анна',
      external_url: undefined,
      source_card_ids: ['card-deleted'],
      status: 'open',
    })
    expect(mockCreateActionItem).toHaveBeenNthCalledWith(2, {
      board_id: 'b-2',
      title: 'Починить тесты',
      text: 'Обновить фикстуру',
      assignee: 'Анна',
      external_url: undefined,
      status: 'open',
    })
  })

  it('пробрасывает не-400 ошибки без повторного запроса', async () => {
    const err500 = { response: { status: 500 } }
    mockCreateActionItem.mockRejectedValueOnce(err500)

    await expect(restoreDeletedActionItem(sampleTarget)).rejects.toBe(err500)
    expect(mockCreateActionItem).toHaveBeenCalledTimes(1)
  })
})
