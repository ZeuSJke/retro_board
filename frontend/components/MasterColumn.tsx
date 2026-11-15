'use client'

import { useEffect, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  CornerUpRight,
  History,
  ListTodo,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import {
  carryForward,
  createActionItem,
  deleteActionItem,
  getAllActionItems,
  suggestActionItems,
  updateActionItem,
} from '../api'
import { getUserAvatarGradient, getUserInitials } from '@/lib/board-themes'
import { useAppStore } from '../store'
import { showToast } from '../store/toastStore'
import { getApiErrorMessage, getApiErrorStatus } from '../utils/apiError'
import type {
  ActionItem,
  ActionItemStatus,
  ActionItemSuggestion,
  DashboardActionItem,
} from '../types'
import { RichCardText } from './RichCardText'
import SuggestActionItemsDialog, { type SuggestFailure } from './SuggestActionItemsDialog'
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
  /** Вернуть задачу, которую сервер не удалил. Без него возврат идёт через `onCreated`. */
  onRestored?: (item: ActionItem) => void
  onDeleted: (id: string) => void
  dropDisabled?: boolean
  /**
   * Доска заблокирована: задачи нельзя создавать, править и удалять. Статус при этом
   * отмечать можно — работа над задачами идёт и после ретро (так же ведут себя API
   * и панель управления).
   */
  readOnly?: boolean
  /** Сервер сейчас скрывает чужие карточки: AI-подбор задач недоступен до раскрытия. */
  cardsHidden?: boolean
}

