import { QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminPage from '../../app/admin/page'
import { generateSlugFromName } from '../../app/admin/AdminTeams'
import { getAdminSessionHint, setAdminSessionHint } from '../../api/admin'
import { makeQueryClient, queryKeys } from '../../lib/query-client'
import { showToast } from '../../store/toastStore'

const api = vi.hoisted(() => ({
  adminLogin: vi.fn(),
  adminLogout: vi.fn(),
  checkAdminSession: vi.fn(),
  getAdminWorkspaces: vi.fn(),
  createAdminWorkspace: vi.fn(),
  updateAdminWorkspace: vi.fn(),
  deleteAdminWorkspace: vi.fn(),
  getAdminWorkspaceInvite: vi.fn(),
  rotateAdminWorkspaceInvite: vi.fn(),
  getAdminAgentTokens: vi.fn(),
  createAdminAgentToken: vi.fn(),
  revokeAdminAgentToken: vi.fn(),
  getAdminAiSettings: vi.fn(),
  updateAdminAiSettings: vi.fn(),
  resetAdminAiSettings: vi.fn(),
  testAdminAiSettings: vi.fn(),
  fetchAdminAiModels: vi.fn(),
}))

// Сетевые вызовы подменены, состояние сессии — настоящий модуль api/admin
vi.mock('../../api/admin', async () => {
  const actual = await vi.importActual<typeof import('../../api/admin')>('../../api/admin')
  return { ...actual, ...api }
})

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
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn()
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn()
  }
})

const origin = window.location.origin

const platform = {
  id: 'ws-1',
  slug: 'platform',
  name: 'Платформа',
  created_at: '2026-11-01T10:00:00',
  boards_count: 7,
}

function httpError(status: number, detail: unknown = '') {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { detail } } })
}

