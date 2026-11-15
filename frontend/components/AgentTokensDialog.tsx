'use client'

import { useEffect, useState } from 'react'
import { Bot, Check, Copy, KeyRound, Loader2, Plus, RefreshCw, ShieldAlert } from 'lucide-react'
import CopyLinkField from '@/components/CopyLinkField'
import { useOpeningCount } from '@/lib/use-opening-count'
import { cn } from '@/lib/utils'
import { showToast } from '@/store/toastStore'
import type { AgentToken, AgentTokenCreated, AgentTokenScope } from '@/types'
import { getApiErrorMessage } from '@/utils/apiError'
import { copyText } from '@/utils/clipboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface AgentTokensAdapter {
  list: () => Promise<AgentToken[]>
  create: (payload: { name: string; scope: AgentTokenScope }) => Promise<AgentTokenCreated>
  revoke: (tokenId: string) => Promise<AgentToken>
}

interface AgentTokensDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamLabel?: string | null
  subtitle?: string
  adapter: AgentTokensAdapter | null
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildMcpSnippet(origin: string, secret: string): string {
  const endpoint = `${origin || 'https://retro.example.ru'}/mcp`
  return JSON.stringify(
    {
      mcpServers: {
        retroboard: {
          type: 'http',
          url: endpoint,
          headers: {
            Authorization: `Bearer ${secret}`,
          },
        },
      },
    },
    null,
    2,
  )
}

export default function AgentTokensDialog({
  open,
  onOpenChange,
  teamLabel,
  subtitle = 'Настройки команды',
  adapter,
}: AgentTokensDialogProps) {
  const opening = useOpeningCount(open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {opening > 0 && adapter && (
        <AgentTokensContent
          key={`${teamLabel || 'team'}:${opening}`}
          teamLabel={teamLabel}
          subtitle={subtitle}
          adapter={adapter}
        />
      )}
    </Dialog>
  )
}

