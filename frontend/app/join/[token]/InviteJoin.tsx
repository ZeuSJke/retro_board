'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import { ArrowRight, Link2Off, Loader2, RefreshCw, Users, WifiOff } from 'lucide-react'
import { getInviteInfo, getWorkspaceInviteToken, joinByInvite } from '@/api/invite'
import { BrandMark } from '@/components/BrandLogo'
import { getUserAvatarGradient, getUserInitials } from '@/lib/board-themes'
import { useAppStore } from '@/store'
import { getApiErrorMessage, getApiErrorStatus, markApiErrorReported } from '@/utils/apiError'
import { inviteDestination, isInviteTokenShape } from '@/utils/inviteLinks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface InviteJoinProps {
  /** Токен приглашения из адреса `/join/<токен>`. */
  token: string
  /** Доска из параметра `?board=`; `null` — ссылка ведёт в команду, а не на доску. */
  boardRef: string | null
}

type Phase =
  | { kind: 'checking' }
  // switching — человек точно состоит в другой команде и по ссылке сменит её
  | { kind: 'form'; teamName: string; switching: boolean }
  | { kind: 'invalid' }
  | { kind: 'failed'; message: string }
  | { kind: 'entering' }

/** Имя по умолчанию в сторе до первого входа — в форму его не подставляем. */
const PLACEHOLDER_NAME = 'Аноним'

/**
 * Вход по ссылке-приглашению.
 *
 * Без сессии — название команды и одно поле «Ваше имя». Участник этой же команды сразу
 * попадает на доску. Участнику другой команды показываем, куда он перейдёт, и входим после
 * подтверждения имени. Недействительная ссылка — экран с переходом к входу по коду и ключу.
 */
