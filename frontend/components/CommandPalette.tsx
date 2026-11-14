'use client'

import { useCallback, useEffect, useState } from 'react'
import { Command } from 'cmdk'
import {
  BarChart3,
  LayoutGrid,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  ThumbsUp,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import type { BoardListItem } from '@/types'
import { Dialog, DialogContent } from '@/components/ui/dialog'

export interface CommandBoardAction {
  id: string
  label: string
  keywords?: string
  shortcut?: string
  onSelect: () => void
}

export interface CommandSearchCard {
  id: string
  text: string
  columnTitle: string
  likesCount: number
  onSelect: () => void
}

interface CommandPaletteProps {
  boards: BoardListItem[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelectBoard: (board: BoardListItem) => void
  onCreateBoard: () => void
  onNavigateDashboard: () => void
  boardActions?: CommandBoardAction[]
  searchableCards?: CommandSearchCard[]
}

export default function CommandPalette({
  boards,
  open: controlledOpen,
  onOpenChange,
  onSelectBoard,
  onCreateBoard,
  onNavigateDashboard,
  boardActions = [],
  searchableCards = [],
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next)
      else setInternalOpen(next)
    },
    [onOpenChange],
  )
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg overflow-hidden p-0" hideClose>
        <Command className="bg-popover text-popover-foreground">
          <div className="flex items-center border-b px-3.5">
            <Search className="mr-2.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              placeholder="Найти доску или команду..."
              className="flex h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              Ничего не найдено
            </Command.Empty>

            <Command.Group heading="Действия" className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
              <Command.Item
                value="create new board новая доска"
                onSelect={() => {
                  setOpen(false)
                  onCreateBoard()
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground aria-selected:bg-accent"
              >
                <Plus className="h-4 w-4 text-primary" />
                Создать новую доску
              </Command.Item>
              <Command.Item
                value="dashboard панель управления аналитика задачи action items"
                onSelect={() => {
                  setOpen(false)
                  onNavigateDashboard()
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground aria-selected:bg-accent"
              >
                <BarChart3 className="h-4 w-4 text-primary" />
                Панель управления и задачи
              </Command.Item>
              <Command.Item
                value="toggle theme переключить тему светлая тёмная"
                onSelect={() => {
                  setTheme(theme === 'dark' ? 'light' : 'dark')
                  setOpen(false)
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground aria-selected:bg-accent"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                Переключить на {theme === 'dark' ? 'светлую' : 'тёмную'} тему
              </Command.Item>
            </Command.Group>

            {boardActions.length > 0 && (
              <Command.Group heading="Команды доски" className="mt-1 px-1.5 py-1 text-xs font-medium text-muted-foreground">
                {boardActions.map((act) => (
                  <Command.Item
                    key={act.id}
                    value={`${act.label} ${act.keywords || ''}`}
                    onSelect={() => {
                      setOpen(false)
                      act.onSelect()
                    }}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground aria-selected:bg-accent"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate">{act.label}</span>
                    </span>
                    {act.shortcut && (
                      <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {act.shortcut}
                      </kbd>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {searchableCards.length > 0 && (
              <Command.Group heading="Карточки доски" className="mt-1 px-1.5 py-1 text-xs font-medium text-muted-foreground">
                {searchableCards.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`card ${c.text} ${c.columnTitle}`}
                    onSelect={() => {
                      setOpen(false)
                      c.onSelect()
                    }}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground aria-selected:bg-accent"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-foreground">{c.text}</span>
                      <span className="ml-2 text-xs text-muted-foreground">· {c.columnTitle}</span>
                    </span>
                    {c.likesCount > 0 && (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
                        <ThumbsUp className="h-3 w-3" />
                        {c.likesCount}
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {boards.length > 0 && (
              <Command.Group heading="Доски" className="mt-1 px-1.5 py-1 text-xs font-medium text-muted-foreground">
                {boards.map((board) => (
                  <Command.Item
                    key={board.id}
                    value={`${board.name} ${board.slug || ''}`}
                    onSelect={() => {
                      setOpen(false)
                      onSelectBoard(board)
                    }}
                    className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-sm text-foreground aria-selected:bg-accent"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{board.name}</span>
                    </span>
                    {board.action_items_open > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {board.action_items_open} задач
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
