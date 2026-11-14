'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, Dices, Eye, EyeOff } from 'lucide-react'
import { showToast } from '@/store/toastStore'
import { generateAccessKey } from '@/utils/accessKey'
import { copyText } from '@/utils/clipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AccessKeyFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Пояснение под полем: что будет с ключом после сохранения. */
  hint?: ReactNode
  autoFocus?: boolean
  disabled?: boolean
}

/** Сколько кнопка показывает «Скопировано», мс. */
const COPIED_FEEDBACK_MS = 1800

/**
 * Поле ключа доступа команды: показать или скрыть, сгенерировать надёжный ключ, скопировать.
 * Ключ на сервере хранится хешем — увидеть и скопировать его можно только здесь, до сохранения.
 */
export default function AccessKeyField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  autoFocus,
  disabled,
}: AccessKeyFieldProps) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  const handleGenerate = () => {
    onChange(generateAccessKey())
    // Сгенерированный ключ нужно увидеть, чтобы сохранить
    setVisible(true)
    setCopied(false)
  }

  const handleCopy = async () => {
    if (!value) return
    // Из поля-пароля браузер копировать не даёт, поэтому поле сюда не передаём
    if (!(await copyText(value))) {
      setVisible(true)
      showToast('Не удалось скопировать — выделите ключ и скопируйте вручную', 'error')
      return
    }
    setCopied(true)
    window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setCopied(false)
          }}
          placeholder={placeholder}
          // Иначе браузер подставит сюда сохранённый пароль администратора
          autoComplete="new-password"
          autoFocus={autoFocus}
          disabled={disabled}
          spellCheck={false}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={`pr-9 ${visible ? 'font-mono text-xs' : ''}`}
          data-testid="access-key-input"
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? 'Скрыть ключ' : 'Показать ключ'}
          aria-pressed={visible}
          className="absolute right-2.5 top-2 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={disabled}
          data-testid="access-key-generate"
        >
          <Dices />
          Сгенерировать
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopy}
          disabled={disabled || !value}
          aria-label="Скопировать ключ доступа"
          data-testid="access-key-copy"
        >
          {copied ? <Check className="text-emerald-600 dark:text-emerald-400" /> : <Copy />}
          <span aria-live="polite">{copied ? 'Скопировано' : 'Скопировать'}</span>
        </Button>
      </div>

      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
