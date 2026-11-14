import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'

type ResErrorInterceptor = (err: unknown) => Promise<never>

// У каждого клиента (`axios.create`) свой набор моков; приглашения ходят через общий `/api`
const { instances } = vi.hoisted(() => {
  interface MockInstance {
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    onResponseError: ((err: unknown) => Promise<never>) | null
    interceptors: {
      request: { use: ReturnType<typeof vi.fn> }
      response: { use: ReturnType<typeof vi.fn> }
    }
  }
  const instances = new Map<string, MockInstance>()
  return { instances }
})

vi.mock('axios', () => ({
  default: {
    create: vi.fn((config: { baseURL: string }) => {
      const instance = {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        onResponseError: null as ResErrorInterceptor | null,
        interceptors: {
          request: { use: vi.fn() },
          response: {
            use: vi.fn((_ok: unknown, onError: ResErrorInterceptor) => {
              instance.onResponseError = onError
            }),
          },
        },
      }
      instances.set(config.baseURL, instance)
      return instance
    }),
  },
}))

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

import { getInviteInfo, getWorkspaceInviteToken, joinByInvite } from '../../api/invite'
import { getApiErrorMessage } from '../../utils/apiError'

const inviteApi = () => instances.get('/api')!

const workspace = { workspaceId: 'w1', workspaceSlug: 'team-1', workspaceName: 'Team 1' }
const participant = { id: 'p-1', name: 'Анна' }

describe('api/invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ workspace, participant })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('приглашения ходят через общий клиент, отдельного экземпляра нет', () => {
    expect(instances.has('/api')).toBe(true)
    expect(instances.has('/api/workspaces')).toBe(false)
  })

  it('getInviteInfo спрашивает название команды по токену из ссылки', async () => {
    inviteApi().get.mockResolvedValueOnce({ data: { workspace_name: 'Платформа' } })

    await expect(getInviteInfo('tok_EN-12345')).resolves.toEqual({ workspaceName: 'Платформа' })
    expect(inviteApi().get).toHaveBeenCalledWith('/workspaces/invite/tok_EN-12345')
  })

  it('joinByInvite отдаёт сессию в том же виде, что и обычный вход', async () => {
    inviteApi().post.mockResolvedValueOnce({
      data: {
        workspace_id: 'w2',
        workspace_slug: 'platform',
        workspace_name: 'Платформа',
        participant: { id: 'p-9', name: 'Аня' },
      },
    })

    await expect(joinByInvite({ invite_token: 'tok_EN-12345', name: 'Аня' })).resolves.toEqual({
      workspace: { workspaceId: 'w2', workspaceSlug: 'platform', workspaceName: 'Платформа' },
      participant: { id: 'p-9', name: 'Аня' },
    })
    expect(inviteApi().post).toHaveBeenCalledWith('/workspaces/join', { invite_token: 'tok_EN-12345', name: 'Аня' })
  })

  it('getWorkspaceInviteToken возвращает токен приглашения своей команды', async () => {
    inviteApi().get.mockResolvedValueOnce({ data: { invite_token: 'tok_EN-12345' } })

    await expect(getWorkspaceInviteToken()).resolves.toBe('tok_EN-12345')
    expect(inviteApi().get).toHaveBeenCalledWith('/workspaces/invite')
  })

  it('401 на токен своей команды сбрасывает сессию без тоста', async () => {
    vi.useFakeTimers()
    const error = { response: { status: 401, data: { detail: 'Сессия устарела' } }, config: { url: '/workspaces/invite' } }

    await expect(inviteApi().onResponseError!(error)).rejects.toBe(error)
    vi.runAllTimers()

    expect(useAppStore.getState().workspace).toBeNull()
    expect(useAppStore.getState().participant).toBeNull()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('401 при входе по приглашению текущую сессию не сбрасывает', async () => {
    const error = { response: { status: 401, data: {} }, config: { url: '/workspaces/join' } }

    await expect(inviteApi().onResponseError!(error)).rejects.toBe(error)

    expect(useAppStore.getState().participant).toEqual(participant)
  })

  it('404 недействительной ссылки сессию не трогает и общего тоста не даёт', async () => {
    vi.useFakeTimers()
    for (const url of ['/workspaces/invite/tok_EN-12345', '/workspaces/join']) {
      await inviteApi().onResponseError!({
        response: { status: 404, data: { detail: 'Ссылка-приглашение недействительна' } },
        config: { url },
      }).catch(() => {})
    }
    vi.runAllTimers()

    expect(useAppStore.getState().participant).toEqual(participant)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('5xx показывает общий тост, только если страница не показала ошибку сама', async () => {
    vi.useFakeTimers()
    const silent = { response: { status: 500, data: { detail: 'Внутренняя ошибка сервера' } }, config: { url: '/workspaces/join' } }
    await inviteApi().onResponseError!(silent).catch(() => {})
    vi.runAllTimers()
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('Что-то пошло не так', 'error')

    vi.mocked(showToast).mockClear()
    const shown = { response: { status: 500, data: { detail: 'Внутренняя ошибка сервера' } }, config: { url: '/workspaces/join' } }
    await inviteApi().onResponseError!(shown).catch((err: unknown) => {
      getApiErrorMessage(err, 'Не удалось войти')
    })
    vi.runAllTimers()
    expect(showToast).not.toHaveBeenCalled()
  })
})
