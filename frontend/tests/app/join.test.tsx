import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InviteJoin from '../../app/join/[token]/InviteJoin'
import { useAppStore } from '../../store'

const mockReplace = vi.fn()
const mockGetInviteInfo = vi.fn()
const mockJoinByInvite = vi.fn()
const mockGetWorkspaceInviteToken = vi.fn()

// Как в Next: объект роутера один и тот же между отрисовками
const mockRouter = { replace: mockReplace, push: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

vi.mock('../../api/invite', () => ({
  getInviteInfo: (...args: unknown[]) => mockGetInviteInfo(...args),
  joinByInvite: (...args: unknown[]) => mockJoinByInvite(...args),
  getWorkspaceInviteToken: (...args: unknown[]) => mockGetWorkspaceInviteToken(...args),
}))

const TOKEN = 'MWx1oFtEG7ikF_SBeDA9UHH1Km9u4ZQG'
const platform = { workspaceId: 'w-1', workspaceSlug: 'platform', workspaceName: 'Платформа' }
const mobile = { workspaceId: 'w-2', workspaceSlug: 'mobile', workspaceName: 'Мобильная разработка' }

function httpError(status: number, detail: unknown = '') {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { detail } } })
}

function signOut() {
  useAppStore.setState({ workspace: null, participant: null, username: 'Аноним', _hasHydrated: true })
}

function signIn(workspace: typeof platform, name: string) {
  useAppStore.setState({
    workspace,
    participant: { id: 'p-old', name },
    username: name,
    _hasHydrated: true,
  })
}

