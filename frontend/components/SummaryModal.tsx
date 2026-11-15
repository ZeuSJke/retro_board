'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileText,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
  Tag,
} from 'lucide-react'
import { getBoardSummary, regenerateBoardSummary } from '@/api'
import { downloadMarkdownFile, formatBoardMarkdown } from '@/lib/export-markdown'
import { useAppStore } from '@/store'
import { showToast } from '@/store/toastStore'
import { getApiErrorMessage } from '@/utils/apiError'
import type { ActionItem, Board, BoardSummary } from '@/types'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ThemeStreakBadge from '@/components/dashboard/ThemeStreakBadge'

interface SummaryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  board: Board
  actionItems: ActionItem[]
  summary: BoardSummary | null
  loading: boolean
  /** Почему итогов нет: не удалось загрузить сохранённые или сгенерировать новые. */
  error: string | null
  onSummaryUpdated: (summary: BoardSummary) => void
}

type SummaryTab = 'summary' | 'markdown'

export default function SummaryModal({
  open,
  onOpenChange,
  board,
  actionItems,
  summary,
  loading,
  error,
  onSummaryUpdated,
}: SummaryModalProps) {
  const aiEnabled = useAppStore((s) => s.aiEnabled)
  const [regenerating, setRegenerating] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exportTab, setExportTab] = useState<SummaryTab>('summary')
  // Ошибка, которую уже исправил повтор: владелец состояния (доска, панель управления)
  // хранит её текст и дальше, а показывать её рядом с готовыми итогами незачем
  const [resolvedError, setResolvedError] = useState<string | null>(null)

  // Каждое открытие начинается с вкладки итогов и без памяти о прошлых ошибках
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setExportTab('summary')
      setResolvedError(null)
    }
  }

  // Почему AI-резюме сейчас недоступно: сервер ответил бы 503 (AI не настроен)
  // или 409 (карточки скрыты), поэтому кнопку не показываем, а объясняем причину
  const aiBlockedReason =
    aiEnabled === false
      ? 'AI на этом сервере не настроен, поэтому итоги (AI-резюме) не формируются. Карточки, голоса и задачи можно выгрузить без AI — на вкладке «Markdown и Slack».'
      : board.cards_hidden
        ? 'Карточки ещё скрыты: итоги можно будет сформировать после их раскрытия.'
        : null

  const shownError = error && error !== resolvedError ? error : null
  const busy = loading || regenerating || reloading
  // Итоги на сервере есть, но показать их не удалось — повтор перечитывает сохранённое.
  // Если сохранённых итогов нет, повторять нечего, кроме самой генерации.
  const canReload = Boolean(board.has_summary) && !summary
  const canGenerate = !aiBlockedReason

  const fullMarkdown = useMemo(
    () => formatBoardMarkdown(board, actionItems, summary),
    [board, actionItems, summary],
  )

  const slackText = useMemo(() => {
    const lines: string[] = [`*Итоги ретро «${board.name}»*`]
    if (summary?.summary_text) {
      lines.push('', summary.summary_text)
    }
    if (summary?.key_themes?.length) {
      lines.push('', '*Ключевые темы:*')
      summary.key_themes.forEach((t) => lines.push(`• ${t}`))
    }
    // Перенесённая задача живёт на другой доске: в сводке этой доски ей не место
    const tasks = actionItems.filter((a) => !a.superseded_by_id)
    if (tasks.length > 0) {
      lines.push('', `*Задачи (${tasks.length}):*`)
      tasks.forEach((a) => {
        const who = a.assignee ? ` — @${a.assignee}` : ''
        lines.push(`• ${a.title || a.text}${who}`)
      })
    }
    return lines.join('\n')
  }, [board.name, summary, actionItems])

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      showToast(label, 'success')
      setTimeout(() => setCopied(false), 1800)
    } catch {
      showToast('Не удалось скопировать в буфер', 'error')
    }
  }

  const handleRegenerate = async () => {
    if (busy || aiBlockedReason) return
    setRegenerating(true)
    try {
      const fresh = await regenerateBoardSummary(board.id)
      setResolvedError(error)
      onSummaryUpdated(fresh)
      showToast(summary ? 'Итоги обновлены' : 'Итоги сформированы', 'success')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось сформировать итоги'), 'error')
    } finally {
      setRegenerating(false)
    }
  }

  const handleReload = async () => {
    if (busy) return
    setReloading(true)
    try {
      const saved = await getBoardSummary(board.id)
      if (saved) {
        setResolvedError(error)
        onSummaryUpdated(saved)
      } else {
        showToast('Сохранённых итогов у этой доски нет', 'info')
      }
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось загрузить итоги'), 'error')
    } finally {
      setReloading(false)
    }
  }

  const openExport = () => setExportTab('markdown')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="structured" className="h-[min(86vh,760px)] max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Итоги ретроспективы
          </DialogTitle>
          <DialogDescription>{board.name}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={exportTab}
          onValueChange={(v) => setExportTab(v as SummaryTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 border-b border-border/60 bg-muted/20 px-6 py-2.5">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="summary">AI-резюме и темы</TabsTrigger>
              <TabsTrigger value="markdown">Markdown и Slack</TabsTrigger>
            </TabsList>
          </div>

          {/* Высота модалки зафиксирована на DialogContent — flex-1 на DialogBody заполняет окно без скачков и лишнего скролла */}
          <DialogBody>
            <TabsContent value="summary" className="mt-0 flex min-h-full flex-col space-y-4">
              {busy && (
                <div className="flex min-h-[260px] flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">
                    {reloading
                      ? 'Загружаем итоги...'
                      : 'Анализируем карточки и формируем выводы...'}
                  </p>
                </div>
              )}

              {/* Итогов нет и взять их не получилось: объясняем и даём действие, а не один красный текст */}
              {!busy && shownError && !summary && (
                <div
                  role="alert"
                  data-testid="summary-error-state"
                  className="flex min-h-[260px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-6 text-center"
                >
                  <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
                  <p className="text-sm font-semibold text-foreground">{shownError}</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    {canReload
                      ? 'Итоги этой доски сохранены на сервере, но загрузить их не получилось. Попробуйте ещё раз.'
                      : (aiBlockedReason ??
                        'AI-сервис не ответил или вернул ошибку. Попробуйте ещё раз — а карточки, голоса и задачи можно выгрузить и без AI-резюме.')}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {(canReload || canGenerate) && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={canReload ? handleReload : handleRegenerate}
                        data-testid="summary-retry-btn"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Повторить
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openExport}
                      data-testid="summary-open-export-btn"
                    >
                      <FileText className="h-4 w-4" />
                      Открыть экспорт
                    </Button>
                  </div>
                </div>
              )}

              {!busy && !shownError && !summary && (
                <div className="flex min-h-[260px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 text-center">
                  {aiBlockedReason ? (
                    <>
                      <p className="max-w-md text-sm text-muted-foreground" data-testid="ai-unavailable-note">
                        {aiBlockedReason}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={openExport}
                        data-testid="summary-open-export-btn"
                      >
                        <FileText className="h-4 w-4" />
                        Открыть экспорт
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="max-w-md text-sm text-muted-foreground">
                        Итоги для этой доски ещё не сформированы. Они появятся, когда ведущий
                        переведёт сессию на этап «Итоги», — или сформируйте их сейчас.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRegenerate}
                        data-testid="generate-summary-btn"
                      >
                        <Sparkles className="h-4 w-4 text-primary" />
                        Сгенерировать AI-резюме
                      </Button>
                    </>
                  )}
                </div>
              )}

              {!busy && summary && (
                <div className="space-y-4">
                  {/* Новые итоги сформировать не удалось, но прошлые есть: показываем их с пояснением */}
                  {shownError && (
                    <div
                      role="alert"
                      data-testid="summary-stale-note"
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-sm"
                    >
                      <span className="min-w-0 flex-1 text-foreground">
                        {shownError.replace(/[.\s]+$/, '')}. Ниже — итоги, сохранённые раньше.
                      </span>
                      {canGenerate && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleRegenerate}
                          data-testid="summary-retry-btn"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Повторить
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="rounded-xl border bg-muted/40 p-3.5">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Общий вывод
                    </div>
                    <p className="text-sm leading-relaxed text-foreground">{summary.summary_text}</p>
                  </div>

                  {(summary.key_themes.length > 0 || summary.recommendations.length > 0) && (
                    <div
                      className={
                        summary.key_themes.length > 0 && summary.recommendations.length > 0
                          ? 'grid gap-4 md:grid-cols-2'
                          : 'grid grid-cols-1 gap-4'
                      }
                    >
                      {summary.key_themes.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <Tag className="h-3.5 w-3.5 text-primary" />
                            Ключевые темы
                          </div>
                          <ul className="divide-y divide-border/60 rounded-xl border bg-card/60">
                            {summary.key_themes.map((theme, idx) => (
                              <li
                                key={idx}
                                className="flex items-start gap-2.5 px-3 py-2 text-sm leading-snug text-foreground"
                              >
                                <span
                                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                                  aria-hidden="true"
                                />
                                <span>{theme}</span>
                                {/* «N-й спринт подряд» из theme_stats — только для серии длиннее одной доски */}
                                <ThemeStreakBadge summary={summary} theme={theme} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {summary.recommendations.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                            Рекомендации
                          </div>
                          <ol className="divide-y divide-border/60 rounded-xl border bg-card/60">
                            {summary.recommendations.map((rec, idx) => (
                              <li
                                key={idx}
                                className="flex items-start gap-2.5 px-3 py-2 text-sm leading-snug text-foreground"
                              >
                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                  {idx + 1}
                                </span>
                                <span>{rec}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="markdown" className="mt-0 flex h-full flex-col gap-3">
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy(slackText, 'Краткая сводка для Slack/Telegram скопирована')}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Скопировать пост для Slack
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy(fullMarkdown, 'Полный Markdown скопирован')}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  Скопировать Markdown
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => downloadMarkdownFile(`${board.slug || board.id}.md`, fullMarkdown)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Скачать .md
                </Button>
              </div>

              <pre className="min-h-0 flex-1 overflow-auto scrollbar-subtle whitespace-pre-wrap rounded-xl border bg-muted/45 p-3.5 font-mono text-xs leading-relaxed text-foreground">
                {fullMarkdown}
              </pre>
            </TabsContent>
          </DialogBody>
        </Tabs>

        <DialogFooter className="sm:justify-between">
          {/* Одно действие на состояние: без итогов — «Сгенерировать» в теле окна, с итогами —
              «Перегенерировать» здесь. На вкладке экспорта и без AI кнопки генерации нет. */}
          {summary && exportTab === 'summary' && aiEnabled !== false ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleRegenerate}
              disabled={busy || Boolean(aiBlockedReason)}
              title={aiBlockedReason ?? undefined}
              data-testid="regenerate-summary-btn"
            >
              <RefreshCw className={`h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
              Перегенерировать
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Готово
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
