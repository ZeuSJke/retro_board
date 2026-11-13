'use client'

import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  CheckCircle2,
  Circle,
  Clock,
  ListTodo,
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { createActionItem, deleteActionItem, updateActionItem } from '../api'
import { getUserAvatarGradient, getUserInitials } from '@/lib/board-themes'
import { showToast } from '../store/toastStore'
import { getApiErrorMessage } from '../utils/apiError'
import type { ActionItem, ActionItemStatus } from '../types'
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
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface MasterColumnProps {
  boardId: string
  actionItems: ActionItem[]
  participants?: string[]
  onCreated?: (item: ActionItem) => void
  onUpdated: (item: ActionItem) => void
  onDeleted: (id: string) => void
  dropDisabled?: boolean
  readOnly?: boolean
}

const NEXT_STATUS: Record<ActionItemStatus, ActionItemStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
}

const STATUS_META: Record<
  ActionItemStatus,
  { label: string; colorClass: string; Icon: typeof Circle }
> = {
  open: {
    label: 'Открыто',
    colorClass: 'text-amber-600 dark:text-amber-400',
    Icon: Circle,
  },
  in_progress: {
    label: 'В работе',
    colorClass: 'text-sky-600 dark:text-sky-400',
    Icon: Clock,
  },
  done: {
    label: 'Выполнено',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
}

export default function MasterColumn({
  boardId,
  actionItems,
  participants = [],
  onCreated,
  onUpdated,
  onDeleted,
  dropDisabled = false,
  readOnly = false,
}: MasterColumnProps) {
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editingDescId, setEditingDescId] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [assigneeDraft, setAssigneeDraft] = useState('')
  const [assigneePopoverId, setAssigneePopoverId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ActionItem | null>(null)

  const [addingNew, setAddingNew] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newText, setNewText] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [creating, setCreating] = useState(false)

  const { setNodeRef, isOver } = useDroppable({
    id: 'master-col',
    data: { type: 'master' },
    disabled: dropDisabled,
  })

  const findItem = (id: string) => actionItems.find((i) => i.id === id)

  const handleCycleStatus = async (item: ActionItem) => {
    if (readOnly) return
    const next = NEXT_STATUS[item.status]
    onUpdated({ ...item, status: next })
    try {
      const updated = await updateActionItem(item.id, { status: next })
      onUpdated(updated)
    } catch (err) {
      onUpdated(item)
      showToast(getApiErrorMessage(err, 'Не удалось обновить статус'), 'error')
    }
  }

  const saveTitle = async (id: string) => {
    setEditingTitleId(null)
    const trimmed = editTitle.trim()
    const prev = findItem(id)
    if (!prev || trimmed === prev.title) return
    onUpdated({ ...prev, title: trimmed })
    try {
      const updated = await updateActionItem(id, { title: trimmed })
      onUpdated(updated)
    } catch (err) {
      onUpdated(prev)
      showToast(getApiErrorMessage(err, 'Не удалось обновить заголовок'), 'error')
    }
  }

  const saveDesc = async (id: string) => {
    setEditingDescId(null)
    const trimmed = editDesc.trim()
    const prev = findItem(id)
    if (!trimmed || !prev || trimmed === prev.text) return
    onUpdated({ ...prev, text: trimmed })
    try {
      const updated = await updateActionItem(id, { text: trimmed })
      onUpdated(updated)
    } catch (err) {
      onUpdated(prev)
      showToast(getApiErrorMessage(err, 'Не удалось обновить текст'), 'error')
    }
  }

  const saveAssignee = async (id: string, val: string | null) => {
    setAssigneePopoverId(null)
    const prev = findItem(id)
    if (!prev) return
    onUpdated({ ...prev, assignee: val })
    try {
      const updated = await updateActionItem(id, { assignee: val })
      onUpdated(updated)
    } catch (err) {
      onUpdated(prev)
      showToast(getApiErrorMessage(err, 'Не удалось назначить ответственного'), 'error')
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    onDeleted(target.id)
    try {
      await deleteActionItem(target.id)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось удалить задачу'), 'error')
    }
  }

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newText.trim() || creating || readOnly) return
    setCreating(true)
    try {
      const created = await createActionItem({
        board_id: boardId,
        title: newTitle.trim() || undefined,
        text: newText.trim(),
        assignee: newAssignee.trim() || undefined,
      })
      onCreated?.(created)
      setNewTitle('')
      setNewText('')
      setNewAssignee('')
      setAddingNew(false)
      showToast('Задача создана', 'success')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось создать задачу'), 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div data-testid="master-column" className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <ListTodo className="h-3.5 w-3.5" />
          </span>
          <h3 className="text-sm font-semibold">Итоги</h3>
          <Badge variant="secondary" className="h-5 px-2 text-xs">
            {actionItems.length}
          </Badge>
        </div>

        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setAddingNew((prev) => !prev)}
          >
            {addingNew ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {addingNew ? 'Закрыть' : 'Добавить'}
          </Button>
        )}
      </div>

      {/* Inline create form */}
      {addingNew && !readOnly && (
        <form onSubmit={handleCreateManual} className="space-y-2 border-b bg-muted/30 p-3">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Краткий заголовок (опционально)"
            className="h-8 text-xs"
          />
          <Textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Что нужно сделать..."
            rows={2}
            required
            className="min-h-[56px] resize-none text-xs"
          />
          <div className="flex items-center gap-1.5">
            <Input
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
              placeholder="Ответственный"
              className="h-8 flex-1 text-xs"
              list="board-participants-list"
            />
            <Button type="submit" size="sm" className="h-8 px-3 text-xs" disabled={creating}>
              {creating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Создать
            </Button>
          </div>
          {participants.length > 0 && (
            <datalist id="board-participants-list">
              {participants.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          )}
        </form>
      )}

      {/* Droppable list */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 space-y-2.5 overflow-y-auto p-3 transition-colors',
          isOver && 'bg-primary/10 ring-2 ring-inset ring-primary/40',
        )}
      >
        {actionItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-4 py-10 text-center text-xs text-muted-foreground">
            <ListTodo className="mb-2 h-6 w-6 opacity-40" />
            <p className="font-medium text-foreground/80">Пока нет Action Items</p>
            <p className="mt-1">
              Перетащите карточку сюда или нажмите кнопку задачи на любой карточке.
            </p>
          </div>
        ) : (
          actionItems.map((item) => {
            const meta = STATUS_META[item.status] || STATUS_META.open
            const StatusIcon = meta.Icon
            const isDone = item.status === 'done'

            return (
              <div
                key={item.id}
                className={cn(
                  'group/ai rounded-xl border bg-card p-3 shadow-sm transition-all',
                  isDone && 'opacity-70',
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => handleCycleStatus(item)}
                    title={`Статус: ${meta.label} (нажмите чтобы сменить)`}
                    className={cn(
                      'mt-0.5 shrink-0 transition-transform hover:scale-110 disabled:cursor-default',
                      meta.colorClass,
                    )}
                  >
                    <StatusIcon className="h-4 w-4" />
                  </button>

                  <div className="min-w-0 flex-1 space-y-1">
                    {editingTitleId === item.id ? (
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        autoFocus
                        className="h-7 px-2 text-xs font-semibold"
                        onBlur={() => saveTitle(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveTitle(item.id)
                          if (e.key === 'Escape') setEditingTitleId(null)
                        }}
                      />
                    ) : (
                      <div
                        onClick={() => {
                          if (!readOnly) {
                            setEditingTitleId(item.id)
                            setEditTitle(item.title || '')
                          }
                        }}
                        className={cn(
                          'text-xs font-semibold leading-snug',
                          isDone && 'line-through',
                          !readOnly && 'cursor-text hover:text-primary',
                        )}
                      >
                        {item.title || (
                          <span className="font-normal italic text-muted-foreground">
                            Без заголовка
                          </span>
                        )}
                      </div>
                    )}

                    {editingDescId === item.id ? (
                      <Textarea
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        autoFocus
                        rows={2}
                        className="min-h-[52px] resize-none text-xs"
                        onBlur={() => saveDesc(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            saveDesc(item.id)
                          } else if (e.key === 'Escape') {
                            setEditingDescId(null)
                          }
                        }}
                      />
                    ) : (
                      <p
                        onClick={() => {
                          if (!readOnly) {
                            setEditingDescId(item.id)
                            setEditDesc(item.text)
                          }
                        }}
                        className={cn(
                          'whitespace-pre-wrap break-words text-xs text-muted-foreground',
                          !readOnly && 'cursor-text hover:text-foreground',
                        )}
                      >
                        {item.text}
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <Popover
                        open={assigneePopoverId === item.id}
                        onOpenChange={(open) => {
                          if (open) {
                            setAssigneeDraft(item.assignee || '')
                            setAssigneePopoverId(item.id)
                          } else {
                            setAssigneePopoverId(null)
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            disabled={readOnly}
                            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border/80 px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:cursor-default"
                          >
                            {item.assignee ? (
                              <>
                                <span
                                  className={`flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br text-[8px] font-bold text-white ${getUserAvatarGradient(item.assignee)}`}
                                >
                                  {getUserInitials(item.assignee)}
                                </span>
                                <span className="max-w-[120px] truncate">{item.assignee}</span>
                              </>
                            ) : (
                              <>
                                <UserPlus className="h-3 w-3" />
                                <span>Назначить</span>
                              </>
                            )}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-60 space-y-2 p-3">
                          <div className="text-xs font-semibold">Ответственный</div>
                          <div className="flex gap-1.5">
                            <Input
                              value={assigneeDraft}
                              onChange={(e) => setAssigneeDraft(e.target.value)}
                              placeholder="Имя участника"
                              className="h-8 text-xs"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  saveAssignee(item.id, assigneeDraft.trim() || null)
                                }
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 px-2.5 text-xs"
                              onClick={() =>
                                saveAssignee(item.id, assigneeDraft.trim() || null)
                              }
                            >
                              ОК
                            </Button>
                          </div>
                          {participants.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {participants.map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => saveAssignee(item.id, p)}
                                  className="rounded-md bg-muted px-2 py-0.5 text-[11px] hover:bg-accent"
                                >
                                  {p}
                                </button>
                              ))}
                            </div>
                          )}
                          {item.assignee && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 w-full text-xs text-muted-foreground"
                              onClick={() => saveAssignee(item.id, null)}
                            >
                              Снять назначение
                            </Button>
                          )}
                        </PopoverContent>
                      </Popover>

                      {!readOnly && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="h-6 w-6 opacity-80 sm:opacity-0 transition-opacity sm:group-hover/ai:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(item)}
                          title="Удалить задачу"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить Action Item?</AlertDialogTitle>
            <AlertDialogDescription>
              Задача «{deleteTarget?.title || deleteTarget?.text}» будет удалена безвозвратно.
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
