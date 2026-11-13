'use client'

import { useMemo, useState } from 'react'
import { BarChart3, Lock, Plus, Search, Sparkles } from 'lucide-react'
import type { BoardListItem } from '@/types'
import { BrandMark } from '@/components/BrandLogo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface BoardsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  boards: BoardListItem[]
  currentBoardId: string | null
  onSelectBoard: (board: BoardListItem) => void
  onOpenCreateBoard: () => void
  onNavigateDashboard: () => void
}

export default function BoardsPanel({
  open,
  onOpenChange,
  boards,
  currentBoardId,
  onSelectBoard,
  onOpenCreateBoard,
  onNavigateDashboard,
}: BoardsPanelProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return boards
    return boards.filter((b) => b.name.toLowerCase().includes(q))
  }, [boards, query])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex flex-col p-0 sm:max-w-sm">
        <SheetHeader className="border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <BrandMark size={24} />
            <SheetTitle>Доски команды</SheetTitle>
          </div>
          <SheetDescription>Переключайтесь между спринтами или создайте новый</SheetDescription>
        </SheetHeader>

        <div className="space-y-3 border-b p-4">
          <Button
            className="w-full"
            onClick={() => {
              onOpenChange(false)
              onOpenCreateBoard()
            }}
            data-testid="sidebar-new-board-btn"
          >
            <Plus className="h-4 w-4" />
            Новая доска
          </Button>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск досок..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 px-3 py-2">
          <div className="space-y-1.5">
            {filtered.map((b) => {
              const active = b.id === currentBoardId
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    onSelectBoard(b)
                    onOpenChange(false)
                  }}
                  className={`flex w-full flex-col gap-1.5 rounded-xl border p-3 text-left transition-all ${
                    active
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-transparent hover:border-border hover:bg-muted/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                      {b.is_locked && <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                      <span className="truncate">{b.name}</span>
                    </span>
                    {b.has_summary && (
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {new Date(b.created_at).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                    {typeof b.cards_count === 'number' && <span>• {b.cards_count} карт.</span>}
                    {b.action_items_open > 0 && (
                      <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                        {b.action_items_open} открыт.
                      </Badge>
                    )}
                    {b.mood_avg != null && (
                      <span className="font-mono">• {b.mood_avg.toFixed(1)}/5</span>
                    )}
                  </div>
                </button>
              )
            })}

            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">Доски не найдены</p>
            )}
          </div>
        </ScrollArea>

        <div className="border-t p-3">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => {
              onOpenChange(false)
              onNavigateDashboard()
            }}
          >
            <BarChart3 className="h-4 w-4 text-primary" />
            Панель управления и отчёты
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
