import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CommandPalette from '../../components/CommandPalette'
import ShortcutsDialog, {
  KEYBOARD_SHORTCUTS,
  MOUSE_SHORTCUTS,
} from '../../components/ShortcutsDialog'
import Topbar from '../../components/Topbar'
import UserSettingsDialog from '../../components/UserSettingsDialog'
import WelcomeDialog from '../../components/WelcomeDialog'
import { TooltipProvider } from '../../components/ui/tooltip'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'
import type { Board } from '../../types'

const api = vi.hoisted(() => ({
  loginToWorkspace: vi.fn(),
  logoutWorkspace: vi.fn(),
  renameParticipant: vi.fn(),
}))

vi.mock('../../api', () => api)

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

const setTheme = vi.hoisted(() => vi.fn())

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme }),
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const board: Board = {
  id: 'b-1',
  name: 'Спринт 42 — релиз платежей',
  slug: 'sprint-42',
  max_votes: 5,
  created_at: '2026-03-01T10:00:00Z',
  columns: [],
  moods: [],
}

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  // cmdk прокручивает выбранный пункт в область видимости
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppStore.setState({
    username: 'Аноним',
    workspace: null,
    participant: null,
    aiEnabled: null,
    currentBoardId: null,
  })
})

function renderTopbar(props: Partial<React.ComponentProps<typeof Topbar>> = {}) {
  const handlers = {
    onOpenBoardsDrawer: vi.fn(),
    onOpenBoardSettings: vi.fn(),
    onOpenUserSettings: vi.fn(),
    onOpenMood: vi.fn(),
    onOpenSummary: vi.fn(),
    onExportMarkdown: vi.fn(),
    onExportPDF: vi.fn(),
  }
  const view = render(
    <TooltipProvider>
      <Topbar
        board={board}
        workspaceName="Команда"
        username="Анна"
        myId="p-me"
        participants={[{ id: 'p-me', name: 'Анна' }]}
        readyIds={[]}
        facilitatorId={null}
        connected
        {...handlers}
        {...props}
      />
    </TooltipProvider>,
  )
  return { ...view, ...handlers }
}

describe('Topbar — кнопка «Панель управления»', () => {
  it('ведёт к задачам всей команды и не несёт счётчика задач этой доски', () => {
    renderTopbar({ openActionItemsCount: 7 })

    const link = screen.getByTestId('dashboard-nav-link')
    expect(link).toHaveAttribute('href', '/dashboard')
    expect(link).toHaveTextContent(/^Панель управления$/)
    expect(link).not.toHaveTextContent('7')
  })

  it('название доски целиком доступно в подсказке, когда не помещается', () => {
    renderTopbar()
    expect(screen.getByTestId('topbar-board-name')).toHaveAttribute('title', 'Спринт 42 — релиз платежей')
  })
})

describe('Topbar — меню доски (на телефоне в нём всё, что не поместилось в шапку)', () => {
  it('в меню есть настроение, панель управления, настройки доски и тема', async () => {
    const user = userEvent.setup()
    const { onOpenMood, onOpenBoardSettings } = renderTopbar({
      board: { ...board, moods: [{ id: 'm-1', board_id: 'b-1', author: 'Анна', score: 4, note: null, created_at: '' }] },
    })

    await user.click(screen.getByTestId('export-menu-btn'))
    const menu = await screen.findByRole('menu')

    expect(within(menu).getByTestId('menu-dashboard-item')).toHaveAttribute('href', '/dashboard')
    expect(within(menu).getByRole('menuitem', { name: 'Итоги ретро и AI' })).toBeInTheDocument()
    expect(within(menu).getByTestId('menu-mood-item')).toHaveTextContent('4.0')

    await user.click(within(menu).getByTestId('menu-mood-item'))
    expect(onOpenMood).toHaveBeenCalledTimes(1)

    await user.click(screen.getByTestId('export-menu-btn'))
    await user.click(await screen.findByTestId('menu-board-settings-item'))
    expect(onOpenBoardSettings).toHaveBeenCalledTimes(1)

    await user.click(screen.getByTestId('export-menu-btn'))
    await user.click(await screen.findByTestId('menu-theme-item'))
    expect(setTheme).toHaveBeenCalledWith('dark')
  })
})

describe('ShortcutsDialog — шпаргалка соответствует доске', () => {
  const allLabels = [...KEYBOARD_SHORTCUTS, ...MOUSE_SHORTCUTS].map((row) => row.label).join('\n')

  it('использует единые термины: «Задачи», «ведущий», «окно фокуса»', () => {
    expect(allLabels).toContain('панель «Задачи»')
    expect(allLabels).toContain('в окне фокуса')
    expect(allLabels).toContain('у ведущего')
    expect(allLabels).not.toMatch(/фасилитатор/i)
    expect(allLabels).not.toMatch(/spotlight/i)
    expect(allLabels).not.toContain('«Итоги»')
  })

  it('описывает выделение кружком и группировку перетаскиванием с Alt или Shift', () => {
    render(<ShortcutsDialog open onOpenChange={vi.fn()} />)
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByRole('region', { name: 'Клавиатура' })).toBeInTheDocument()
    const mouse = within(dialog).getByRole('region', { name: 'Мышь' })
    expect(mouse).toHaveTextContent('По кружку слева от автора')
    expect(mouse).toHaveTextContent('выделить все карточки между ней и выбранной раньше')
    expect(mouse).toHaveTextContent('объединить их в новую группу')
    expect(within(mouse).getByText('Alt')).toBeInTheDocument()
    expect(within(mouse).getAllByText('Shift').length).toBeGreaterThanOrEqual(2)
    expect(dialog).toHaveTextContent('не открыто окно или меню')
  })
})

