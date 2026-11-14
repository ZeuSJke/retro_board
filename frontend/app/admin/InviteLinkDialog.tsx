'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { getAdminWorkspaceInvite, rotateAdminWorkspaceInvite } from '@/api/admin'
import CopyLinkField from '@/components/CopyLinkField'
import { useOpeningCount } from '@/lib/use-opening-count'
import { showToast } from '@/store/toastStore'
import { getApiErrorMessage } from '@/utils/apiError'
import { buildInviteLink } from '@/utils/inviteLinks'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface InviteTeam {
  id: string
  name: string
}

interface InviteLinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Команда, чьё приглашение показываем; между открытиями остаётся прежней. */
  team: InviteTeam | null
}

type InviteState =
  | { status: 'loading' }
  | { status: 'ready'; token: string }
  | { status: 'error'; message: string }

/** Ссылка-приглашение команды в админке: показать, скопировать, перевыпустить. */
export default function InviteLinkDialog({ open, onOpenChange, team }: InviteLinkDialogProps) {
  const opening = useOpeningCount(open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {opening > 0 && team && <InviteLinkContent key={`${team.id}:${opening}`} team={team} />}
    </Dialog>
  )
}

function InviteLinkContent({ team }: { team: InviteTeam }) {
  const [invite, setInvite] = useState<InviteState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [rotateError, setRotateError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getAdminWorkspaceInvite(team.id)
      .then((token) => {
        if (!cancelled) setInvite({ status: 'ready', token })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setInvite({
          status: 'error',
          message: getApiErrorMessage(err, 'Не удалось получить ссылку. Попробуйте ещё раз.'),
        })
      })
    return () => {
      cancelled = true
    }
  }, [team.id, attempt])

  const retry = () => {
    setInvite({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  const handleRotate = async () => {
    setRotating(true)
    setRotateError(null)
    try {
      const token = await rotateAdminWorkspaceInvite(team.id)
      setInvite({ status: 'ready', token })
      setConfirming(false)
      showToast('Ссылка перевыпущена — прежняя больше не работает', 'success')
    } catch (err) {
      setRotateError(getApiErrorMessage(err, 'Не удалось перевыпустить ссылку'))
    } finally {
      setRotating(false)
    }
  }

  const link =
    invite.status === 'ready' ? buildInviteLink(window.location.origin, invite.token) : ''

  return (
    <DialogContent className="max-w-md" data-testid="admin-invite-dialog">
      <DialogHeader>
        <DialogTitle className="pr-8 leading-tight">Приглашение в команду «{team.name}»</DialogTitle>
        <DialogDescription>
          По ссылке в команду входят, введя только имя, — без кода и ключа доступа.
        </DialogDescription>
      </DialogHeader>

      {invite.status === 'error' ? (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive"
        >
          <p>{invite.message}</p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            <RefreshCw />
            Повторить
          </Button>
        </div>
      ) : (
        <>
          <CopyLinkField
            id="admin-invite-link"
            label="Ссылка-приглашение"
            value={link}
            hint="Отправьте её коллегам. Доступ в команду получит любой, у кого есть ссылка."
            copyLabel="Скопировать ссылку-приглашение"
            testId="admin-invite-link"
          />

          <div className="space-y-2 border-t pt-4">
            {confirming ? (
              <div
                className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3"
                data-testid="admin-invite-rotate-confirm"
              >
                <p className="flex gap-2 text-sm text-foreground">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    Прежняя ссылка перестанет работать: по ней больше никто не войдёт. Те, кто уже
                    вошёл, останутся в команде.
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleRotate}
                    disabled={rotating}
                    data-testid="admin-invite-rotate-confirm-btn"
                  >
                    {rotating && <Loader2 className="animate-spin" />}
                    Перевыпустить
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirming(false)
                      setRotateError(null)
                    }}
                    disabled={rotating}
                  >
                    Отмена
                  </Button>
                </div>
                {rotateError && (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {rotateError}
                  </p>
                )}
              </div>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirming(true)}
                  disabled={invite.status !== 'ready'}
                  data-testid="admin-invite-rotate-btn"
                >
                  <RefreshCw />
                  Перевыпустить ссылку
                </Button>
                <p className="text-xs text-muted-foreground">
                  Если ссылка попала не тем людям, выпустите новую — прежняя перестанет работать.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </DialogContent>
  )
}
