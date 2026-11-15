'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import {
  ArrowLeft,
  Bot,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  LogOut,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Sun,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import {
  createAdminAgentToken,
  createAdminWorkspace,
  deleteAdminWorkspace,
  getAdminAgentTokens,
  getAdminWorkspaces,
  revokeAdminAgentToken,
  updateAdminWorkspace,
  type WorkspaceListItem,
} from '@/api/admin'
import AgentTokensDialog, { type AgentTokensAdapter } from '@/components/AgentTokensDialog'
import { BrandMark } from '@/components/BrandLogo'
import { showToast } from '@/store/toastStore'
import {
  getApiErrorMessage,
  getApiErrorStatus,
  markApiErrorReported,
  type FieldLabels,
} from '@/utils/apiError'
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
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AccessKeyField from './AccessKeyField'
import InviteLinkDialog from './InviteLinkDialog'

type DialogMode = 'create' | 'rename' | 'key' | 'invite' | 'tokens' | null

/** Как поля команды называются в формах админки — для сообщений о проверке (ответ 422). */
const TEAM_FIELD_LABELS: FieldLabels = {
  name: 'Название команды',
  slug: 'Код команды',
  access_key: 'Ключ доступа',
}

const CYR_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/** Код команды из названия: транслитерация, только `a-z`, `0-9` и дефис, не длиннее 80 символов. */
export function generateSlugFromName(name: string): string {
  const transliterated = name
    .toLowerCase()
    .split('')
    .map((ch) => CYR_MAP[ch] ?? ch)
    .join('')
  return transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/, '')
}

interface TeamAction {
  key: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  destructive?: boolean
}

interface AdminTeamsProps {
  onLogout: () => void
}

/**
 * Список команд и действия администратора: создать, переименовать, сменить ключ доступа,
 * показать и перевыпустить ссылку-приглашение, удалить.
 *
 * Ответ 401 здесь не обрабатывается: перехватчик `api/admin.ts` снимает отметку о входе,
 * и страница показывает форму входа — этот компонент исчезает вместе со своим состоянием.
 */
