import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BoardSettingsDialog from '../../components/BoardSettingsDialog'
import HiddenCollectBanner from '../../components/HiddenCollectBanner'
import MoodDialog from '../../components/MoodDialog'
import SessionBar from '../../components/SessionBar'
import SummaryModal from '../../components/SummaryModal'
import Topbar from '../../components/Topbar'
import UserSettingsDialog from '../../components/UserSettingsDialog'
import WelcomeDialog from '../../components/WelcomeDialog'
import { TooltipProvider } from '../../components/ui/tooltip'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'
import type { Board, BoardMood, FacilitatorInfo } from '../../types'

const api = vi.hoisted(() => ({
  loginToWorkspace: vi.fn(),
  logoutWorkspace: vi.fn(),
  renameParticipant: vi.fn(),
  submitBoardMood: vi.fn(),
  updateBoard: vi.fn(),
  deleteBoard: vi.fn(),
  regenerateBoardSummary: vi.fn(),
}))

vi.mock('../../api', () => api)

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: React.ReactNode; href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const workspace = { workspaceId: 'w-1', workspaceSlug: 'team', workspaceName: 'Команда' }
const me = { id: 'p-me', name: 'Анна' }

function resetStore() {
  useAppStore.setState({
    username: 'Аноним',
    workspace: null,
    participant: null,
    aiEnabled: null,
    currentBoardId: null,
  })
}

beforeAll(() => {
  // Radix Switch измеряет себя через ResizeObserver, которого нет в jsdom
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetStore()
})

// ── вход ─────────────────────────────────────────────────────────────────────

