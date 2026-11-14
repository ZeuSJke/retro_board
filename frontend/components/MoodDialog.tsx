'use client'

import { useEffect, useState } from 'react'
import { HeartPulse, Loader2 } from 'lucide-react'
import { submitBoardMood } from '@/api'
import { MOOD_OPTIONS, getUserAvatarGradient, getUserInitials } from '@/lib/board-themes'
import { showToast } from '@/store/toastStore'
import { getApiErrorMessage } from '@/utils/apiError'
import type { BoardMood } from '@/types'
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
import { Badge } from '@/components/ui/badge'

interface MoodDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  boardId: string
  username: string
  moods: BoardMood[]
  onMoodSubmitted: (mood: BoardMood) => void
}

export default function MoodDialog({
  open,
  onOpenChange,
  boardId,
  username,
  moods,
  onMoodSubmitted,
}: MoodDialogProps) {
  const existingMine = moods.find((m) => m.author === username)
  const [score, setScore] = useState<number>(existingMine?.score ?? 4)
  const [note, setNote] = useState<string>(existingMine?.note ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const mine = moods.find((m) => m.author === username)
    setScore(mine?.score ?? 4)
    setNote(mine?.note ?? '')
  }, [open, moods, username])

  const avg =
    moods.length > 0 ? (moods.reduce((sum, m) => sum + m.score, 0) / moods.length).toFixed(1) : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const saved = await submitBoardMood(boardId, {
        author: username,
        score,
        note: note.trim() || null,
      })
      onMoodSubmitted(saved)
      showToast('Настроение сохранено', 'success')
      onOpenChange(false)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось сохранить настроение'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-rose-500" />
            Чек-ин настроения
            {avg && (
              <Badge variant="secondary" className="ml-1 font-mono">
                Среднее: {avg}/5
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Как для вас прошёл этот спринт? Оценка видна всей команде в статистике доски.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-5 gap-2">
            {MOOD_OPTIONS.map((opt) => {
              const selected = score === opt.score
              return (
                <button
                  key={opt.score}
                  type="button"
                  onClick={() => setScore(opt.score)}
                  data-testid={`mood-option-${opt.score}`}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-2.5 text-center transition-all ${
                    selected
                      ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                      : 'border-border hover:bg-muted/60'
                  }`}
                >
                  <span className="text-2xl">{opt.emoji}</span>
                  <span className="text-[11px] font-medium leading-tight">{opt.score}</span>
                </button>
              )
            })}
          </div>

          <div className="text-center text-xs text-muted-foreground">
            {MOOD_OPTIONS.find((m) => m.score === score)?.label}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mood-note">Короткий комментарий (необязательно)</Label>
            <Input
              id="mood-note"
              placeholder="Например: Отличный релиз, но устали от срочных правок"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
            />
          </div>

          {moods.length > 0 && (
            <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
              <div className="text-xs font-medium text-muted-foreground">
                Отклики команды ({moods.length})
              </div>
              <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                {moods.map((m) => {
                  const emoji = MOOD_OPTIONS.find((o) => o.score === m.score)?.emoji || '🙂'
                  return (
                    <div key={m.id} className="flex items-start justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-linear-to-br/srgb text-[10px] font-semibold text-white ${getUserAvatarGradient(
                            m.author,
                          )}`}
                        >
                          {getUserInitials(m.author)}
                        </span>
                        <div className="min-w-0">
                          <span className="font-medium text-foreground">{m.author}</span>
                          {m.note && (
                            <p className="truncate text-muted-foreground">{m.note}</p>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-base">{emoji}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
            <Button type="submit" disabled={saving} data-testid="mood-submit-btn">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Сохранить оценку
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
