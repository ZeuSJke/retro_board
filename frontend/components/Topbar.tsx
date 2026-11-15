'use client'

import Link from 'next/link'
import { useTheme } from 'next-themes'
import {
  BarChart3,
  Check,
  Crown,
  Download,
  FileText,
  HeartPulse,
  Keyboard,
  Lock,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Printer,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react'
import { BrandMark } from '@/components/BrandLogo'
import { ShareBoardButton, ShareBoardMenuItem } from '@/components/ShareBoardDialog'
import { getUserAvatarGradient, getUserInitials } from '@/lib/board-themes'
import { avatarSeed } from '@/lib/participants'
import type { Board, Participant } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface TopbarProps {
  board: Board | null
  workspaceName: string
  /** Имя текущего участника (подпись). */
  username: string
  /** Идентификатор текущего участника: по нему определяется «вы» в списке. */
  myId: string
  /** Участники, подключённые к доске. Тёзки — разные записи с разными `id`. */
  participants: Participant[]
  /** Идентификаторы участников, отметивших готовность. */
  readyIds: string[]
  /** Идентификатор участника-ведущего. */
  facilitatorId: string | null
  /** Передать роль ведущего участнику; задаётся, только когда ведущий — текущий участник. */
  onTransferFacilitator?: (participantId: string) => void
  connected: boolean
  /**
   * Не используется. Раньше число открытых задач этой доски стояло на кнопке «Панель
   * управления», которая ведёт к задачам всей команды; счётчик задач доски показывает кнопка
   * «Задачи» в панели инструментов. Поле оставлено, чтобы не менять вызов в `BoardPage`.
   */
  openActionItemsCount?: number
  onOpenBoardsDrawer: () => void
  onOpenCommandPalette?: () => void
  onOpenBoardSettings: () => void
  onOpenUserSettings: () => void
  onOpenShortcuts?: () => void
  onOpenMood: () => void
  onOpenSummary: () => void
  onExportMarkdown: () => void
  onExportPDF: () => void
}

export default function Topbar({
  board,
  workspaceName,
  username,
  myId,
  participants,
  readyIds,
  facilitatorId,
  onTransferFacilitator,
  connected,
  onOpenBoardsDrawer,
  onOpenCommandPalette,
  onOpenBoardSettings,
  onOpenUserSettings,
  onOpenShortcuts,
  onOpenMood,
  onOpenSummary,
  onExportMarkdown,
  onExportPDF,
}: TopbarProps) {
  const { theme, setTheme } = useTheme()

  const moodAvg =
    board?.moods && board.moods.length > 0
      ? (board.moods.reduce((s, m) => s + m.score, 0) / board.moods.length).toFixed(1)
      : null

  // Пока сервер не прислал состав доски, показываем хотя бы себя
  const onlineList: Participant[] =
    participants.length > 0
      ? participants
      : connected && myId
        ? [{ id: myId, name: username }]
        : []

  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-2 sm:gap-3 border-b bg-background/85 px-2.5 sm:px-4 backdrop-blur-md">
      {/* Левый блок: доски и название. На телефоне он занимает всё, что оставил правый блок */}
      <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onOpenBoardsDrawer}
              aria-label="Список досок"
              className="shrink-0"
              data-testid="boards-drawer-btn"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Список досок</TooltipContent>
        </Tooltip>

        <div className="flex min-w-0 items-center gap-2">
          {/* На телефоне место логотипа нужнее названию доски */}
          <BrandMark size={32} className="hidden sm:block" />
          <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
            <span className="truncate max-w-[130px] font-medium text-foreground/80">
              {workspaceName}
            </span>
            <span>/</span>
          </div>
          {board ? (
            <button
              type="button"
              onClick={onOpenBoardsDrawer}
              title={board.name}
              data-testid="topbar-board-name"
              className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-foreground hover:bg-muted/70 transition-colors"
            >
              {board.is_locked && (
                <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Заблокирована" />
              )}
              <span className="truncate sm:max-w-[240px] md:max-w-[280px]">{board.name}</span>
            </button>
          ) : (
            <span className="text-sm font-semibold">RetroBoard</span>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenCommandPalette}
          data-testid="command-palette-trigger"
          title="Быстрый поиск и команды (Ctrl+K)"
          className="hidden sm:inline-flex items-center gap-1.5 rounded-md border bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <Search className="h-3 w-3" />
          <span className="hidden md:inline">Поиск</span>
          <kbd className="font-mono text-[10px] opacity-80">Ctrl K</kbd>
        </button>
      </div>

      {/* Правый блок: участники, настроение, панель управления, экспорт, настройки.
          На телефоне остаются участники, меню и профиль — остальное переезжает в меню. */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Присутствие */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full border bg-background px-2 py-1 text-xs hover:bg-muted/60 transition-colors"
              aria-label="Онлайн участники"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  connected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                }`}
                title={connected ? 'Подключено (Live)' : 'Переподключение...'}
              />
              <div className="hidden sm:flex -space-x-1.5">
                {onlineList.slice(0, 4).map((p) => (
                  <span
                    key={p.id}
                    title={p.name}
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-linear-to-br/srgb text-[10px] font-bold text-white ${getUserAvatarGradient(
                      avatarSeed(p.id, p.name),
                    )}`}
                  >
                    {getUserInitials(p.name)}
                  </span>
                ))}
              </div>
              <span className="font-mono font-medium text-foreground">{onlineList.length}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 max-w-[calc(100vw-1.5rem)] space-y-2 p-3">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                На доске ({onlineList.length})
              </span>
              <span>{connected ? 'Live' : 'Офлайн'}</span>
            </div>
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {onlineList.map((p) => {
                const isMe = p.id === myId
                const isFac = Boolean(facilitatorId) && p.id === facilitatorId
                const isReady = readyIds.includes(p.id)
                return (
                  <div
                    key={p.id}
                    data-testid="presence-row"
                    className="flex items-center justify-between gap-2 text-xs py-1"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-linear-to-br/srgb text-[10px] font-bold text-white ${getUserAvatarGradient(
                          avatarSeed(p.id, p.name),
                        )}`}
                      >
                        {getUserInitials(p.name)}
                      </span>
                      <span className="truncate font-medium">
                        {p.name} {isMe ? '(вы)' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isFac && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Ведущий</Badge>}
                      {isReady && (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                      {onTransferFacilitator && !isMe && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 px-1.5 text-[11px]"
                          title={`Передать роль ведущего участнику ${p.name}`}
                          onClick={() => onTransferFacilitator(p.id)}
                          data-testid="transfer-facilitator-btn"
                        >
                          <Crown className="h-3 w-3 text-amber-500" />
                          Передать роль
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {onTransferFacilitator && onlineList.length < 2 && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Роль ведущего можно передать участнику, который сейчас на доске.
              </p>
            )}
          </PopoverContent>
        </Popover>

        {board && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenMood}
                className="hidden h-8 gap-1.5 rounded-full px-2.5 text-xs sm:inline-flex"
                data-testid="mood-checkin-btn"
              >
                <HeartPulse className="h-3.5 w-3.5 text-rose-500" />
                <span className="hidden md:inline">Настроение</span>
                {moodAvg && <span className="font-mono font-semibold">{moodAvg}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Чек-ин настроения команды</TooltipContent>
          </Tooltip>
        )}

        {/* Кнопка ведёт к задачам и отчётам всей команды, поэтому счётчика задач этой доски на ней нет */}
        <Button
          asChild
          variant="outline"
          size="sm"
          className="hidden h-8 gap-1.5 text-xs sm:inline-flex"
        >
          <Link
            href="/dashboard"
            title="Панель управления: задачи и отчёты всей команды"
            data-testid="dashboard-nav-link"
          >
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            <span className="hidden lg:inline">Панель управления</span>
          </Link>
        </Button>

        {board && <ShareBoardButton board={board} />}

        {board && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs sm:px-3"
                title="Экспорт и меню доски"
                data-testid="export-menu-btn"
              >
                {/* На телефоне это общее меню доски: в нём всё, что не поместилось в шапку */}
                <MoreHorizontal className="h-4 w-4 sm:hidden" />
                <Download className="hidden h-3.5 w-3.5 sm:block" />
                <span className="hidden md:inline">Экспорт</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="sm:hidden"
                onClick={onOpenMood}
                data-testid="menu-mood-item"
              >
                <HeartPulse className="h-4 w-4 text-rose-500" />
                Настроение команды
                {moodAvg && <span className="ml-auto font-mono text-xs">{moodAvg}</span>}
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="sm:hidden">
                <Link href="/dashboard" data-testid="menu-dashboard-item">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Панель управления
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="sm:hidden" />
              <ShareBoardMenuItem />
              <DropdownMenuItem onClick={onOpenSummary}>
                <Sparkles className="h-4 w-4 text-primary" />
                Итоги ретро и AI
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onExportMarkdown}>
                <FileText className="h-4 w-4" />
                Скачать Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExportPDF}>
                <Printer className="h-4 w-4" />
                Печать / Сохранить PDF
              </DropdownMenuItem>
              <DropdownMenuSeparator className="sm:hidden" />
              <DropdownMenuItem
                className="sm:hidden"
                onClick={onOpenBoardSettings}
                data-testid="menu-board-settings-item"
              >
                <Settings className="h-4 w-4" />
                Настройки доски
              </DropdownMenuItem>
              <DropdownMenuItem
                className="sm:hidden"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                data-testid="menu-theme-item"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {board && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onOpenBoardSettings}
                aria-label="Настройки доски"
                className="hidden sm:inline-flex"
                data-testid="board-settings-btn"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Настройки доски</TooltipContent>
          </Tooltip>
        )}

        {onOpenShortcuts && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onOpenShortcuts}
                aria-label="Горячие клавиши"
                className="hidden sm:inline-flex"
                data-testid="shortcuts-btn"
              >
                <Keyboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Горячие клавиши (?)</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Переключить тему"
              className="hidden sm:inline-flex"
              data-testid="theme-toggle-btn"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Сменить тему</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpenUserSettings}
              aria-label="Профиль и настройки"
              data-testid="user-settings-btn"
              className={`flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br/srgb text-xs font-bold text-white shadow-xs ring-offset-background transition-transform hover:scale-105 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${getUserAvatarGradient(
                avatarSeed(myId, username),
              )}`}
            >
              {getUserInitials(username)}
            </button>
          </TooltipTrigger>
          <TooltipContent>{username}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
