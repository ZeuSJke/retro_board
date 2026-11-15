'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Lock, User } from 'lucide-react'
import { adminLogin, adminLogout } from '@/api/admin'
import { BrandMark } from '@/components/BrandLogo'
import { getApiErrorMessage, getApiErrorStatus, markApiErrorReported } from '@/utils/apiError'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AdminTeams from './AdminTeams'
import { useAdminSessionHint } from './useAdminSessionHint'

/**
 * Админка: проверка сессии администратора и управление командами.
 *
 * Сессия — httpOnly-cookie `admin_token`, поэтому признак входа спрашиваем
 * эндпоинтом `GET /api/admin/session`: он отвечает 200 и `{authenticated}`,
 * без ответа 401 в консоли. Пока ответа нет — «Проверка доступа...»; если
 * сервер сессию уже не принимает, страница возвращается к форме входа
 * с объяснением.
 */
export default function AdminPage() {
  const sessionHint = useAdminSessionHint()
  const [seenHint, setSeenHint] = useState(sessionHint)
  const [loggingOut, setLoggingOut] = useState(false)
  // Сессию завершил сервер, а не кнопка «Выйти»: это нужно объяснить на форме входа
  const [sessionEnded, setSessionEnded] = useState(false)

  if (sessionHint !== seenHint) {
    setSeenHint(sessionHint)
    if (seenHint === true && sessionHint === false) {
      setSessionEnded(!loggingOut)
      setLoggingOut(false)
    } else if (sessionHint === true) {
      setSessionEnded(false)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await adminLogout()
    } catch (err) {
      // Отметка о входе снята в любом случае — форма входа уже на экране
      markApiErrorReported(err)
    }
  }

  if (sessionHint === null) {
    return (
      <div
        role="status"
        className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Проверка доступа...</p>
      </div>
    )
  }

  if (!sessionHint) {
    return (
      <AdminLogin
        notice={sessionEnded ? 'Сессия администратора завершилась — войдите снова' : null}
      />
    )
  }

  return <AdminTeams onLogout={handleLogout} />
}

function AdminLogin({ notice }: { notice: string | null }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      // Успешный вход ставит отметку о сессии — страница сама переключится на список команд
      await adminLogin({ login, password })
    } catch (err: unknown) {
      setError(
        getApiErrorStatus(err) === 401
          ? 'Неверный логин или пароль'
          : getApiErrorMessage(err, 'Не удалось войти. Попробуйте ещё раз.'),
      )
      markApiErrorReported(err)
      setLoading(false)
    }
  }

  const message = error ?? notice

  return (
    <div className="bg-dot-grid flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex justify-center">
            <BrandMark size={44} />
          </div>
          <CardTitle className="text-xl">Панель администратора</CardTitle>
          <CardDescription>Управление командами и ключами доступа</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-login">Логин</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="admin-login"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="Логин"
                  autoComplete="username"
                  disabled={loading}
                  autoFocus
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-password">Пароль</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="admin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Пароль"
                  autoComplete="current-password"
                  disabled={loading}
                  className="pl-9"
                />
              </div>
            </div>

            {message && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
              >
                {message}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Войти
            </Button>

            <div className="text-center">
              <Link
                href="/"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Вернуться к доскам
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
