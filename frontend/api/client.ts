import axios, { type AxiosError } from 'axios'
import { getCsrfToken, handleCommonHttpError } from './index'
import { useAppStore } from '../store'
import { isApiErrorReported } from '../utils/apiError'

/**
 * HTTP-клиент модулей `api/health.ts` и `api/themes.ts`.
 *
 * Экземпляр axios из `api/index.ts` наружу не экспортируется, поэтому здесь — второй
 * экземпляр с теми же правилами (как у `api/admin.ts`): сессия в httpOnly-cookie,
 * `X-CSRF-Token` на небезопасных методах, ответ 401 сбрасывает сессию без тоста,
 * общий тост — запасной, если вызывающий код не показал ошибку сам.
 */
export const teamApi = axios.create({ baseURL: '/api' })

teamApi.interceptors.request.use((config) => {
  if (config.method && !['get', 'head', 'options'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = getCsrfToken()
  }
  return config
})

teamApi.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ detail?: string }>) => {
    const status = error.response?.status
    const detail = error.response?.data?.detail || ''

    if (status === 401) {
      // Сессии нет или она отозвана — приложение покажет экран входа
      useAppStore.getState().clearSession()
      return Promise.reject(error)
    }

    // Обработчик вызывающего кода выполнится раньше этого таймера: если он показал
    // сообщение через getApiErrorMessage, второго тоста не будет
    setTimeout(() => {
      if (!isApiErrorReported(error)) handleCommonHttpError(status, detail)
    }, 0)
    return Promise.reject(error)
  },
)