describe('Страница приглашения /join/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signOut()
    mockGetInviteInfo.mockResolvedValue({ workspaceName: 'Платформа' })
  })

  describe('без сессии', () => {
    it('показывает команду и одно поле имени; вход записывает сессию и ведёт на доску из ссылки', async () => {
      const user = userEvent.setup()
      mockJoinByInvite.mockResolvedValueOnce({
        workspace: platform,
        participant: { id: 'p-new', name: 'Аня' },
      })

      render(<InviteJoin token={TOKEN} boardRef="retro-sprinta-42" />)

      expect(await screen.findByRole('heading', { name: 'Платформа' })).toBeInTheDocument()
      expect(mockGetInviteInfo).toHaveBeenCalledWith(TOKEN)
      // Сессии нет — спрашивать токен своей команды незачем (и это был бы ответ 401)
      expect(mockGetWorkspaceInviteToken).not.toHaveBeenCalled()
      expect(screen.getAllByRole('textbox')).toHaveLength(1)

      await user.type(screen.getByLabelText(/Ваше имя/), '  Аня ')
      await user.click(screen.getByRole('button', { name: /Войти на доску/ }))

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/board/retro-sprinta-42'))
      expect(mockJoinByInvite).toHaveBeenCalledWith({ invite_token: TOKEN, name: 'Аня' })
      expect(useAppStore.getState().workspace).toEqual(platform)
      expect(useAppStore.getState().participant).toEqual({ id: 'p-new', name: 'Аня' })
    })

    it('имя можно не вводить: сервер сам назовёт участника, без доски в ссылке — на стартовую', async () => {
      const user = userEvent.setup()
      mockJoinByInvite.mockResolvedValueOnce({
        workspace: platform,
        participant: { id: 'p-new', name: 'Участник' },
      })

      render(<InviteJoin token={TOKEN} boardRef={null} />)

      await user.click(await screen.findByRole('button', { name: /Войти в команду/ }))

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'))
      expect(mockJoinByInvite).toHaveBeenCalledWith({ invite_token: TOKEN })
      expect(useAppStore.getState().participant?.name).toBe('Участник')
    })

    it('обычный вход по коду и ключу остаётся запасным путём', async () => {
      render(<InviteJoin token={TOKEN} boardRef={null} />)

      await screen.findByRole('heading', { name: 'Платформа' })
      expect(screen.getByRole('link', { name: 'Войти по ним' })).toHaveAttribute('href', '/')
    })

    it('ошибку проверки имени показывает по делу и оставляет форму', async () => {
      const user = userEvent.setup()
      mockJoinByInvite.mockRejectedValueOnce(
        httpError(422, [
          { type: 'string_too_long', loc: ['body', 'name'], ctx: { max_length: 60 } },
        ]),
      )

      render(<InviteJoin token={TOKEN} boardRef={null} />)
      await user.type(await screen.findByLabelText(/Ваше имя/), 'Аня')
      await user.click(screen.getByRole('button', { name: /Войти в команду/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Имя: не длиннее 60 символов')
      expect(screen.getByRole('button', { name: /Войти в команду/ })).toBeEnabled()
      expect(mockReplace).not.toHaveBeenCalled()
      expect(useAppStore.getState().participant).toBeNull()
    })
  })

  describe('недействительная ссылка', () => {
    it('404: понятный экран с переходом к входу по коду и ключу', async () => {
      mockGetInviteInfo.mockRejectedValueOnce(httpError(404, 'Ссылка-приглашение недействительна'))

      render(<InviteJoin token={TOKEN} boardRef="retro-sprinta-42" />)

      expect(
        await screen.findByRole('heading', { name: 'Ссылка-приглашение не работает' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Войти по коду и ключу' })).toHaveAttribute('href', '/')
      expect(screen.queryByLabelText(/Ваше имя/)).toBeNull()
    })

    it('токен не по форме отклоняется сразу, без запросов', () => {
      render(<InviteJoin token="x" boardRef={null} />)

      expect(screen.getByRole('heading', { name: 'Ссылка-приглашение не работает' })).toBeInTheDocument()
      expect(mockGetInviteInfo).not.toHaveBeenCalled()
    })

    it('ссылку перевыпустили, пока форма была открыта: вход отвечает 404 — тот же экран', async () => {
      const user = userEvent.setup()
      mockJoinByInvite.mockRejectedValueOnce(httpError(404, 'Ссылка-приглашение недействительна'))

      render(<InviteJoin token={TOKEN} boardRef={null} />)
      await user.click(await screen.findByRole('button', { name: /Войти в команду/ }))

      expect(
        await screen.findByRole('heading', { name: 'Ссылка-приглашение не работает' }),
      ).toBeInTheDocument()
    })

    it('участнику с сессией предлагает вернуться к своим доскам', async () => {
      signIn(mobile, 'Борис')
      mockGetInviteInfo.mockRejectedValueOnce(httpError(404, 'Ссылка-приглашение недействительна'))
      mockGetWorkspaceInviteToken.mockResolvedValueOnce('other-team-token-123')

      render(<InviteJoin token={TOKEN} boardRef={null} />)

      expect(await screen.findByText('Вы уже вошли в команду «Мобильная разработка».')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Открыть мои доски' })).toHaveAttribute('href', '/')
    })
  })

  describe('уже вошёл', () => {
    it('в эту же команду: сразу на доску, без формы и нового участника', async () => {
      signIn(platform, 'Аня')
      mockGetWorkspaceInviteToken.mockResolvedValueOnce(TOKEN)

      render(<InviteJoin token={TOKEN} boardRef="retro-sprinta-42" />)

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/board/retro-sprinta-42'))
      expect(mockJoinByInvite).not.toHaveBeenCalled()
      expect(screen.queryByLabelText(/Ваше имя/)).toBeNull()
      expect(useAppStore.getState().participant).toEqual({ id: 'p-old', name: 'Аня' })
    })

    it('в другую команду: говорит, куда человек перейдёт, и входит после подтверждения имени', async () => {
      const user = userEvent.setup()
      signIn(mobile, 'Борис')
      mockGetWorkspaceInviteToken.mockResolvedValueOnce('other-team-token-123')
      mockJoinByInvite.mockResolvedValueOnce({
        workspace: platform,
        participant: { id: 'p-new', name: 'Борис' },
      })

      render(<InviteJoin token={TOKEN} boardRef={null} />)

      expect(await screen.findByRole('heading', { name: 'Платформа' })).toBeInTheDocument()
      expect(screen.getByTestId('join-switch-note')).toHaveTextContent(
        'Сейчас вы в команде «Мобильная разработка». После входа по этой ссылке вы перейдёте в команду «Платформа».',
      )
      // Имя подставлено из текущей сессии — его остаётся подтвердить
      expect(screen.getByLabelText(/Ваше имя/)).toHaveValue('Борис')
      expect(mockReplace).not.toHaveBeenCalled()
      expect(mockJoinByInvite).not.toHaveBeenCalled()
      expect(screen.getByRole('link', { name: 'Остаться в команде «Мобильная разработка»' })).toHaveAttribute(
        'href',
        '/',
      )

      await user.click(screen.getByRole('button', { name: /Войти в команду/ }))

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'))
      expect(mockJoinByInvite).toHaveBeenCalledWith({ invite_token: TOKEN, name: 'Борис' })
      expect(useAppStore.getState().workspace).toEqual(platform)
      expect(useAppStore.getState().participant).toEqual({ id: 'p-new', name: 'Борис' })
    })

    it('сессия в сторе устарела (401): форма как для нового участника, без пометки о смене команды', async () => {
      signIn(mobile, 'Борис')
      mockGetWorkspaceInviteToken.mockImplementationOnce(() => {
        // Так ведёт себя перехватчик api/invite.ts
        useAppStore.getState().clearSession()
        return Promise.reject(httpError(401))
      })

      render(<InviteJoin token={TOKEN} boardRef={null} />)

      expect(await screen.findByRole('heading', { name: 'Платформа' })).toBeInTheDocument()
      expect(screen.queryByTestId('join-switch-note')).toBeNull()
      expect(screen.getByRole('link', { name: 'Войти по ним' })).toBeInTheDocument()
    })
  })

  it('сервер не ответил: предлагает повторить, повтор открывает форму', async () => {
    const user = userEvent.setup()
    mockGetInviteInfo.mockRejectedValueOnce(httpError(500, 'Внутренняя ошибка сервера'))

    render(<InviteJoin token={TOKEN} boardRef={null} />)

    expect(
      await screen.findByRole('heading', { name: 'Не удалось проверить приглашение' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByRole('heading', { name: 'Платформа' })).toBeInTheDocument()
    expect(mockGetInviteInfo).toHaveBeenCalledTimes(2)
  })
})
