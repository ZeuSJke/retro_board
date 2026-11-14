'use client'

import Link from 'next/link'
import { useTheme } from 'next-themes'
import {
  BarChart3,
  Check,
  Download,
  FileText,
  HeartPulse,
  Keyboard,
  Lock,
  Moon,
  PanelLeft,
  Printer,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react'
import { BrandMark } from '@/components/BrandLogo'
import { getUserAvatarGradient, getUserInitials } from '@/lib/board-themes'
import type { Board } from '@/types'
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
  username: string
  activeUsers: string[]
  readyUsers: string[]
  facilitator: string | null
  connected: boolean
  openActionItemsCount: number
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
  activeUsers,
  readyUsers,
  facilitator,
  connected,
  openActionItemsCount,
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

  const onlineList = activeUsers.length > 0 ? activeUsers : connected && username ? [username] : []

  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-2 sm:gap-3 border-b bg-background/85 px-2.5 sm:px-4 backdrop-blur-md">
      {/* Левый блок: Доски + Хлебные крошки */}
      <div className="flex items-center gap-2 min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onOpenBoardsDrawer}
              aria-label="Список досок"
              data-testid="boards-drawer-btn"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Список досок</TooltipContent>
        </Tooltip>

        <div className="flex items-center gap-2 min-w-0">
          <BrandMark size={32} />
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
              className="flex items-center gap-1.5 truncate rounded-lg px-2 py-1 text-sm font-semibold text-foreground hover:bg-muted/70 transition-colors"
            >
              {board.is_locked && (
                <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Заблокирована" />
              )}
              <span className="truncate max-w-[130px] sm:max-w-[240px] md:max-w-[280px]">{board.name}</span>
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

      {/* Правый блок: Участники, Настроение, Дашборд, Экспорт, Настройки */}
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
                {onlineList.slice(0, 4).map((u) => (
                  <span
                    key={u}
                    title={u}
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-gradient-to-br text-[10px] font-bold text-white ${getUserAvatarGradient(
                      u,
                    )}`}
                  >
                    {getUserInitials(u)}
                  </span>
                ))}
              </div>
              <span className="font-mono font-medium text-foreground">{onlineList.length}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 space-y-2 p-3">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                На доске ({onlineList.length})
              </span>
              <span>{connected ? 'Live' : 'Офлайн'}</span>
            </div>
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {onlineList.map((u) => {
                const isMe = u === username
                const isFac = u === facilitator
                const isReady = readyUsers.includes(u)
                return (
                  <div key={u} className="flex items-center justify-between gap-2 text-xs py-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white ${getUserAvatarGradient(
                          u,
                        )}`}
                      >
                        {getUserInitials(u)}
                      </span>
                      <span className="truncate font-medium">
                        {u} {isMe ? '(вы)' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isFac && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Ведущий</Badge>}
                      {isReady && (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
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
                className="h-8 gap-1.5 rounded-full px-2.5 text-xs"
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

        <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Link href="/dashboard" data-testid="dashboard-nav-link">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            <span className="hidden lg:inline">Панель управления</span>
            {openActionItemsCount > 0 && (
              <Badge variant="secondary" className="px-1.5 py-0 font-mono text-[10px]">
                {openActionItemsCount}
              </Badge>
            )}
          </Link>
        </Button>

        {board && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                data-testid="export-menu-btn"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Экспорт</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
              className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white shadow-sm ring-offset-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${getUserAvatarGradient(
                username,
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
