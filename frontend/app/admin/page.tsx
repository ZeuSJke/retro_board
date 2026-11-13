'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import {
  ArrowLeft,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  LogOut,
  Moon,
  Pencil,
  Plus,
  Sun,
  Trash2,
  User,
} from 'lucide-react'
import { BrandMark } from '@/components/BrandLogo'
import {
  adminLogin,
  adminLogout,
  createAdminWorkspace,
  deleteAdminWorkspace,
  getAdminWorkspaces,
  updateAdminWorkspace,
  type WorkspaceListItem,
} from '../../api/admin'
import { showToast } from '../../store/toastStore'
import { getApiErrorMessage } from '../../utils/apiError'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type PageState = 'checking' | 'login' | 'workspaces'
type DialogMode = 'create' | 'rename' | 'key' | null

const CYR_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

function generateSlugFromName(name: string): string {
  const transliterated = name
    .toLowerCase()
    .split('')
    .map((ch) => CYR_MAP[ch] ?? ch)
    .join('')
  return transliterated.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function AdminPage() {
  const { theme, setTheme } = useTheme()
  const [pageState, setPageState] = useState<PageState>('checking')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)

  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dialogLoading, setDialogLoading] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceListItem | null>(null)

  const [createName, setCreateName] = useState('')
  const [createSlug, setCreateSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [createAccessKey, setCreateAccessKey] = useState('')
  const [renameName, setRenameName] = useState('')
  const [keyAccessKey, setKeyAccessKey] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getAdminWorkspaces()
        if (!cancelled) {
          setWorkspaces(data)
          setPageState('workspaces')
        }
      } catch {
        if (!cancelled) setPageState('login')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const loadWorkspaces = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAdminWorkspaces()
      setWorkspaces(data)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401) {
        setPageState('login')
      } else {
        setError('Не удалось загрузить рабочие пространства')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError(null)
    try {
      await adminLogin({ login, password })
      setPageState('workspaces')
      await loadWorkspaces()
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      setLoginError(status === 401 ? 'Неверный логин или пароль' : 'Ошибка при входе')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await adminLogout()
    } finally {
      setPageState('login')
      setLogin('')
      setPassword('')
      setWorkspaces([])
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createName.trim() || !createSlug.trim() || !createAccessKey) {
      setDialogError('Заполните все поля')
      return
    }
    setDialogLoading(true)
    setDialogError(null)
    try {
      const created = await createAdminWorkspace({
        slug: createSlug.trim(),
        name: createName.trim(),
        access_key: createAccessKey,
      })
      setWorkspaces((prev) => [created, ...prev])
      setDialogMode(null)
      showToast('Пространство создано', 'success')
    } catch (err) {
      setDialogError(getApiErrorMessage(err, 'Ошибка при создании'))
    } finally {
      setDialogLoading(false)
    }
  }

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!renameName.trim() || !editingId) {
      setDialogError('Введите название')
      return
    }
    setDialogLoading(true)
    setDialogError(null)
    try {
      const updated = await updateAdminWorkspace(editingId, { name: renameName.trim() })
      setWorkspaces((prev) => prev.map((w) => (w.id === editingId ? { ...w, ...updated } : w)))
      setDialogMode(null)
      showToast('Название обновлено', 'success')
    } catch (err) {
      setDialogError(getApiErrorMessage(err, 'Ошибка при переименовании'))
    } finally {
      setDialogLoading(false)
    }
  }

  const handleUpdateKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyAccessKey || !editingId) {
      setDialogError('Введите новый ключ доступа')
      return
    }
    setDialogLoading(true)
    setDialogError(null)
    try {
      await updateAdminWorkspace(editingId, { access_key: keyAccessKey })
      setDialogMode(null)
      showToast('Ключ доступа обновлён', 'success')
    } catch (err) {
      setDialogError(getApiErrorMessage(err, 'Ошибка при смене ключа'))
    } finally {
      setDialogLoading(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const ws = deleteTarget
    setDeleteTarget(null)
    try {
      await deleteAdminWorkspace(ws.id)
      setWorkspaces((prev) => prev.filter((w) => w.id !== ws.id))
      showToast('Пространство удалено', 'success')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Не удалось удалить пространство'))
    }
  }

  if (pageState === 'checking') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Проверка доступа...</p>
      </div>
    )
  }

  if (pageState === 'login') {
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
                    disabled={loginLoading}
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
                    disabled={loginLoading}
                    className="pl-9"
                  />
                </div>
              </div>

              {loginError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                  {loginError}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loginLoading}>
                {loginLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                К доскам
              </Button>
            </Link>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2 font-semibold">
              <BrandMark size={24} />
              <span>Администрирование</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Переключить тему"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>

            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setCreateName('')
                setCreateSlug('')
                setSlugEdited(false)
                setCreateAccessKey('')
                setDialogError(null)
                setDialogMode('create')
              }}
            >
              <Plus className="h-4 w-4" />
              Создать workspace
            </Button>

            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              Выйти
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Рабочие пространства (Workspaces)</h1>
            <p className="text-sm text-muted-foreground">
              Каждое пространство изолирует доски, карточки и задачи команды
            </p>
          </div>
          <Badge variant="secondary" className="font-mono">
            Всего: {workspaces.length}
          </Badge>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : workspaces.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Layers className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">Пока нет ни одного workspace</p>
              <Button
                size="sm"
                onClick={() => {
                  setCreateName('')
                  setCreateSlug('')
                  setSlugEdited(false)
                  setCreateAccessKey('')
                  setDialogError(null)
                  setDialogMode('create')
                }}
              >
                Создать первое пространство
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Название</th>
                    <th className="px-4 py-3 font-medium">Slug (код входа)</th>
                    <th className="px-4 py-3 font-medium">Досок</th>
                    <th className="px-4 py-3 font-medium">Создано</th>
                    <th className="px-4 py-3 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {workspaces.map((ws) => (
                    <tr key={ws.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{ws.name}</td>
                      <td className="px-4 py-3">
                        <code className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
                          {ws.slug}
                        </code>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{ws.boards_count}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(ws.created_at).toLocaleDateString('ru-RU')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 px-2 text-xs"
                            onClick={() => {
                              setEditingId(ws.id)
                              setRenameName(ws.name)
                              setDialogError(null)
                              setDialogMode('rename')
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Переименовать
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 px-2 text-xs"
                            onClick={() => {
                              setEditingId(ws.id)
                              setKeyAccessKey('')
                              setDialogError(null)
                              setDialogMode('key')
                            }}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            Ключ
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTarget(ws)}
                            title="Удалить workspace"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Create Dialog */}
      <Dialog open={dialogMode === 'create'} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Новое рабочее пространство</DialogTitle>
              <DialogDescription>Участники смогут войти по slug и ключу доступа.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Название команды</Label>
                <Input
                  value={createName}
                  onChange={(e) => {
                    const v = e.target.value
                    setCreateName(v)
                    if (!slugEdited) setCreateSlug(generateSlugFromName(v))
                  }}
                  placeholder="Например: Платформа"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Slug (латиницей)</Label>
                <Input
                  value={createSlug}
                  onChange={(e) => {
                    setSlugEdited(true)
                    setCreateSlug(e.target.value)
                  }}
                  placeholder="platform-team"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label>Ключ доступа</Label>
                <Input
                  type="password"
                  value={createAccessKey}
                  onChange={(e) => setCreateAccessKey(e.target.value)}
                  placeholder="Придумайте ключ"
                />
              </div>
              {dialogError && (
                <p className="text-xs font-medium text-destructive">{dialogError}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogMode(null)}>
                Отмена
              </Button>
              <Button type="submit" disabled={dialogLoading}>
                {dialogLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Создать
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={dialogMode === 'rename'} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="max-w-sm">
          <form onSubmit={handleRename}>
            <DialogHeader>
              <DialogTitle>Переименовать workspace</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <Input
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder="Новое название"
                autoFocus
              />
              {dialogError && (
                <p className="text-xs font-medium text-destructive">{dialogError}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogMode(null)}>
                Отмена
              </Button>
              <Button type="submit" disabled={dialogLoading}>
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Key Dialog */}
      <Dialog open={dialogMode === 'key'} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="max-w-sm">
          <form onSubmit={handleUpdateKey}>
            <DialogHeader>
              <DialogTitle>Сменить ключ доступа</DialogTitle>
              <DialogDescription>Старый ключ перестанет действовать для новых входов.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <Input
                type="password"
                value={keyAccessKey}
                onChange={(e) => setKeyAccessKey(e.target.value)}
                placeholder="Новый ключ доступа"
                autoFocus
              />
              {dialogError && (
                <p className="text-xs font-medium text-destructive">{dialogError}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogMode(null)}>
                Отмена
              </Button>
              <Button type="submit" disabled={dialogLoading}>
                Обновить ключ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{deleteTarget?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Все доски, карточки и задачи этого пространства будут удалены безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
