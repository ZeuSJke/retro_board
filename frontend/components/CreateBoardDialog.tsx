'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckSquare,
  Copy,
  EyeOff,
  Kanban,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react'
import { createBoard, getAllActionItems, getBoardTemplates, updateActionItem } from '@/api'
import { withoutCarriedOriginals } from '@/lib/action-items'
import { COLUMN_COLOR_PALETTE } from '@/lib/board-themes'
import { queryKeys } from '@/lib/query-client'
import { useOpeningCount } from '@/lib/use-opening-count'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { showToast } from '@/store/toastStore'
import type {
  ActionItem,
  ActionItemStatus,
  Board,
  BoardListItem,
  BoardTemplateInfo,
  ColumnSeed,
  DashboardActionItem,
} from '@/types'
import { getApiErrorMessage, markApiErrorReported } from '@/utils/apiError'
import ActionItemsKanban from '@/components/action-items/ActionItemsKanban'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

type DialogStep = 'setup' | 'kanban'

const FALLBACK_TEMPLATES: BoardTemplateInfo[] = [
  {
    id: 'classic',
    name: 'Классическое ретро',
    description: 'Что хорошо, что улучшить и идеи',
    columns: [
      { title: '😊 Что хорошо', color: '#006E1C' },
      { title: '😟 Что улучшить', color: '#BA1A1A' },
      { title: '💡 Идеи', color: '#E8760A' },
    ],
  },
  {
    id: 'start_stop_continue',
    name: 'Start / Stop / Continue',
    description: 'Фокус на конкретных изменениях процесса',
    columns: [
      { title: '🚀 Start (Начать)', color: '#006E1C' },
      { title: '🛑 Stop (Прекратить)', color: '#BA1A1A' },
      { title: '🔁 Continue (Продолжать)', color: '#6750A4' },
    ],
  },
  {
    id: '4ls',
    name: '4Ls',
    description: 'Liked, Learned, Lacked, Longed for',
    columns: [
      { title: '❤️ Liked (Понравилось)', color: '#006E1C' },
      { title: '🎓 Learned (Узнали)', color: '#00639B' },
      { title: '🔍 Lacked (Не хватило)', color: '#E8760A' },
      { title: '✨ Longed for (Хочется)', color: '#6750A4' },
    ],
  },
  {
    id: 'sailboat',
    name: 'Парусник',
    description: 'Ветер, якорь, рифы и цель спринта',
    columns: [
      { title: '💨 Ветер (Двигает вперёд)', color: '#006E1C' },
      { title: '⚓ Якорь (Тормозит)', color: '#E8760A' },
      { title: '🪨 Рифы (Риски)', color: '#BA1A1A' },
      { title: '🏝️ Цель (Остров)', color: '#6750A4' },
    ],
  },
  {
    id: 'mad_sad_glad',
    name: 'Mad / Sad / Glad',
    description: 'Эмоциональный чек-ин по итогам спринта',
    columns: [
      { title: '😠 Mad (Злит)', color: '#BA1A1A' },
      { title: '😔 Sad (Грустно)', color: '#00639B' },
      { title: '😄 Glad (Радует)', color: '#006E1C' },
    ],
  },
]

function formatVotesLimit(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} голос`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} голоса`
  return `${count} голосов`
}

interface CreateBoardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingBoards: BoardListItem[]
  onCreated: (board: Board) => void
}

