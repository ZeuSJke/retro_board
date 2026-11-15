import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'

vi.mock('axios', () => {
  const mockAxios = {
    create: vi.fn(() => mockAxios),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  }
  return { default: mockAxios }
})

// Must import after mock
import {
  getBoards,
  createBoard,
  getBoard,
  updateBoard,
  deleteBoard,
  createCard,
  toggleLike,
  resetBoardVotes,
  revealBoardCards,
  submitBoardMood,
  autoClusterPreview,
  AI_API_TIMEOUT_MS,
} from '../../api'

const api = axios.create()

describe('API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getBoards calls GET /boards/', async () => {
    const boards = [{ id: '1', name: 'Test', slug: 'test', max_votes: 5, created_at: '' }]
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: boards })
    const result = await getBoards()
    expect(api.get).toHaveBeenCalledWith('/boards/')
    expect(result).toEqual(boards)
  })

  it('createBoard calls POST /boards/', async () => {
    const board = { id: '1', name: 'New', slug: 'new', max_votes: 5, created_at: '', columns: [] }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: board })
    const result = await createBoard('New')
    expect(api.post).toHaveBeenCalledWith('/boards/', { name: 'New' })
    expect(result).toEqual(board)
  })

  it('getBoard calls GET /boards/:id', async () => {
    const board = { id: '1', name: 'Test', slug: 'test', max_votes: 5, created_at: '', columns: [] }
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: board })
    const result = await getBoard('1')
    expect(api.get).toHaveBeenCalledWith('/boards/1')
    expect(result).toEqual(board)
  })

  it('updateBoard calls PATCH /boards/:id', async () => {
    const board = { id: '1', name: 'Updated', slug: 'updated', max_votes: 5, created_at: '', columns: [] }
    ;(api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({ data: board })
    const result = await updateBoard('1', { name: 'Updated' })
    expect(api.patch).toHaveBeenCalledWith('/boards/1', { name: 'Updated' })
    expect(result).toEqual(board)
  })

  it('deleteBoard calls DELETE /boards/:id', async () => {
    ;(api.delete as ReturnType<typeof vi.fn>).mockResolvedValue({})
    await deleteBoard('1')
    expect(api.delete).toHaveBeenCalledWith('/boards/1')
  })

  it('createCard calls POST /cards/', async () => {
    const card = { id: '1', column_id: 'c1', text: 'Test', author: 'A', author_id: 'p-1', color: '#FFF', position: 0, likes: [], masked: false, created_at: '', group_id: null }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: card })
    const result = await createCard({ column_id: 'c1', text: 'Test' })
    expect(api.post).toHaveBeenCalledWith('/cards/', { column_id: 'c1', text: 'Test' })
    expect(result).toEqual(card)
  })

  it('toggleLike голосует от имени сессии: ни имени, ни идентификатора в запросе нет', async () => {
    const card = { id: '1', column_id: 'c1', text: 'Test', author: 'A', author_id: 'p-1', color: '#FFF', position: 0, likes: ['p-2'], masked: false, created_at: '', group_id: null }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: card })

    const result = await toggleLike('1')
    expect(api.post).toHaveBeenCalledWith('/cards/1/like', null, undefined)
    expect(result).toEqual(card)

    await toggleLike('1', 'remove')
    expect(api.post).toHaveBeenLastCalledWith('/cards/1/like', null, { params: { action: 'remove' } })
  })

  it('resetBoardVotes и submitBoardMood не передают автора', async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} })

    await resetBoardVotes('b-1')
    expect(api.post).toHaveBeenLastCalledWith('/boards/b-1/reset-votes')

    await submitBoardMood('b-1', { score: 4, note: null })
    expect(api.post).toHaveBeenLastCalledWith('/boards/b-1/mood', { score: 4, note: null })
  })

  it('revealBoardCards вызывает POST /boards/:id/reveal', async () => {
    const board = { id: 'b-1', name: 'Test', slug: 'test', max_votes: 5, created_at: '', columns: [], cards_hidden: false }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: board })

    const result = await revealBoardCards('b-1')
    expect(api.post).toHaveBeenCalledWith('/boards/b-1/reveal')
    expect(result).toEqual(board)
  })

  it('autoClusterPreview отправляет только колонку и увеличенный таймаут', async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { column_id: 'c1', groups: [] } })
    await autoClusterPreview('c1')
    expect(api.post).toHaveBeenCalledWith(
      '/groups/auto-cluster-preview',
      { column_id: 'c1' },
      { timeout: AI_API_TIMEOUT_MS },
    )
  })
})