export default function AdminTeams({ onLogout }: AdminTeamsProps) {
  const { theme, setTheme } = useTheme()

  // null — список ещё не загружен
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  // Команда, с которой работает открытый диалог; после закрытия остаётся до следующего выбора
  const [target, setTarget] = useState<WorkspaceListItem | null>(null)
  const [dialogLoading, setDialogLoading] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceListItem | null>(null)

  const [createName, setCreateName] = useState('')
  const [createSlug, setCreateSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [createAccessKey, setCreateAccessKey] = useState('')
  const [renameName, setRenameName] = useState('')
  const [keyAccessKey, setKeyAccessKey] = useState('')
  const [activeTokensCount, setActiveTokensCount] = useState(0)
  const [revokeAgentTokens, setRevokeAgentTokens] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAdminWorkspaces()
      .then((data) => {
        if (cancelled) return
        setWorkspaces(data)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Ошибка показана на странице — общий тост не нужен
        markApiErrorReported(err)
        if (getApiErrorStatus(err) !== 401) {
          setLoadError('Не удалось загрузить список команд. Проверьте соединение и повторите.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = () => {
    setLoadError(null)
    setReloadKey((n) => n + 1)
  }

  const openCreate = () => {
    setCreateName('')
    setCreateSlug('')
    setSlugEdited(false)
    setCreateAccessKey('')
    setDialogError(null)
    setDialogMode('create')
  }

  useEffect(() => {
    if (dialogMode !== 'key' || !target) return
    let cancelled = false
    Promise.resolve(getAdminAgentTokens(target.id))
      .then((tokens) => {
        if (cancelled || !Array.isArray(tokens)) return
        setActiveTokensCount(tokens.filter((t) => !t.revoked_at).length)
      })
      .catch(() => {
        // Оставляем счётчик, полученный со списком команд, чтобы не блокировать смену ключа.
      })
    return () => {
      cancelled = true
    }
  }, [dialogMode, target])

  const openFor = (mode: Exclude<DialogMode, 'create' | null>, ws: WorkspaceListItem) => {
    setTarget(ws)
    setRenameName(ws.name)
    setKeyAccessKey('')
    setRevokeAgentTokens(false)
    setActiveTokensCount(ws.active_agent_tokens_count ?? 0)
    setDialogError(null)
    setDialogMode(mode)
  }

  const closeDialog = () => setDialogMode(null)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createName.trim() || !createSlug.trim() || !createAccessKey) {
      setDialogError('Заполните название, код команды и ключ доступа')
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
      // Порядок как у сервера: новые команды — в конце списка
      setWorkspaces((prev) => [...(prev ?? []), created])
      setDialogMode(null)
      showToast('Команда создана', 'success')
    } catch (err) {
      setDialogError(getApiErrorMessage(err, 'Не удалось создать команду', TEAM_FIELD_LABELS))
    } finally {
      setDialogLoading(false)
    }
  }

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!renameName.trim() || !target) {
      setDialogError('Введите название команды')
      return
    }
    setDialogLoading(true)
    setDialogError(null)
    try {
      const updated = await updateAdminWorkspace(target.id, { name: renameName.trim() })
      setWorkspaces((prev) =>
        (prev ?? []).map((w) => (w.id === updated.id ? { ...w, ...updated } : w)),
      )
      setDialogMode(null)
      showToast('Название обновлено', 'success')
    } catch (err) {
      setDialogError(getApiErrorMessage(err, 'Не удалось переименовать команду', TEAM_FIELD_LABELS))
    } finally {
      setDialogLoading(false)
    }
  }

  const handleUpdateKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyAccessKey || !target) {
      setDialogError('Введите новый ключ доступа')
      return
    }
    setDialogLoading(true)
    setDialogError(null)
    try {
      await updateAdminWorkspace(
        target.id,
        revokeAgentTokens
          ? { access_key: keyAccessKey, revoke_agent_tokens: true }
          : { access_key: keyAccessKey },
      )
      if (revokeAgentTokens) {
        setWorkspaces((prev) =>
          (prev ?? []).map((w) =>
            w.id === target.id ? { ...w, active_agent_tokens_count: 0 } : w,
          ),
        )
      }
      setDialogMode(null)
      showToast(
        revokeAgentTokens
          ? 'Ключ доступа изменён, токены агентов отозваны: участникам нужно войти заново'
          : 'Ключ доступа изменён: участникам нужно войти заново',
        'success',
      )
    } catch (err) {
      setDialogError(getApiErrorMessage(err, 'Не удалось сменить ключ доступа', TEAM_FIELD_LABELS))
    } finally {
      setDialogLoading(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const ws = deleteTarget
    setDeleteTarget(null)
    setError(null)
    try {
      await deleteAdminWorkspace(ws.id)
      setWorkspaces((prev) => (prev ?? []).filter((w) => w.id !== ws.id))
      showToast('Команда удалена', 'success')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Не удалось удалить команду'))
    }
  }

  const actionsFor = (ws: WorkspaceListItem): TeamAction[] => [
    { key: 'invite', label: 'Приглашение', icon: Link2, onSelect: () => openFor('invite', ws) },
    { key: 'tokens', label: 'Токены агентов', icon: Bot, onSelect: () => openFor('tokens', ws) },
    { key: 'rename', label: 'Переименовать', icon: Pencil, onSelect: () => openFor('rename', ws) },
    { key: 'key', label: 'Ключ', icon: KeyRound, onSelect: () => openFor('key', ws) },
    {
      key: 'delete',
      label: 'Удалить команду',
      icon: Trash2,
      onSelect: () => setDeleteTarget(ws),
      destructive: true,
    },
  ]

  const targetId = target?.id ?? null
  const tokensAdapter = useMemo<AgentTokensAdapter | null>(() => {
    if (!targetId) return null
    return {
      list: () => getAdminAgentTokens(targetId),
      create: (payload) => createAdminAgentToken(targetId, payload),
      revoke: (tokenId) => revokeAdminAgentToken(targetId, tokenId),
    }
  }, [targetId])

  // До первого ответа сервера страницу не показываем: если сессия закончилась, вместо неё
  // сразу появится форма входа
  if (workspaces === null && !loadError) {
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button asChild variant="ghost" size="sm" className="gap-1.5 px-2 sm:px-3">
              <Link href="/" aria-label="К доскам">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">К доскам</span>
              </Link>
            </Button>
            <div className="h-4 w-px shrink-0 bg-border" />
            <div className="flex min-w-0 items-center gap-2 font-semibold">
              <BrandMark size={24} />
              <span className="hidden truncate sm:inline">Администрирование</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
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

            {/* Без загруженного списка создавать нечего: новая команда встала бы в пустой список */}
            <Button
              size="sm"
              className="gap-1.5"
              onClick={openCreate}
              disabled={workspaces === null}
              data-testid="admin-create-team"
            >
              <Plus className="h-4 w-4" />
              Создать команду
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 px-2 sm:px-3"
              onClick={onLogout}
              aria-label="Выйти"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Выйти</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Команды</h1>
            <p className="text-sm text-muted-foreground">
              У каждой команды свои доски, карточки и задачи
            </p>
          </div>
          {workspaces && (
            <Badge variant="secondary" className="font-mono">
              Всего: {workspaces.length}
            </Badge>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {workspaces === null ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <p>{loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              <RefreshCw />
              Повторить
            </Button>
          </div>
        ) : workspaces.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Layers className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">Пока нет ни одной команды</p>
              <Button size="sm" onClick={openCreate}>
                Создать первую команду
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Название</th>
                    <th className="hidden px-4 py-3 font-medium sm:table-cell">Код команды</th>
                    <th className="px-4 py-3 font-medium">Досок</th>
                    <th className="hidden px-4 py-3 font-medium md:table-cell">Создана</th>
                    <th className="px-4 py-3 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {workspaces.map((ws) => {
                    const actions = actionsFor(ws)
                    return (
                      <tr key={ws.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">
                          <span className="wrap-break-word">{ws.name}</span>
                          {/* На телефоне колонка кода скрыта — он переезжает под название */}
                          <span className="mt-1 block font-mono text-xs font-normal text-muted-foreground sm:hidden">
                            {ws.slug}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <code className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
                            {ws.slug}
                          </code>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs" data-testid="team-boards-count">
                          {ws.boards_count ?? 0}
                        </td>
                        <td className="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell">
                          {new Date(ws.created_at).toLocaleDateString('ru-RU')}
                        </td>
                        <td className="px-4 py-3">
                          {/* Широкий экран: действия кнопками */}
                          <div className="hidden items-center justify-end gap-1 lg:flex">
                            {actions.map((action) =>
                              action.destructive ? (
                                <Button
                                  key={action.key}
                                  variant="ghost"
                                  size="icon-sm"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={action.onSelect}
                                  aria-label={action.label}
                                  title={action.label}
                                >
                                  <action.icon className="h-3.5 w-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  key={action.key}
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 gap-1 px-2 text-xs"
                                  onClick={action.onSelect}
                                >
                                  <action.icon className="h-3.5 w-3.5" />
                                  {action.label}
                                </Button>
                              ),
                            )}
                          </div>
                          {/* Узкий экран: те же действия в меню */}
                          <div className="flex justify-end lg:hidden">
                            <DropdownMenu modal={false}>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="h-8 w-8"
                                  aria-label={`Действия с командой «${ws.name}»`}
                                  data-testid="team-actions-menu"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {actions.map((action) => (
                                  <Fragment key={action.key}>
                                    {action.destructive && <DropdownMenuSeparator />}
                                    <DropdownMenuItem
                                      onClick={action.onSelect}
                                      className={
                                        action.destructive
                                          ? 'text-destructive focus:text-destructive'
                                          : undefined
                                      }
                                    >
                                      <action.icon className="h-4 w-4" />
                                      {action.label}
                                    </DropdownMenuItem>
                                  </Fragment>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Создание команды */}
      <Dialog open={dialogMode === 'create'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Новая команда</DialogTitle>
              <DialogDescription>
                Участники войдут по ссылке-приглашению или по коду команды и ключу доступа.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="team-name">Название команды</Label>
                <Input
                  id="team-name"
                  value={createName}
                  onChange={(e) => {
                    const v = e.target.value
                    setCreateName(v)
                    if (!slugEdited) setCreateSlug(generateSlugFromName(v))
                    setDialogError(null)
                  }}
                  placeholder="Например: Платформа"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-slug">Код команды</Label>
                <Input
                  id="team-slug"
                  value={createSlug}
                  onChange={(e) => {
                    setSlugEdited(true)
                    setCreateSlug(e.target.value)
                    setDialogError(null)
                  }}
                  placeholder="platform-team"
                  spellCheck={false}
                  aria-describedby="team-slug-hint"
                  className="font-mono text-xs"
                />
                <p id="team-slug-hint" className="text-xs text-muted-foreground">
                  Строчные латинские буквы, цифры и дефис. Его вводят при входе; после создания
                  код не меняется.
                </p>
              </div>
              <AccessKeyField
                id="team-access-key"
                label="Ключ доступа"
                value={createAccessKey}
                onChange={(value) => {
                  setCreateAccessKey(value)
                  setDialogError(null)
                }}
                placeholder="Придумайте или сгенерируйте ключ"
                hint="Ключ нельзя посмотреть после создания — только сменить. Сохраните его сейчас."
              />
              {dialogError && (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {dialogError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>
                Отмена
              </Button>
              <Button type="submit" disabled={dialogLoading}>
                {dialogLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Создать
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Переименование */}
      <Dialog open={dialogMode === 'rename'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-sm">
          <form onSubmit={handleRename}>
            <DialogHeader>
              <DialogTitle>Переименовать команду</DialogTitle>
              <DialogDescription>
                Код команды и ссылки на доски останутся прежними.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <Input
                value={renameName}
                onChange={(e) => {
                  setRenameName(e.target.value)
                  setDialogError(null)
                }}
                placeholder="Новое название"
                aria-label="Название команды"
                autoFocus
              />
              {dialogError && (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {dialogError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>
                Отмена
              </Button>
              <Button type="submit" disabled={dialogLoading}>
                {dialogLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Смена ключа доступа */}
      <Dialog open={dialogMode === 'key'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleUpdateKey}>
            <DialogHeader>
              <DialogTitle>Сменить ключ доступа</DialogTitle>
              <DialogDescription>Команда «{target?.name}»</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p
                className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-foreground"
                data-testid="key-change-warning"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  Все участники команды выйдут из системы, а ссылка-приглашение будет
                  перевыпущена: прежние ключ и ссылка перестанут работать.
                </span>
              </p>
              <AccessKeyField
                id="team-new-access-key"
                label="Новый ключ доступа"
                value={keyAccessKey}
                onChange={(value) => {
                  setKeyAccessKey(value)
                  setDialogError(null)
                }}
                placeholder="Придумайте или сгенерируйте ключ"
                hint="Ключ нельзя посмотреть после сохранения — только сменить ещё раз. Сохраните его сейчас."
                autoFocus
              />
              <div
                className="space-y-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs"
                data-testid="key-change-agent-tokens-box"
              >
                <p className="text-muted-foreground">
                  Действующих токенов MCP-агентов:{' '}
                  <span className="font-mono font-semibold text-foreground">
                    {activeTokensCount}
                  </span>
                  . По умолчанию смена ключа их не отзывает.
                </p>
                {activeTokensCount > 0 && (
                  <label
                    htmlFor="revoke-agent-tokens-checkbox"
                    className="flex cursor-pointer items-start gap-2 pt-0.5 text-foreground"
                  >
                    <Checkbox
                      id="revoke-agent-tokens-checkbox"
                      checked={revokeAgentTokens}
                      onCheckedChange={(checked) => setRevokeAgentTokens(checked === true)}
                      className="mt-0.5"
                    />
                    <span>
                      Также отозвать действующие токены агентов ({activeTokensCount})
                    </span>
                  </label>
                )}
              </div>
              {dialogError && (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {dialogError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>
                Отмена
              </Button>
              <Button type="submit" disabled={dialogLoading}>
                {dialogLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Сменить ключ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ссылка-приглашение */}
      <InviteLinkDialog
        open={dialogMode === 'invite'}
        onOpenChange={(o) => !o && closeDialog()}
        team={target}
      />

      {/* Токены MCP-агентов команды */}
      <AgentTokensDialog
        open={dialogMode === 'tokens'}
        onOpenChange={(o) => !o && closeDialog()}
        teamLabel={target?.name}
        subtitle="Администрирование"
        adapter={tokensAdapter}
      />

      {/* Подтверждение удаления */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить команду «{deleteTarget?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Все доски, карточки и задачи этой команды будут удалены безвозвратно.
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
