'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Check, Grid3X3, LogOut, Moon, Palette, Sun, User } from 'lucide-react'
import { useAppStore } from '@/store'
import {
  ACCENT_PRESETS,
  applyAccent,
  getUserAvatarGradient,
  getUserInitials,
  resolveInitialAccent,
  type AccentKey,
} from '@/lib/board-themes'
import { showToast } from '@/store/toastStore'
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
  const username = useAppStore((s) => s.username)
  const setUsername = useAppStore((s) => s.setUsername)
  const workspace = useAppStore((s) => s.workspace)
  const setWorkspace = useAppStore((s) => s.setWorkspace)
  const dotGrid = useAppStore((s) => s.dotGrid)
  const setDotGrid = useAppStore((s) => s.setDotGrid)

  const { theme, setTheme } = useTheme()
  const [nameInput, setNameInput] = useState(username)
  const [accent, setAccent] = useState<AccentKey>('violet')

  useEffect(() => {
    if (!open) return
    setNameInput(username)
    setAccent(resolveInitialAccent())
  }, [open, username])

  const handleAccentSelect = (key: AccentKey) => {
    setAccent(key)
    applyAccent(key)
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = nameInput.trim()
    if (!trimmed) return
    if (trimmed !== username) {
      setUsername(trimmed)
      showToast(`Имя изменено на «${trimmed}»`, 'success')
    }
    onOpenChange(false)
  }

  const handleLogoutWorkspace = () => {
    setWorkspace(null)
    onOpenChange(false)
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

        <form onSubmit={handleSave} className="space-y-5">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-base font-bold text-white shadow ${getUserAvatarGradient(
                nameInput || username,
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
              />
            </div>

            <div className="flex items-center justify-between border-t pt-2.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Grid3X3 className="h-4 w-4 text-muted-foreground" />
                Точечная сетка холста
              </div>
              <Switch checked={dotGrid} onCheckedChange={setDotGrid} />
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
              <div>
                <div className="font-medium">{workspace.workspaceName}</div>
                <div className="text-xs text-muted-foreground">/{workspace.workspaceSlug}</div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLogoutWorkspace}
              >
                <LogOut className="h-3.5 w-3.5" />
                Выйти
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
            <Button type="submit" disabled={!nameInput.trim()}>
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
