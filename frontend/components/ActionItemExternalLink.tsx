'use client'

import { useState } from 'react'
import { ExternalLink, Link2, Loader2, Pencil, Trash2 } from 'lucide-react'
import { updateActionItem } from '@/api'
import { parseSafeExternalUrl } from '@/lib/urls'
import { showToast } from '@/store/toastStore'
import type { ActionItem } from '@/types'
import { getApiErrorMessage } from '@/utils/apiError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface ActionItemExternalLinkProps {
  item: ActionItem
  editDisabled?: boolean
  onUpdated: (item: ActionItem) => void
  /** На канбан-доске перетаскивание слушает pointerDown: тормозим всплытие, чтобы открывался клик. */
  stopPointerDown?: boolean
}

export default function ActionItemExternalLink({
  item,
  editDisabled = false,
  onUpdated,
  stopPointerDown = false,
}: ActionItemExternalLinkProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const safeLink = parseSafeExternalUrl(item.external_url)

  const openEditor = () => {
    setDraft(item.external_url || '')
    setError(null)
    setOpen(true)
  }

  const handleSave = async (nextRaw: string) => {
    const trimmed = nextRaw.trim()
    if (trimmed && !parseSafeExternalUrl(trimmed)) {
      setError('Укажите ссылку http:// или https:// с доменом')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updated = await updateActionItem(item.id, {
        external_url: trimmed || null,
      })
      onUpdated(updated)
      setOpen(false)
    } catch (err) {
      const msg = getApiErrorMessage(err, 'Не удалось сохранить ссылку')
      setError(msg)
      showToast(msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!safeLink && editDisabled) return null

  const stop = stopPointerDown ? (e: React.PointerEvent) => e.stopPropagation() : undefined

  return (
    <div className="inline-flex items-center gap-1" onPointerDown={stop}>
      {safeLink && (
        <a
          href={safeLink.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          data-testid="action-item-external-link"
          title={safeLink.href}
          className="inline-flex max-w-[175px] items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-500/15 dark:text-sky-300"
        >
          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{safeLink.label}</span>
        </a>
      )}

      {!editDisabled && (
        <Popover
          open={open}
          onOpenChange={(nextOpen) => {
            if (nextOpen) openEditor()
            else setOpen(false)
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={safeLink ? 'Изменить внешнюю ссылку' : 'Указать внешнюю ссылку'}
              title={safeLink ? 'Изменить внешнюю ссылку' : 'Ссылка в Jira / Tracker / GitHub'}
              data-testid={`action-item-link-btn-${item.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/80 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {safeLink ? <Pencil className="h-2.5 w-2.5" /> : <Link2 className="h-3 w-3" />}
              {!safeLink && <span>Ссылка</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-2 p-3">
            <div className="text-xs font-semibold">Внешняя задача</div>
            <Input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                if (error) setError(null)
              }}
              placeholder="https://tracker.company.ru/TASK-1"
              className="h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleSave(draft)
                }
              }}
            />
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              {item.external_url ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => void handleSave('')}
                  className="h-7 gap-1 px-2 text-[11px] text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                  Убрать
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => void handleSave(draft)}
                className="h-7 px-3 text-xs"
              >
                {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Сохранить
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
