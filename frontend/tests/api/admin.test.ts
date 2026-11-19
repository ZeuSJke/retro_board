import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showToast } from '../../store/toastStore'

type ResErrorInterceptor = (err: unknown) => Promise<never>

const { instances } = vi.hoisted(() => {
  interface MockInstance {
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
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
        put: vi.fn(),
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

import {
  adminLogin,
  adminLogout,
  checkAdminSession,
  fetchAdminAiModels,
  getAdminAiSettings,
  getAdminSession,
  getAdminSessionHint,
  getAdminWorkspaceInvite,
  resetAdminAiSettings,
  rotateAdminWorkspaceInvite,
  setAdminSessionHint,
  subscribeAdminSessionHint,
  testAdminAiSettings,
  updateAdminAiSettings,
} from '../../api/admin'
import { getApiErrorMessage } from '../../utils/apiError'

const adminApi = () => instances.get('/api/admin')!

describe('api/admin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAdminSessionHint(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('состояние сессии администратора', () => {
    it('до проверки состояние неизвестно', () => {
      expect(getAdminSessionHint()).toBeNull()
    })

    it('проверка сессии спрашивает сервер без 401 и запоминает ответ', async () => {
      adminApi().get.mockResolvedValueOnce({ data: { authenticated: true } })

      await expect(getAdminSession()).resolves.toEqual({ authenticated: true })
      expect(adminApi().get).toHaveBeenCalledWith('/session')

      adminApi().get.mockResolvedValueOnce({ data: { authenticated: true } })
      await expect(checkAdminSession()).resolves.toBe(true)
      expect(getAdminSessionHint()).toBe(true)
    })

    it('анонимный браузер: 200 и authenticated=false, форма входа', async () => {
      adminApi().get.mockResolvedValueOnce({ data: { authenticated: false } })

      await expect(checkAdminSession()).resolves.toBe(false)
      expect(getAdminSessionHint()).toBe(false)
    })

    it('повторные проверки до ответа переиспользуют один запрос', async () => {
      let resolveRequest!: (value: { data: { authenticated: boolean } }) => void
      adminApi().get.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
      )

      const first = checkAdminSession()
      const second = checkAdminSession()
      expect(adminApi().get).toHaveBeenCalledTimes(1)

      resolveRequest({ data: { authenticated: true } })
      await expect(first).resolves.toBe(true)
      await expect(second).resolves.toBe(true)
    })

    it('сеть недоступна на первом заходе — false и пояснение', async () => {
      adminApi().get.mockRejectedValueOnce(new Error('Network Error'))

      await expect(checkAdminSession()).resolves.toBe(false)
      expect(getAdminSessionHint()).toBe(false)
      expect(showToast).toHaveBeenCalledWith(
        'Не удалось проверить сессию администратора',
        'error',
        expect.objectContaining({ description: expect.any(String) }),
      )
    })

    it('сбой сети не снимает уже известное состояние true', async () => {
      setAdminSessionHint(true)
      adminApi().get.mockRejectedValueOnce(new Error('Network Error'))

      await expect(checkAdminSession()).resolves.toBe(true)
      expect(getAdminSessionHint()).toBe(true)
    })

    it('вход ставит состояние true, выход его снимает', async () => {
      adminApi().post.mockResolvedValue({ data: { ok: true } })

      await adminLogin({ login: 'admin', password: 'secret' })
      expect(adminApi().post).toHaveBeenCalledWith('/login', { login: 'admin', password: 'secret' })
      expect(getAdminSessionHint()).toBe(true)

      await adminLogout()
      expect(getAdminSessionHint()).toBe(false)
    })

    it('неудачный вход состояние не ставит', async () => {
      adminApi().post.mockRejectedValueOnce({ response: { status: 401 } })

      await expect(adminLogin({ login: 'admin', password: 'wrong' })).rejects.toBeTruthy()
      expect(getAdminSessionHint()).toBeNull()
    })

    it('выход снимает состояние, даже если запрос не дошёл до сервера', async () => {
      setAdminSessionHint(true)
      adminApi().post.mockRejectedValueOnce(new Error('Network Error'))

      await expect(adminLogout()).rejects.toThrow('Network Error')
      expect(getAdminSessionHint()).toBe(false)
    })

    it('подписчики узнают о смене состояния', () => {
      const listener = vi.fn()
      const unsubscribe = subscribeAdminSessionHint(listener)

      setAdminSessionHint(true)
      expect(listener).toHaveBeenCalledTimes(1)

      setAdminSessionHint(false)
      expect(listener).toHaveBeenCalledTimes(2)

      unsubscribe()
      setAdminSessionHint(true)
      expect(listener).toHaveBeenCalledTimes(2)
    })
  })

  describe('перехватчик ответов', () => {
    it('401 на обычный запрос снимает отметку: сессия закончилась', async () => {
      setAdminSessionHint(true)

      await adminApi().onResponseError!({
        response: { status: 401, data: { detail: 'Not authenticated' } },
        config: { url: '/workspaces' },
      }).catch(() => {})

      expect(getAdminSessionHint()).toBe(false)
      expect(showToast).not.toHaveBeenCalled()
    })

    it('401 на вход — это неверный пароль, отметку другой вкладки не трогает', async () => {
      setAdminSessionHint(true)

      await adminApi().onResponseError!({
        response: { status: 401, data: { detail: 'Неверный логин или пароль' } },
        config: { url: '/login' },
      }).catch(() => {})

      expect(getAdminSessionHint()).toBe(true)
    })

    it('ошибка, которую страница показала сама, не дублируется тостом', async () => {
      vi.useFakeTimers()
      const shown = { response: { status: 500, data: { detail: 'Внутренняя ошибка сервера' } }, config: { url: '/workspaces' } }
      await adminApi().onResponseError!(shown).catch((err: unknown) => {
        getApiErrorMessage(err, 'Не удалось создать команду')
      })
      vi.runAllTimers()
      expect(showToast).not.toHaveBeenCalled()

      const silent = { response: { status: 500, data: { detail: 'Внутренняя ошибка сервера' } }, config: { url: '/workspaces' } }
      await adminApi().onResponseError!(silent).catch(() => {})
      vi.runAllTimers()
      expect(showToast).toHaveBeenCalledTimes(1)
    })

    it('422 со списком ошибок проверки не роняет запасной тост', async () => {
      vi.useFakeTimers()
      await adminApi().onResponseError!({
        response: { status: 422, data: { detail: [{ type: 'missing', loc: ['body', 'slug'] }] } },
        config: { url: '/workspaces' },
      }).catch(() => {})
      vi.runAllTimers()

      expect(showToast).not.toHaveBeenCalled()
    })
  })

  describe('ссылка-приглашение команды', () => {
    it('читает и перевыпускает токен по путям админского API', async () => {
      adminApi().get.mockResolvedValueOnce({ data: { invite_token: 'old-token-1234' } })
      adminApi().post.mockResolvedValueOnce({ data: { invite_token: 'new-token-5678' } })

      await expect(getAdminWorkspaceInvite('ws-1')).resolves.toBe('old-token-1234')
      expect(adminApi().get).toHaveBeenCalledWith('/workspaces/ws-1/invite')

      await expect(rotateAdminWorkspaceInvite('ws-1')).resolves.toBe('new-token-5678')
      expect(adminApi().post).toHaveBeenCalledWith('/workspaces/ws-1/invite/rotate')
    })
  })

  describe('настройки ИИ', () => {
    it('читает, сохраняет, сбрасывает и тестирует настройки ИИ по путям админского API', async () => {
      const sample = {
        enabled: true,
        base_url: 'https://api.example.com/v1',
        model: 'model-a',
        reasoning_effort: 'high' as const,
        source: 'database' as const,
        has_api_key: true,
        api_key_masked: 'sk-••••1234',
        key_decrypt_error: false,
        env_configured: false,
        updated_at: '2026-11-19T12:00:00Z',
      }
      adminApi().get.mockResolvedValueOnce({ data: sample })
      adminApi().put.mockResolvedValueOnce({ data: sample })
      adminApi().delete.mockResolvedValueOnce({ data: { ...sample, source: 'env' } })
      adminApi().post
        .mockResolvedValueOnce({
          data: {
            ok: true,
            latency_ms: 42,
            reply_preview: 'ОК',
            error: null,
            reasoning_used: true,
          },
        })
        .mockResolvedValueOnce({ data: { models: ['model-a', 'model-b'] } })

      await expect(getAdminAiSettings()).resolves.toEqual(sample)
      expect(adminApi().get).toHaveBeenCalledWith('/ai-settings')

      await expect(
        updateAdminAiSettings({
          enabled: true,
          base_url: 'https://api.example.com/v1',
          model: 'model-a',
          reasoning_effort: 'high',
          api_key: 'sk-test-1234',
        }),
      ).resolves.toEqual(sample)
      expect(adminApi().put).toHaveBeenCalledWith('/ai-settings', {
        enabled: true,
        base_url: 'https://api.example.com/v1',
        model: 'model-a',
        reasoning_effort: 'high',
        api_key: 'sk-test-1234',
      })

      await expect(resetAdminAiSettings()).resolves.toMatchObject({ source: 'env' })
      expect(adminApi().delete).toHaveBeenCalledWith('/ai-settings')

      await expect(
        testAdminAiSettings({
          base_url: 'https://api.example.com/v1',
          model: 'model-a',
          reasoning_effort: 'high',
        }),
      ).resolves.toMatchObject({ ok: true, latency_ms: 42, reasoning_used: true })
      expect(adminApi().post).toHaveBeenCalledWith(
        '/ai-settings/test',
        {
          base_url: 'https://api.example.com/v1',
          model: 'model-a',
          reasoning_effort: 'high',
        },
        { timeout: 45000 },
      )

      await expect(
        fetchAdminAiModels({ base_url: 'https://api.example.com/v1' }),
      ).resolves.toEqual(['model-a', 'model-b'])
      expect(adminApi().post).toHaveBeenCalledWith(
        '/ai-settings/models',
        { base_url: 'https://api.example.com/v1' },
        { timeout: 15000 },
      )
    })
  })
})
