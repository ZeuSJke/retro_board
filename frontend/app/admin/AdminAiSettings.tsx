'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import {
  fetchAdminAiModels,
  getAdminAiSettings,
  testAdminAiSettings,
  updateAdminAiSettings,
  type AdminAiSettings,
  type AdminAiTestResponse,
  type AIReasoningEffort,
} from '@/api/admin'
import { queryKeys } from '@/lib/query-client'
import { showToast } from '@/store/toastStore'
import { getApiErrorMessage, markApiErrorReported, type FieldLabels } from '@/utils/apiError'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const AI_FIELD_LABELS: FieldLabels = {
  base_url: 'Base URL',
  model: 'Модель',
  api_key: 'API-ключ',
  reasoning_effort: 'Уровень размышлений',
}

const REASONING_EFFORT_OPTIONS: { value: AIReasoningEffort; label: string }[] = [
  { value: 'default', label: 'По умолчанию модели' },
  { value: 'none', label: 'Отключено (none)' },
  { value: 'low', label: 'Низкий (low)' },
  { value: 'medium', label: 'Средний (medium)' },
  { value: 'high', label: 'Высокий (high)' },
  { value: 'max', label: 'Максимальный (max)' },
]

function normalizeUrl(raw: string): string {
  const cleaned = raw.trim().replace(/\/+$/, '')
  if (!cleaned) return ''
  try {
    const parsed = new URL(cleaned)
    if (parsed.username || parsed.password) {
      return cleaned
    }
    const scheme = parsed.protocol.toLowerCase()
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '')
    const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    const port = parsed.port
    const skipPort =
      !port || (scheme === 'https:' && port === '443') || (scheme === 'http:' && port === '80')
    const netloc = skipPort ? hostPart : `${hostPart}:${port}`
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${scheme}//${netloc}${path}${parsed.search}${parsed.hash}`
  } catch {
    return cleaned
  }
}

/**
 * Вкладка «Настройки ИИ» в `/admin`: единая настройка любого OpenAI-совместимого
 * эндпоинта, загрузка списка моделей и проверка подключения.
 */
