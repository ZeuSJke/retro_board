import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAppStore } from '../../store'
import { showToast } from '../../store/toastStore'

type ReqInterceptor = (config: { method?: string; headers: Record<string, string> }) => {
  method?: string
  headers: Record<string, string>
}
type ResErrorInterceptor = (err: unknown) => Promise<never>

const { mockGet, mockInstance, getReqInterceptor, getResErrorInterceptor } = vi.hoisted(() => {
  let reqFn: ReqInterceptor | null = null
  let resErrFn: ResErrorInterceptor | null = null
  const mockGet = vi.fn()
  const mockInstance = {
    get: mockGet,
    post: vi.fn(),
    patch: vi.fn(),
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

import { checkWorkspaceSession, getCsrfToken } from '../../api'

describe('api interceptors and session helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      workspace: {
        token: 'ws-token-1',
        workspaceId: 'w1',
        workspaceSlug: 'team-1',
        workspaceName: 'Team 1',
      },
    })
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: 'csrf_token=csrf-abc-123',
    })
  })

  it('clears workspace on 401 regardless of detail when URL is not /workspaces/login', async () => {
    const onError = getResErrorInterceptor()
    expect(onError).toBeTypeOf('function')

    await expect(
      onError!({
        response: { status: 401, data: { detail: 'Invalid token' } },
        config: { url: '/boards/' },
      }),
    ).rejects.toBeDefined()

    expect(useAppStore.getState().workspace).toBeNull()
  })

  it('preserves workspace state when /workspaces/login itself returns 401', async () => {
    const onError = getResErrorInterceptor()
    expect(onError).toBeTypeOf('function')

    await expect(
      onError!({
        response: { status: 401, data: { detail: 'Wrong key' } },
        config: { url: '/workspaces/login' },
      }),
    ).rejects.toBeDefined()

    expect(useAppStore.getState().workspace?.token).toBe('ws-token-1')
  })

  it('shows error toast on 500 server error', async () => {
    const onError = getResErrorInterceptor()
    await expect(
      onError!({
        response: { status: 500, data: {} },
        config: { url: '/boards/' },
      }),
    ).rejects.toBeDefined()

    expect(showToast).toHaveBeenCalledWith('Что-то пошло не так', 'error')
  })

  it('attaches X-CSRF-Token on mutating requests and X-Workspace-Token on all requests', () => {
    const onReq = getReqInterceptor()
    expect(onReq).toBeTypeOf('function')

    const getCfg = onReq!({ method: 'get', headers: {} })
    expect(getCfg.headers['X-CSRF-Token']).toBeUndefined()
    expect(getCfg.headers['X-Workspace-Token']).toBe('ws-token-1')

    const postCfg = onReq!({ method: 'post', headers: {} })
    expect(postCfg.headers['X-CSRF-Token']).toBe('csrf-abc-123')
    expect(postCfg.headers['X-Workspace-Token']).toBe('ws-token-1')
  })

  it('getCsrfToken reads csrf_token from document.cookie', () => {
    document.cookie = 'other=1; csrf_token=my_token_val'
    expect(getCsrfToken()).toBe('my_token_val')
  })

  it('checkWorkspaceSession calls GET /workspaces/me and returns data', async () => {
    const payload = { id: 'w1', slug: 'team-1', name: 'Team 1' }
    mockGet.mockResolvedValueOnce({ data: payload })

    const res = await checkWorkspaceSession()
    expect(mockGet).toHaveBeenCalledWith('/workspaces/me')
    expect(res).toEqual(payload)
  })
})
