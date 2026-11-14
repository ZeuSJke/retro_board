import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import App from '../../components/App'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'
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

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

// Доска и диалог создания здесь не проверяются — только то, кому и когда показывается доска
vi.mock('../../components/BoardPage', () => ({
  default: ({ board }: { board: Board }) => <div data-testid="board-page">{board.name}</div>,
}))

vi.mock('../../components/CreateBoardDialog', () => ({
  default: () => null,
}))

const workspace = { workspaceId: 'w-1', workspaceSlug: 'team', workspaceName: 'Команда' }
const anna = { id: 'p-anna', name: 'Анна' }
const boris = { id: 'p-boris', name: 'Борис' }

const boardFor = (name: string): Board => ({
  id: 'b-1',
  name,
  slug: 'sprint',
  max_votes: 5,
  created_at: '2026-03-01T10:00:00Z',
  columns: [],
})

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

const unauthorized = () => Object.assign(new Error('Unauthorized'), { response: { status: 401 } })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppStore.setState({
    username: 'Анна',
    workspace,
    participant: anna,
    aiEnabled: null,
    currentBoardId: null,
    _hasHydrated: true,
  })
  api.refreshWorkspaceSession.mockResolvedValue({})
  api.getBoards.mockResolvedValue([listItem])
  api.getBoardBySlug.mockResolvedValue(boardFor('Доска Анны'))
})

describe('App — сессия и экран входа', () => {
  it('с действующей сессией сверяет её с сервером и открывает доску', async () => {
    render(<App boardId="sprint" />)

    expect(await screen.findByTestId('board-page')).toHaveTextContent('Доска Анны')
    expect(api.refreshWorkspaceSession).toHaveBeenCalledTimes(1)
  })

  it('401 возвращает на экран входа: без тостов, без экрана ошибки и без повторных запросов', async () => {
    api.refreshWorkspaceSession.mockImplementation(() => {
      // Так поступает перехватчик ответов: сбрасывает сессию и отклоняет запрос
      useAppStore.getState().clearSession()
      return Promise.reject(unauthorized())
    })

    render(<App boardId="sprint" />)

    expect(await screen.findByRole('button', { name: /войти на доску/i })).toBeInTheDocument()
    expect(screen.queryByText('Не удалось открыть доску')).not.toBeInTheDocument()
    expect(showToast).not.toHaveBeenCalled()

    // Ждём возможных повторов: сессии нет — запросов быть не должно
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(api.refreshWorkspaceSession).toHaveBeenCalledTimes(1)
    expect(api.getBoards).not.toHaveBeenCalled()
  })

  it('состояние старой версии (команда без участника) сразу ведёт на вход, без запросов', async () => {
    useAppStore.setState({ participant: null })

    render(<App boardId="sprint" />)

    expect(await screen.findByRole('button', { name: /войти на доску/i })).toBeInTheDocument()
    expect(screen.getByTestId('workspace-slug-input')).toHaveValue('team')
    expect(api.refreshWorkspaceSession).not.toHaveBeenCalled()
    expect(api.getBoards).not.toHaveBeenCalled()
  })

  it('вход без имени пользователя считается сессией: достаточно команды и участника', async () => {
    useAppStore.setState({ username: 'Аноним', participant: { id: 'p-x', name: 'Участник' } })

    render(<App boardId="sprint" />)

    expect(await screen.findByTestId('board-page')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /войти на доску/i })).not.toBeInTheDocument()
  })

  it('доску, загруженную для одного участника, другому не показывает — перечитывает', async () => {
    render(<App boardId="sprint" />)
    expect(await screen.findByTestId('board-page')).toHaveTextContent('Доска Анны')

    // Повторный вход другим участником: сервер соберёт для него свой вид доски
    let resolveBoard: (board: Board) => void = () => {}
    api.getBoardBySlug.mockReturnValue(
      new Promise<Board>((resolve) => {
        resolveBoard = resolve
      }),
    )
    act(() => {
      useAppStore.getState().setSession({ workspace, participant: boris })
    })

    // Пока новый ответ не пришёл, вид доски прошлого участника не показывается
    await waitFor(() => expect(screen.queryByTestId('board-page')).not.toBeInTheDocument())

    await act(async () => {
      resolveBoard(boardFor('Доска Бориса'))
      await Promise.resolve()
    })
    expect(await screen.findByTestId('board-page')).toHaveTextContent('Доска Бориса')
  })

  it('ошибка сервера при загрузке показывает экран с «Повторить», а не вход', async () => {
    api.getBoards.mockRejectedValue({ response: { status: 500, data: { detail: 'Внутренняя ошибка сервера' } } })

    render(<App boardId="sprint" />)

    expect(await screen.findByText('Не удалось открыть доску')).toBeInTheDocument()
    expect(screen.getByText('Внутренняя ошибка сервера')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
    expect(useAppStore.getState().participant).toEqual(anna)
  })
})
