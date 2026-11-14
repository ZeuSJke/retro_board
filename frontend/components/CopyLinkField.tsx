'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { showToast } from '@/store/toastStore'
import { copyText } from '@/utils/clipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface CopyLinkFieldProps {
  id: string
  label: string
  /** Ссылка; пустая строка — ещё загружается. */
  value: string
  hint?: ReactNode
  /** Подпись кнопки для экранных дикторов: какую именно ссылку она копирует. */
  copyLabel: string
  testId?: string
}

/** Сколько кнопка показывает «Скопировано», мс. */
const COPIED_FEEDBACK_MS = 1800

/** Поле со ссылкой, которую нельзя править, и кнопкой «Скопировать». */
export default function CopyLinkField({ id, label, value, hint, copyLabel, testId }: CopyLinkFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const resetTimer = useRef<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  const handleCopy = async () => {
    if (!value) return
    const ok = await copyText(value, inputRef.current)
    if (!ok) {
      // Ссылка осталась выделенной в поле — её можно скопировать вручную
      inputRef.current?.select()
      showToast('Не удалось скопировать — выделите ссылку и скопируйте вручную', 'error')
      return
    }
    setCopied(true)
    window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {/* На телефоне кнопка уходит под поле: рядом с ней от ссылки оставалось бы несколько букв */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id={id}
          ref={inputRef}
          readOnly
          value={value}
          placeholder="Загружаем ссылку…"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 font-mono text-xs sm:flex-1"
          data-testid={testId}
        />
        <Button
          type="button"
          variant="outline"
          onClick={handleCopy}
          disabled={!value}
          aria-label={copyLabel}
          className="shrink-0"
          data-testid={testId ? `${testId}-copy` : undefined}
        >
          {copied ? <Check className="text-emerald-600 dark:text-emerald-400" /> : <Copy />}
          <span aria-live="polite">{copied ? 'Скопировано' : 'Скопировать'}</span>
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
