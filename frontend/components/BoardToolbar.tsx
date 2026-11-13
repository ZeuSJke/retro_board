'use client'

import { useState } from 'react'
import { ArrowDownWideNarrow, ArrowUpDown, PanelRight, Plus, Search, User, X } from 'lucide-react'
import { COLUMN_COLOR_PALETTE } from '@/lib/board-themes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface BoardToolbarProps {
  searchQuery: string
  onSearchChange: (q: string) => void
  onlyMine: boolean
  onOnlyMineChange: (v: boolean) => void
  sortBy: 'order' | 'votes'
  onSortByChange: (s: 'order' | 'votes') => void
  readOnly?: boolean
  masterOpen: boolean
  onToggleMaster: () => void
  actionItemsCount: number
  onAddColumn: (title: string, color: string) => Promise<void>
}

export default function BoardToolbar({
  searchQuery,
  onSearchChange,
  onlyMine,
  onOnlyMineChange,
  sortBy,
  onSortByChange,
  readOnly = false,
  masterOpen,
  onToggleMaster,
  actionItemsCount,
  onAddColumn,
}: BoardToolbarProps) {
  const [colPopoverOpen, setColPopoverOpen] = useState(false)
  const [colTitle, setColTitle] = useState('')
  const [colColor, setColColor] = useState(COLUMN_COLOR_PALETTE[0])
  const [creatingCol, setCreatingCol] = useState(false)

  const handleCreateColumn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!colTitle.trim() || creatingCol) return
    setCreatingCol(true)
    try {
      await onAddColumn(colTitle.trim(), colColor)
      setColTitle('')
      setColPopoverOpen(false)
    } finally {
      setCreatingCol(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-background/70 px-3 py-2 backdrop-blur-sm md:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-44 sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск карточек..."
            className="h-8 pl-8 pr-7 text-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              aria-label="Сбросить поиск"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Button
          type="button"
          variant={onlyMine ? 'default' : 'outline'}
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => onOnlyMineChange(!onlyMine)}
        >
          <User className="h-3.5 w-3.5" />
          Только мои
        </Button>

        <Button
          type="button"
          variant={sortBy === 'votes' ? 'default' : 'outline'}
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => onSortByChange(sortBy === 'order' ? 'votes' : 'order')}
        >
          {sortBy === 'votes' ? (
            <ArrowDownWideNarrow className="h-3.5 w-3.5" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5" />
          )}
          {sortBy === 'votes' ? 'По голосам' : 'По порядку'}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {!readOnly && (
          <Popover open={colPopoverOpen} onOpenChange={setColPopoverOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Plus className="h-3.5 w-3.5" />
                Колонка
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <form onSubmit={handleCreateColumn} className="space-y-3">
                <div className="text-xs font-semibold">Новая колонка</div>
                <Input
                  value={colTitle}
                  onChange={(e) => setColTitle(e.target.value)}
                  placeholder="Например: Благодарности"
                  autoFocus
                  className="h-8 text-xs"
                />
                <div className="flex items-center gap-1.5">
                  {COLUMN_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColColor(c)}
                      className={cn(
                        'h-5 w-5 rounded-full transition-transform hover:scale-110',
                        colColor === c && 'ring-2 ring-primary ring-offset-2',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 w-full text-xs"
                  disabled={!colTitle.trim() || creatingCol}
                >
                  Добавить колонку
                </Button>
              </form>
            </PopoverContent>
          </Popover>
        )}

        <Button
          type="button"
          variant={masterOpen ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={onToggleMaster}
        >
          <PanelRight className="h-3.5 w-3.5" />
          <span>Итоги</span>
          {actionItemsCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              {actionItemsCount}
            </Badge>
          )}
        </Button>
      </div>
    </div>
  )
}