describe('CommandPalette — заголовок для экранных дикторов', () => {
  it('диалог назван «Палитра команд»', () => {
    render(
      <CommandPalette
        boards={[]}
        open
        onOpenChange={vi.fn()}
        onSelectBoard={vi.fn()}
        onCreateBoard={vi.fn()}
        onNavigateDashboard={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Палитра команд' })).toBeInTheDocument()
    expect(screen.getByText('Панель управления')).toBeInTheDocument()
  })
})

describe('WelcomeDialog — ошибки входа', () => {
  async function submitLogin(error: unknown) {
    const user = userEvent.setup()
    api.loginToWorkspace.mockRejectedValue(error)
    render(<WelcomeDialog onConfirm={vi.fn()} />)

    await user.type(screen.getByTestId('welcome-name-input'), 'Анна')
    await user.type(screen.getByTestId('workspace-slug-input'), 'team')
    await user.type(screen.getByTestId('workspace-key-input'), 'secret')
    await user.click(screen.getByTestId('welcome-submit-btn'))
    return screen.findByRole('alert')
  }

  it('422 разбирается по полям: длинное имя названо «Имя»', async () => {
    const alert = await submitLogin({
      response: {
        status: 422,
        data: { detail: [{ type: 'string_too_long', loc: ['body', 'name'], ctx: { max_length: 60 } }] },
      },
    })
    expect(alert).toHaveTextContent('Имя: не длиннее 60 символов')
  })

  it('422 с проверкой сервера показывает её текст', async () => {
    const alert = await submitLogin({
      response: {
        status: 422,
        data: {
          detail: [
            { type: 'value_error', loc: ['body', 'name'], msg: 'Value error, Имя не должно содержать HTML-теги' },
          ],
        },
      },
    })
    expect(alert).toHaveTextContent('Имя не должно содержать HTML-теги')
  })

  it('422 по ключу и коду команды называет поля словами интерфейса', async () => {
    const alert = await submitLogin({
      response: {
        status: 422,
        data: {
          detail: [
            { type: 'string_too_short', loc: ['body', 'access_key'], ctx: { min_length: 4 } },
            { type: 'string_too_long', loc: ['body', 'workspace_slug'], ctx: { max_length: 80 } },
          ],
        },
      },
    })
    expect(alert).toHaveTextContent('Ключ доступа: не короче 4 символов')
    expect(alert).toHaveTextContent('Код команды: не длиннее 80 символов')
  })

  it('401 — неверные код или ключ, а не «сессия завершилась»', async () => {
    const alert = await submitLogin({ response: { status: 401, data: { detail: 'Invalid credentials' } } })
    expect(alert).toHaveTextContent('Неверный код команды или ключ доступа')
  })

  it('сервер недоступен — понятная просьба повторить, без тоста', async () => {
    const alert = await submitLogin(new Error('Network Error'))
    expect(alert).toHaveTextContent('Не удалось подключиться к команде')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('экран входа говорит о «команде», а не о пространстве', () => {
    render(<WelcomeDialog onConfirm={vi.fn()} />)
    expect(screen.getByText('Войдите в свою команду, чтобы начать ретроспективу.')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/пространств/i)
  })
})

describe('UserSettingsDialog — имя и команда', () => {
  beforeEach(() => {
    useAppStore.setState({
      username: 'Анна',
      workspace: { workspaceId: 'w-1', workspaceSlug: 'payments', workspaceName: 'Платежи' },
      participant: { id: 'p-me', name: 'Анна' },
    })
  })

  it('код команды подписан словами', () => {
    render(<UserSettingsDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByText('Код команды: payments')).toBeInTheDocument()
  })

  it('ошибка 422 при смене имени показана по делу', async () => {
    const user = userEvent.setup()
    api.renameParticipant.mockRejectedValue({
      response: {
        status: 422,
        data: { detail: [{ type: 'string_too_long', loc: ['body', 'name'], ctx: { max_length: 60 } }] },
      },
    })
    render(<UserSettingsDialog open onOpenChange={vi.fn()} />)

    const input = screen.getByLabelText('Имя участника')
    await user.clear(input)
    await user.type(input, 'Анна Петрова')
    await user.click(screen.getByTestId('profile-save-btn'))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Имя: не длиннее 60 символов', 'error'),
    )
  })
})
