import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'

type ReqInterceptor = (config: { method?: string; headers: Record<string, string> }) => {
  method?: string
  headers: Record<string, string>
}
type ResErrorInterceptor = (err: unknown) => Promise<never>

const { mockGet, mockPost, mockPatch, mockInstance, getReqInterceptor, getResErrorInterceptor } = vi.hoisted(() => {
  let reqFn: ReqInterceptor | null = null
  let resErrFn: ResErrorInterceptor | null = null
  const mockGet = vi.fn()
  const mockPost = vi.fn()
  const mockPatch = vi.fn()
  const mockInstance = {
    get: mockGet,
    post: mockPost,
    patch: mockPatch,
    delete: vi.fn(),
    interceptors: {
      request: {
        use: vi.fn((fn: ReqInterceptor) => {
          reqFn = fn
        }),
      },
      response: {
        use: vi.fn((_ok: unknown, errFn: ResErrorInterceptor) => {
          resErrFn = errFn
        }),
      },
    },
  }
  return {
    mockGet,
    mockPost,
    mockPatch,
    mockInstance,
    getReqInterceptor: () => reqFn,
    getResErrorInterceptor: () => resErrFn,
  }
})

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockInstance),
  },
}))

vi.mock('../../store/toastStore', () => ({
  showToast: vi.fn(),
}))

import {
  checkWorkspaceSession,
  getCsrfToken,
  loginToWorkspace,
  logoutWorkspace,
  refreshWorkspaceSession,
  renameParticipant,
} from '../../api'
import { getApiErrorMessage } from '../../utils/apiError'

const workspace = { workspaceId: 'w1', workspaceSlug: 'team-1', workspaceName: 'Team 1' }
const participant = { id: 'p-1', name: 'Анна' }

