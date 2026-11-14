'use client'

import { useEffect, useState } from 'react'
import {
  Copy,
  EyeOff,
  Loader2,
  Plus,
  Shield,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { createBoard, getBoardTemplates } from '@/api'
import { COLUMN_COLOR_PALETTE } from '@/lib/board-themes'
import { getApiErrorMessage } from '@/utils/apiError'
import { showToast } from '@/store/toastStore'
import type { Board, BoardListItem, BoardTemplateInfo, ColumnSeed } from '@/types'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'

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
  {
    id: 'empty',
    name: 'Пустая доска',
    description: 'Без заранее заданных колонок',
    columns: [],
  },
]

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
  const [templates, setTemplates] = useState<BoardTemplateInfo[]>(FALLBACK_TEMPLATES)
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<string>('classic')
  const [maxVotes, setMaxVotes] = useState<number>(5)
  const [sourceBoardId, setSourceBoardId] = useState<string>('')
  const [customColumns, setCustomColumns] = useState<ColumnSeed[]>([
    { title: 'Плюсы', color: COLUMN_COLOR_PALETTE[0] },
    { title: 'Риски', color: COLUMN_COLOR_PALETTE[1] },
  ])
  const [carryForward, setCarryForward] = useState(false)
  const [hideCards, setHideCards] = useState(false)
  const [anonymousVotes, setAnonymousVotes] = useState(false)
  const [allowMultipleVotes, setAllowMultipleVotes] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    getBoardTemplates()
      .then((list) => {
        if (list.length > 0) setTemplates(list)
      })
      .catch(() => {
        /* fallback templates already loaded */
      })
  }, [open])

  useEffect(() => {
    if (!open) return
    setName('')
    setTemplate('classic')
    setMaxVotes(5)
    setCarryForward(false)
    setHideCards(false)
    setAnonymousVotes(false)
    setAllowMultipleVotes(false)
    setSourceBoardId(existingBoards[0]?.id ?? '')
  }, [open, existingBoards])

  const selectedSourceBoard = existingBoards.find((b) => b.id === sourceBoardId)
  const openItemsCount = selectedSourceBoard?.action_items_open ?? existingBoards[0]?.action_items_open ?? 0

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || submitting) return
    if (template === 'copy' && !sourceBoardId) {
      showToast('Выберите исходную доску для копирования', 'error')
      return
    }
    setSubmitting(true)
    try {
      const board = await createBoard({
        name: trimmed,
        template,
        max_votes: maxVotes,
        source_board_id: template === 'copy' || carryForward ? sourceBoardId || null : null,
        custom_columns:
          template === 'custom'
            ? customColumns.filter((c) => c.title.trim().length > 0)
            : undefined,
        carry_forward_items: carryForward,
        hide_cards_until_reveal: hideCards,
        anonymous_votes: anonymousVotes,
        allow_multiple_votes_per_card: allowMultipleVotes,
      })
      showToast('Доска создана', 'success')
      onOpenChange(false)
      onCreated(board)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось создать доску'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Новая доска ретроспективы
          </DialogTitle>
          <DialogDescription>
            Выберите готовый фреймворк, скопируйте колонки прошлой доски или настройте свои.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
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
                      {v} голосов
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
                  Задайте названия и цвета вручную
                </span>
              </button>
            </div>
          </div>

          {(template === 'copy' || (existingBoards.length > 0 && carryForward)) && (
            <div className="space-y-1.5 rounded-xl border bg-muted/40 p-3">
              <Label>Исходная доска</Label>
              <Select value={sourceBoardId} onValueChange={setSourceBoardId}>
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
                      className="h-7 w-7 shrink-0 rounded-lg border shadow-sm transition-transform hover:scale-105"
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
                      disabled={customColumns.length <= 1}
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
                  Скрывать чужие карточки до раскрытия
                </div>
                <p className="text-xs text-muted-foreground">
                  Во время мозгового штурма участники видят только свои стикеры
                </p>
              </div>
              <Switch checked={hideCards} onCheckedChange={setHideCards} />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  Анонимное голосование
                </div>
                <p className="text-xs text-muted-foreground">
                  Скрывать авторов карточек для непредвзятого голосования
                </p>
              </div>
              <Switch checked={anonymousVotes} onCheckedChange={setAnonymousVotes} />
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
              <div className="flex items-center justify-between gap-3 border-t pt-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    Перенести нерешённые Action Items
                    {openItemsCount > 0 && (
                      <Badge variant="warning" className="text-[11px]">
                        {openItemsCount} открытых
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Скопировать незакрытые задачи с прошлой доски на новую
                  </p>
                </div>
                <Switch checked={carryForward} onCheckedChange={setCarryForward} />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || submitting}
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