function AgentTokensContent({
  teamLabel,
  subtitle,
  adapter,
}: {
  teamLabel?: string | null
  subtitle: string
  adapter: AgentTokensAdapter
}) {
  const [tokens, setTokens] = useState<AgentToken[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const [name, setName] = useState('')
  const [scope, setScope] = useState<AgentTokenScope>('read_only')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [justCreated, setJustCreated] = useState<AgentTokenCreated | null>(null)
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const mcpEndpoint = origin ? `${origin}/mcp` : '/mcp'

  useEffect(() => {
    let cancelled = false
    adapter
      .list()
      .then((list) => {
        if (!cancelled) {
          setTokens(list)
          setLoadError(null)
          setRefreshing(false)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(getApiErrorMessage(err, 'Не удалось загрузить токены агентов'))
        setRefreshing(false)
      })
    return () => {
      cancelled = true
    }
  }, [adapter, reloadKey])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setCreateError('Укажите имя агента')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const created = await adapter.create({ name: trimmed, scope })
      setJustCreated(created)
      setSnippetCopied(false)
      setTokens((prev) => [created.token, ...(prev ?? [])])
      setName('')
      showToast(`Токен для «${created.token.name}» выпущен`, 'success')
    } catch (err) {
      setCreateError(getApiErrorMessage(err, 'Не удалось выпустить токен'))
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (tokenId: string) => {
    setRevokingId(tokenId)
    try {
      const updated = await adapter.revoke(tokenId)
      setTokens((prev) => (prev ?? []).map((t) => (t.id === tokenId ? updated : t)))
      setConfirmRevokeId(null)
      setJustCreated((prev) => (prev?.token.id === tokenId ? null : prev))
      showToast('Токен отозван и сразу перестал работать', 'success')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось отозвать токен'), 'error')
    } finally {
      setRevokingId(null)
    }
  }

  const handleCopySnippet = async () => {
    if (!justCreated) return
    const snippet = buildMcpSnippet(origin, justCreated.secret)
    const ok = await copyText(snippet)
    if (!ok) {
      showToast('Не удалось скопировать JSON-конфигурацию', 'error')
      return
    }
    setSnippetCopied(true)
    showToast('Конфигурация MCP скопирована', 'success')
  }

  const handleReload = () => {
    setRefreshing(true)
    setLoadError(null)
    setReloadKey((n) => n + 1)
  }

  return (
    <DialogContent layout="structured" className="sm:max-w-2xl" data-testid="agent-tokens-dialog">
      <DialogHeader>
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Bot className="h-3.5 w-3.5 text-primary" />
          <span>{subtitle}</span>
          {teamLabel && (
            <>
              <span>·</span>
              <span className="truncate font-semibold text-foreground/85">{teamLabel}</span>
            </>
          )}
        </div>
        <DialogTitle className="text-lg">Токены агентов (MCP)</DialogTitle>
        <DialogDescription>
          Подключайте ИИ-агентов (Claude Code, Cursor, Codex) к доскам команды по протоколу Streamable HTTP.
          Токены не зависят от смены ключа команды и отзываются здесь по одному.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        <CopyLinkField
          id="mcp-endpoint-url"
          label="Адрес MCP-сервера команды"
          value={mcpEndpoint}
          copyLabel="Скопировать адрес MCP"
          testId="mcp-endpoint-input"
        />

        {/* Форма выпуска нового токена */}
        <form onSubmit={handleCreate} className="space-y-3 rounded-xl border bg-muted/25 p-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="agent-token-name" className="block text-xs">
              Имя агента
            </Label>
            <Input
              id="agent-token-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (createError) setCreateError(null)
              }}
              placeholder="Например, Sprint Bot"
              maxLength={60}
              data-testid="agent-token-name-input"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <Label id="agent-token-scope-label" className="block text-xs">
                Права доступа
              </Label>
              <div
                role="radiogroup"
                aria-labelledby="agent-token-scope-label"
                className="inline-flex h-9 rounded-md border bg-background p-0.5"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === 'read_only'}
                  onClick={() => setScope('read_only')}
                  className={cn(
                    'rounded-sm px-3 text-xs font-medium transition-colors',
                    scope === 'read_only'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Чтение
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === 'read_write'}
                  onClick={() => setScope('read_write')}
                  className={cn(
                    'rounded-sm px-3 text-xs font-medium transition-colors',
                    scope === 'read_write'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Чтение и запись
                </button>
              </div>
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={creating}
              className="h-9 w-full gap-1.5 px-4 text-xs sm:ml-auto sm:w-auto"
              data-testid="agent-token-create-btn"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Выпустить
            </Button>
          </div>
          {createError && (
            <p role="alert" className="text-xs text-destructive">
              {createError}
            </p>
          )}
          <p className="text-[11px] leading-snug text-muted-foreground">
            Чтение — только просмотр досок, карточек и задач. Чтение и запись — создание и изменение.
          </p>
        </form>

        {/* Одноразовый показ секрета после выпуска */}
        {justCreated && (
          <div
            data-testid="agent-token-secret-banner"
            className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>Сохраните секрет сейчас — повторно он показан не будет</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => setJustCreated(null)}
              >
                Скрыть
              </Button>
            </div>

            <CopyLinkField
              id="agent-token-secret-once"
              label={`Bearer-токен для «${justCreated.token.name}»`}
              value={justCreated.secret}
              copyLabel="Скопировать секрет токена"
              testId="agent-token-secret-input"
            />

            <div className="flex flex-col gap-2 pt-0.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[11px] text-muted-foreground">
                Готовый фрагмент для `.mcp.json` / Cursor
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 w-full gap-1.5 text-xs sm:w-auto"
                onClick={() => void handleCopySnippet()}
              >
                {snippetCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                {snippetCopied ? 'Скопировано' : 'Скопировать конфиг MCP'}
              </Button>
            </div>
          </div>
        )}

        {/* Список выпущенных токенов */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
            <span>Выпущенные токены {tokens ? `(${tokens.length})` : ''}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReload}
              disabled={refreshing || tokens === null}
              className="h-7 gap-1 px-2 text-[11px]"
              aria-label="Обновить список токенов"
              title="Обновить список токенов"
              data-testid="agent-tokens-refresh-btn"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              <span className="hidden sm:inline">Обновить</span>
            </Button>
          </div>

          {loadError && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-5 text-center text-xs text-muted-foreground">
              <p className="text-destructive">{loadError}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={handleReload}
              >
                <RefreshCw className="h-3 w-3" />
                Повторить
              </Button>
            </div>
          )}
          {tokens === null ? (
            !loadError && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Загружаем токены...
              </div>
            )
          ) : tokens.length === 0 ? (
            !loadError && (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-6 text-center text-xs text-muted-foreground">
                <KeyRound className="mb-1.5 h-5 w-5 opacity-45" />
                Пока нет ни одного токена агента.
              </div>
            )
          ) : (
            <div className="space-y-2" data-testid="agent-tokens-list">
              {tokens.map((tok) => {
                const revoked = Boolean(tok.revoked_at)
                const confirming = confirmRevokeId === tok.id
                return (
                  <div
                    key={tok.id}
                    data-testid={`agent-token-row-${tok.id}`}
                    className={cn(
                      'flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between',
                      revoked && 'opacity-65',
                    )}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{tok.name}</span>
                        <Badge variant={tok.scope === 'read_write' ? 'warning' : 'secondary'} className="text-[10px]">
                          {tok.scope === 'read_write' ? 'Чтение и запись' : 'Только чтение'}
                        </Badge>
                        {revoked && (
                          <Badge variant="outline" className="border-destructive/40 text-[10px] text-destructive">
                            Отозван
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <code
                          className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]"
                          title={tok.token_prefix}
                        >
                          {tok.token_prefix}…
                        </code>
                        <span>Создан: {formatDate(tok.created_at)}</span>
                        <span>
                          Последнее использование: {tok.last_used_at ? formatDate(tok.last_used_at) : 'не было'}
                        </span>
                      </div>
                    </div>

                    {!revoked && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {confirming ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={revokingId === tok.id}
                              onClick={() => void handleRevoke(tok.id)}
                              className="h-7 px-2.5 text-xs"
                              data-testid={`agent-token-confirm-revoke-${tok.id}`}
                            >
                              {revokingId === tok.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                              Подтвердить
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={revokingId === tok.id}
                              onClick={() => setConfirmRevokeId(null)}
                              className="h-7 px-2 text-xs"
                            >
                              Отмена
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmRevokeId(tok.id)}
                            className="h-7 px-2.5 text-xs text-destructive hover:text-destructive"
                            data-testid={`agent-token-revoke-${tok.id}`}
                          >
                            Отозвать
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogBody>
    </DialogContent>
  )
}
