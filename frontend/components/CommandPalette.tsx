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

const COMMAND_ITEM_CLASS =
  'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-foreground outline-hidden transition-colors aria-selected:bg-accent aria-selected:text-accent-foreground'

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
      <DialogContent layout="structured" className="max-w-xl" hideClose>
        <Command className="flex min-w-0 flex-1 flex-col overflow-hidden bg-popover text-popover-foreground">
          <div className="flex shrink-0 items-center gap-2.5 border-b border-border/70 px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              placeholder="Найти доску или команду..."
              className="flex h-12 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
            <kbd className="hidden shrink-0 rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
              Esc
            </kbd>
          </div>
          <Command.List className="max-h-[min(56vh,420px)] overflow-y-auto scroll-py-2 p-2.5 scrollbar-subtle **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-wider **:[[cmdk-group-heading]]:text-muted-foreground/80 **:[[cmdk-group]]:px-1 **:[[cmdk-group]]:py-1">
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
              Ничего не найдено
            </Command.Empty>

            <Command.Group heading="Действия">
              <Command.Item
                value="create new board новая доска"
                onSelect={() => {
                  setOpen(false)
                  onCreateBoard()
                }}
                className={COMMAND_ITEM_CLASS}
              >
                <span className="flex items-center gap-2.5">
                  <Plus className="h-4 w-4 shrink-0 text-primary" />
                  <span>Создать новую доску</span>
                </span>
              </Command.Item>
              <Command.Item
                value="dashboard панель управления аналитика задачи action items"
                onSelect={() => {
                  setOpen(false)
                  onNavigateDashboard()
                }}
                className={COMMAND_ITEM_CLASS}
              >
                <span className="flex items-center gap-2.5">
                  <BarChart3 className="h-4 w-4 shrink-0 text-primary" />
                  <span>Панель управления и задачи</span>
                </span>
              </Command.Item>
              <Command.Item
                value="toggle theme переключить тему светлая тёмная"
                onSelect={() => {
                  setTheme(theme === 'dark' ? 'light' : 'dark')
                  setOpen(false)
                }}
                className={COMMAND_ITEM_CLASS}
              >
                <span className="flex items-center gap-2.5">
                  {theme === 'dark' ? (
                    <Sun className="h-4 w-4 shrink-0" />
                  ) : (
                    <Moon className="h-4 w-4 shrink-0" />
                  )}
                  <span>Переключить на {theme === 'dark' ? 'светлую' : 'тёмную'} тему</span>
                </span>
              </Command.Item>
            </Command.Group>

            {boardActions.length > 0 && (
              <>
                <Command.Separator className="mx-3 my-1.5 h-px bg-border/60" />
                <Command.Group heading="Команды доски">
                  {boardActions.map((act) => (
                    <Command.Item
                      key={act.id}
                      value={`${act.label} ${act.keywords || ''}`}
                      onSelect={() => {
                        setOpen(false)
                        act.onSelect()
                      }}
                      className={COMMAND_ITEM_CLASS}
                    >
                      <span className="flex min-w-0 items-center gap-2.5 truncate">
                        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">{act.label}</span>
                      </span>
                      {act.shortcut && (
                        <kbd className="shrink-0 rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {act.shortcut}
                        </kbd>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              </>
            )}

            {searchableCards.length > 0 && (
              <>
                <Command.Separator className="mx-3 my-1.5 h-px bg-border/60" />
                <Command.Group heading="Карточки доски">
                  {searchableCards.map((c) => (
                    <Command.Item
                      key={c.id}
                      value={`card ${c.text} ${c.columnTitle}`}
                      onSelect={() => {
                        setOpen(false)
                        c.onSelect()
                      }}
                      className={COMMAND_ITEM_CLASS}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-foreground">{c.text}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          · {c.columnTitle}
                        </span>
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
              </>
            )}

            {boards.length > 0 && (
              <>
                <Command.Separator className="mx-3 my-1.5 h-px bg-border/60" />
                <Command.Group heading="Доски">
                  {boards.map((board) => (
                    <Command.Item
                      key={board.id}
                      value={`${board.name} ${board.slug || ''}`}
                      onSelect={() => {
                        setOpen(false)
                        onSelectBoard(board)
                      }}
                      className={COMMAND_ITEM_CLASS}
                    >
                      <span className="flex min-w-0 items-center gap-2.5 truncate">
                        <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{board.name}</span>
                      </span>
                      {board.action_items_open > 0 && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {board.action_items_open} задач
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              </>
            )}
          </Command.List>
          <div className="flex shrink-0 items-center justify-between border-t border-border/70 bg-muted/25 px-4 py-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[10px]">
                  ↑↓
                </kbd>
                выбор
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[10px]">
                  ↵
                </kbd>
                открыть
              </span>
            </div>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[10px]">
                Esc
              </kbd>
              закрыть
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
