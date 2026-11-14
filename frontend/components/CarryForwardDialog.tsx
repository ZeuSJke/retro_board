'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Loader2, Repeat } from 'lucide-react'
import { carryForward } from '../api'
import { showToast } from '../store/toastStore'
import { getApiErrorMessage } from '../utils/apiError'
import type { ActionItem, BoardListItem } from '../types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface CarryForwardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  boards: BoardListItem[]
  onCarried: (created: ActionItem[], targetBoardId: string) => void
}

export default function CarryForwardDialog({
  open,
  onOpenChange,
  boards,
  onCarried,
}: CarryForwardDialogProps) {
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || boards.length < 2) return
    const withOpen = boards.find((b) => b.action_items_open > 0)
    const first = withOpen || boards[1] || boards[0]
    const target = boards.find((b) => b.id !== first.id) || boards[0]
    setSourceId((prev) => (prev && boards.some((b) => b.id === prev) ? prev : first.id))
    setTargetId((prev) =>
      prev && prev !== first.id && boards.some((b) => b.id === prev) ? prev : target.id,
    )
  }, [open, boards])

  const handleConfirm = async () => {
    if (!sourceId || !targetId || sourceId === targetId || loading) return
    setLoading(true)
    try {
      const created = await carryForward({
        source_board_id: sourceId,
        target_board_id: targetId,
      })
      if (created.length === 0) {
        showToast('Нет незакрытых задач для переноса', 'info')
      } else {
        showToast(`Перенесено задач: ${created.length}`, 'success')
      }
      onCarried(created, targetId)
      onOpenChange(false)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось перенести задачи'), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-primary" />
            Перенести незакрытые задачи
          </DialogTitle>
          <DialogDescription>
            Все задачи со статусом «Открыто» или «В работе» будут скопированы на выбранную доску.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Откуда перенести</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите исходную доску" />
              </SelectTrigger>
              <SelectContent>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} ({b.action_items_open} открытых)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-center text-muted-foreground">
            <ArrowRight className="h-4 w-4 rotate-90" />
          </div>

          <div className="space-y-2">
            <Label>На какую доску перенести</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите целевую доску" />
              </SelectTrigger>
              <SelectContent>
                {boards
                  .filter((b) => b.id !== sourceId)
                  .map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !sourceId || !targetId || sourceId === targetId}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Перенести
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
