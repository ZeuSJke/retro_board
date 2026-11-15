import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showToast } from '../../store/toastStore'

type ResErrorInterceptor = (err: unknown) => Promise<never>

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

import {
  adminLogin,
  adminLogout,
  getAdminSessionHint,
  getAdminWorkspaceInvite,
  rotateAdminWorkspaceInvite,
  setAdminSessionHint,
  subscribeAdminSessionHint,
} from '../../api/admin'
import { getApiErrorMessage } from '../../utils/apiError'

const adminApi = () => instances.get('/api/admin')!
const SESSION_KEY = 'retroboard-admin-session'

describe('api/admin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setAdminSessionHint(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('отметка о входе администратора', () => {
    it('без входа отметки нет — страница может не спрашивать сервер', () => {
      expect(getAdminSessionHint()).toBe(false)
    })

    it('вход ставит отметку на срок жизни cookie, выход её снимает', async () => {
      adminApi().post.mockResolvedValue({ data: { ok: true } })

      await adminLogin({ login: 'admin', password: 'secret' })
      expect(adminApi().post).toHaveBeenCalledWith('/login', { login: 'admin', password: 'secret' })
      expect(getAdminSessionHint()).toBe(true)
      const expiresAt = Number(localStorage.getItem(SESSION_KEY))
      expect(expiresAt - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000)
      expect(expiresAt - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000)

      await adminLogout()
      expect(getAdminSessionHint()).toBe(false)
      expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    })

    it('неудачный вход отметку не ставит', async () => {
      adminApi().post.mockRejectedValueOnce({ response: { status: 401 } })

      await expect(adminLogin({ login: 'admin', password: 'wrong' })).rejects.toBeTruthy()
      expect(getAdminSessionHint()).toBe(false)
    })

    it('выход снимает отметку, даже если запрос не дошёл до сервера', async () => {
      setAdminSessionHint(true)
      adminApi().post.mockRejectedValueOnce(new Error('Network Error'))

      await expect(adminLogout()).rejects.toThrow('Network Error')
      expect(getAdminSessionHint()).toBe(false)
    })

    it('просроченная отметка не считается входом', () => {
      localStorage.setItem(SESSION_KEY, String(Date.now() - 1000))
      expect(getAdminSessionHint()).toBe(false)
    })

    it('работает и без localStorage: отметка живёт в памяти вкладки', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      setAdminSessionHint(true)
      expect(getAdminSessionHint()).toBe(true)
    })

    it('подписчики узнают о смене отметки и о входе в другой вкладке', () => {
      const listener = vi.fn()
      const unsubscribe = subscribeAdminSessionHint(listener)

      setAdminSessionHint(true)
      expect(listener).toHaveBeenCalledTimes(1)

      window.dispatchEvent(new StorageEvent('storage', { key: SESSION_KEY }))
      expect(listener).toHaveBeenCalledTimes(2)

      unsubscribe()
      setAdminSessionHint(false)
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
})