describe('api interceptors and session helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ workspace, participant, aiEnabled: null })
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: 'csrf_token=csrf-abc-123',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('401 сбрасывает сессию целиком и не показывает тост', async () => {
    vi.useFakeTimers()
    const onError = getResErrorInterceptor()
    expect(onError).toBeTypeOf('function')

    await expect(
      onError!({
        response: { status: 401, data: { detail: 'Сессия устарела, войдите снова' } },
        config: { url: '/boards/' },
      }),
    ).rejects.toBeDefined()
    vi.runAllTimers()

    expect(useAppStore.getState().workspace).toBeNull()
    expect(useAppStore.getState().participant).toBeNull()
    expect(showToast).not.toHaveBeenCalled()
  })

  it.each(['/workspaces/login', '/workspaces/join'])(
    '401 от %s (неверный ключ) не трогает текущую сессию',
    async (url) => {
      const onError = getResErrorInterceptor()

      await expect(
        onError!({ response: { status: 401, data: { detail: 'Wrong key' } }, config: { url } }),
      ).rejects.toBeDefined()

      expect(useAppStore.getState().workspace).toEqual(workspace)
      expect(useAppStore.getState().participant).toEqual(participant)
    },
  )

  it('500 без своего сообщения у вызывающего кода даёт общий тост', async () => {
    vi.useFakeTimers()
    const onError = getResErrorInterceptor()
    await expect(
      onError!({
        response: { status: 500, data: {} },
        config: { url: '/boards/' },
      }),
    ).rejects.toBeDefined()
    vi.runAllTimers()

    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('Что-то пошло не так', 'error')
  })

  it('403 показывается один раз: общий тост уступает сообщению вызывающего кода', async () => {
    vi.useFakeTimers()
    const onError = getResErrorInterceptor()
    const error = {
      response: { status: 403, data: { detail: 'Текст карточки может менять только её автор' } },
      config: { url: '/cards/c-1' },
    }

    // Так ведёт себя компонент: ловит ошибку и сам показывает её текст
    await onError!(error).catch((err: unknown) => {
      showToast(getApiErrorMessage(err, 'Не удалось обновить карточку'), 'error')
    })
    vi.runAllTimers()

    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('Текст карточки может менять только её автор', 'error')
  })

  it('503 от AI не дублируется общим «Что-то пошло не так»', async () => {
    vi.useFakeTimers()
    const onError = getResErrorInterceptor()
    const error = {
      response: { status: 503, data: { detail: 'AI-сервис временно недоступен' } },
      config: { url: '/groups/auto-cluster-preview' },
    }

    await onError!(error).catch((err: unknown) => {
      showToast(getApiErrorMessage(err, 'Не удалось выполнить AI-кластеризацию'), 'error')
    })
    vi.runAllTimers()

    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('AI-сервис временно недоступен', 'error')
  })

  it('403 без обработчика у вызывающего кода всё равно виден пользователю', async () => {
    vi.useFakeTimers()
    const onError = getResErrorInterceptor()
    await onError!({
      response: { status: 403, data: { detail: 'Лимит голосов исчерпан' } },
      config: { url: '/cards/c-1/like' },
    }).catch(() => {})
    vi.runAllTimers()

    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('Лимит голосов исчерпан', 'error')
  })

  it('к запросам добавляется только CSRF-заголовок; токен сессии из браузера не уходит', () => {
    const onReq = getReqInterceptor()
    expect(onReq).toBeTypeOf('function')

    const getCfg = onReq!({ method: 'get', headers: {} })
    expect(getCfg.headers['X-CSRF-Token']).toBeUndefined()
    expect(getCfg.headers['X-Workspace-Token']).toBeUndefined()

    const postCfg = onReq!({ method: 'post', headers: {} })
    expect(postCfg.headers['X-CSRF-Token']).toBe('csrf-abc-123')
    expect(postCfg.headers['X-Workspace-Token']).toBeUndefined()
  })

  it('getCsrfToken reads csrf_token from document.cookie', () => {
    document.cookie = 'other=1; csrf_token=my_token_val'
    expect(getCsrfToken()).toBe('my_token_val')
  })

  it('checkWorkspaceSession calls GET /workspaces/me and returns data', async () => {
    const payload = {
      id: 'w1',
      slug: 'team-1',
      name: 'Team 1',
      created_at: '2026-01-01T00:00:00Z',
      participant,
      ai_enabled: false,
    }
    mockGet.mockResolvedValueOnce({ data: payload })

    const res = await checkWorkspaceSession()
    expect(mockGet).toHaveBeenCalledWith('/workspaces/me')
    expect(res).toEqual(payload)
  })

  it('refreshWorkspaceSession записывает в стор участника, команду и признак AI', async () => {
    useAppStore.setState({ workspace: null, participant: null, aiEnabled: null })
    mockGet.mockResolvedValueOnce({
      data: {
        id: 'w2',
        slug: 'team-2',
        name: 'Team 2',
        created_at: '2026-01-01T00:00:00Z',
        participant: { id: 'p-2', name: 'Борис' },
        ai_enabled: true,
      },
    })

    await refreshWorkspaceSession()

    const state = useAppStore.getState()
    expect(state.workspace).toEqual({
      workspaceId: 'w2',
      workspaceSlug: 'team-2',
      workspaceName: 'Team 2',
    })
    expect(state.participant).toEqual({ id: 'p-2', name: 'Борис' })
    expect(state.username).toBe('Борис')
    expect(state.aiEnabled).toBe(true)
  })

  it('loginToWorkspace отправляет имя и возвращает сессию без токена', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        workspace_id: 'w1',
        workspace_slug: 'team-1',
        workspace_name: 'Team 1',
        participant,
      },
    })

    const session = await loginToWorkspace({
      workspace_slug: 'team-1',
      access_key: 'secret',
      name: 'Анна',
    })

    expect(mockPost).toHaveBeenCalledWith('/workspaces/login', {
      workspace_slug: 'team-1',
      access_key: 'secret',
      name: 'Анна',
    })
    expect(session).toEqual({ workspace, participant })
    expect(session).not.toHaveProperty('token')
  })

  it('logoutWorkspace вызывает POST /workspaces/logout и сам стор не трогает', async () => {
    mockPost.mockResolvedValueOnce({ status: 204 })

    await logoutWorkspace()

    expect(mockPost).toHaveBeenCalledWith('/workspaces/logout')
    expect(useAppStore.getState().participant).toEqual(participant)
  })

  it('renameParticipant вызывает PATCH /workspaces/me/participant', async () => {
    mockPatch.mockResolvedValueOnce({ data: { id: 'p-1', name: 'Анна П.' } })

    const updated = await renameParticipant('Анна П.')

    expect(mockPatch).toHaveBeenCalledWith('/workspaces/me/participant', { name: 'Анна П.' })
    expect(updated).toEqual({ id: 'p-1', name: 'Анна П.' })
  })
})
