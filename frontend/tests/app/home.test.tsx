import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomePage from '../../app/page'
import { useAppStore } from '../../store'

const api = vi.hoisted(() => ({
  getBoards: vi.fn(),
  createBoard: vi.fn(),
}))

vi.mock('../../api', () => api)

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

const board = (id: string, slug: string) => ({
  id,
  name: slug,
  slug,
  max_votes: 5,
  created_at: '2026-03-01T10:00:00Z',
  action_items_total: 0,
  action_items_open: 0,
  has_summary: false,
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppStore.setState({
    username: 'Анна',
    workspace: { workspaceId: 'w-1', workspaceSlug: 'team', workspaceName: 'Команда' },
    participant: { id: 'p-1', name: 'Анна' },
    currentBoardId: null,
    _hasHydrated: true,
  })
})

describe('Главная /', () => {
  it('открывает последнюю открытую доску, а если её нет в списке — первую', async () => {
    useAppStore.setState({ currentBoardId: 'b-2' })
    api.getBoards.mockResolvedValue([board('b-1', 'sprint-1'), board('b-2', 'sprint-2')])
    const first = render(<HomePage />)
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/board/sprint-2'))
    first.unmount()

    router.replace.mockClear()
    useAppStore.setState({ currentBoardId: 'b-gone' })
    render(<HomePage />)
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/board/sprint-1'))
  })

  it('без досок ведёт на страницу доски и ничего не создаёт молча', async () => {
    api.getBoards.mockResolvedValue([])

    render(<HomePage />)

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/board/start'))
    expect(api.createBoard).not.toHaveBeenCalled()
  })

  it('без сессии сразу ведёт на страницу входа, без запросов', async () => {
    useAppStore.setState({ participant: null })

    render(<HomePage />)

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/board/start'))
    expect(api.getBoards).not.toHaveBeenCalled()
  })

  it('ошибка сервера — сообщение с «Повторить», а не вечная загрузка', async () => {
    const user = userEvent.setup()
    api.getBoards.mockRejectedValueOnce({
      response: { status: 500, data: { detail: 'Внутренняя ошибка сервера' } },
    })

    render(<HomePage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить доски команды')
    expect(screen.getByText('Внутренняя ошибка сервера')).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()

    api.getBoards.mockResolvedValue([board('b-1', 'sprint-1')])
    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/board/sprint-1'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('сеть недоступна (ответа нет) — тоже сообщение с «Повторить»', async () => {
    api.getBoards.mockRejectedValue(new Error('Network Error'))

    render(<HomePage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте соединение')
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })

  it('401 — не ошибка: ведём на вход', async () => {
    api.getBoards.mockImplementation(() => {
      // Так поступает перехватчик ответов
      useAppStore.getState().clearSession()
      return Promise.reject(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }))
    })

    render(<HomePage />)

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/board/start'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
