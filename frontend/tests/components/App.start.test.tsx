import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import App from '../../components/App'
import { useAppStore } from '../../store'
import type { Board } from '../../types'

const api = vi.hoisted(() => ({
  refreshWorkspaceSession: vi.fn(),
  getBoards: vi.fn(),
  getBoard: vi.fn(),
  getBoardBySlug: vi.fn(),
  createBoard: vi.fn(),
  loginToWorkspace: vi.fn(),
}))

vi.mock('../../api', () => api)

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

// Каждое монтирование доски — это ещё одно подключение её сокета
const boardMounts = vi.hoisted(() => ({ count: 0 }))

vi.mock('../../components/BoardPage', async () => {
  const { useEffect } = await import('react')
  function BoardPageDouble({ board }: { board: Board }) {
    useEffect(() => {
      boardMounts.count += 1
    }, [])
    return <div data-testid="board-page">{board.name}</div>
  }
  return { default: BoardPageDouble }
})

vi.mock('../../components/CreateBoardDialog', () => ({
  default: () => null,
}))

const listItem = {
  id: 'b-1',
  name: 'Спринт',
  slug: 'sprint',
  max_votes: 5,
  created_at: '2026-03-01T10:00:00Z',
  action_items_total: 0,
  action_items_open: 0,
  has_summary: false,
}

const board: Board = {
  id: 'b-1',
  name: 'Спринт',
  slug: 'sprint',
  max_votes: 5,
  created_at: '2026-03-01T10:00:00Z',
  columns: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  boardMounts.count = 0
  localStorage.clear()
  useAppStore.setState({
    username: 'Анна',
    workspace: { workspaceId: 'w-1', workspaceSlug: 'team', workspaceName: 'Команда' },
    participant: { id: 'p-anna', name: 'Анна' },
    aiEnabled: null,
    currentBoardId: null,
    _hasHydrated: true,
  })
  api.refreshWorkspaceSession.mockResolvedValue({})
  api.getBoards.mockResolvedValue([listItem])
  api.getBoard.mockResolvedValue(board)
  api.getBoardBySlug.mockResolvedValue(board)
})

describe('App — адрес /board/start', () => {
  it('только перенаправляет на адрес первой доски: доску не загружает и не монтирует', async () => {
    render(<App boardId="start" />)

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/board/sprint'))
    // Даём отработать всему, что могло быть запланировано после перенаправления
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })

    // Доска, смонтированная до смены адреса, открыла бы сокет, который тут же закроется
    expect(boardMounts.count).toBe(0)
    expect(screen.queryByTestId('board-page')).not.toBeInTheDocument()
    expect(api.getBoard).not.toHaveBeenCalled()
    expect(api.getBoardBySlug).not.toHaveBeenCalled()
    // До смены адреса виден индикатор загрузки, а не экран ошибки
    expect(screen.getByText('Загрузка доски...')).toBeInTheDocument()
    expect(screen.queryByText('Не удалось открыть доску')).not.toBeInTheDocument()
  })

  it('у доски без slug перенаправляет по идентификатору', async () => {
    api.getBoards.mockResolvedValue([{ ...listItem, slug: null }])

    render(<App boardId="start" />)

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/board/b-1'))
    expect(boardMounts.count).toBe(0)
  })

  it('по адресу доски монтирует её один раз', async () => {
    render(<App boardId="sprint" />)

    expect(await screen.findByTestId('board-page')).toHaveTextContent('Спринт')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(boardMounts.count).toBe(1)
    expect(api.getBoardBySlug).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('доска со служебным slug «start» открывается по этому адресу без перенаправления', async () => {
    // Старые данные: у доски slug совпал со служебным адресом — она уже открыта по своему адресу
    api.getBoards.mockResolvedValue([{ ...listItem, slug: 'start' }])
    api.getBoard.mockResolvedValue({ ...board, slug: 'start' })

    render(<App boardId="start" />)

    expect(await screen.findByTestId('board-page')).toHaveTextContent('Спринт')
    expect(router.replace).not.toHaveBeenCalled()
    expect(boardMounts.count).toBe(1)
  })
})