export default function CreateBoardDialog({
  open,
  onOpenChange,
  existingBoards,
  onCreated,
}: CreateBoardDialogProps) {
  // Форма живёт одно открытие (key): каждое открытие начинается с чистого листа, а обновление
  // списка досок, пока окно открыто (коллега что-то изменил), введённое не сбрасывает
  const opening = useOpeningCount(open)
  const [prevOpen, setPrevOpen] = useState(open)
  const [step, setStep] = useState<DialogStep>('setup')

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open && step !== 'setup') {
      setStep('setup')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        layout="structured"
        className={cn(
          'transition-[max-width] duration-200',
          step === 'kanban' && existingBoards.length > 0 ? 'max-w-5xl' : 'max-w-2xl',
        )}
      >
        {opening > 0 && (
          <CreateBoardForm
            key={opening}
            existingBoards={existingBoards}
            step={step}
            onStepChange={setStep}
            onCancel={() => onOpenChange(false)}
            onCreated={(board) => {
              onOpenChange(false)
              onCreated(board)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface CreateBoardFormProps {
  existingBoards: BoardListItem[]
  step: DialogStep
  onStepChange: (step: DialogStep) => void
  onCancel: () => void
  onCreated: (board: Board) => void
}

function CreateBoardForm({
  existingBoards,
  step,
  onStepChange,
  onCancel,
  onCreated,
}: CreateBoardFormProps) {
  const queryClient = useQueryClient()
  const workspaceId = useAppStore((s) => s.workspace?.workspaceId ?? 'anonymous')
  const createDialogItemsKey = useMemo(
    () => ['create-board-dialog', workspaceId, 'action-items'] as const,
    [workspaceId],
  )

  const { data: serverTemplates } = useQuery({
    queryKey: queryKeys.boardTemplates(),
    queryFn: async () => {
      try {
        return await getBoardTemplates()
      } catch (err) {
        markApiErrorReported(err)
        throw err
      }
    },
    staleTime: 10 * 60_000,
  })

  const itemsQuery = useQuery({
    queryKey: createDialogItemsKey,
    queryFn: async () => {
      try {
        return withoutCarriedOriginals(await getAllActionItems())
      } catch (err) {
        markApiErrorReported(err)
        throw err
      }
    },
    enabled: existingBoards.length > 0,
    staleTime: 0,
  })

  // «Пустая доска» и «Свой набор колонок» — один выбор: пустой холст без готовых колонок
  const templates = (serverTemplates && serverTemplates.length > 0
    ? serverTemplates
    : FALLBACK_TEMPLATES
  ).filter((tpl) => tpl.id !== 'empty')

  const [name, setName] = useState('')
  const [template, setTemplate] = useState<string>('classic')
  const [maxVotes, setMaxVotes] = useState<number>(5)
  const [pickedSourceId, setPickedSourceId] = useState<string>('')
  const [customColumns, setCustomColumns] = useState<ColumnSeed[]>([])
  const [carryForward, setCarryForward] = useState(false)
  const [hideCards, setHideCards] = useState(false)
  const [anonymousVotes, setAnonymousVotes] = useState(false)
  const [allowMultipleVotes, setAllowMultipleVotes] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Триаж задач в канбане (шаг 2)
  const [kanbanBoardFilter, setKanbanBoardFilter] = useState<string>('all')
  const [touchedSelection, setTouchedSelection] = useState(false)
  const [selectedCarryIds, setSelectedCarryIds] = useState<Set<string>>(() => new Set())

  // Исходная доска: выбранная, пока она есть в списке, иначе самая свежая
  const selectedSourceBoard =
    existingBoards.find((b) => b.id === pickedSourceId) ?? existingBoards[0]
  const sourceBoardId = selectedSourceBoard?.id ?? ''
  const openItemsCount = selectedSourceBoard?.action_items_open ?? 0

  const allItems = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data])
  const filteredKanbanItems = useMemo(() => {
    if (kanbanBoardFilter === 'all') return allItems
    return allItems.filter((i) => i.board_id === kanbanBoardFilter)
  }, [allItems, kanbanBoardFilter])

  const openItemsInScope = useMemo(
    () => filteredKanbanItems.filter((i) => i.status !== 'done'),
    [filteredKanbanItems],
  )

  // Пока выбор не трогали руками, если включён простой перенос с исходной доски — подсвечиваем её открытые задачи
  const effectiveSelectedIds = useMemo(() => {
    if (touchedSelection) return selectedCarryIds
    if (!carryForward) return new Set<string>()
    return new Set(
      allItems
        .filter((i) => i.status !== 'done' && (!sourceBoardId || i.board_id === sourceBoardId))
        .map((i) => i.id),
    )
  }, [touchedSelection, selectedCarryIds, carryForward, allItems, sourceBoardId])

  const boardsWithTasks = useMemo(() => {
    const idsWithTasks = new Set(allItems.map((i) => i.board_id))
    return existingBoards.filter((b) => idsWithTasks.has(b.id))
  }, [existingBoards, allItems])

  const handleAddCustomColumn = () => {
    if (customColumns.length >= 8) return
    setCustomColumns((prev) => [
      ...prev,
      {
        title: `Колонка ${prev.length + 1}`,
        color: COLUMN_COLOR_PALETTE[prev.length % COLUMN_COLOR_PALETTE.length],
      },
    ])
  }

  const handleToggleSelect = (id: string) => {
    const target = allItems.find((i) => i.id === id)
    if (target?.status === 'done') return
    const next = new Set(effectiveSelectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedCarryIds(next)
    setTouchedSelection(true)
  }

  const handleSelectAllOpen = () => {
    const next = new Set(effectiveSelectedIds)
    for (const item of openItemsInScope) {
      next.add(item.id)
    }
    setSelectedCarryIds(next)
    setTouchedSelection(true)
  }

  const handleClearSelection = () => {
    setSelectedCarryIds(new Set())
    setTouchedSelection(true)
  }

  const handleKanbanStatusChange = async (
    item: DashboardActionItem,
    nextStatus: ActionItemStatus,
  ) => {
    const snapshot = queryClient.getQueryData<DashboardActionItem[]>(createDialogItemsKey)
    queryClient.setQueryData<DashboardActionItem[]>(createDialogItemsKey, (prev = []) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: nextStatus } : i)),
    )

    if (nextStatus === 'done' && effectiveSelectedIds.has(item.id)) {
      const next = new Set(effectiveSelectedIds)
      next.delete(item.id)
      setSelectedCarryIds(next)
      setTouchedSelection(true)
    }

    try {
      const updated = await updateActionItem(item.id, { status: nextStatus })
      queryClient.setQueryData<DashboardActionItem[]>(createDialogItemsKey, (prev = []) =>
        prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)),
      )
      void queryClient.invalidateQueries({ queryKey: ['dashboard', workspaceId] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.boards(workspaceId) })
    } catch (err) {
      queryClient.setQueryData<DashboardActionItem[]>(createDialogItemsKey, snapshot)
      showToast(getApiErrorMessage(err, 'Не удалось обновить статус задачи'), 'error')
    }
  }

  const handleExternalLinkUpdated = (updated: ActionItem) => {
    queryClient.setQueryData<DashboardActionItem[]>(createDialogItemsKey, (prev = []) =>
      prev.map((i) => (i.id === updated.id ? { ...i, ...updated, board_name: i.board_name } : i)),
    )
    void queryClient.invalidateQueries({ queryKey: ['dashboard', workspaceId] })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      if (step !== 'setup') onStepChange('setup')
      return
    }
    if (submitting) return
    if (template === 'copy' && !sourceBoardId) {
      showToast('Выберите исходную доску для копирования', 'error')
      return
    }
    setSubmitting(true)
    try {
      const basePayload = {
        name: trimmed,
        template,
        max_votes: maxVotes,
        custom_columns:
          template === 'custom'
            ? customColumns.filter((c) => c.title.trim().length > 0)
            : undefined,
        hide_cards_until_reveal: hideCards,
        anonymous_votes: anonymousVotes,
        allow_multiple_votes_per_card: allowMultipleVotes,
      }
      const board = await createBoard(
        touchedSelection
          ? {
              ...basePayload,
              source_board_id: template === 'copy' ? sourceBoardId || null : null,
              carry_forward_items: false,
              carry_forward_item_ids: Array.from(selectedCarryIds),
            }
          : {
              ...basePayload,
              source_board_id:
                template === 'copy' || carryForward ? sourceBoardId || null : null,
              carry_forward_items: carryForward,
            },
      )
      void queryClient.invalidateQueries({ queryKey: createDialogItemsKey })
      void queryClient.invalidateQueries({ queryKey: ['dashboard', workspaceId] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.boards(workspaceId) })
      showToast('Доска создана', 'success')
      onCreated(board)
    } catch (err) {
      showToast(
        getApiErrorMessage(err, 'Не удалось создать доску', { name: 'Название доски' }),
        'error',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // Шапка и кнопки закреплены, прокручивается только содержимое: «Создать» видна
    // на любой высоте экрана
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Новая доска ретроспективы
        </DialogTitle>
        <DialogDescription>
          {step === 'kanban'
            ? 'Обсудите открытые задачи команды, актуализируйте статусы и отметьте перенос на новую доску.'
            : 'Выберите готовый шаблон колонок, повторите прошлую доску или настройте свои.'}
        </DialogDescription>
      </DialogHeader>

      {existingBoards.length > 0 && (
        <div
          role="tablist"
          aria-label="Этапы настройки новой доски"
          className="flex shrink-0 items-center gap-1.5 border-b border-border/60 bg-muted/20 px-6 py-2"
        >
          <button
            type="button"
            role="tab"
            aria-selected={step === 'setup'}
            onClick={() => onStepChange('setup')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              step === 'setup'
                ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            1. Настройки доски
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={step === 'kanban'}
            onClick={() => onStepChange('kanban')}
            data-testid="create-board-kanban-tab"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              step === 'kanban'
                ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Kanban className="h-3.5 w-3.5 text-primary" />
            <span>2. Разбор задач</span>
            {(effectiveSelectedIds.size > 0 || allItems.some((i) => i.status !== 'done')) && (
              <Badge
                variant={effectiveSelectedIds.size > 0 ? 'default' : 'secondary'}
                className="h-4 px-1.5 text-[10px] tabular-nums"
              >
                {effectiveSelectedIds.size > 0
                  ? `${effectiveSelectedIds.size} выбр.`
                  : allItems.filter((i) => i.status !== 'done').length}
              </Badge>
            )}
          </button>
        </div>
      )}

      <DialogBody className="space-y-5">
        {step === 'setup' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-board-name">Название доски</Label>
                <Input
                  id="new-board-name"
                  placeholder="Например: Спринт 24"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  autoFocus
                  data-testid="create-board-name-input"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-board-votes">Лимит голосов</Label>
                <Select value={String(maxVotes)} onValueChange={(v) => setMaxVotes(Number(v))}>
                  <SelectTrigger id="new-board-votes">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[3, 5, 7, 10].map((v) => (
                      <SelectItem key={v} value={String(v)}>
                        {formatVotesLimit(v)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Шаблон колонок</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {templates.map((tpl) => {
                  const active = template === tpl.id
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setTemplate(tpl.id)}
                      className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all ${
                        active
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-foreground/30 hover:bg-muted/40'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-sm font-medium">{tpl.name}</span>
                        {tpl.columns.length > 0 && (
                          <div className="flex gap-1">
                            {tpl.columns.map((c, idx) => (
                              <span
                                key={idx}
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: c.color }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {tpl.description}
                      </span>
                      {tpl.columns.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {tpl.columns.map((c, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: c.color }}
                              />
                              <span className="max-w-[115px] truncate">{c.title}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  )
                })}

                {existingBoards.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTemplate('copy')}
                    className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all ${
                      template === 'copy'
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:border-foreground/30 hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Copy className="h-3.5 w-3.5 text-primary" />
                      Повторить прошлую доску
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Скопировать структуру колонок
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setTemplate('custom')}
                  className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all ${
                    template === 'custom'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-foreground/30 hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Plus className="h-3.5 w-3.5 text-primary" />
                    Свой набор колонок
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Начните с пустой доски или задайте колонки сразу
                  </span>
                </button>
              </div>
            </div>

            {(template === 'copy' ||
              (existingBoards.length > 0 && !touchedSelection && carryForward)) && (
              <div className="space-y-1.5 rounded-xl border bg-muted/40 p-3">
                <Label>Исходная доска</Label>
                <Select value={sourceBoardId} onValueChange={setPickedSourceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите доску" />
                  </SelectTrigger>
                  <SelectContent>
                    {existingBoards.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {template === 'custom' && (
              <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <Label>Колонки ({customColumns.length}/8)</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddCustomColumn}
                    disabled={customColumns.length >= 8}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Добавить
                  </Button>
                </div>
                <div className="space-y-2">
                  {customColumns.length === 0 && (
                    <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs leading-snug text-muted-foreground">
                      Колонок пока нет — доска создастся пустой. Их можно добавить здесь или позже
                      на самой доске.
                    </p>
                  )}
                  {customColumns.map((col, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="Сменить цвет колонки"
                        onClick={() =>
                          setCustomColumns((prev) =>
                            prev.map((c, i) =>
                              i === idx
                                ? {
                                    ...c,
                                    color:
                                      COLUMN_COLOR_PALETTE[
                                        (COLUMN_COLOR_PALETTE.indexOf(c.color) + 1) %
                                          COLUMN_COLOR_PALETTE.length
                                      ],
                                  }
                                : c,
                            ),
                          )
                        }
                        className="h-7 w-7 shrink-0 rounded-lg border shadow-xs transition-transform hover:scale-105"
                        style={{ backgroundColor: col.color }}
                      />
                      <Input
                        value={col.title}
                        onChange={(e) =>
                          setCustomColumns((prev) =>
                            prev.map((c, i) => (i === idx ? { ...c, title: e.target.value } : c)),
                          )
                        }
                        maxLength={80}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Удалить колонку"
                        onClick={() =>
                          setCustomColumns((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 rounded-xl border p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                    Скрытый сбор
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Каждый видит только свои карточки, пока создатель доски не нажмёт «Раскрыть».
                    В сессии ведущего карточки откроет этап «Раскрытие».
                  </p>
                </div>
                <Switch
                  checked={hideCards}
                  onCheckedChange={setHideCards}
                  aria-label="Скрытый сбор"
                  data-testid="create-hide-cards-switch"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    Анонимный режим
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Авторы карточек и голосовавшие скрыты от других участников
                  </p>
                </div>
                <Switch
                  checked={anonymousVotes}
                  onCheckedChange={setAnonymousVotes}
                  aria-label="Анонимный режим"
                  data-testid="create-anonymous-switch"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Несколько голосов в одну карточку (Dot Voting)
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Участники смогут отдавать несколько голосов одной важной карточке
                  </p>
                </div>
                <Switch checked={allowMultipleVotes} onCheckedChange={setAllowMultipleVotes} />
              </div>

              {existingBoards.length > 0 && (
                <div className="space-y-2.5 border-t pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        Перенести незакрытые задачи
                        {touchedSelection ? (
                          <Badge variant="default" className="text-[11px]">
                            Выбрано в канбане: {selectedCarryIds.size}
                          </Badge>
                        ) : (
                          openItemsCount > 0 && (
                            <Badge variant="warning" className="text-[11px]">
                              {openItemsCount} открытых
                            </Badge>
                          )
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {touchedSelection
                          ? 'Будут перенесены только задачи, отмеченные вами в канбане на вкладке «Разбор задач».'
                          : 'Незакрытые задачи исходной доски переедут на новую. На исходной они останутся в истории с пометкой «Перенесена».'}
                      </p>
                    </div>
                    <Switch
                      checked={touchedSelection ? selectedCarryIds.size > 0 : carryForward}
                      onCheckedChange={(checked) => {
                        setTouchedSelection(false)
                        setSelectedCarryIds(new Set())
                        setCarryForward(checked)
                      }}
                      aria-label="Перенести незакрытые задачи"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => onStepChange('kanban')}
                      data-testid="open-create-kanban-btn"
                    >
                      <Kanban className="h-3.5 w-3.5 text-primary" />
                      Разобрать в канбане
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div data-testid="create-board-kanban-panel" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={kanbanBoardFilter === 'all' ? 'secondary' : 'ghost'}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setKanbanBoardFilter('all')}
                >
                  Все доски
                </Button>
                {boardsWithTasks.map((b) => (
                  <Button
                    key={b.id}
                    type="button"
                    size="sm"
                    variant={kanbanBoardFilter === b.id ? 'secondary' : 'ghost'}
                    className="h-7 max-w-[180px] truncate px-2.5 text-xs"
                    onClick={() => setKanbanBoardFilter(b.id)}
                  >
                    {b.name}
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={openItemsInScope.length === 0}
                  onClick={handleSelectAllOpen}
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  Выбрать все открытые
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={effectiveSelectedIds.size === 0 && !touchedSelection}
                  onClick={handleClearSelection}
                >
                  <Square className="h-3.5 w-3.5" />
                  Снять выбор
                </Button>
                <Badge variant={effectiveSelectedIds.size > 0 ? 'default' : 'secondary'}>
                  К переносу: {effectiveSelectedIds.size}
                </Badge>
              </div>
            </div>

            {itemsQuery.isPending ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Загружаем задачи команды...
              </div>
            ) : itemsQuery.isError ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-center">
                <p className="text-sm text-destructive">Не удалось загрузить задачи команды</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void itemsQuery.refetch()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Повторить
                </Button>
              </div>
            ) : filteredKanbanItems.length === 0 ? (
              <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                По прошлым доскам пока нет задач. Можно сразу перейти к созданию новой доски.
              </div>
            ) : (
              <ActionItemsKanban
                items={filteredKanbanItems}
                compact
                selectable
                defaultDoneCollapsed
                selectedIds={effectiveSelectedIds}
                onToggleSelect={handleToggleSelect}
                onStatusChange={handleKanbanStatusChange}
                onExternalLinkUpdated={handleExternalLinkUpdated}
                emptyHint="В этой колонке задач нет"
              />
            )}
          </div>
        )}
      </DialogBody>

      <DialogFooter className="sm:justify-between">
        {step === 'kanban' ? (
          <Button type="button" variant="outline" onClick={() => onStepChange('setup')}>
            Назад к настройкам
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            type="submit"
            disabled={!name.trim() || submitting}
            title={!name.trim() ? 'Сначала укажите название доски на шаге «Настройки доски»' : undefined}
            data-testid="create-board-submit-btn"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Создаём...
              </>
            ) : (
              'Создать'
            )}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