export default function AdminAiSettings() {
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({
    queryKey: queryKeys.adminAiSettings(),
    refetchOnReconnect: false,
    queryFn: async () => {
      try {
        return await getAdminAiSettings()
      } catch (err) {
        markApiErrorReported(err)
        throw err
      }
    },
  })

  const serverData = settingsQuery.data ?? null
  const [seenData, setSeenData] = useState<AdminAiSettings | null>(null)
  const [dirty, setDirty] = useState(false)

  const [enabled, setEnabled] = useState(true)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState<AIReasoningEffort>('default')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [keyVisible, setKeyVisible] = useState(false)

  const [loadedModels, setLoadedModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<AdminAiTestResponse | null>(null)

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const applyServerState = (next: AdminAiSettings) => {
    setSeenData(next)
    setEnabled(next.enabled)
    setBaseUrl(next.base_url)
    setModel(next.model)
    setReasoningEffort(next.reasoning_effort)
    setApiKey('')
    setClearApiKey(false)
    setKeyVisible(false)
    setDirty(false)
    setFormError(null)
  }

  if (serverData && serverData !== seenData && (!seenData || !dirty)) {
    applyServerState(serverData)
  } else if (serverData && serverData !== seenData) {
    setSeenData(serverData)
  }

  if (settingsQuery.isPending) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
      >
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span>Загрузка настроек ИИ...</span>
      </div>
    )
  }

  if (settingsQuery.isError || !serverData) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <p>Не удалось загрузить настройки ИИ. Проверьте соединение и повторите.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void settingsQuery.refetch()}>
          <RefreshCw />
          Повторить
        </Button>
      </div>
    )
  }

  const busy = saving || testing || modelsLoading
  const savedUrl = normalizeUrl(serverData.base_url)
  const currentUrl = normalizeUrl(baseUrl)
  const urlChangedFromSaved = Boolean(savedUrl) && currentUrl !== savedUrl
  const savedKeyReusable =
    serverData.has_api_key && !serverData.key_decrypt_error && !urlChangedFromSaved && !clearApiKey

  const validateClientUrl = (raw: string): boolean => {
    const clean = normalizeUrl(raw)
    if (!clean) {
      setFormError('Укажите Base URL')
      return false
    }
    if (!clean.toLowerCase().startsWith('https://')) {
      setFormError('Поддерживается только HTTPS (https://...)')
      return false
    }
    return true
  }

  const handleLoadModels = async () => {
    setModelsError(null)
    setFormError(null)
    if (!validateClientUrl(baseUrl)) return
    setModelsLoading(true)
    try {
      const list = await fetchAdminAiModels({
        base_url: currentUrl,
        api_key: apiKey.trim() || undefined,
        clear_api_key: clearApiKey || undefined,
      })
      setLoadedModels(list)
      if (!model.trim() && list.length > 0) {
        setModel(list[0])
        setDirty(true)
      }
      showToast(`Загружено моделей: ${list.length}`, 'success')
    } catch (err: unknown) {
      setModelsError(getApiErrorMessage(err, 'Не удалось загрузить список моделей', AI_FIELD_LABELS))
    } finally {
      setModelsLoading(false)
    }
  }

  const handleTest = async () => {
    setFormError(null)
    setTestResult(null)
    if (!validateClientUrl(baseUrl)) return
    if (!model.trim()) {
      setFormError('Укажите имя модели')
      return
    }
    setTesting(true)
    try {
      const res = await testAdminAiSettings({
        base_url: currentUrl,
        model: model.trim(),
        reasoning_effort: reasoningEffort,
        api_key: apiKey.trim() || undefined,
        clear_api_key: clearApiKey || undefined,
      })
      setTestResult(res)
    } catch (err: unknown) {
      setFormError(
        getApiErrorMessage(err, 'Не удалось выполнить проверку подключения', AI_FIELD_LABELS),
      )
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (enabled) {
      if (!validateClientUrl(baseUrl)) return
      if (!model.trim()) {
        setFormError('Укажите имя модели')
        return
      }
    }
    setSaving(true)
    try {
      const updated = await updateAdminAiSettings({
        enabled,
        base_url: currentUrl,
        model: model.trim(),
        reasoning_effort: reasoningEffort,
        api_key: apiKey.trim() || undefined,
        clear_api_key: clearApiKey || undefined,
      })
      queryClient.setQueryData(queryKeys.adminAiSettings(), updated)
      applyServerState(updated)
      setTestResult(null)
      showToast('Настройки ИИ сохранены', 'success')
    } catch (err: unknown) {
      setFormError(getApiErrorMessage(err, 'Не удалось сохранить настройки ИИ', AI_FIELD_LABELS))
    } finally {
      setSaving(false)
    }
  }

  const aiStatus =
    serverData.enabled && Boolean(serverData.base_url)
      ? { variant: 'default' as const, label: 'Включён' }
      : Boolean(serverData.base_url)
        ? { variant: 'secondary' as const, label: 'Выключен' }
        : { variant: 'secondary' as const, label: 'Не настроен' }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Настройки ИИ</h1>
          <p className="text-sm text-muted-foreground">
            Общий OpenAI-совместимый шлюз для итогов доски, кластеризации, тем и названий задач
          </p>
        </div>
        <Badge variant={aiStatus.variant} data-testid="ai-settings-status-badge">
          {aiStatus.label}
        </Badge>
      </div>

      {serverData.key_decrypt_error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Сохранённый API-ключ не удалось расшифровать (возможно, изменился{' '}
            <code>ADMIN_JWT_SECRET</code> или <code>AI_SETTINGS_ENCRYPTION_KEY</code>). Введите
            новый ключ или удалите старый перед сохранением.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">OpenAI-совместимое подключение</CardTitle>
          <CardDescription>
            Изменения применяются сразу после сохранения без перезапуска сервера
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 px-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="ai-enabled" className="cursor-pointer text-sm font-medium">
                  Включить ИИ-функции
                </Label>
                <p className="text-xs text-muted-foreground">
                  Если выключено, кнопки ИИ и автогенерация итогов отключены для всех команд
                </p>
              </div>
              <Switch
                id="ai-enabled"
                checked={enabled}
                onCheckedChange={(checked) => {
                  setEnabled(checked)
                  setDirty(true)
                  setFormError(null)
                }}
                disabled={busy}
                data-testid="ai-enabled-switch"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-base-url">Base URL (только HTTPS)</Label>
              <Input
                id="ai-base-url"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value)
                  setDirty(true)
                  setLoadedModels([])
                  setModelsError(null)
                  setTestResult(null)
                  setFormError(null)
                }}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                data-testid="ai-base-url-input"
              />
              <p className="text-xs text-muted-foreground">
                Базовый URL OpenAI-совместимого API (без <code>/chat/completions</code>), например{' '}
                <code>https://api.example.com/v1</code>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-api-key">API-ключ (Bearer)</Label>
              <div className="relative">
                <Input
                  id="ai-api-key"
                  type={keyVisible ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setDirty(true)
                    if (e.target.value.trim()) setClearApiKey(false)
                    setTestResult(null)
                    setFormError(null)
                  }}
                  placeholder={
                    savedKeyReusable
                      ? 'Оставьте пустым, чтобы сохранить текущий ключ'
                      : 'Введите API-ключ провайдера'
                  }
                  autoComplete="new-password"
                  spellCheck={false}
                  disabled={busy}
                  className="pr-9 font-mono text-xs sm:text-sm"
                  data-testid="ai-api-key-input"
                />
                <button
                  type="button"
                  onClick={() => setKeyVisible((v) => !v)}
                  disabled={busy}
                  aria-label={keyVisible ? 'Скрыть ключ' : 'Показать ключ'}
                  aria-pressed={keyVisible}
                  className="absolute right-2.5 top-2 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {keyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {serverData.has_api_key && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {urlChangedFromSaved && !apiKey.trim() && !clearApiKey ? (
                    <span className="text-amber-700 dark:text-amber-400">
                      Base URL изменён: прежний ключ не будет отправлен на новый адрес — введите
                      новый ключ (или сохраните без ключа).
                    </span>
                  ) : clearApiKey ? (
                    <>
                      <span>Сохранённый ключ будет удалён после сохранения.</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        disabled={busy}
                        onClick={() => {
                          setClearApiKey(false)
                          setDirty(true)
                        }}
                      >
                        Отменить удаление
                      </Button>
                    </>
                  ) : (
                    <>
                      <span>
                        {serverData.key_decrypt_error ? (
                          'Сохранён ключ (не расшифрован)'
                        ) : (
                          <>
                            Сохранён ключ:{' '}
                            <code className="font-mono text-foreground">
                              {serverData.api_key_masked ?? 'задан'}
                            </code>
                          </>
                        )}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => {
                          setClearApiKey(true)
                          setApiKey('')
                          setDirty(true)
                          setTestResult(null)
                        }}
                        disabled={busy}
                        data-testid="ai-clear-key-btn"
                      >
                        <Trash2 className="h-3 w-3" />
                        Удалить ключ
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-model">Модель</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value)
                    setDirty(true)
                    setTestResult(null)
                    setFormError(null)
                  }}
                  placeholder="model-id"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  className="font-mono text-xs sm:text-sm"
                  data-testid="ai-model-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleLoadModels}
                  disabled={busy || !baseUrl.trim()}
                  className="shrink-0"
                  data-testid="ai-load-models-btn"
                >
                  {modelsLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Загрузить модели
                </Button>
              </div>

              {loadedModels.length > 0 && (
                <Select
                  value={loadedModels.includes(model) ? model : ''}
                  onValueChange={(value) => {
                    if (!value) return
                    setModel(value)
                    setDirty(true)
                    setTestResult(null)
                    setFormError(null)
                  }}
                  disabled={busy}
                >
                  <SelectTrigger aria-label="Выбрать модель из загруженного списка">
                    <SelectValue placeholder={`Выбрать из загруженных (${loadedModels.length})`} />
                  </SelectTrigger>
                  <SelectContent>
                    {loadedModels.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {modelsError && (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {modelsError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-reasoning-effort">
                Уровень размышлений (<code>reasoning_effort</code>)
              </Label>
              <Select
                value={reasoningEffort}
                onValueChange={(value) => {
                  setReasoningEffort(value as AIReasoningEffort)
                  setDirty(true)
                  setTestResult(null)
                  setFormError(null)
                }}
                disabled={busy}
              >
                <SelectTrigger id="ai-reasoning-effort" data-testid="ai-reasoning-effort-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONING_EFFORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Стандартный параметр <code>reasoning_effort</code> для OpenAI-совместимых моделей.
                Пока размышления активны, лимит токенов расширяется автоматически, а JSON-ответы
                запрашиваются структурированно; «Отключено (none)» даёт минимальную задержку.
              </p>
            </div>

            {testResult && (
              <div
                role="status"
                data-testid="ai-test-result"
                className={
                  testResult.ok
                    ? 'flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300'
                    : 'flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'
                }
              >
                {testResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div className="min-w-0 space-y-0.5">
                  {testResult.ok ? (
                    <p>
                      Подключение успешно ({testResult.latency_ms} мс
                      {testResult.reasoning_used ? ' · с размышлениями' : ''})
                      {testResult.reply_preview ? ` — ответ: «${testResult.reply_preview}»` : ''}
                    </p>
                  ) : (
                    <p>
                      {testResult.error ?? 'Проверка подключения не удалась'} (
                      {testResult.latency_ms} мс)
                    </p>
                  )}
                </div>
              </div>
            )}

            {formError && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {formError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={handleTest}
                disabled={busy || !baseUrl.trim() || !model.trim()}
                data-testid="ai-test-btn"
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlugZap className="h-4 w-4" />
                )}
                Проверить подключение
              </Button>
              <Button type="submit" disabled={busy} data-testid="ai-save-btn">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Сохранить
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
