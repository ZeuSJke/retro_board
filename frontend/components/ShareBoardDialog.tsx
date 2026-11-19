'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Maximize2, RefreshCw, Share2 } from 'lucide-react'
import { getWorkspaceInviteToken } from '@/api/invite'
import { useOpeningCount } from '@/lib/use-opening-count'
import { useAppStore } from '@/store'
import { useUiStore } from '@/store/uiStore'
import type { Board } from '@/types'
import { getApiErrorMessage } from '@/utils/apiError'
import { buildInviteLink } from '@/utils/inviteLinks'
import CopyLinkField from '@/components/CopyLinkField'
import QrCode from '@/components/QrCode'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Что нужно знать о доске, чтобы ею поделиться. */
export type ShareableBoard = Pick<Board, 'id' | 'name' | 'slug'>

interface ShareBoardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  board: ShareableBoard
}

type InviteState =
  | { status: 'loading' }
  | { status: 'ready'; token: string }
  | { status: 'error'; message: string }

/**
 * «Поделиться доской»: ссылка на доску, приглашение в команду и QR-код ссылки на доску.
 *
 * Обе ссылки содержат токен приглашения команды (`GET /api/workspaces/invite`): человеку
 * без сессии остаётся ввести имя. Токен запрашивается при каждом открытии — администратор
 * мог перевыпустить приглашение.
 */
export default function ShareBoardDialog({ open, onOpenChange, board }: ShareBoardDialogProps) {
  // Каждое открытие — заново: чистое состояние и свежий токен
  const opening = useOpeningCount(open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {opening > 0 && <ShareBoardContent key={opening} board={board} />}
    </Dialog>
  )
}

function ShareBoardContent({ board }: { board: ShareableBoard }) {
  const workspaceName = useAppStore((s) => s.workspace?.workspaceName)
  const [invite, setInvite] = useState<InviteState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // Крупный код на весь диалог — показать на общем экране или проекторе
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getWorkspaceInviteToken()
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
  }, [attempt])

  const retry = () => {
    setInvite({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  const token = invite.status === 'ready' ? invite.token : null
  const origin = window.location.origin
  // Адрес доски не меняется при переименовании, поэтому ссылку можно хранить и пересылать
  const boardLink = token ? buildInviteLink(origin, token, board.slug || board.id) : ''
  const teamLink = token ? buildInviteLink(origin, token) : ''
  const qrLabel = `QR-код ссылки на доску «${board.name}»`

  if (zoomed) {
    return (
      <DialogContent className="max-w-[min(94vw,72vh)]" data-testid="share-board-dialog">
        <DialogHeader>
          <DialogTitle className="truncate pr-8 leading-tight">{board.name}</DialogTitle>
          <DialogDescription>
            Наведите камеру телефона на код — откроется эта доска.
          </DialogDescription>
        </DialogHeader>
        <QrCode value={boardLink} label={qrLabel} className="w-full" />
        <Button type="button" variant="outline" onClick={() => setZoomed(false)}>
          <ArrowLeft />
          К ссылкам
        </Button>
      </DialogContent>
    )
  }

  return (
    <DialogContent className="max-w-md" data-testid="share-board-dialog">
      <DialogHeader>
        <DialogTitle>Поделиться доской</DialogTitle>
        <DialogDescription>
          Отправьте ссылку или покажите QR-код: коллеге останется ввести имя.
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
          <div className="flex flex-col items-center gap-1.5">
            <QrCode value={boardLink} label={qrLabel} className="w-44 sm:w-56" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setZoomed(true)}
              disabled={!boardLink}
              data-testid="share-qr-zoom"
            >
              <Maximize2 />
              Показать крупно
            </Button>
          </div>

          <CopyLinkField
            id="share-board-link"
            label="Ссылка на эту доску"
            value={boardLink}
            hint={`Ведёт прямо на доску «${board.name}».`}
            copyLabel="Скопировать ссылку на доску"
            testId="share-board-link"
          />
          <CopyLinkField
            id="share-team-link"
            label="Приглашение в команду"
            value={teamLink}
            hint={
              workspaceName
                ? `Открывает доски команды «${workspaceName}».`
                : 'Открывает доски команды.'
            }
            copyLabel="Скопировать приглашение в команду"
            testId="share-team-link"
          />

          <p className="text-xs text-muted-foreground">
            По этим ссылкам в команду войдёт любой, у кого они есть. Закрыть доступ может
            администратор: перевыпустить приглашение.
          </p>
        </>
      )}
    </DialogContent>
  )
}

// ── Кнопка в шапке доски ─────────────────────────────────────────────────────

/** Открыть «Поделиться» из любого места доски. Сам диалог рисует `ShareBoardButton`. */
export function openShareBoardDialog(): void {
  useUiStore.getState().setShareDialogOpen(true)
}

/**
 * Кнопка «Поделиться» для шапки доски вместе с диалогом.
 *
 * Шапка тесная: до 1280 px кнопка отнимала бы место у названия доски, поэтому она скрыта,
 * а диалог открывает `ShareBoardMenuItem` из меню шапки. От 1280 px — значок, от 1400 px —
 * значок с подписью.
 */
export function ShareBoardButton({ board }: { board: ShareableBoard }) {
  const open = useUiStore((s) => s.shareDialogOpen)
  const setOpen = useUiStore((s) => s.setShareDialogOpen)

  // Шапка исчезла (выход, смена сессии) — диалог не должен всплыть при следующем показе
  useEffect(() => () => useUiStore.getState().setShareDialogOpen(false), [])

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            aria-label="Поделиться доской"
            className="hidden h-8 gap-1.5 text-xs xl:inline-flex"
            data-testid="share-board-btn"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden min-[1400px]:inline">Поделиться</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ссылка на доску и QR-код</TooltipContent>
      </Tooltip>
      <ShareBoardDialog open={open} onOpenChange={setOpen} board={board} />
    </>
  )
}

/** Пункт «Поделиться доской» для выпадающего меню шапки: виден там, где кнопка скрыта. */
export function ShareBoardMenuItem() {
  return (
    <>
      <DropdownMenuItem
        className="xl:hidden"
        onClick={openShareBoardDialog}
        data-testid="share-board-menu-item"
      >
        <Share2 className="h-4 w-4 text-primary" />
        Поделиться доской
      </DropdownMenuItem>
      <DropdownMenuSeparator className="xl:hidden" />
    </>
  )
}
