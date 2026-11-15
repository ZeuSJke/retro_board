import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../components/App'
import {
  markOwnBoardDeletion,
  requestBoardsRefresh,
  unmarkOwnBoardDeletion,
} from '../../lib/board-list-signals'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'
import type { Board, BoardListItem, WsMessage } from '../../types'

const api = vi.hoisted(() => ({
  refreshWorkspaceSession: vi.fn(),
  getBoards: vi.fn(),
  getBoard: vi.fn(),
  getBoardBySlug: vi.fn(),
  createBoard: vi.fn(),
  loginToWorkspace: vi.fn(),
  logoutWorkspace: vi.fn(),
  renameParticipant: vi.fn(),
}))

vi.mock('../../api', () => api)

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))

// Сокет команды: пустое состояние слушает по нему появление первой доски
const workspaceSocket = vi.hoisted(() => ({
  onMessage: null as ((msg: { event: string; data: Record<string, unknown> }) => void) | null,
}))

vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: (_room: string, onMessage: (msg: WsMessage) => void) => {
    workspaceSocket.onMessage = onMessage
    return { sendMessage: vi.fn(), connected: true }
  },
}))

// Вместо доски — её название, число досок в списке и кнопки, которые зовут обработчики App
vi.mock('../../components/BoardPage', () => ({
  default: ({
    board,
    boards,
    onBoardDeleted,
    onBoardsListDeleted,
  }: {
    board: Board
    boards: BoardListItem[]
    onBoardDeleted: (id: string) => void
    onBoardsListDeleted: (id: string) => void
  }) => (
    <div data-testid="board-page">
      <span data-testid="board-name">{board.name}</span>
      <span data-testid="boards-count">{boards.length}</span>
      <span data-testid="first-board-cards">{boards[0]?.cards_count ?? '-'}</span>
      <button onClick={() => onBoardDeleted(board.id)}>deleted-by-me</button>
      <button onClick={() => onBoardsListDeleted(board.id)}>deleted-event</button>
    </div>
  ),
}))

vi.mock('../../components/CreateBoardDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="create-dialog" /> : null),
}))

const workspace = { workspaceId: 'w-1', workspaceSlug: 'team', workspaceName: 'Платежи' }
const anna = { id: 'p-anna', name: 'Анна' }

const boardOf = (id: string, name: string, slug: string | null): Board => ({
  id,
  name,
  slug,
  max_votes: 5,
  created_at: '2026-03-01T10:00:00Z',
  columns: [],
})

const listItem = (id: string, name: string, slug: string | null, cards = 0): BoardListItem => ({
  id,
  name,
  slug,
  max_votes: 5,
  created_at: '2026-03-01T10:00:00Z',
  action_items_total: 0,
  action_items_open: 0,
  has_summary: false,
  cards_count: cards,
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  workspaceSocket.onMessage = null
  useAppStore.setState({
    username: 'Анна',
    workspace,
    participant: anna,
    aiEnabled: null,
    currentBoardId: null,
    _hasHydrated: true,
  })
  api.refreshWorkspaceSession.mockResolvedValue({})
})

describe('App — команда без досок', () => {
  it('показывает пустое состояние и не создаёт доску молча', async () => {
    api.getBoards.mockResolvedValue([])

    render(<App boardId="start" />)

    expect(await screen.findByTestId('no-boards-screen')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'В команде «Платежи» пока нет досок' })).toBeInTheDocument()
    expect(api.createBoard).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
    expect(screen.queryByText('Не удалось открыть доску')).not.toBeInTheDocument()
  })

  it('«Создать доску» открывает диалог создания', async () => {
    const user = userEvent.setup()
    api.getBoards.mockResolvedValue([])
    render(<App boardId="start" />)

    await user.click(await screen.findByTestId('empty-create-board-btn'))

    expect(screen.getByTestId('create-dialog')).toBeInTheDocument()
  })

  it('доску создал коллега — она открывается без перезагрузки', async () => {
    api.getBoards.mockResolvedValueOnce([])
    render(<App boardId="start" />)
    await screen.findByTestId('no-boards-screen')

    api.getBoards.mockResolvedValue([listItem('b-1', 'Спринт 1', 'sprint-1')])
    api.getBoard.mockResolvedValue(boardOf('b-1', 'Спринт 1', 'sprint-1'))
    act(() => {
      workspaceSocket.onMessage?.({ event: 'board_created', data: { id: 'b-1' } })
    })

    expect(await screen.findByTestId('board-name')).toHaveTextContent('Спринт 1')
    expect(router.replace).toHaveBeenCalledWith('/board/sprint-1')
  })
})