describe('WelcomeDialog — вход создаёт участника', () => {
  it('имя необязательно: входим только с кодом команды и ключом', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    api.loginToWorkspace.mockResolvedValue({
      workspace,
      participant: { id: 'p-new', name: 'Участник' },
    })
    render(<WelcomeDialog onConfirm={onConfirm} />)

    const submit = screen.getByRole('button', { name: /войти на доску/i })
    expect(submit).toBeDisabled()

    await user.type(screen.getByTestId('workspace-slug-input'), 'team')
    await user.type(screen.getByTestId('workspace-key-input'), 'secret')
    expect(submit).toBeEnabled()
    await user.click(submit)

    // Без имени поле name не отправляется — сервер подставит «Участник»
    await waitFor(() =>
      expect(api.loginToWorkspace).toHaveBeenCalledWith({ workspace_slug: 'team', access_key: 'secret' }),
    )
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Участник'))
    const state = useAppStore.getState()
    expect(state.participant).toEqual({ id: 'p-new', name: 'Участник' })
    expect(state.workspace).toEqual(workspace)
  })

  it('имя уходит на сервер, а в стор попадает участник из ответа', async () => {
    const user = userEvent.setup()
    api.loginToWorkspace.mockResolvedValue({ workspace, participant: me })
    render(<WelcomeDialog onConfirm={vi.fn()} />)

    await user.type(screen.getByTestId('welcome-name-input'), '  Анна  ')
    await user.type(screen.getByTestId('workspace-slug-input'), 'team')
    await user.type(screen.getByTestId('workspace-key-input'), 'secret')
    await user.click(screen.getByRole('button', { name: /войти на доску/i }))

    await waitFor(() =>
      expect(api.loginToWorkspace).toHaveBeenCalledWith({
        workspace_slug: 'team',
        access_key: 'secret',
        name: 'Анна',
      }),
    )
    await waitFor(() => expect(useAppStore.getState().participant).toEqual(me))
  })

  it('неверный ключ: ошибка в форме, сессии нет, тостов нет', async () => {
    const user = userEvent.setup()
    api.loginToWorkspace.mockRejectedValue({ response: { status: 401 } })
    render(<WelcomeDialog onConfirm={vi.fn()} />)

    await user.type(screen.getByTestId('workspace-slug-input'), 'team')
    await user.type(screen.getByTestId('workspace-key-input'), 'wrong')
    await user.click(screen.getByRole('button', { name: /войти на доску/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный код команды или ключ доступа')
    expect(useAppStore.getState().participant).toBeNull()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('после обновления со старой версии подставляет имя и код команды', () => {
    // Так выглядит состояние версии 0 после миграции: команда известна, участника нет
    useAppStore.setState({ username: 'Анна', workspace, participant: null })
    render(<WelcomeDialog onConfirm={vi.fn()} />)

    expect(screen.getByTestId('welcome-name-input')).toHaveValue('Анна')
    expect(screen.getByTestId('workspace-slug-input')).toHaveValue('team')
    expect(screen.getByTestId('workspace-key-input')).toHaveValue('')
  })
})

// ── профиль: выход и переименование ──────────────────────────────────────────

describe('UserSettingsDialog — выход и имя', () => {
  beforeEach(() => {
    useAppStore.setState({ username: 'Анна', workspace, participant: me })
  })

  it('«Выйти» сначала завершает сессию на сервере и только потом чистит стор', async () => {
    const user = userEvent.setup()
    let finishLogout: () => void = () => {}
    api.logoutWorkspace.mockReturnValue(
      new Promise<void>((resolve) => {
        finishLogout = resolve
      }),
    )
    const onOpenChange = vi.fn()
    render(<UserSettingsDialog open onOpenChange={onOpenChange} />)

    await user.click(screen.getByTestId('logout-btn'))

    expect(api.logoutWorkspace).toHaveBeenCalledTimes(1)
    // Сервер ещё не ответил — локальная сессия на месте
    expect(useAppStore.getState().participant).toEqual(me)

    await act(async () => {
      finishLogout()
      await Promise.resolve()
    })

    await waitFor(() => expect(useAppStore.getState().participant).toBeNull())
    expect(useAppStore.getState().workspace).toBeNull()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('если сервер недоступен, сессия остаётся и показано одно сообщение', async () => {
    const user = userEvent.setup()
    api.logoutWorkspace.mockRejectedValue(new Error('Network Error'))
    render(<UserSettingsDialog open onOpenChange={vi.fn()} />)

    await user.click(screen.getByTestId('logout-btn'))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Не удалось выйти: сервер недоступен', 'error'),
    )
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().participant).toEqual(me)
    expect(useAppStore.getState().workspace).toEqual(workspace)
  })

  it('переименование идёт через сервер: идентификатор участника не меняется', async () => {
    const user = userEvent.setup()
    api.renameParticipant.mockResolvedValue({ id: 'p-me', name: 'Анна Петрова' })
    render(<UserSettingsDialog open onOpenChange={vi.fn()} />)

    const input = screen.getByLabelText('Имя участника')
    await user.clear(input)
    await user.type(input, 'Анна Петрова')
    await user.click(screen.getByTestId('profile-save-btn'))

    await waitFor(() => expect(api.renameParticipant).toHaveBeenCalledWith('Анна Петрова'))
    await waitFor(() =>
      expect(useAppStore.getState().participant).toEqual({ id: 'p-me', name: 'Анна Петрова' }),
    )
  })

  it('то же имя запрос не отправляет', async () => {
    const user = userEvent.setup()
    render(<UserSettingsDialog open onOpenChange={vi.fn()} />)
    await user.click(screen.getByTestId('profile-save-btn'))
    expect(api.renameParticipant).not.toHaveBeenCalled()
  })

  it('из профиля можно перейти в администрирование', () => {
    render(<UserSettingsDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByTestId('admin-panel-row')).toHaveTextContent('Администрирование')
    expect(
      screen.getByRole('link', { name: 'Администрирование — открыть панель' }),
    ).toHaveAttribute('href', '/admin')
  })
})

// ── ведущий: по идентификатору, передача и перехват роли ─────────────────────

const noFacilitator: FacilitatorInfo = { id: null, name: null, online: false }

function renderSessionBar(props: Partial<React.ComponentProps<typeof SessionBar>> = {}) {
  return render(
    <TooltipProvider>
      <SessionBar
        facilitator={noFacilitator}
        phase={null}
        myId="p-me"
        onlineCount={2}
        readyIds={[]}
        isLocked={false}
        usedVotes={0}
        maxVotes={5}
        timer={{ duration: 300, remaining: 300, running: false }}
        autoAdvance={false}
        soundMuted
        onToggleSoundMuted={vi.fn()}
        onAutoAdvanceChange={vi.fn()}
        onTimerStart={vi.fn()}
        onTimerPause={vi.fn()}
        onTimerReset={vi.fn()}
        onAddTime={vi.fn()}
        onFacilitatorStart={vi.fn()}
        onFacilitatorStop={vi.fn()}
        onPhaseChange={vi.fn()}
        onNextPhase={vi.fn()}
        onToggleReady={vi.fn()}
        onSendReaction={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  )
}

describe('SessionBar — роль ведущего по идентификатору участника', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ведущий видит управление сессией', () => {
    renderSessionBar({
      facilitator: { id: 'p-me', name: 'Анна', online: true },
      phase: 'brainstorm',
    })
    expect(screen.getByTestId('next-phase-btn')).toBeInTheDocument()
    expect(screen.getByTestId('stop-facilitator-btn')).toBeInTheDocument()
    expect(screen.getByTestId('facilitator-badge')).toHaveTextContent('Анна (вы)')
  })

  it('тёзка ведущего ведущим не считается', () => {
    renderSessionBar({
      facilitator: { id: 'p-other', name: 'Анна', online: true },
      phase: 'brainstorm',
    })
    expect(screen.queryByTestId('next-phase-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('stop-facilitator-btn')).not.toBeInTheDocument()
    expect(screen.getByTestId('facilitator-badge')).toHaveTextContent(/^Анна$/)
  })

  it('готовность — по своему идентификатору', () => {
    const view = renderSessionBar({
      facilitator: { id: 'p-other', name: 'Борис', online: true },
      phase: 'discuss',
      readyIds: ['p-namesake'],
    })
    expect(screen.getByTestId('ready-toggle-btn')).toHaveTextContent('Я закончил(а)')
    view.unmount()

    renderSessionBar({
      facilitator: { id: 'p-other', name: 'Борис', online: true },
      phase: 'discuss',
      readyIds: ['p-namesake', 'p-me'],
    })
    expect(screen.getByTestId('ready-toggle-btn')).toHaveTextContent('Готов(а)')
    expect(screen.getByTestId('ready-toggle-btn')).toHaveTextContent('2/2')
  })

  it('пока ведущий в сети, забрать роль нельзя', () => {
    renderSessionBar({
      facilitator: { id: 'p-other', name: 'Борис', online: true },
      phase: 'discuss',
      onFacilitatorTakeover: vi.fn(),
    })
    expect(screen.queryByTestId('takeover-facilitator-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('facilitator-offline-badge')).not.toBeInTheDocument()
  })

  it('ведущий пропал: роль можно забрать через 15 секунд', () => {
    vi.useFakeTimers()
    const onFacilitatorTakeover = vi.fn()
    renderSessionBar({
      facilitator: { id: 'p-other', name: 'Борис', online: false },
      phase: 'discuss',
      onFacilitatorTakeover,
    })

    expect(screen.getByTestId('facilitator-offline-badge')).toBeInTheDocument()
    const button = screen.getByTestId('takeover-facilitator-btn')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Забрать роль через 15 с')

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Забрать роль через 5 с')

    act(() => {
      vi.advanceTimersByTime(5_500)
    })
    expect(button).toBeEnabled()
    expect(button).toHaveTextContent(/^Забрать роль$/)

    act(() => {
      button.click()
    })
    expect(onFacilitatorTakeover).toHaveBeenCalledTimes(1)
  })

  it('самому ведущему «не в сети» и перехват не показываются', () => {
    renderSessionBar({
      facilitator: { id: 'p-me', name: 'Анна', online: false },
      phase: 'discuss',
      onFacilitatorTakeover: vi.fn(),
    })
    expect(screen.queryByTestId('takeover-facilitator-btn')).not.toBeInTheDocument()
  })
})

const board: Board = {
  id: 'b-1',
  name: 'Спринт 42',
  slug: 'sprint-42',
  max_votes: 5,
  created_at: '2026-03-01T10:00:00Z',
  created_by_id: 'p-creator',
  columns: [],
}

function renderTopbar(props: Partial<React.ComponentProps<typeof Topbar>> = {}) {
  return render(
    <TooltipProvider>
      <Topbar
        board={board}
        workspaceName="Команда"
        username="Анна"
        myId="p-me"
        participants={[
          { id: 'p-me', name: 'Анна' },
          { id: 'p-2', name: 'Анна' },
          { id: 'p-3', name: 'Борис' },
        ]}
        readyIds={['p-2']}
        facilitatorId="p-me"
        connected
        onOpenBoardsDrawer={vi.fn()}
        onOpenBoardSettings={vi.fn()}
        onOpenUserSettings={vi.fn()}
        onOpenMood={vi.fn()}
        onOpenSummary={vi.fn()}
        onExportMarkdown={vi.fn()}
        onExportPDF={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  )
}

describe('Topbar — участники на доске', () => {
  it('тёзки — отдельные строки; «вы» и «Ведущий» отмечены по идентификатору', async () => {
    const user = userEvent.setup()
    renderTopbar()

    await user.click(screen.getByRole('button', { name: 'Онлайн участники' }))
    const rows = await screen.findAllByTestId('presence-row')

    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Анна (вы)')
    expect(rows[0]).toHaveTextContent('Ведущий')
    // Тёзка — не «вы» и не ведущий
    expect(rows[1]).toHaveTextContent('Анна')
    expect(rows[1]).not.toHaveTextContent('(вы)')
    expect(rows[1]).not.toHaveTextContent('Ведущий')
  })

  it('ведущий передаёт роль выбранному участнику — по его идентификатору', async () => {
    const user = userEvent.setup()
    const onTransferFacilitator = vi.fn()
    renderTopbar({ onTransferFacilitator })

    await user.click(screen.getByRole('button', { name: 'Онлайн участники' }))
    const buttons = await screen.findAllByTestId('transfer-facilitator-btn')
    // Себе роль не передаём: кнопки только у двух других участников
    expect(buttons).toHaveLength(2)

    await user.click(buttons[0])
    expect(onTransferFacilitator).toHaveBeenCalledWith('p-2')
  })

  it('не ведущему передача роли недоступна', async () => {
    const user = userEvent.setup()
    renderTopbar({ facilitatorId: 'p-3' })

    await user.click(screen.getByRole('button', { name: 'Онлайн участники' }))
    await screen.findAllByTestId('presence-row')
    expect(screen.queryByTestId('transfer-facilitator-btn')).not.toBeInTheDocument()
  })
})

// ── скрытый сбор ─────────────────────────────────────────────────────────────

describe('HiddenCollectBanner — состояние скрытого сбора', () => {
  it('модератор видит число скрытых карточек и кнопку раскрытия', async () => {
    const user = userEvent.setup()
    const onReveal = vi.fn()
    render(<HiddenCollectBanner inSession={false} maskedCount={3} canReveal onReveal={onReveal} />)

    expect(screen.getByTestId('hidden-collect-banner')).toHaveTextContent(
      'Скрытый сбор идёт — вы видите только свои карточки',
    )
    expect(screen.getByTestId('hidden-cards-count')).toHaveTextContent('Скрыто чужих: 3')

    await user.click(screen.getByTestId('reveal-cards-btn'))
    expect(onReveal).toHaveBeenCalledTimes(1)
  })

  it('участнику кнопка недоступна — написано, кто может раскрыть', () => {
    render(<HiddenCollectBanner inSession={false} maskedCount={1} canReveal={false} onReveal={vi.fn()} />)

    expect(screen.queryByTestId('reveal-cards-btn')).not.toBeInTheDocument()
    expect(screen.getByText('Раскрыть может создатель доски')).toBeInTheDocument()
  })

  it('в сессии ведущего кнопки нет: карточки откроет этап «Раскрытие»', () => {
    render(<HiddenCollectBanner inSession maskedCount={0} canReveal onReveal={vi.fn()} />)

    expect(screen.getByTestId('hidden-collect-banner')).toHaveTextContent('Идёт штурм')
    expect(screen.getByTestId('hidden-cards-count')).toHaveTextContent('Чужих карточек пока нет')
    expect(screen.queryByTestId('reveal-cards-btn')).not.toBeInTheDocument()
    expect(screen.getByText(/откроются всем на этапе «Раскрытие»/)).toBeInTheDocument()
  })

  it('на заблокированной доске раскрытие отключено', () => {
    render(<HiddenCollectBanner inSession={false} maskedCount={2} canReveal locked onReveal={vi.fn()} />)
    expect(screen.getByTestId('reveal-cards-btn')).toBeDisabled()
  })
})

describe('BoardSettingsDialog — скрытый сбор, анонимность и права', () => {
  it('у настроек однозначные подписи', () => {
    render(
      <BoardSettingsDialog open onOpenChange={vi.fn()} board={board} onBoardUpdated={vi.fn()} onBoardDeleted={vi.fn()} />,
    )
    expect(screen.getByText('Скрытый сбор')).toBeInTheDocument()
    expect(screen.getByText('Анонимный режим')).toBeInTheDocument()
    expect(screen.queryByText('Скрывать карточки в штурме')).not.toBeInTheDocument()
    expect(screen.queryByText('Анонимные карточки')).not.toBeInTheDocument()
  })

  it('переключатель «Скрытый сбор» сохраняет hide_cards_until_reveal', async () => {
    const user = userEvent.setup()
    api.updateBoard.mockResolvedValue({ ...board, hide_cards_until_reveal: true, cards_hidden: true })
    const onBoardUpdated = vi.fn()
    render(
      <BoardSettingsDialog open onOpenChange={vi.fn()} board={board} onBoardUpdated={onBoardUpdated} onBoardDeleted={vi.fn()} />,
    )

    await user.click(screen.getByTestId('hide-cards-switch'))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(api.updateBoard).toHaveBeenCalledWith(
        'b-1',
        expect.objectContaining({ hide_cards_until_reveal: true, anonymous_votes: false }),
      ),
    )
    await waitFor(() =>
      expect(onBoardUpdated).toHaveBeenCalledWith(expect.objectContaining({ cards_hidden: true })),
    )
  })

  it('не модератору переключатели приватности недоступны — с объяснением, а остальное сохраняется', async () => {
    const user = userEvent.setup()
    api.updateBoard.mockResolvedValue(board)
    render(
      <BoardSettingsDialog
        open
        onOpenChange={vi.fn()}
        board={board}
        canModerate={false}
        onBoardUpdated={vi.fn()}
        onBoardDeleted={vi.fn()}
      />,
    )

    expect(screen.getByTestId('hide-cards-switch')).toBeDisabled()
    expect(screen.getByTestId('anonymous-switch')).toBeDisabled()
    expect(screen.getByTestId('privacy-settings-hint')).toHaveTextContent(
      'Скрытый сбор и анонимный режим меняет создатель доски или ведущий',
    )
    // Нажатие на отключённый переключатель ничего не меняет: сервер получит прежние значения
    await user.click(screen.getByTestId('hide-cards-switch'))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() =>
      expect(api.updateBoard).toHaveBeenCalledWith(
        'b-1',
        expect.objectContaining({
          hide_cards_until_reveal: Boolean(board.hide_cards_until_reveal),
          anonymous_votes: Boolean(board.anonymous_votes),
        }),
      ),
    )
  })

  it('модератору переключатели приватности доступны, подсказки нет', () => {
    render(
      <BoardSettingsDialog open onOpenChange={vi.fn()} board={board} canModerate onBoardUpdated={vi.fn()} onBoardDeleted={vi.fn()} />,
    )
    expect(screen.getByTestId('hide-cards-switch')).toBeEnabled()
    expect(screen.getByTestId('anonymous-switch')).toBeEnabled()
    expect(screen.queryByTestId('privacy-settings-hint')).not.toBeInTheDocument()
  })

  it('показывает, идёт сбор или карточки уже раскрыты', () => {
    const collecting = render(
      <BoardSettingsDialog
        open
        onOpenChange={vi.fn()}
        board={{ ...board, hide_cards_until_reveal: true, cards_revealed: false }}
        onBoardUpdated={vi.fn()}
        onBoardDeleted={vi.fn()}
      />,
    )
    expect(screen.getByTestId('hidden-collect-state')).toHaveTextContent('сбор идёт')
    collecting.unmount()

    render(
      <BoardSettingsDialog
        open
        onOpenChange={vi.fn()}
        board={{ ...board, hide_cards_until_reveal: true, cards_revealed: true }}
        onBoardUpdated={vi.fn()}
        onBoardDeleted={vi.fn()}
      />,
    )
    expect(screen.getByTestId('hidden-collect-state')).toHaveTextContent('карточки раскрыты')
  })

  it('удалить доску может только модератор — остальным кнопка отключена с причиной', () => {
    const participantView = render(
      <BoardSettingsDialog open onOpenChange={vi.fn()} board={board} canModerate={false} onBoardUpdated={vi.fn()} onBoardDeleted={vi.fn()} />,
    )
    expect(screen.getByTestId('delete-board-btn')).toBeDisabled()
    expect(screen.getByText('Удалить доску может её создатель или ведущий')).toBeInTheDocument()
    participantView.unmount()

    render(
      <BoardSettingsDialog open onOpenChange={vi.fn()} board={board} canModerate onBoardUpdated={vi.fn()} onBoardDeleted={vi.fn()} />,
    )
    expect(screen.getByTestId('delete-board-btn')).toBeEnabled()
    expect(screen.queryByText('Удалить доску может её создатель или ведущий')).not.toBeInTheDocument()
  })
})

// ── настроение ───────────────────────────────────────────────────────────────

const mood = (id: string, extra: Partial<BoardMood> = {}): BoardMood => ({
  id,
  board_id: 'b-1',
  author: 'Борис',
  participant_id: 'p-boris',
  score: 4,
  note: null,
  created_at: '2026-03-01T10:00:00Z',
  mine: false,
  ...extra,
})

describe('MoodDialog — своя оценка и анонимный режим', () => {
  it('свою оценку берёт по признаку mine, а не по имени', () => {
    render(
      <MoodDialog
        open
        onOpenChange={vi.fn()}
        boardId="b-1"
        moods={[
          // Оценка тёзки: то же имя, но не моя
          mood('m-1', { author: 'Анна', participant_id: 'p-namesake', score: 1, note: 'чужая' }),
          mood('m-2', { author: 'Анна', participant_id: 'p-me', score: 5, note: 'моя', mine: true }),
        ]}
        onMoodSubmitted={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/Короткий комментарий/)).toHaveValue('моя')
  })

  it('отправляет только оценку и комментарий — автора сервер берёт из сессии', async () => {
    const user = userEvent.setup()
    const saved = mood('m-9', { author: 'Анна', participant_id: 'p-me', score: 2, mine: true })
    api.submitBoardMood.mockResolvedValue(saved)
    const onMoodSubmitted = vi.fn()
    render(<MoodDialog open onOpenChange={vi.fn()} boardId="b-1" moods={[]} onMoodSubmitted={onMoodSubmitted} />)

    await user.click(screen.getByTestId('mood-option-2'))
    await user.click(screen.getByTestId('mood-submit-btn'))

    await waitFor(() => expect(api.submitBoardMood).toHaveBeenCalledWith('b-1', { score: 2, note: null }))
    await waitFor(() => expect(onMoodSubmitted).toHaveBeenCalledWith(saved))
  })

  it('в анонимном режиме имён в откликах нет', () => {
    render(
      <MoodDialog
        open
        onOpenChange={vi.fn()}
        boardId="b-1"
        anonymous
        moods={[
          mood('m-1', { author: 'Участник', participant_id: null, note: 'устали' }),
          // Свою оценку сервер отдаёт с настоящим именем — показываем «Вы»
          mood('m-2', { author: 'Анна', participant_id: 'p-me', mine: true }),
        ]}
        onMoodSubmitted={vi.fn()}
      />,
    )

    const entries = screen.getAllByTestId('mood-entry')
    expect(entries[0]).toHaveTextContent('Участник')
    expect(entries[1]).toHaveTextContent('Вы')
    expect(screen.queryByText('Анна')).not.toBeInTheDocument()
    expect(screen.getByText(/имена в откликах скрыты/)).toBeInTheDocument()
  })

  it('вне анонимного режима имена видны, своя оценка помечена', () => {
    render(
      <MoodDialog
        open
        onOpenChange={vi.fn()}
        boardId="b-1"
        moods={[mood('m-1'), mood('m-2', { author: 'Анна', participant_id: 'p-me', mine: true })]}
        onMoodSubmitted={vi.fn()}
      />,
    )
    const entries = screen.getAllByTestId('mood-entry')
    expect(entries[0]).toHaveTextContent('Борис')
    expect(entries[1]).toHaveTextContent('Анна (вы)')
  })
})

// ── AI недоступен ────────────────────────────────────────────────────────────

function renderSummary(props: Partial<React.ComponentProps<typeof SummaryModal>> = {}) {
  return render(
    <SummaryModal
      open
      onOpenChange={vi.fn()}
      board={board}
      actionItems={[]}
      summary={null}
      loading={false}
      error={null}
      onSummaryUpdated={vi.fn()}
      {...props}
    />,
  )
}

const readySummary = {
  id: 's-1',
  board_id: 'b-1',
  session_id: null,
  summary_text: 'Хороший спринт.',
  key_themes: [],
  recommendations: [],
  created_at: '2026-03-01T12:00:00Z',
}

describe('SummaryModal — AI-резюме', () => {
  it('AI настроен: одна кнопка «Сгенерировать», без дубля «Перегенерировать»', () => {
    useAppStore.setState({ aiEnabled: true })
    renderSummary()

    expect(screen.getByTestId('generate-summary-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('regenerate-summary-btn')).not.toBeInTheDocument()
  })

  it('готовое резюме можно перегенерировать', () => {
    useAppStore.setState({ aiEnabled: true })
    renderSummary({ summary: readySummary })

    expect(screen.getByTestId('regenerate-summary-btn')).toBeEnabled()
    expect(screen.queryByTestId('generate-summary-btn')).not.toBeInTheDocument()
  })

  it('AI не настроен: кнопок нет, причина названа', () => {
    useAppStore.setState({ aiEnabled: false })
    renderSummary()

    expect(screen.queryByTestId('generate-summary-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('regenerate-summary-btn')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-unavailable-note')).toHaveTextContent('AI на этом сервере не настроен')
  })

  it('карточки скрыты: генерация недоступна до раскрытия', () => {
    useAppStore.setState({ aiEnabled: true })
    const hiddenBoard = { ...board, cards_hidden: true }
    const empty = renderSummary({ board: hiddenBoard })
    expect(screen.queryByTestId('generate-summary-btn')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-unavailable-note')).toHaveTextContent('Карточки ещё скрыты')
    empty.unmount()

    renderSummary({ board: hiddenBoard, summary: readySummary })
    expect(screen.getByTestId('regenerate-summary-btn')).toBeDisabled()
  })

  it('ошибка генерации — одно сообщение с причиной от сервера', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ aiEnabled: true })
    api.regenerateBoardSummary.mockRejectedValue({
      response: { status: 502, data: { detail: 'Не удалось сгенерировать AI-резюме' } },
    })
    renderSummary()

    await user.click(screen.getByTestId('generate-summary-btn'))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Не удалось сгенерировать AI-резюме', 'error'),
    )
    expect(showToast).toHaveBeenCalledTimes(1)
  })
})
