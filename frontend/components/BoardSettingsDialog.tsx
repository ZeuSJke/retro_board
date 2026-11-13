'use client'

import { useEffect, useState } from 'react'
import { EyeOff, Loader2, Lock, Shield, Trash2 } from 'lucide-react'
import { deleteBoard, updateBoard } from '@/api'
import { showToast } from '@/store/toastStore'
import { getApiErrorMessage } from '@/utils/apiError'
import type { Board } from '@/types'
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

interface BoardSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  board: Board
  onBoardUpdated: (board: Board) => void
  onBoardDeleted: (boardId: string) => void
}

export default function BoardSettingsDialog({
  open,
  onOpenChange,
  board,
  onBoardUpdated,
  onBoardDeleted,
}: BoardSettingsDialogProps) {
  const [name, setName] = useState(board.name)
  const [maxVotes, setMaxVotes] = useState(board.max_votes)
  const [isLocked, setIsLocked] = useState(Boolean(board.is_locked))
  const [hideCards, setHideCards] = useState(Boolean(board.hide_cards_until_reveal))
  const [anonymousVotes, setAnonymousVotes] = useState(Boolean(board.anonymous_votes))
  const [saving, setSaving] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(board.name)
    setMaxVotes(board.max_votes)
    setIsLocked(Boolean(board.is_locked))
    setHideCards(Boolean(board.hide_cards_until_reveal))
    setAnonymousVotes(Boolean(board.anonymous_votes))
  }, [open, board])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const updated = await updateBoard(board.id, {
        name: trimmed,
        max_votes: Math.max(1, Math.min(99, maxVotes)),
        is_locked: isLocked,
        hide_cards_until_reveal: hideCards,
        anonymous_votes: anonymousVotes,
      })
      onBoardUpdated(updated)
      showToast('Настройки доски сохранены', 'success')
      onOpenChange(false)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось обновить доску'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteBoard(board.id)
      showToast('Доска удалена', 'success')
      setConfirmDeleteOpen(false)
      onOpenChange(false)
      onBoardDeleted(board.id)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось удалить доску'), 'error')
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Настройки доски</DialogTitle>
            <DialogDescription>
              Управляйте правилами голосования, видимостью карточек и доступом к редактированию.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="board-settings-name">Название</Label>
                <Input
                  id="board-settings-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="board-settings-votes">Лимит голосов</Label>
                <Input
                  id="board-settings-votes"
                  type="number"
                  min={1}
                  max={99}
                  value={maxVotes}
                  onChange={(e) => setMaxVotes(Number(e.target.value) || 5)}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-xl border p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Lock className="h-4 w-4 text-amber-500" />
                    Заблокировать доску (архив)
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Запретить создание, редактирование карточек и голосование
                  </p>
                </div>
                <Switch checked={isLocked} onCheckedChange={setIsLocked} />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                    Скрывать карточки в штурме
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Участники не видят чужие стикеры до этапа раскрытия
                  </p>
                </div>
                <Switch checked={hideCards} onCheckedChange={setHideCards} />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    Анонимные карточки
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Скрывать имена авторов карточек от других участников
                  </p>
                </div>
                <Switch checked={anonymousVotes} onCheckedChange={setAnonymousVotes} />
              </div>
            </div>

            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                Удалить доску
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={!name.trim() || saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Сохранить
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить доску «{board.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Колонки, карточки и связанные данные этой доски будут скрыты. Это действие нельзя
              отменить из интерфейса.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