/** Открытые задачи других досок. Перенесённые оригиналы сюда не попадают: их представляют копии. */
export function selectPreviousOpenItems(
  all: DashboardActionItem[],
  boardId: string,
): DashboardActionItem[] {
  return all.filter(
    (item) => item.board_id !== boardId && item.status !== 'done' && !item.superseded_by_id,
  )
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
  onRestored,
  onDeleted,
  dropDisabled = false,
  readOnly = false,
  cardsHidden = false,
}: MasterColumnProps) {
  const aiEnabled = useAppStore((s) => s.aiEnabled)
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

  const [prevOpenExpanded, setPrevOpenExpanded] = useState(false)
  const [prevItems, setPrevItems] = useState<DashboardActionItem[]>([])
  const [loadingPrev, setLoadingPrev] = useState(false)
  const [prevLoaded, setPrevLoaded] = useState(false)
  // Ошибка загрузки — отдельное состояние: пустой список означал бы «всё закрыто»
  const [prevError, setPrevError] = useState<string | null>(null)
  const [pullingPrevId, setPullingPrevId] = useState<string | null>(null)

  const [suggestDialogOpen, setSuggestDialogOpen] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestCreating, setSuggestCreating] = useState(false)
  const [suggestions, setSuggestions] = useState<ActionItemSuggestion[]>([])
  const [suggestFailure, setSuggestFailure] = useState<SuggestFailure | null>(null)

  useEffect(() => {
    setPrevLoaded(false)
    setPrevItems([])
    setPrevError(null)
  }, [boardId])

  const loadPreviousOpenItems = async () => {
    if (loadingPrev) return
    setLoadingPrev(true)
    setPrevError(null)
    try {
      const all = await getAllActionItems()
      setPrevItems(selectPreviousOpenItems(all, boardId))
      setPrevLoaded(true)
    } catch (err) {
      setPrevError(getApiErrorMessage(err, 'Проверьте соединение и попробуйте ещё раз.'))
    } finally {
      setLoadingPrev(false)
    }
  }

  const handleTogglePrevSection = () => {
    const next = !prevOpenExpanded
    setPrevOpenExpanded(next)
    if (next && !prevLoaded) {
      void loadPreviousOpenItems()
    }
  }

  const handleCompletePrevItem = async (item: DashboardActionItem) => {
    try {
      await updateActionItem(item.id, { status: 'done' })
      setPrevItems((prev) => prev.filter((x) => x.id !== item.id))
      showToast('Прошлая задача отмечена выполненной', 'success')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось обновить задачу'), 'error')
    }
  }

  // Перенос, а не копия: сервер создаёт задачу на этой доске и помечает оригинал перенесённым,
  // так что одна реальная задача остаётся одной открытой записью. Повторный перенос ничего не создаёт.
  const handlePullPrevItemToBoard = async (item: DashboardActionItem) => {
    if (readOnly || pullingPrevId) return
    setPullingPrevId(item.id)
    try {
      const created = await carryForward({
        source_board_id: item.board_id,
        target_board_id: boardId,
        item_ids: [item.id],
      })
      created.forEach((copy) => onCreated?.(copy))
      setPrevItems((prev) => prev.filter((x) => x.id !== item.id))
      showToast(
        created.length > 0
          ? 'Задача перенесена на эту доску'
          : 'Эту задачу уже перенесли или закрыли — список обновлён',
        created.length > 0 ? 'success' : 'info',
      )
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось перенести задачу'), 'error')
    } finally {
      setPullingPrevId(null)
    }
  }

  const handleOpenAiSuggest = async () => {
    if (readOnly || cardsHidden) return
    setSuggestDialogOpen(true)
    setSuggestLoading(true)
    setSuggestions([])
    setSuggestFailure(null)
    try {
      const res = await suggestActionItems(boardId)
      setSuggestions(res.suggestions)
    } catch (err) {
      // Ошибка — не «мало данных»: окно остаётся открытым и называет причину.
      // 503 с отключённым AI сервер отдаёт и до обращения к модели («AI сервис не настроен»).
      const message = getApiErrorMessage(err, 'Не удалось получить предложения AI')
      const notConfigured =
        useAppStore.getState().aiEnabled === false ||
        (getApiErrorStatus(err) === 503 && /не настроен/i.test(message))
      setSuggestFailure({ kind: notConfigured ? 'not_configured' : 'error', message })
    } finally {
      setSuggestLoading(false)
    }
  }

  const handleCreateSuggestedItems = async (
    itemsToCreate: { title: string; text: string; assignee: string | null; source_card_ids: string[] }[],
  ) => {
    if (itemsToCreate.length === 0 || readOnly) return
    setSuggestCreating(true)
    try {
      for (const s of itemsToCreate) {
        const created = await createActionItem({
          board_id: boardId,
          title: s.title,
          text: s.text,
          assignee: s.assignee || undefined,
          source_card_ids: s.source_card_ids,
        })
        onCreated?.(created)
      }
      showToast(`Добавлено задач: ${itemsToCreate.length}`, 'success')
      setSuggestDialogOpen(false)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось создать часть задач'), 'error')
    } finally {
      setSuggestCreating(false)
    }
  }

  const { setNodeRef, isOver } = useDroppable({
    id: 'master-col',
    data: { type: 'master' },
    disabled: dropDisabled,
  })

  const findItem = (id: string) => actionItems.find((i) => i.id === id)

  // Статус отмечают и на заблокированной доске. Перенесённую задачу ведут там, куда её перенесли
  const handleCycleStatus = async (item: ActionItem) => {
    if (item.superseded_by_id) return
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
      // Сервер задачу не удалил: возвращаем её в список. Это именно возврат, а не правка:
      // правка задачу, которой в списке нет, не добавляет.
      ;(onRestored ?? onCreated)?.(target)
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
      {/* Header. До 1024 px панель живёт в выезжающей шторке: справа оставлено место под её крестик */}
      <div className="flex items-center justify-between gap-2 border-b py-3 pl-4 pr-12 lg:pr-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <ListTodo className="h-3.5 w-3.5" />
          </span>
          <h3 className="text-sm font-semibold">Задачи</h3>
          <Badge variant="secondary" className="h-5 px-2 text-xs">
            {actionItems.length}
          </Badge>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-1">
            {/* Без настроенного AI кнопки нет; пока карточки скрыты — отключена с пояснением */}
            {aiEnabled !== false && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={handleOpenAiSuggest}
                disabled={cardsHidden}
                title={
                  cardsHidden
                    ? 'AI-подбор задач станет доступен после раскрытия карточек'
                    : 'AI: предложить задачи на основе карточек'
                }
                data-testid="ai-suggest-action-items-btn"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline">AI</span>
              </Button>
            )}
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
          </div>
        )}
      </div>

      {/* Previous retro open items accordion */}
      <div className="border-b bg-muted/20">
        <button
          type="button"
          onClick={handleTogglePrevSection}
          className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <span className="flex items-center gap-1.5">
            <History className="h-3.5 w-3.5 text-amber-500" />
            <span>Открытые с прошлых ретро</span>
            {prevLoaded && prevItems.length > 0 && (
              <Badge variant="warning" className="h-4 px-1.5 text-[10px]">
                {prevItems.length}
              </Badge>
            )}
          </span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform',
              prevOpenExpanded && 'rotate-180',
            )}
          />
        </button>

        <AnimatePresence initial={false}>
          {prevOpenExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden border-t bg-background/60"
            >
              <div className="max-h-52 space-y-1.5 overflow-y-auto p-2.5">
                {loadingPrev ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Загрузка задач...
                  </div>
                ) : prevError ? (
                  <div
                    role="alert"
                    data-testid="prev-items-error"
                    className="flex flex-col items-center gap-2 py-3 text-center text-[11px] text-muted-foreground"
                  >
                    <span>
                      <span className="font-medium text-foreground">
                        Не удалось загрузить задачи прошлых ретро.
                      </span>{' '}
                      {prevError}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 gap-1 px-2 text-[11px]"
                      onClick={() => void loadPreviousOpenItems()}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Повторить
                    </Button>
                  </div>
                ) : prevItems.length === 0 ? (
                  <div className="py-3 text-center text-[11px] text-muted-foreground">
                    Все задачи с прошлых ретро закрыты.
                  </div>
                ) : (
                  prevItems.map((prevItem) => (
                    <div
                      key={prevItem.id}
                      className="rounded-lg border bg-card p-2 text-xs"
                    >
                      <div className="mb-1 flex items-center justify-between gap-1.5 text-[10px] text-muted-foreground">
                        <span className="truncate font-medium">{prevItem.board_name}</span>
                        {prevItem.assignee && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5">
                            {prevItem.assignee}
                          </span>
                        )}
                      </div>
                      <p className="line-clamp-2 font-medium leading-snug text-foreground">
                        {prevItem.title || prevItem.text}
                      </p>
                      <div className="mt-1.5 flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 gap-1 px-2 text-[11px] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
                          onClick={() => handleCompletePrevItem(prevItem)}
                          title="Отметить выполненной"
                        >
                          <Check className="h-3 w-3" />
                          Готово
                        </Button>
                        {!readOnly && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 gap-1 px-2 text-[11px]"
                            disabled={pullingPrevId !== null}
                            onClick={() => handlePullPrevItemToBoard(prevItem)}
                            title="Перенести задачу на эту доску: на прежней она будет помечена перенесённой"
                          >
                            {pullingPrevId === prevItem.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <ArrowDownToLine className="h-3 w-3" />
                            )}
                            На доску
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Inline create form */}
      <AnimatePresence initial={false}>
        {addingNew && !readOnly && (
          <motion.form
            key="master-create-form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onSubmit={handleCreateManual}
            className="overflow-hidden border-b bg-muted/30"
          >
            <div className="space-y-2 p-3">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Краткий заголовок (опционально)"
                className="h-8 text-xs"
              />
              <Textarea
                autoResize
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="Что нужно сделать..."
                required
                className="min-h-[56px] text-xs"
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
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Droppable list */}
      <div
        ref={setNodeRef}
        className={cn(
          'scrollbar-subtle flex-1 space-y-2.5 overflow-y-auto p-3 transition-colors',
          isOver && 'bg-primary/10 ring-2 ring-inset ring-primary/40',
        )}
      >
        {actionItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-4 py-10 text-center text-xs text-muted-foreground">
            <ListTodo className="mb-2 h-6 w-6 opacity-40" />
            <p className="font-medium text-foreground/80">Пока нет задач</p>
            <p className="mt-1">
              {readOnly
                ? 'Доска заблокирована: новые задачи на неё не добавляются.'
                : cardsHidden
                  ? 'Пока карточки скрыты, задачу можно добавить только вручную — кнопкой «Добавить».'
                  : 'Перетащите карточку сюда или нажмите кнопку задачи на любой карточке.'}
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {actionItems.map((item) => {
              const meta = STATUS_META[item.status] || STATUS_META.open
              // Задачу перенесли на другую доску: здесь она осталась в истории, а открытой
              // считается её копия — статус меняют там
              const carried = Boolean(item.superseded_by_id)
              const StatusIcon = carried ? CornerUpRight : meta.Icon
              const isDone = item.status === 'done'

              return (
                <motion.div
                  key={item.id}
                  layout="position"
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.94, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  data-testid="action-item"
                  className={cn(
                    'group/ai overflow-hidden rounded-xl border bg-card p-3 shadow-xs transition-colors hover:border-border',
                    (isDone || carried) && 'opacity-70',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      disabled={carried}
                      onClick={() => handleCycleStatus(item)}
                      title={
                        carried
                          ? 'Задача перенесена на другую доску — статус меняют там'
                          : `Статус: ${meta.label} — нажмите, чтобы сменить`
                      }
                      aria-label={
                        carried
                          ? 'Задача перенесена на другую доску'
                          : `Статус: ${meta.label}. Сменить`
                      }
                      data-testid="action-item-status"
                      className={cn(
                        'mt-0.5 shrink-0 transition-transform hover:scale-110 active:scale-95 disabled:cursor-default disabled:hover:scale-100',
                        carried ? 'text-muted-foreground' : meta.colorClass,
                      )}
                    >
                      <motion.span
                        key={item.status}
                        initial={{ scale: 0.7, rotate: -15 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 480, damping: 20 }}
                        className="inline-flex"
                      >
                        <StatusIcon className="h-4 w-4" />
                      </motion.span>
                    </button>

                  <div className="min-w-0 flex-1 space-y-1">
                    {carried && (
                      <Badge
                        variant="outline"
                        className="h-4 gap-1 px-1.5 text-[10px] font-normal text-muted-foreground"
                        data-testid="action-item-carried"
                      >
                        Перенесена на другую доску
                      </Badge>
                    )}
                    {editingTitleId === item.id ? (
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        autoFocus
                        className="h-7 px-2 text-xs font-semibold"
                        onBlur={() => saveTitle(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveTitle(item.id)
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
                        autoResize
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        autoFocus
                        className="min-h-[52px] text-xs"
                        onBlur={() => saveDesc(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            void saveDesc(item.id)
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
                          'whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground',
                          !readOnly && 'cursor-text hover:text-foreground',
                        )}
                      >
                        <RichCardText text={item.text} />
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
                                  className={`flex h-4 w-4 items-center justify-center rounded-full bg-linear-to-br/srgb text-[8px] font-bold text-white ${getUserAvatarGradient(item.assignee)}`}
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
                                  void saveAssignee(item.id, assigneeDraft.trim() || null)
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
                </motion.div>
              )
            })}
          </AnimatePresence>
        )}
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить задачу?</AlertDialogTitle>
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

      <SuggestActionItemsDialog
        open={suggestDialogOpen}
        onOpenChange={setSuggestDialogOpen}
        loading={suggestLoading}
        submitting={suggestCreating}
        suggestions={suggestions}
        failure={suggestFailure}
        onRetry={handleOpenAiSuggest}
        onCreateSelected={handleCreateSuggestedItems}
      />
    </div>
  )
}