function renderAdminPage(client = makeQueryClient()) {
  const result = render(<AdminPage />, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
  return { ...result, client }
}

/** Открыть админку уже вошедшим администратором со списком команд. */
async function renderSignedIn(workspaces = [platform], client = makeQueryClient()) {
  setAdminSessionHint(true)
  api.checkAdminSession.mockImplementation(() => {
    setAdminSessionHint(true)
    return Promise.resolve(true)
  })
  api.getAdminWorkspaces.mockResolvedValue(workspaces)
  renderAdminPage(client)
  await screen.findByRole('heading', { name: 'Команды' })
  return client
}

function teamRow(name: string) {
  return within(screen.getByRole('row', { name: new RegExp(name) }))
}

describe('Админка /admin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAdminSessionHint(null)
    api.checkAdminSession.mockImplementation(() => {
      setAdminSessionHint(false)
      return Promise.resolve(false)
    })
    api.adminLogin.mockImplementation(() => {
      setAdminSessionHint(true)
      return Promise.resolve()
    })
    api.adminLogout.mockImplementation(() => {
      setAdminSessionHint(false)
      return Promise.resolve()
    })
  })

  describe('вход', () => {
    it('без сессии показывает форму входа, проверив cookie без 401', async () => {
      renderAdminPage()

      expect(await screen.findByText('Панель администратора')).toBeInTheDocument()
      expect(api.checkAdminSession).toHaveBeenCalledTimes(1)
      expect(api.getAdminWorkspaces).not.toHaveBeenCalled()
    })

    it('пока проверяет сессию, можно вернуться к доскам', () => {
      api.checkAdminSession.mockImplementation(() => new Promise(() => {}))
      renderAdminPage()

      expect(screen.getByText('Проверка доступа...')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Вернуться к доскам' })).toHaveAttribute('href', '/')
    })

    it('перепроверяет сессию при возврате на вкладку', async () => {
      await renderSignedIn()
      expect(api.checkAdminSession).toHaveBeenCalledTimes(1)

      document.dispatchEvent(new Event('visibilitychange'))

      await waitFor(() => expect(api.checkAdminSession).toHaveBeenCalledTimes(2))
    })

    it('успешный вход открывает список команд', async () => {
      const user = userEvent.setup()
      api.getAdminWorkspaces.mockResolvedValue([platform])
      renderAdminPage()

      await user.type(screen.getByLabelText('Логин'), 'admin')
      await user.type(screen.getByLabelText('Пароль'), 'secret')
      await user.click(screen.getByRole('button', { name: 'Войти' }))

      expect(await screen.findByRole('heading', { name: 'Команды' })).toBeInTheDocument()
      expect(api.adminLogin).toHaveBeenCalledWith({ login: 'admin', password: 'secret' })
      expect(teamRow('Платформа').getByTestId('team-boards-count')).toHaveTextContent('7')
    })

    it('неверный пароль — понятное сообщение, форма остаётся', async () => {
      const user = userEvent.setup()
      api.adminLogin.mockRejectedValueOnce(httpError(401, 'Неверный логин или пароль'))
      renderAdminPage()

      await user.type(screen.getByLabelText('Логин'), 'admin')
      await user.type(screen.getByLabelText('Пароль'), 'wrong')
      await user.click(screen.getByRole('button', { name: 'Войти' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Неверный логин или пароль')
      expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled()
      expect(api.getAdminWorkspaces).not.toHaveBeenCalled()
    })

    it('состояние есть, а сервер сессию уже не принимает: форма входа с объяснением', async () => {
      setAdminSessionHint(true)
      expect(getAdminSessionHint()).toBe(true)
      // Проверка сессии ещё идёт — состояние снимает только 401 от данных
      api.checkAdminSession.mockImplementation(() => new Promise(() => {}))
      api.getAdminWorkspaces.mockImplementationOnce(() => {
        // Так ведёт себя перехватчик api/admin.ts на ответ 401
        setAdminSessionHint(false)
        return Promise.reject(httpError(401))
      })
      renderAdminPage()

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Сессия администратора завершилась — войдите снова',
      )
      expect(screen.getByText('Панель администратора')).toBeInTheDocument()
    })

    it('«Выйти» возвращает форму входа без сообщения об истёкшей сессии', async () => {
      const user = userEvent.setup()
      const client = await renderSignedIn()
      expect(client.getQueryData(queryKeys.adminWorkspaces())).toEqual([platform])

      await user.click(screen.getByRole('button', { name: 'Выйти' }))

      expect(await screen.findByText('Панель администратора')).toBeInTheDocument()
      expect(api.adminLogout).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(client.getQueryData(queryKeys.adminWorkspaces())).toBeUndefined()
    })

    it('список не загрузился — ошибка и «Повторить», а не форма входа', async () => {
      const user = userEvent.setup()
      setAdminSessionHint(true)
      api.checkAdminSession.mockImplementation(() => {
        setAdminSessionHint(true)
        return Promise.resolve(true)
      })
      api.getAdminWorkspaces.mockRejectedValueOnce(httpError(500, 'Внутренняя ошибка сервера'))
      renderAdminPage()

      expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить список команд')
      expect(screen.queryByText('Панель администратора')).toBeNull()

      api.getAdminWorkspaces.mockResolvedValueOnce([platform])
      await user.click(screen.getByRole('button', { name: 'Повторить' }))

      expect(await screen.findByRole('row', { name: /Платформа/ })).toBeInTheDocument()
    })
  })

  describe('создание команды', () => {
    it('колонка «Досок» заполнена сразу после создания', async () => {
      const user = userEvent.setup()
      await renderSignedIn()
      api.createAdminWorkspace.mockResolvedValueOnce({
        id: 'ws-2',
        slug: 'analitika',
        name: 'Аналитика',
        created_at: '2026-11-14T12:00:00',
        boards_count: 0,
      })

      await user.click(screen.getByRole('button', { name: 'Создать команду' }))
      const dialog = await screen.findByRole('dialog', { name: 'Новая команда' })
      await user.type(within(dialog).getByLabelText('Название команды'), 'Аналитика')
      // Код команды подставляется из названия
      expect(within(dialog).getByLabelText('Код команды')).toHaveValue('analitika')
      await user.type(within(dialog).getByLabelText('Ключ доступа'), 'team-key-1')
      await user.click(within(dialog).getByRole('button', { name: 'Создать' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(api.createAdminWorkspace).toHaveBeenCalledWith({
        slug: 'analitika',
        name: 'Аналитика',
        access_key: 'team-key-1',
      })
      expect(teamRow('Аналитика').getByTestId('team-boards-count')).toHaveTextContent('0')
      expect(showToast).toHaveBeenCalledWith('Команда создана', 'success')
    })

    it('ошибки проверки сервера показывает по полям, а не общим «не удалось создать»', async () => {
      const user = userEvent.setup()
      await renderSignedIn()
      api.createAdminWorkspace.mockRejectedValueOnce(
        httpError(422, [
          { type: 'string_pattern_mismatch', loc: ['body', 'slug'], ctx: { pattern: '^[a-z0-9-]+$' } },
          { type: 'string_too_long', loc: ['body', 'name'], ctx: { max_length: 120 } },
          { type: 'string_too_short', loc: ['body', 'access_key'], ctx: { min_length: 4 } },
        ]),
      )

      await user.click(screen.getByRole('button', { name: 'Создать команду' }))
      const dialog = await screen.findByRole('dialog', { name: 'Новая команда' })
      await user.type(within(dialog).getByLabelText('Название команды'), 'Аналитика')
      await user.clear(within(dialog).getByLabelText('Код команды'))
      await user.type(within(dialog).getByLabelText('Код команды'), 'Плохой Код')
      await user.type(within(dialog).getByLabelText('Ключ доступа'), 'abc')
      await user.click(within(dialog).getByRole('button', { name: 'Создать' }))

      const alert = await within(dialog).findByRole('alert')
      expect(alert).toHaveTextContent('Код команды: только строчные латинские буквы, цифры и дефис')
      expect(alert).toHaveTextContent('Название команды: не длиннее 120 символов')
      expect(alert).toHaveTextContent('Ключ доступа: не короче 4 символов')

      // Правка поля убирает прежнюю ошибку
      await user.type(within(dialog).getByLabelText('Ключ доступа'), 'd')
      expect(within(dialog).queryByRole('alert')).toBeNull()
    })

    it('занятый код команды — текст сервера', async () => {
      const user = userEvent.setup()
      await renderSignedIn()
      api.createAdminWorkspace.mockRejectedValueOnce(httpError(409, 'Команда с таким кодом уже существует'))

      await user.click(screen.getByRole('button', { name: 'Создать команду' }))
      const dialog = await screen.findByRole('dialog', { name: 'Новая команда' })
      await user.type(within(dialog).getByLabelText('Название команды'), 'Платформа')
      await user.type(within(dialog).getByLabelText('Ключ доступа'), 'team-key-1')
      await user.click(within(dialog).getByRole('button', { name: 'Создать' }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Команда с таким кодом уже существует',
      )
    })
  })

  describe('ключ доступа', () => {
    it('поле скрыто по умолчанию; показать, сгенерировать надёжный ключ и скопировать', async () => {
      const user = userEvent.setup()
      await renderSignedIn()

      await user.click(screen.getByRole('button', { name: 'Создать команду' }))
      const dialog = await screen.findByRole('dialog', { name: 'Новая команда' })
      const field = within(dialog).getByLabelText('Ключ доступа')

      expect(field).toHaveAttribute('type', 'password')
      expect(within(dialog).getByText(/Ключ нельзя посмотреть после создания — только сменить/)).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Скопировать ключ доступа' })).toBeDisabled()

      await user.click(within(dialog).getByRole('button', { name: 'Показать ключ' }))
      expect(field).toHaveAttribute('type', 'text')
      await user.click(within(dialog).getByRole('button', { name: 'Скрыть ключ' }))
      expect(field).toHaveAttribute('type', 'password')

      await user.click(within(dialog).getByRole('button', { name: 'Сгенерировать' }))
      // Сгенерированный ключ виден: его нужно сохранить до создания команды
      expect(field).toHaveAttribute('type', 'text')
      const generated = (field as HTMLInputElement).value
      expect(generated).toMatch(/^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/)

      await user.click(within(dialog).getByRole('button', { name: 'Скопировать ключ доступа' }))
      expect(await navigator.clipboard.readText()).toBe(generated)
    })

    it('смена ключа предупреждает о выходе участников, показывает число токенов агентов и даёт отозвать их опционально', async () => {
      const user = userEvent.setup()
      await renderSignedIn()
      api.getAdminAgentTokens.mockResolvedValueOnce([
        { id: 't1', revoked_at: null },
        { id: 't2', revoked_at: null },
        { id: 't3', revoked_at: '2026-11-10T10:00:00Z' },
      ])
      api.updateAdminWorkspace.mockResolvedValueOnce({ ...platform })

      await user.click(teamRow('Платформа').getByRole('button', { name: 'Ключ' }))
      const dialog = await screen.findByRole('dialog', { name: 'Сменить ключ доступа' })

      expect(within(dialog).getByTestId('key-change-warning')).toHaveTextContent(
        'Все участники команды выйдут из системы, а ссылка-приглашение будет перевыпущена: прежние ключ и ссылка перестанут работать.',
      )
      expect(within(dialog).getByText(/Ключ нельзя посмотреть после сохранения/)).toBeInTheDocument()

      const tokensBox = within(dialog).getByTestId('key-change-agent-tokens-box')
      expect(await within(tokensBox).findByText('2')).toBeInTheDocument()
      expect(tokensBox).toHaveTextContent('По умолчанию смена ключа их не отзывает')

      // Без отметки чекбокса передаётся только access_key
      const checkbox = within(dialog).getByRole('checkbox', {
        name: /Также отозвать действующие токены агентов \(2\)/,
      })
      expect(checkbox).not.toBeChecked()

      await user.type(within(dialog).getByLabelText('Новый ключ доступа'), 'new-team-key')
      await user.click(within(dialog).getByRole('button', { name: 'Сменить ключ' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(api.updateAdminWorkspace).toHaveBeenCalledWith('ws-1', { access_key: 'new-team-key' })
      expect(showToast).toHaveBeenCalledWith('Ключ доступа изменён: участникам нужно войти заново', 'success')

      // Повторное открытие: если отметить отзыв — уходит revoke_agent_tokens: true
      api.getAdminAgentTokens.mockResolvedValueOnce([{ id: 't1', revoked_at: null }])
      api.updateAdminWorkspace.mockResolvedValueOnce({ ...platform })
      await user.click(teamRow('Платформа').getByRole('button', { name: 'Ключ' }))
      const dialog2 = await screen.findByRole('dialog', { name: 'Сменить ключ доступа' })
      const checkbox2 = await within(dialog2).findByRole('checkbox', {
        name: /Также отозвать действующие токены агентов \(1\)/,
      })
      await user.click(checkbox2)
      expect(checkbox2).toBeChecked()
      await user.type(within(dialog2).getByLabelText('Новый ключ доступа'), 'another-key-99')
      await user.click(within(dialog2).getByRole('button', { name: 'Сменить ключ' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(api.updateAdminWorkspace).toHaveBeenLastCalledWith('ws-1', {
        access_key: 'another-key-99',
        revoke_agent_tokens: true,
      })
      expect(showToast).toHaveBeenLastCalledWith(
        'Ключ доступа изменён, токены агентов отозваны: участникам нужно войти заново',
        'success',
      )
    })

    it('слишком короткий ключ при смене — сообщение сервера по делу', async () => {
      const user = userEvent.setup()
      await renderSignedIn()
      api.updateAdminWorkspace.mockRejectedValueOnce(
        httpError(422, [{ type: 'string_too_short', loc: ['body', 'access_key'], ctx: { min_length: 4 } }]),
      )

      await user.click(teamRow('Платформа').getByRole('button', { name: 'Ключ' }))
      const dialog = await screen.findByRole('dialog', { name: 'Сменить ключ доступа' })
      await user.type(within(dialog).getByLabelText('Новый ключ доступа'), 'abc')
      await user.click(within(dialog).getByRole('button', { name: 'Сменить ключ' }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ключ доступа: не короче 4 символов')
    })
  })

  describe('ссылка-приглашение', () => {
    it('показывает ссылку команды и даёт её скопировать', async () => {
      const user = userEvent.setup()
      await renderSignedIn()
      api.getAdminWorkspaceInvite.mockResolvedValueOnce('old-invite-token-1')

      await user.click(teamRow('Платформа').getByRole('button', { name: 'Приглашение' }))
      const dialog = await screen.findByRole('dialog', { name: 'Приглашение в команду «Платформа»' })

      await waitFor(() =>
        expect(within(dialog).getByLabelText('Ссылка-приглашение')).toHaveValue(
          `${origin}/join/old-invite-token-1`,
        ),
      )
      expect(api.getAdminWorkspaceInvite).toHaveBeenCalledWith('ws-1')

      await user.click(within(dialog).getByRole('button', { name: 'Скопировать ссылку-приглашение' }))
      expect(await navigator.clipboard.readText()).toBe(`${origin}/join/old-invite-token-1`)
    })

    it('перевыпуск предупреждает, что старая ссылка перестанет работать, и показывает новую', async () => {
      const user = userEvent.setup()
      await renderSignedIn()
      api.getAdminWorkspaceInvite.mockResolvedValueOnce('old-invite-token-1')
      api.rotateAdminWorkspaceInvite.mockResolvedValueOnce('new-invite-token-2')

      await user.click(teamRow('Платформа').getByRole('button', { name: 'Приглашение' }))
      const dialog = await screen.findByRole('dialog', { name: 'Приглашение в команду «Платформа»' })
      await waitFor(() => expect(within(dialog).getByLabelText('Ссылка-приглашение')).not.toHaveValue(''))

      await user.click(within(dialog).getByRole('button', { name: 'Перевыпустить ссылку' }))
      // Первое нажатие только спрашивает
      expect(api.rotateAdminWorkspaceInvite).not.toHaveBeenCalled()
      expect(within(dialog).getByTestId('admin-invite-rotate-confirm')).toHaveTextContent(
        'Прежняя ссылка перестанет работать',
      )

      await user.click(within(dialog).getByRole('button', { name: 'Перевыпустить' }))

      await waitFor(() =>
        expect(within(dialog).getByLabelText('Ссылка-приглашение')).toHaveValue(
          `${origin}/join/new-invite-token-2`,
        ),
      )
      expect(api.rotateAdminWorkspaceInvite).toHaveBeenCalledWith('ws-1')
      expect(within(dialog).queryByTestId('admin-invite-rotate-confirm')).toBeNull()
      expect(showToast).toHaveBeenCalledWith('Ссылка перевыпущена — прежняя больше не работает', 'success')
    })

    it('отмена перевыпуска оставляет прежнюю ссылку', async () => {
      const user = userEvent.setup()
      await renderSignedIn()
      api.getAdminWorkspaceInvite.mockResolvedValueOnce('old-invite-token-1')

      await user.click(teamRow('Платформа').getByRole('button', { name: 'Приглашение' }))
      const dialog = await screen.findByRole('dialog', { name: 'Приглашение в команду «Платформа»' })
      await waitFor(() => expect(within(dialog).getByLabelText('Ссылка-приглашение')).not.toHaveValue(''))

      await user.click(within(dialog).getByRole('button', { name: 'Перевыпустить ссылку' }))
      await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))

      expect(api.rotateAdminWorkspaceInvite).not.toHaveBeenCalled()
      expect(within(dialog).getByLabelText('Ссылка-приглашение')).toHaveValue(
        `${origin}/join/old-invite-token-1`,
      )
    })
  })

  it('переименование сохраняет счётчик досок: в ответе сервера его нет', async () => {
    const user = userEvent.setup()
    await renderSignedIn()
    api.updateAdminWorkspace.mockResolvedValueOnce({
      id: 'ws-1',
      slug: 'platform',
      name: 'Платформа 2',
      created_at: platform.created_at,
    })

    await user.click(teamRow('Платформа').getByRole('button', { name: 'Переименовать' }))
    const dialog = await screen.findByRole('dialog', { name: 'Переименовать команду' })
    await user.clear(within(dialog).getByLabelText('Название команды'))
    await user.type(within(dialog).getByLabelText('Название команды'), 'Платформа 2')
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(teamRow('Платформа 2').getByTestId('team-boards-count')).toHaveTextContent('7')
  })
})

describe('generateSlugFromName', () => {
  it('транслитерирует название в код команды по образцу сервера', () => {
    expect(generateSlugFromName('Платформа')).toBe('platforma')
    expect(generateSlugFromName('  Команда №1: Ядро!  ')).toBe('komanda-1-yadro')
    expect(generateSlugFromName('Mobile Team')).toBe('mobile-team')
  })

  it('не длиннее 80 символов и без дефиса на конце', () => {
    // 19 × «shch» + «abc» = 79 символов, восьмидесятым оказался бы дефис между словами
    const slug = generateSlugFromName(`${'щ'.repeat(19)}abc ${'я'.repeat(10)}`)
    expect(slug).toBe(`${'shch'.repeat(19)}abc`)
    expect(generateSlugFromName('я'.repeat(60))).toHaveLength(80)
  })
})

describe('токены агентов в админке', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAdminSessionHint(null)
    api.checkAdminSession.mockImplementation(() => {
      setAdminSessionHint(false)
      return Promise.resolve(false)
    })
  })

  it('открывает диалог токенов команды, выпускает и отзывает токен через admin API', async () => {
    const user = userEvent.setup()
    api.getAdminAgentTokens.mockResolvedValueOnce([])
    api.createAdminAgentToken.mockResolvedValueOnce({
      token: {
        id: 'tok-adm-1',
        workspace_id: 'ws-1',
        participant_id: 'p-adm-bot-1',
        name: 'Admin Bot',
        token_prefix: 'rba_adm1',
        scope: 'read_write',
        created_by_id: null,
        created_at: '2026-11-15T10:00:00Z',
        last_used_at: null,
        revoked_at: null,
      },
      secret: 'rba_adm1_secret_token',
    })
    api.revokeAdminAgentToken.mockResolvedValueOnce({
      id: 'tok-adm-1',
      workspace_id: 'ws-1',
      participant_id: 'p-adm-bot-1',
      name: 'Admin Bot',
      token_prefix: 'rba_adm1',
      scope: 'read_write',
      created_by_id: null,
      created_at: '2026-11-15T10:00:00Z',
      last_used_at: null,
      revoked_at: '2026-11-15T10:05:00Z',
    })

    await renderSignedIn()

    await user.click(teamRow('Платформа').getByRole('button', { name: 'Токены агентов' }))

    const dialog = await screen.findByTestId('agent-tokens-dialog')
    expect(within(dialog).getByText('Администрирование')).toBeInTheDocument()
    expect(within(dialog).getByText('Платформа')).toBeInTheDocument()
    await waitFor(() => expect(api.getAdminAgentTokens).toHaveBeenCalledWith('ws-1'))

    await user.type(within(dialog).getByTestId('agent-token-name-input'), 'Admin Bot')
    await user.click(within(dialog).getByRole('radio', { name: 'Чтение и запись' }))
    await user.click(within(dialog).getByTestId('agent-token-create-btn'))

    await waitFor(() =>
      expect(api.createAdminAgentToken).toHaveBeenCalledWith('ws-1', {
        name: 'Admin Bot',
        scope: 'read_write',
      }),
    )
    expect(within(dialog).getByTestId('agent-token-secret-input')).toHaveValue('rba_adm1_secret_token')

    await user.click(within(dialog).getByTestId('agent-token-revoke-tok-adm-1'))
    await user.click(within(dialog).getByTestId('agent-token-confirm-revoke-tok-adm-1'))

    await waitFor(() => expect(api.revokeAdminAgentToken).toHaveBeenCalledWith('ws-1', 'tok-adm-1'))
    expect(within(dialog).getByTestId('agent-token-row-tok-adm-1')).toHaveTextContent('Отозван')
  })
})

describe('настройки ИИ в админке', () => {
  const envSettings = {
    enabled: true,
    base_url: 'https://llm-gw.example.com/v1',
    model: 'model-from-env',
    reasoning_effort: 'none' as const,
    source: 'env' as const,
    has_api_key: true,
    api_key_masked: 'sk-••••1234',
    key_decrypt_error: false,
    env_configured: true,
    updated_at: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setAdminSessionHint(null)
    api.checkAdminSession.mockImplementation(() => {
      setAdminSessionHint(false)
      return Promise.resolve(false)
    })
  })

  it('переключение на вкладку «Настройки ИИ», выбор reasoning_effort, загрузка моделей, проверка, сохранение и сброс', async () => {
    const user = userEvent.setup()
    api.getAdminAiSettings.mockResolvedValueOnce(envSettings)
    api.fetchAdminAiModels.mockResolvedValueOnce(['fast-model', 'smart-model'])
    api.testAdminAiSettings.mockResolvedValueOnce({
      ok: true,
      latency_ms: 87,
      reply_preview: 'ОК',
      error: null,
      reasoning_used: true,
    })
    api.updateAdminAiSettings.mockResolvedValueOnce({
      enabled: true,
      base_url: 'https://api.provider.example/v1',
      model: 'smart-model',
      reasoning_effort: 'high',
      source: 'database',
      has_api_key: true,
      api_key_masked: 'sk-••••9999',
      key_decrypt_error: false,
      env_configured: true,
      updated_at: '2026-11-19T12:20:00Z',
    })
    api.resetAdminAiSettings.mockResolvedValueOnce(envSettings)

    await renderSignedIn()
    expect(api.getAdminAiSettings).not.toHaveBeenCalled()
    expect(screen.getByTestId('admin-create-team')).toBeInTheDocument()

    await user.click(screen.getByTestId('admin-tab-ai'))

    expect(await screen.findByRole('heading', { name: 'Настройки ИИ' })).toBeInTheDocument()
    expect(screen.queryByTestId('admin-create-team')).toBeNull()
    expect(screen.getByTestId('ai-settings-source-badge')).toHaveTextContent('Из переменных окружения')
    expect(screen.getByTestId('ai-base-url-input')).toHaveValue('https://llm-gw.example.com/v1')
    expect(screen.getByTestId('ai-model-input')).toHaveValue('model-from-env')

    // Редактирование полей и выбор универсального уровня размышлений
    const urlInput = screen.getByTestId('ai-base-url-input')
    await user.clear(urlInput)
    await user.type(urlInput, 'https://api.provider.example/v1')
    await user.type(screen.getByTestId('ai-api-key-input'), 'sk-provider-9999')

    await user.click(screen.getByTestId('ai-reasoning-effort-trigger'))
    await user.click(await screen.findByRole('option', { name: 'Высокий (high)' }))

    // Загрузка списка моделей и выбор из выпадающего списка
    await user.click(screen.getByTestId('ai-load-models-btn'))
    await waitFor(() =>
      expect(api.fetchAdminAiModels).toHaveBeenCalledWith({
        base_url: 'https://api.provider.example/v1',
        api_key: 'sk-provider-9999',
        clear_api_key: undefined,
      }),
    )
    await user.click(screen.getByRole('combobox', { name: 'Выбрать модель из загруженного списка' }))
    await user.click(await screen.findByRole('option', { name: 'smart-model' }))
    expect(screen.getByTestId('ai-model-input')).toHaveValue('smart-model')

    // Проверка подключения (включая индикатор размышлений)
    await user.click(screen.getByTestId('ai-test-btn'))
    expect(await screen.findByTestId('ai-test-result')).toHaveTextContent(
      'Подключение успешно (87 мс · с размышлениями) — ответ: «ОК»',
    )
    expect(api.testAdminAiSettings).toHaveBeenCalledWith({
      base_url: 'https://api.provider.example/v1',
      model: 'smart-model',
      reasoning_effort: 'high',
      api_key: 'sk-provider-9999',
      clear_api_key: undefined,
    })

    // Переключение на вкладку «Команды» и обратно не теряет введённые данные
    await user.click(screen.getByTestId('admin-tab-teams'))
    expect(screen.getByTestId('admin-create-team')).toBeInTheDocument()
    await user.click(screen.getByTestId('admin-tab-ai'))
    expect(screen.getByTestId('ai-base-url-input')).toHaveValue('https://api.provider.example/v1')
    expect(screen.getByTestId('ai-api-key-input')).toHaveValue('sk-provider-9999')

    // Сохранение
    await user.click(screen.getByTestId('ai-save-btn'))
    await waitFor(() =>
      expect(api.updateAdminAiSettings).toHaveBeenCalledWith({
        enabled: true,
        base_url: 'https://api.provider.example/v1',
        model: 'smart-model',
        reasoning_effort: 'high',
        api_key: 'sk-provider-9999',
        clear_api_key: undefined,
      }),
    )
    expect(await screen.findByTestId('ai-settings-source-badge')).toHaveTextContent('Задано в админке')
    expect(screen.getByTestId('ai-api-key-input')).toHaveValue('')

    // Сброс на env с подтверждением
    await user.click(screen.getByTestId('ai-reset-btn'))
    const confirmDialog = await screen.findByRole('alertdialog')
    await user.click(within(confirmDialog).getByRole('button', { name: 'Сбросить' }))

    await waitFor(() => expect(api.resetAdminAiSettings).toHaveBeenCalledTimes(1))
    expect(await screen.findByTestId('ai-settings-source-badge')).toHaveTextContent(
      'Из переменных окружения',
    )
    expect(screen.getByTestId('ai-base-url-input')).toHaveValue('https://llm-gw.example.com/v1')
  })

  it('отклоняет http://, позволяет отключить ИИ, сбрасывает модели при смене URL и даёт удалить битый ключ', async () => {
    const user = userEvent.setup()
    api.getAdminAiSettings.mockResolvedValueOnce({
      ...envSettings,
      source: 'database',
      key_decrypt_error: true,
      api_key_masked: null,
    })
    api.fetchAdminAiModels
      .mockResolvedValueOnce(['m1', 'm2'])
      .mockRejectedValueOnce(httpError(502, 'Эндпоинт /models не поддерживается'))
    api.testAdminAiSettings.mockResolvedValueOnce({
      ok: false,
      latency_ms: 55,
      reply_preview: null,
      error: 'Ошибка авторизации (HTTP 401): проверьте API-ключ',
      reasoning_used: false,
    })
    api.updateAdminAiSettings
      .mockRejectedValueOnce(httpError(422, 'Нестандартная запись IP-адреса запрещена'))
      .mockResolvedValueOnce({
        ...envSettings,
        enabled: true,
        source: 'database',
        has_api_key: false,
        api_key_masked: null,
        key_decrypt_error: false,
      })

    await renderSignedIn()
    await user.click(screen.getByTestId('admin-tab-ai'))
    await screen.findByRole('heading', { name: 'Настройки ИИ' })

    // При key_decrypt_error видны предупреждение и кнопка «Удалить ключ»
    expect(
      screen.getByText(/Сохранённый API-ключ не удалось расшифровать/),
    ).toBeInTheDocument()
    expect(screen.getByTestId('ai-clear-key-btn')).toBeInTheDocument()

    // Загруженные модели очищаются при ручном изменении URL
    await user.click(screen.getByTestId('ai-load-models-btn'))
    expect(
      await screen.findByRole('combobox', { name: 'Выбрать модель из загруженного списка' }),
    ).toBeInTheDocument()

    const urlInput = screen.getByTestId('ai-base-url-input')
    await user.clear(urlInput)
    await user.type(urlInput, 'https://other.example.com/v1')
    expect(
      screen.queryByRole('combobox', { name: 'Выбрать модель из загруженного списка' }),
    ).toBeNull()
    expect(
      screen.getByText(/прежний ключ не будет отправлен на новый адрес/),
    ).toBeInTheDocument()

    // Ошибка загрузки моделей и ok: false в тесте подключения
    await user.click(screen.getByTestId('ai-load-models-btn'))
    expect(await screen.findByText('Эндпоинт /models не поддерживается')).toBeInTheDocument()

    await user.click(screen.getByTestId('ai-test-btn'))
    expect(await screen.findByTestId('ai-test-result')).toHaveTextContent(
      'Ошибка авторизации (HTTP 401): проверьте API-ключ (55 мс)',
    )

    // http:// отклоняется на клиенте
    await user.clear(urlInput)
    await user.type(urlInput, 'http://insecure.example.com/v1')
    await user.click(screen.getByTestId('ai-save-btn'))
    expect(await screen.findByText('Поддерживается только HTTPS (https://...)')).toBeInTheDocument()
    expect(api.updateAdminAiSettings).not.toHaveBeenCalled()

    // Ошибка 422 от сервера показывается в форме, а повторное сохранение с clear_api_key проходит
    await user.clear(urlInput)
    await user.type(urlInput, 'https://llm-gw.example.com/v1')
    await user.click(screen.getByTestId('ai-clear-key-btn'))
    await user.click(screen.getByTestId('ai-save-btn'))
    expect(await screen.findByText('Нестандартная запись IP-адреса запрещена')).toBeInTheDocument()

    await user.click(screen.getByTestId('ai-save-btn'))
    await waitFor(() =>
      expect(api.updateAdminAiSettings).toHaveBeenLastCalledWith({
        enabled: true,
        base_url: 'https://llm-gw.example.com/v1',
        model: 'model-from-env',
        reasoning_effort: 'none',
        api_key: undefined,
        clear_api_key: true,
      }),
    )
    expect(screen.queryByText(/Сохранённый API-ключ не удалось расшифровать/)).toBeNull()
  })

  it('позволяет отключить ИИ через переключатель', async () => {
    const user = userEvent.setup()
    api.getAdminAiSettings.mockResolvedValueOnce(envSettings)
    api.updateAdminAiSettings.mockResolvedValueOnce({
      ...envSettings,
      enabled: false,
      base_url: '',
      source: 'database',
    })

    await renderSignedIn()
    await user.click(screen.getByTestId('admin-tab-ai'))
    await screen.findByRole('heading', { name: 'Настройки ИИ' })

    await user.clear(screen.getByTestId('ai-base-url-input'))
    await user.click(screen.getByTestId('ai-enabled-switch'))
    await user.click(screen.getByTestId('ai-save-btn'))

    await waitFor(() =>
      expect(api.updateAdminAiSettings).toHaveBeenCalledWith({
        enabled: false,
        base_url: '',
        model: 'model-from-env',
        reasoning_effort: 'none',
        api_key: undefined,
        clear_api_key: undefined,
      }),
    )
  })

  it('показывает ошибку загрузки настроек и позволяет повторить', async () => {
    const user = userEvent.setup()
    api.getAdminAiSettings
      .mockRejectedValueOnce(httpError(500, 'Сервер недоступен'))
      .mockResolvedValueOnce(envSettings)

    await renderSignedIn()
    await user.click(screen.getByTestId('admin-tab-ai'))

    expect(
      await screen.findByText(/Не удалось загрузить настройки ИИ/),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('heading', { name: 'Настройки ИИ' })).toBeInTheDocument()
  })
})