export default function InviteJoin({ token, boardRef }: InviteJoinProps) {
  const router = useRouter()
  const hasHydrated = useAppStore((s) => s._hasHydrated ?? true)
  // Команда текущей сессии; без участника сессии нет
  const currentTeamName = useAppStore((s) => (s.participant ? s.workspace?.workspaceName : null) ?? null)
  const setSession = useAppStore((s) => s.setSession)

  const tokenLooksValid = isInviteTokenShape(token)
  const [phase, setPhase] = useState<Phase>(tokenLooksValid ? { kind: 'checking' } : { kind: 'invalid' })
  const [attempt, setAttempt] = useState(0)
  const destination = inviteDestination(boardRef)

  useEffect(() => {
    // Токен не по форме сервер всё равно отклонит — не спрашиваем
    if (!hasHydrated || !tokenLooksValid) return
    let cancelled = false

    void (async () => {
      const { workspace, participant } = useAppStore.getState()
      const signedIn = Boolean(workspace && participant)
      const [info, ownToken] = await Promise.all([
        getInviteInfo(token).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
        // Есть сессия — сверяем приглашение со своей командой. Сбой этой проверки входу
        // не мешает: покажем форму, как новому участнику (ответ 401 заодно сбросит сессию).
        signedIn
          ? getWorkspaceInviteToken().catch((error: unknown) => {
              markApiErrorReported(error)
              return null
            })
          : null,
      ])
      if (cancelled) return

      if (ownToken === token) {
        // Уже в этой команде: сразу на доску
        setPhase({ kind: 'entering' })
        return
      }
      if (info.ok) {
        setPhase({
          kind: 'form',
          teamName: info.value.workspaceName,
          switching: ownToken !== null,
        })
      } else if (getApiErrorStatus(info.error) === 404) {
        markApiErrorReported(info.error)
        setPhase({ kind: 'invalid' })
      } else {
        setPhase({
          kind: 'failed',
          message: getApiErrorMessage(
            info.error,
            'Сервер не ответил. Проверьте соединение и попробуйте ещё раз.',
          ),
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [hasHydrated, tokenLooksValid, token, attempt])

  // Сессия есть (была или только что создана) — уходим на доску
  const entering = phase.kind === 'entering'
  useEffect(() => {
    if (entering) router.replace(destination)
  }, [entering, router, destination])

  const handleJoin = async (name: string): Promise<string | null> => {
    try {
      const session = await joinByInvite({ invite_token: token, ...(name ? { name } : {}) })
      // Сначала убираем форму, потом записываем сессию: иначе форма на мгновение
      // показала бы новую команду как текущую
      flushSync(() => setPhase({ kind: 'entering' }))
      setSession(session)
      return null
    } catch (err: unknown) {
      if (getApiErrorStatus(err) === 404) {
        // Ссылку перевыпустили, пока форма была открыта
        markApiErrorReported(err)
        setPhase({ kind: 'invalid' })
        return null
      }
      return getApiErrorMessage(err, 'Не удалось войти. Попробуйте ещё раз.', {
        name: 'Имя',
      })
    }
  }

  if (phase.kind === 'checking' || phase.kind === 'entering') {
    return (
      <div
        role="status"
        className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">
          {phase.kind === 'checking' ? 'Проверяем приглашение…' : 'Открываем доску…'}
        </p>
      </div>
    )
  }

  if (phase.kind === 'invalid') {
    return (
      <StatusScreen
        icon={<Link2Off className="h-7 w-7" />}
        title="Ссылка-приглашение не работает"
        text="Её могли перевыпустить, или в адресе опечатка. Попросите у коллег новую ссылку."
      >
        {currentTeamName ? (
          <>
            <p className="text-sm text-muted-foreground">
              Вы уже вошли в команду «{currentTeamName}».
            </p>
            <Button asChild>
              <Link href="/">Открыть мои доски</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="max-w-sm text-sm text-muted-foreground">
              Если у вас есть код команды и ключ доступа, войдите по ним.
            </p>
            <Button asChild>
              <Link href="/" data-testid="join-fallback-login">
                Войти по коду и ключу
              </Link>
            </Button>
          </>
        )}
      </StatusScreen>
    )
  }

  if (phase.kind === 'failed') {
    return (
      <StatusScreen
        icon={<WifiOff className="h-7 w-7" />}
        title="Не удалось проверить приглашение"
        text={phase.message}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => {
              setPhase({ kind: 'checking' })
              setAttempt((n) => n + 1)
            }}
          >
            <RefreshCw />
            Повторить
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Войти по коду и ключу</Link>
          </Button>
        </div>
      </StatusScreen>
    )
  }

  return (
    <JoinForm
      teamName={phase.teamName}
      currentTeamName={currentTeamName}
      switching={phase.switching && currentTeamName !== null}
      toBoard={boardRef !== null}
      onJoin={handleJoin}
    />
  )
}

function StatusScreen({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode
  title: string
  text: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      </div>
      {children}
    </div>
  )
}

interface JoinFormProps {
  teamName: string
  /** Команда текущей сессии; `null` — сессии нет. */
  currentTeamName: string | null
  /** Сессия — в другой команде: вход по ссылке её заменит, об этом нужно сказать. */
  switching: boolean
  /** Ссылка ведёт на конкретную доску, а не просто в команду. */
  toBoard: boolean
  /** Войти; возвращает текст ошибки для формы или `null`, если форма больше не нужна. */
  onJoin: (name: string) => Promise<string | null>
}

function JoinForm({ teamName, currentTeamName, switching, toBoard, onJoin }: JoinFormProps) {
  // Форма появляется уже после чтения localStorage, поэтому имя можно взять сразу
  const [name, setName] = useState(() => {
    const saved = useAppStore.getState().username
    return saved && saved !== PLACEHOLDER_NAME ? saved : ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmedName = name.trim()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    const message = await onJoin(trimmedName)
    if (message !== null) {
      setError(message)
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background bg-dot-grid p-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,hsl(var(--primary)/0.14),transparent_55%)]"
      />

      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <Card className="w-full border-border/80 bg-background/95 shadow-2xl backdrop-blur-md">
          <CardHeader className="items-center space-y-3 pb-4 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 text-xs font-semibold text-foreground">
              <BrandMark size={20} />
              <span>RetroBoard</span>
            </div>

            <div
              className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br/srgb text-xl font-bold text-white shadow-lg transition-all ${
                trimmedName ? getUserAvatarGradient(trimmedName) : 'from-zinc-400 to-zinc-500'
              }`}
            >
              {trimmedName ? getUserInitials(trimmedName) : <Users className="h-7 w-7" />}
            </div>

            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Вас приглашают в команду</p>
              <h1
                className="wrap-break-word text-2xl font-bold leading-tight tracking-tight"
                data-testid="join-team-name"
              >
                {teamName}
              </h1>
              <p className="text-sm text-muted-foreground">
                {toBoard
                  ? 'Введите имя — и вы сразу окажетесь на доске.'
                  : 'Введите имя, чтобы открыть доски команды.'}
              </p>
            </div>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {switching && (
                <div
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
                  data-testid="join-switch-note"
                >
                  Сейчас вы в команде «{currentTeamName}». После входа по этой ссылке вы
                  перейдёте в команду «{teamName}».
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="join-name">
                  Ваше имя{' '}
                  <span className="font-normal text-muted-foreground">(необязательно)</span>
                </Label>
                <Input
                  id="join-name"
                  placeholder="Например: Аня"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  autoComplete="nickname"
                  autoFocus
                  aria-describedby="join-name-hint"
                  data-testid="join-name-input"
                />
                <p id="join-name-hint" className="text-xs text-muted-foreground">
                  Так вас увидят на доске. Без имени вы будете «Участник» — сменить его можно в
                  профиле.
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
                >
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full"
                size="lg"
                data-testid="join-submit-btn"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Входим…
                  </>
                ) : (
                  <>
                    {toBoard ? 'Войти на доску' : 'Войти в команду'}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-5 border-t pt-4 text-center text-xs text-muted-foreground">
              {currentTeamName ? (
                <Link href="/" className="font-medium text-primary hover:underline">
                  Остаться в команде «{currentTeamName}»
                </Link>
              ) : (
                <>
                  Есть код команды и ключ доступа?{' '}
                  <Link
                    href="/"
                    className="font-medium text-primary hover:underline"
                    data-testid="join-fallback-login"
                  >
                    Войти по ним
                  </Link>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
