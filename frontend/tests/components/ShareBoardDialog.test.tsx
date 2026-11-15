import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShareBoardDialog, {
  ShareBoardButton,
  ShareBoardMenuItem,
  openShareBoardDialog,
} from '../../components/ShareBoardDialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'

const mockGetWorkspaceInviteToken = vi.fn()

vi.mock('../../api/invite', () => ({
  getWorkspaceInviteToken: (...args: unknown[]) => mockGetWorkspaceInviteToken(...args),
}))

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
})

const TOKEN = 'MWx1oFtEG7ikF_SBeDA9UHH1Km9u4ZQG'
const board = { id: 'board-id-1', name: 'Ретро спринта 42', slug: 'retro-sprinta-42' }
const origin = window.location.origin

function httpError(status: number, detail: unknown = '') {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { detail } } })
}

describe('ShareBoardDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceInviteToken.mockResolvedValue(TOKEN)
    useAppStore.setState({
      workspace: { workspaceId: 'w-1', workspaceSlug: 'platform', workspaceName: 'Платформа' },
      participant: { id: 'p-1', name: 'Аня' },
    })
  })

  it('пока закрыт, токен приглашения не запрашивает', () => {
    render(<ShareBoardDialog open={false} onOpenChange={vi.fn()} board={board} />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockGetWorkspaceInviteToken).not.toHaveBeenCalled()
  })

  it('показывает ссылку на доску и приглашение в команду с токеном команды', async () => {
    render(<ShareBoardDialog open onOpenChange={vi.fn()} board={board} />)

    const dialog = await screen.findByRole('dialog', { name: 'Поделиться доской' })
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Ссылка на эту доску')).toHaveValue(
        `${origin}/join/${TOKEN}?board=retro-sprinta-42`,
      ),
    )
    expect(within(dialog).getByLabelText('Приглашение в команду')).toHaveValue(`${origin}/join/${TOKEN}`)
    expect(within(dialog).getByText('Открывает доски команды «Платформа».')).toBeInTheDocument()
    // Ссылки только для копирования
    expect(within(dialog).getByLabelText('Ссылка на эту доску')).toHaveAttribute('readonly')
  })

  it('у доски без slug в ссылке стоит её идентификатор', async () => {
    render(<ShareBoardDialog open onOpenChange={vi.fn()} board={{ ...board, slug: null }} />)

    await waitFor(() =>
      expect(screen.getByLabelText('Ссылка на эту доску')).toHaveValue(
        `${origin}/join/${TOKEN}?board=board-id-1`,
      ),
    )
  })

  it('рисует QR-код ссылки на доску прямо на странице, без картинок', async () => {
    render(<ShareBoardDialog open onOpenChange={vi.fn()} board={board} />)

    const qr = await screen.findByRole('img', { name: 'QR-код ссылки на доску «Ретро спринта 42»' })
    expect(qr.tagName.toLowerCase()).toBe('svg')
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+ \d+h\d+v1h-\d+z/)
    expect(document.querySelector('img')).toBeNull()
  })

  it('«Скопировать» кладёт в буфер нужную ссылку и подтверждает это на кнопке', async () => {
    const user = userEvent.setup()
    render(<ShareBoardDialog open onOpenChange={vi.fn()} board={board} />)
    await waitFor(() => expect(screen.getByLabelText('Ссылка на эту доску')).not.toHaveValue(''))

    await user.click(screen.getByRole('button', { name: 'Скопировать ссылку на доску' }))
    expect(await navigator.clipboard.readText()).toBe(`${origin}/join/${TOKEN}?board=retro-sprinta-42`)
    expect(screen.getByRole('button', { name: 'Скопировать ссылку на доску' })).toHaveTextContent('Скопировано')

    await user.click(screen.getByRole('button', { name: 'Скопировать приглашение в команду' }))
    expect(await navigator.clipboard.readText()).toBe(`${origin}/join/${TOKEN}`)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('«Показать крупно» оставляет один код на весь диалог и возвращает к ссылкам', async () => {
    const user = userEvent.setup()
    render(<ShareBoardDialog open onOpenChange={vi.fn()} board={board} />)
    await screen.findByRole('img', { name: /QR-код/ })

    await user.click(screen.getByRole('button', { name: 'Показать крупно' }))

    expect(await screen.findByRole('dialog', { name: 'Ретро спринта 42' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /QR-код/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Ссылка на эту доску')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'К ссылкам' }))
    expect(screen.getByLabelText('Ссылка на эту доску')).toHaveValue(
      `${origin}/join/${TOKEN}?board=retro-sprinta-42`,
    )
  })

  it('не получил токен — показывает причину и даёт повторить', async () => {
    const user = userEvent.setup()
    mockGetWorkspaceInviteToken.mockRejectedValueOnce(httpError(500, 'Внутренняя ошибка сервера'))
    render(<ShareBoardDialog open onOpenChange={vi.fn()} board={board} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Внутренняя ошибка сервера')
    expect(screen.queryByLabelText('Ссылка на эту доску')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Ссылка на эту доску')).toHaveValue(
        `${origin}/join/${TOKEN}?board=retro-sprinta-42`,
      ),
    )
  })

  it('каждое открытие запрашивает токен заново: перевыпущенное приглашение видно сразу', async () => {
    const { rerender } = render(<ShareBoardDialog open onOpenChange={vi.fn()} board={board} />)
    await waitFor(() => expect(screen.getByLabelText('Приглашение в команду')).toHaveValue(`${origin}/join/${TOKEN}`))

    rerender(<ShareBoardDialog open={false} onOpenChange={vi.fn()} board={board} />)
    mockGetWorkspaceInviteToken.mockResolvedValueOnce('rotated-token-123456')
    rerender(<ShareBoardDialog open onOpenChange={vi.fn()} board={board} />)

    await waitFor(() =>
      expect(screen.getByLabelText('Приглашение в команду')).toHaveValue(`${origin}/join/rotated-token-123456`),
    )
    expect(mockGetWorkspaceInviteToken).toHaveBeenCalledTimes(2)
  })
})

describe('ShareBoardButton и ShareBoardMenuItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceInviteToken.mockResolvedValue(TOKEN)
  })

  it('кнопка в шапке открывает диалог, закрытие возвращает к доске', async () => {
    const user = userEvent.setup()
    render(<ShareBoardButton board={board} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Поделиться доской' }))
    expect(await screen.findByRole('dialog', { name: 'Поделиться доской' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('пункт меню шапки (для телефона) открывает тот же диалог', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ShareBoardButton board={board} />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger>Экспорт</DropdownMenuTrigger>
          <DropdownMenuContent>
            <ShareBoardMenuItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Экспорт' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Поделиться доской' }))

    expect(await screen.findByRole('dialog', { name: 'Поделиться доской' })).toBeInTheDocument()
  })

  it('openShareBoardDialog открывает диалог из любого места; вместе с шапкой он закрывается', async () => {
    const { unmount } = render(<ShareBoardButton board={board} />)

    act(() => openShareBoardDialog())
    expect(await screen.findByRole('dialog', { name: 'Поделиться доской' })).toBeInTheDocument()

    unmount()
    render(<ShareBoardButton board={board} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
