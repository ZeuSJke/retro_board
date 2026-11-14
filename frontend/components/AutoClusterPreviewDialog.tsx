'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Layers, Sparkles, X } from 'lucide-react'
import type { AutoClusterPreviewResult, Card } from '../types'
import { RichCardText } from './RichCardText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
      <DialogContent layout="structured" className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Предпросмотр AI-кластеризации
          </DialogTitle>
          <DialogDescription>
            Колонка «{columnTitle}». Отредактируйте названия, снимите галочки с лишних групп или
            уберите карточки перед применением.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3 bg-muted/15">
          {clusters.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-background/60 py-10 text-center text-sm text-muted-foreground">
              AI не нашёл близких по смыслу групп карточек для объединения.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
                <span>Найдено кластеров: {clusters.length}</span>
                <span className="tabular-nums">Будет создано: {validGroups.length}</span>
              </div>

              <div className="space-y-3">
                {clusters.map((cluster, idx) => {
                  const tooSmall = cluster.cardIds.length < 2
                  const isActive = cluster.included && !tooSmall
                  return (
                    <div
                      key={idx}
                      className={cn(
                        'rounded-xl border bg-card p-3.5 transition-all',
                        isActive
                          ? 'border-primary/35 ring-1 ring-primary/10'
                          : 'border-border/70 bg-muted/40 opacity-70',
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          checked={isActive}
                          disabled={tooSmall}
                          onCheckedChange={() => handleToggleCluster(idx)}
                          aria-label={`Включить группу ${cluster.title}`}
                        />
                        <Layers className="h-4 w-4 shrink-0 text-primary" />
                        <Input
                          value={cluster.title}
                          onChange={(e) => handleTitleChange(idx, e.target.value)}
                          className="h-8 flex-1 bg-background/80 text-sm font-medium"
                          maxLength={200}
                        />
                        <Badge variant="secondary" className="shrink-0 tabular-nums font-normal">
                          {cluster.cardIds.length} карт.
                        </Badge>
                      </div>

                      {tooSmall && (
                        <p className="mt-2 pl-7 text-[11px] text-amber-600 dark:text-amber-400">
                          Для группы нужно минимум 2 карточки — этот кластер будет пропущен.
                        </p>
                      )}

                      <ul className="mt-2.5 space-y-1.5 pl-7">
                        {cluster.cardIds.map((cid) => {
                          const card = cardMap.get(cid)
                          return (
                            <li
                              key={cid}
                              className="flex items-start justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs"
                            >
                              <span className="wrap-break-word leading-relaxed text-foreground">
                                {card ? <RichCardText text={card.text} /> : cid}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveCard(idx, cid)}
                                className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                title="Исключить карточку из группы"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </DialogBody>

        <DialogFooter>
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