describe('App — адрес /board/start и доска «Start»', () => {
  it('/board/start открывает первую доску и подставляет её адрес', async () => {
    api.getBoards.mockResolvedValue([
      listItem('b-2', 'Спринт 2', 'sprint-2'),
      listItem('b-1', 'Спринт 1', 'sprint-1'),
    ])
    api.getBoard.mockResolvedValue(boardOf('b-2', 'Спринт 2', 'sprint-2'))

    render(<App boardId="start" />)

    expect(await screen.findByTestId('board-name')).toHaveTextContent('Спринт 2')
    expect(api.getBoard).toHaveBeenCalledWith('b-2')
    expect(router.replace).toHaveBeenCalledWith('/board/sprint-2')
  })

  it('доска «Start» открывается по своему адресу start-xxxxxx', async () => {
    api.getBoards.mockResolvedValue([
      listItem('b-2', 'Спринт 2', 'sprint-2'),
      listItem('b-1', 'Start', 'start-299b72'),
    ])
    api.getBoardBySlug.mockResolvedValue(boardOf('b-1', 'Start', 'start-299b72'))

    render(<App boardId="start-299b72" />)

    expect(await screen.findByTestId('board-name')).toHaveTextContent('Start')
    expect(api.getBoardBySlug).toHaveBeenCalledWith('start-299b72')
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('доска со slug «start» (старые данные) открывается по /board/start, а не подменяется первой', async () => {
    api.getBoards.mockResolvedValue([
      listItem('b-2', 'Спринт 2', 'sprint-2'),
      listItem('b-1', 'Start', 'start'),
    ])
    api.getBoard.mockResolvedValue(boardOf('b-1', 'Start', 'start'))

    render(<App boardId="start" />)

    expect(await screen.findByTestId('board-name')).toHaveTextContent('Start')
    expect(api.getBoard).toHaveBeenCalledWith('b-1')
    // Адрес уже верный — лишнего перехода нет
    expect(router.replace).not.toHaveBeenCalled()
  })
})

describe('App — удаление доски', () => {
  const twoBoards = [listItem('b-1', 'Спринт 1', 'sprint-1'), listItem('b-2', 'Спринт 2', 'sprint-2')]

  it('чужое удаление открытой доски: уведомление и переход к другой доске', async () => {
    const user = userEvent.setup()
    api.getBoards.mockResolvedValue(twoBoards)
    api.getBoardBySlug.mockResolvedValue(boardOf('b-1', 'Спринт 1', 'sprint-1'))
    render(<App boardId="sprint-1" />)
    await screen.findByTestId('board-page')

    await user.click(screen.getByText('deleted-event'))

    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Эту доску удалили'), 'info')
    expect(router.replace).toHaveBeenCalledWith('/board/start')
  })

  it('своё удаление: событие с сервера не даёт второго перехода и лишнего уведомления', async () => {
    const user = userEvent.setup()
    api.getBoards.mockResolvedValue(twoBoards)
    api.getBoardBySlug.mockResolvedValue(boardOf('b-1', 'Спринт 1', 'sprint-1'))
    render(<App boardId="sprint-1" />)
    await screen.findByTestId('board-page')

    // Диалог настроек помечает доску до запроса; событие board_deleted приходит раньше ответа
    markOwnBoardDeletion('b-1')
    try {
      await user.click(screen.getByText('deleted-event'))
      expect(showToast).not.toHaveBeenCalled()
      expect(router.replace).not.toHaveBeenCalled()

      // Ответ на запрос: единственный переход — к оставшейся доске
      await user.click(screen.getByText('deleted-by-me'))
      expect(router.replace).toHaveBeenCalledTimes(1)
      expect(router.replace).toHaveBeenCalledWith('/board/sprint-2')
      expect(showToast).not.toHaveBeenCalled()
    } finally {
      unmarkOwnBoardDeletion('b-1')
    }
  })

  it('удалена последняя доска: переход на /board/start, новая доска не создаётся', async () => {
    const user = userEvent.setup()
    api.getBoards.mockResolvedValue([twoBoards[0]])
    api.getBoardBySlug.mockResolvedValue(boardOf('b-1', 'Спринт 1', 'sprint-1'))
    render(<App boardId="sprint-1" />)
    await screen.findByTestId('board-page')

    await user.click(screen.getByText('deleted-by-me'))

    expect(router.replace).toHaveBeenCalledWith('/board/start')
    expect(api.createBoard).not.toHaveBeenCalled()
  })
})

describe('App — счётчики списка досок', () => {
  it('по просьбе панели досок список перечитывается с сервера', async () => {
    api.getBoards.mockResolvedValue([listItem('b-1', 'Спринт 1', 'sprint-1', 0)])
    api.getBoardBySlug.mockResolvedValue(boardOf('b-1', 'Спринт 1', 'sprint-1'))
    render(<App boardId="sprint-1" />)
    await screen.findByTestId('board-page')
    expect(screen.getByTestId('first-board-cards')).toHaveTextContent('0')

    // За это время на доске появилось девять карточек
    api.getBoards.mockResolvedValue([listItem('b-1', 'Спринт 1', 'sprint-1', 9)])
    act(() => requestBoardsRefresh())

    await waitFor(() => expect(screen.getByTestId('first-board-cards')).toHaveTextContent('9'))
  })

  it('сбой фонового обновления не показывает ошибку и оставляет прежний список', async () => {
    api.getBoards.mockResolvedValue([listItem('b-1', 'Спринт 1', 'sprint-1', 3)])
    api.getBoardBySlug.mockResolvedValue(boardOf('b-1', 'Спринт 1', 'sprint-1'))
    render(<App boardId="sprint-1" />)
    await screen.findByTestId('board-page')

    api.getBoards.mockRejectedValue({ response: { status: 500 } })
    act(() => requestBoardsRefresh())
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('first-board-cards')).toHaveTextContent('3')
    expect(screen.queryByText('Не удалось открыть доску')).not.toBeInTheDocument()
    expect(showToast).not.toHaveBeenCalled()
  })
})
