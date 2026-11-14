'use client'

import { useMemo, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
  Tag,
} from 'lucide-react'
import { regenerateBoardSummary } from '@/api'
import { downloadMarkdownFile, formatBoardMarkdown } from '@/lib/export-markdown'
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

interface SummaryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  board: Board
  actionItems: ActionItem[]
  summary: BoardSummary | null
  loading: boolean
  error: string | null
  onSummaryUpdated: (summary: BoardSummary) => void
}

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
  const [regenerating, setRegenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exportTab, setExportTab] = useState<'summary' | 'markdown'>('summary')

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
    if (actionItems.length > 0) {
      lines.push('', `*Задачи по итогам (${actionItems.length}):*`)
      actionItems.forEach((a) => {
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
    if (regenerating) return
    setRegenerating(true)
    try {
      const fresh = await regenerateBoardSummary(board.id)
      onSummaryUpdated(fresh)
      showToast('Итоги обновлены', 'success')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось перегенерировать итоги'), 'error')
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="structured" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Итоги ретроспективы
          </DialogTitle>
          <DialogDescription>{board.name}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={exportTab}
          onValueChange={(v) => setExportTab(v as 'summary' | 'markdown')}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 border-b border-border/60 bg-muted/20 px-6 py-2.5">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="summary">AI-резюме и темы</TabsTrigger>
              <TabsTrigger value="markdown">Markdown и Slack</TabsTrigger>
            </TabsList>
          </div>

          {/* Фиксированная высота тела исключает скачки модалки и кнопок футера при смене вкладки */}
          <DialogBody className="h-[420px] flex-none">
            <TabsContent value="summary" className="mt-0 space-y-4">
              {(loading || regenerating) && (
                <div className="flex h-[340px] flex-col items-center justify-center gap-3 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">Анализируем карточки и формируем выводы...</p>
                </div>
              )}

              {!loading && !regenerating && error && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                  {error}
                </div>
              )}

              {!loading && !regenerating && !error && !summary && (
                <div className="flex h-[340px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 text-center">
                  <p className="max-w-md text-sm text-muted-foreground">
                    AI-резюме для этой доски ещё не создано. Переведите сессию на этап «Итоги» или
                    сгенерируйте его вручную.
                  </p>
                  <Button variant="outline" size="sm" onClick={handleRegenerate}>
                    <Sparkles className="h-4 w-4 text-primary" />
                    Сгенерировать AI-резюме
                  </Button>
                </div>
              )}

              {!loading && !regenerating && summary && (
                <div className="space-y-4">
                  <div className="rounded-xl border bg-muted/40 p-4">
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Общий вывод
                    </div>
                    <p className="text-sm leading-relaxed text-foreground">{summary.summary_text}</p>
                  </div>

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
                            className="flex items-start gap-2.5 px-3.5 py-2.5 text-sm leading-relaxed text-foreground"
                          >
                            <span
                              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                              aria-hidden="true"
                            />
                            <span>{theme}</span>
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
                            className="flex items-start gap-3 px-3.5 py-2.5 text-sm leading-relaxed text-foreground"
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
          <Button
            type="button"
            variant="outline"
            onClick={handleRegenerate}
            disabled={regenerating}
          >
            <RefreshCw className={`h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
            Перегенерировать
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Готово
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
