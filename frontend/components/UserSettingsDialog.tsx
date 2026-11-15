'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { Check, Grid3X3, Loader2, LogOut, Moon, Palette, Shield, Sun, User } from 'lucide-react'
import { logoutWorkspace, renameParticipant } from '@/api'
import { useAppStore } from '@/store'
import {
  ACCENT_PRESETS,
  applyAccent,
  getUserAvatarGradient,
  getUserInitials,
  resolveInitialAccent,
  type AccentKey,
} from '@/lib/board-themes'
import { avatarSeed } from '@/lib/participants'
import { showToast } from '@/store/toastStore'
import { getApiErrorMessage } from '@/utils/apiError'
import { Button } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'

interface UserSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function UserSettingsDialog({ open, onOpenChange }: UserSettingsDialogProps) {
  const participant = useAppStore((s) => s.participant)
  const savedName = useAppStore((s) => s.username)
  const setParticipant = useAppStore((s) => s.setParticipant)
  const workspace = useAppStore((s) => s.workspace)
  const clearSession = useAppStore((s) => s.clearSession)
  const dotGrid = useAppStore((s) => s.dotGrid)
  const setDotGrid = useAppStore((s) => s.setDotGrid)
  const username = participant?.name ?? savedName

  const { theme, setTheme } = useTheme()
  const [nameInput, setNameInput] = useState(username)
  const [accent, setAccent] = useState<AccentKey>('violet')
  const [saving, setSaving] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    if (!open) return
    setNameInput(username)
    setAccent(resolveInitialAccent())
  }, [open, username])

  const handleAccentSelect = (key: AccentKey) => {
    setAccent(key)
    applyAccent(key)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = nameInput.trim()
    if (!trimmed || saving) return
    if (trimmed === username) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    try {
      // Имя — подпись участника: карточки, голоса и роль ведущего остаются за ним
      const updated = await renameParticipant(trimmed)
      setParticipant(updated)
      showToast(`Имя изменено на «${updated.name}»`, 'success')
      onOpenChange(false)
    } catch (err) {
      // Ответ 422 разбирается по полям: «Имя: не длиннее 60 символов», «Имя не должно содержать HTML-теги»
      showToast(getApiErrorMessage(err, 'Не удалось изменить имя', { name: 'Имя' }), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleLogoutWorkspace = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      // Сначала сервер сбрасывает cookie сессии — и только потом забываем её локально:
      // иначе экран входа показан, а запросы продолжают проходить
      await logoutWorkspace()
      clearSession()
      onOpenChange(false)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось выйти: сервер недоступен'), 'error')
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Профиль и оформление
          </DialogTitle>
          <DialogDescription>
            Персональные настройки отображения и имя участника на доске.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="min-w-0 space-y-5">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br/srgb text-base font-bold text-white shadow-sm ${getUserAvatarGradient(
                // Цвет — от идентификатора участника, как в шапке и на карточках
                avatarSeed(participant?.id, nameInput || username),
              )}`}
            >
              {getUserInitials(nameInput || username)}
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="profile-name">Имя участника</Label>
              <Input
                id="profile-name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={60}
              />
            </div>
          </div>

          <div className="space-y-2.5 rounded-xl border p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                {theme === 'dark' ? (
                  <Moon className="h-4 w-4 text-primary" />
                ) : (
                  <Sun className="h-4 w-4 text-amber-500" />
                )}
                Тёмная тема
              </div>
              <Switch
                checked={theme === 'dark'}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                aria-label="Тёмная тема"
              />
            </div>

            <div className="flex items-center justify-between border-t pt-2.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Grid3X3 className="h-4 w-4 text-muted-foreground" />
                Точечная сетка холста
              </div>
              <Switch
                checked={dotGrid}
                onCheckedChange={setDotGrid}
                aria-label="Точечная сетка холста"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Palette className="h-3.5 w-3.5 text-muted-foreground" />
              Акцентный цвет
            </Label>
            <div className="grid grid-cols-6 gap-2">
              {ACCENT_PRESETS.map((preset) => {
                const selected = accent === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.name}
                    onClick={() => handleAccentSelect(preset.id)}
                    className={`flex h-9 items-center justify-center rounded-xl border transition-all ${
                      selected ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : ''
                    }`}
                    style={{ backgroundColor: preset.swatch }}
                  >
                    {selected && <Check className="h-4 w-4 text-white" />}
                  </button>
                )
              })}
            </div>
          </div>

          {workspace && (
            <div className="flex items-center justify-between rounded-xl border bg-muted/40 px-3.5 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{workspace.workspaceName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  Код команды: {workspace.workspaceSlug}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loggingOut}
                onClick={handleLogoutWorkspace}
                data-testid="logout-btn"
              >
                {loggingOut ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogOut className="h-3.5 w-3.5" />
                )}
                Выйти
              </Button>
            </div>
          )}

          <div
            className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 px-3.5 py-2.5 text-sm"
            data-testid="admin-panel-row"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Shield className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate font-medium">Администрирование</div>
                <div className="text-xs leading-snug text-muted-foreground">
                  Команды, ключи доступа и токены агентов
                </div>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link
                href="/admin"
                aria-label="Администрирование — открыть панель"
                data-testid="admin-panel-link"
              >
                Открыть
              </Link>
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
            <Button type="submit" disabled={!nameInput.trim() || saving} data-testid="profile-save-btn">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
