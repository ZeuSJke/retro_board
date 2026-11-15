'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Users } from 'lucide-react'
import { BrandMark } from '@/components/BrandLogo'
import { useAppStore } from '@/store'
import { loginToWorkspace } from '@/api'
import { getUserAvatarGradient, getUserInitials } from '@/lib/board-themes'
import { getApiErrorMessage, getApiErrorStatus } from '@/utils/apiError'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface WelcomeDialogProps {
  /** Вход выполнен: сессия уже записана в стор, аргумент — имя участника от сервера. */
  onConfirm: (name: string) => void
}

/**
 * Экран входа: имя, код команды и ключ доступа. Вход создаёт на сервере участника,
 * токен сессии сервер кладёт в httpOnly-cookie. Имя необязательно — без него
 * сервер назовёт участника «Участник», сменить имя можно в профиле.
 */
export default function WelcomeDialog({ onConfirm }: WelcomeDialogProps) {
  const savedName = useAppStore((s) => s.username)
  // Сведения о команде без участника остаются после обновления со старой версии:
  // сессию сервер уже не принимает, но код команды можно подставить в форму
  const knownWorkspaceSlug = useAppStore((s) => s.workspace?.workspaceSlug ?? '')
  const setSession = useAppStore((s) => s.setSession)

  const [name, setName] = useState(savedName === 'Аноним' ? '' : savedName)
  const [workspaceSlug, setWorkspaceSlug] = useState(knownWorkspaceSlug)
  const [accessKey, setAccessKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (savedName && savedName !== 'Аноним') {
      setName((prev) => prev || savedName)
    }
  }, [savedName])

  const trimmedName = name.trim()
  const canSubmit = workspaceSlug.trim().length > 0 && accessKey.length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || loading) return

    setLoading(true)
    setError(null)
    try {
      const session = await loginToWorkspace({
        workspace_slug: workspaceSlug.trim(),
        access_key: accessKey,
        ...(trimmedName ? { name: trimmedName } : {}),
      })
      setSession(session)
      onConfirm(session.participant.name)
    } catch (err: unknown) {
      // Ошибка показана в форме: общий разбор помечает её показанной, второго тоста не будет.
      // Ответ 422 он разбирает по полям («Имя: не длиннее 60 символов»), остальное берёт у сервера.
      const message = getApiErrorMessage(
        err,
        'Не удалось подключиться к команде. Проверьте соединение и попробуйте ещё раз.',
        { name: 'Имя' },
      )
      // 401 при входе — не «сессия истекла», а неверные код или ключ
      setError(
        getApiErrorStatus(err) === 401 ? 'Неверный код команды или ключ доступа' : message,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background bg-dot-grid p-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,hsl(var(--primary)/0.14),transparent_55%)]"
      />

      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <Card className="w-full border-border/80 bg-background/95 shadow-2xl backdrop-blur-md">
        <CardHeader className="items-center space-y-3 pb-4 text-center">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 text-xs font-semibold text-foreground">
              <BrandMark size={20} />
              <span>RetroBoard</span>
            </div>
          </div>

          <div
            className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br/srgb text-xl font-bold text-white shadow-lg transition-all ${
              trimmedName ? getUserAvatarGradient(trimmedName) : 'from-zinc-400 to-zinc-500'
            }`}
          >
            {trimmedName ? getUserInitials(trimmedName) : <Users className="h-7 w-7" />}
          </div>

          <div className="space-y-1">
            <CardTitle className="text-2xl font-bold">Добро пожаловать!</CardTitle>
            <CardDescription>
              Войдите в свою команду, чтобы начать ретроспективу.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="welcome-name">
                Ваше имя{' '}
                <span className="font-normal text-muted-foreground">(необязательно)</span>
              </Label>
              <Input
                id="welcome-name"
                placeholder="Ваше имя"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                autoFocus
                data-testid="welcome-name-input"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="welcome-slug">Код команды</Label>
              <Input
                id="welcome-slug"
                placeholder="Например: fmrm-core"
                value={workspaceSlug}
                onChange={(e) => setWorkspaceSlug(e.target.value)}
                data-testid="workspace-slug-input"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="welcome-key">Ключ доступа</Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="welcome-key"
                  type={showKey ? 'text' : 'password'}
                  placeholder="Ключ доступа команды"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  className="pl-9 pr-9"
                  data-testid="workspace-key-input"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((prev) => !prev)}
                  aria-label={showKey ? 'Скрыть ключ' : 'Показать ключ'}
                  className="absolute right-2.5 top-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={!canSubmit || loading}
              className="w-full"
              size="lg"
              data-testid="welcome-submit-btn"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Подключаемся...
                </>
              ) : (
                <>
                  Войти на доску
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-5 border-t pt-4 text-center text-xs text-muted-foreground">
            Нужно создать новую команду?{' '}
            <Link href="/admin" className="font-medium text-primary hover:underline">
              Открыть администрирование
            </Link>
          </div>
        </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
