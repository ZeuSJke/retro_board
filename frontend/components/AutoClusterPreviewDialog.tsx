'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Layers, Sparkles, X } from 'lucide-react'
import type { AutoClusterPreviewResult, Card } from '../types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface EditableCluster {
  title: string
  cardIds: string[]
  included: boolean
}

interface AutoClusterPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  columnTitle: string
  preview: AutoClusterPreviewResult | null
  cards: Card[]
  applying?: boolean
  onApply: (groups: { title: string; card_ids: string[] }[]) => Promise<void>
}

export default function AutoClusterPreviewDialog({
  open,
  onOpenChange,
  columnTitle,
  preview,
  cards,
  applying = false,
  onApply,
}: AutoClusterPreviewDialogProps) {
  const [clusters, setClusters] = useState<EditableCluster[]>([])

  useEffect(() => {
    if (!preview) {
      setClusters([])
      return
    }
    setClusters(
      preview.groups.map((g) => ({
        title: g.title,
        cardIds: [...g.card_ids],
        included: true,
      })),
    )
  }, [preview])

  const cardMap = useMemo(() => {
    const map = new Map<string, Card>()
    cards.forEach((c) => map.set(c.id, c))
    return map
  }, [cards])

  const validGroups = useMemo(
    () =>
      clusters
        .filter((c) => c.included && c.cardIds.length >= 2)
        .map((c) => ({ title: c.title.trim() || 'Группа', card_ids: c.cardIds })),
    [clusters],
  )

  const handleToggleCluster = (idx: number) => {
    setClusters((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, included: !item.included } : item)),
    )
  }

  const handleTitleChange = (idx: number, title: string) => {
    setClusters((prev) => prev.map((item, i) => (i === idx ? { ...item, title } : item)))
  }

  const handleRemoveCard = (idx: number, cardId: string) => {
    setClusters((prev) =>
      prev.map((item, i) =>
        i === idx ? { ...item, cardIds: item.cardIds.filter((id) => id !== cardId) } : item,
      ),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Предпросмотр AI-кластеризации
          </DialogTitle>
          <DialogDescription>
            Колонка «{columnTitle}». Отредактируйте названия, снимите галочки с лишних групп или уберите карточки перед применением.
          </DialogDescription>
        </DialogHeader>

        {clusters.length === 0 ? (
          <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
            AI не нашёл близких по смыслу групп карточек для объединения.
          </div>
        ) : (
          <ScrollArea className="max-h-[55vh] pr-2">
            <div className="space-y-3">
              {clusters.map((cluster, idx) => {
                const tooSmall = cluster.cardIds.length < 2
                return (
                  <div
                    key={idx}
                    className={cn(
                      'rounded-xl border p-3 transition-colors',
                      cluster.included && !tooSmall
                        ? 'border-primary/30 bg-primary/[0.03]'
                        : 'border-border/70 bg-muted/30 opacity-75',
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Checkbox
                        checked={cluster.included && !tooSmall}
                        disabled={tooSmall}
                        onCheckedChange={() => handleToggleCluster(idx)}
                        aria-label={`Включить группу ${cluster.title}`}
                      />
                      <Layers className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <Input
                        value={cluster.title}
                        onChange={(e) => handleTitleChange(idx, e.target.value)}
                        className="h-8 flex-1 text-sm font-medium"
                        maxLength={200}
                      />
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {cluster.cardIds.length} карт.
                      </span>
                    </div>

                    {tooSmall && (
                      <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">
                        Для группы нужно минимум 2 карточки — этот кластер будет пропущен.
                      </p>
                    )}

                    <ul className="space-y-1.5 pl-6">
                      {cluster.cardIds.map((cid) => {
                        const card = cardMap.get(cid)
                        return (
                          <li
                            key={cid}
                            className="flex items-start justify-between gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs"
                          >
                            <span className="line-clamp-2 leading-snug text-foreground">
                              {card ? card.text : cid}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveCard(idx, cid)}
                              className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Исключить карточку из группы"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Отмена
          </Button>
          <Button
            onClick={() => onApply(validGroups)}
            disabled={applying || validGroups.length === 0}
            className="gap-1.5"
          >
            <Check className="h-4 w-4" />
            {applying ? 'Применяем...' : `Создать групп: ${validGroups.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
