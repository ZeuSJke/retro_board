'use client'

import { useState } from 'react'
import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Hand,
  Palette,
  PanelRight,
  Plus,
  Search,
  User,
  X,
} from 'lucide-react'
import { CARD_COLOR_PRESETS, COLUMN_COLOR_PALETTE, getColumnColorName } from '@/lib/board-themes'
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
  colorFilter?: string | null
  onColorFilterChange?: (colorId: string | null) => void
  hasGroups?: boolean
  allGroupsCollapsed?: boolean
  onToggleCollapseAllGroups?: () => void
  searchInputRef?: React.RefObject<HTMLInputElement | null>
  readOnly?: boolean
  masterOpen: boolean
  onToggleMaster: () => void
  actionItemsCount: number
  onAddColumn: (title: string, color: string) => Promise<void>
  /** Форма новой колонки открыта извне — например, кнопкой на пустом холсте. */
  addColumnOpen?: boolean
  onAddColumnOpenChange?: (open: boolean) => void
  /**
   * Почему сейчас нельзя перетаскивать карточки (сортировка по голосам, фильтр, поиск);
   * `null` — можно. Показывается рядом с фильтрами, чтобы отключение не было молчаливым.
   */
  dragDisabledReason?: string | null
}

export default function BoardToolbar({
  searchQuery,
  onSearchChange,
  onlyMine,
  onOnlyMineChange,
  sortBy,
  onSortByChange,
  colorFilter = null,
  onColorFilterChange,
  hasGroups = false,
  allGroupsCollapsed = false,
  onToggleCollapseAllGroups,
  searchInputRef,
  readOnly = false,
  masterOpen,
  onToggleMaster,
  actionItemsCount,
  onAddColumn,
  addColumnOpen,
  onAddColumnOpenChange,
  dragDisabledReason = null,
}: BoardToolbarProps) {
  const [internalColPopoverOpen, setInternalColPopoverOpen] = useState(false)
  const colPopoverOpen = addColumnOpen ?? internalColPopoverOpen
  const setColPopoverOpen = onAddColumnOpenChange ?? setInternalColPopoverOpen
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
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-background/70 px-3 py-2 backdrop-blur-xs md:px-4">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-none">
        <div className="relative min-w-[140px] flex-1 sm:w-56 sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            data-board-search-input="true"
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
          className="h-8 gap-1.5 text-xs transition-transform active:scale-95"
          onClick={() => onOnlyMineChange(!onlyMine)}
        >
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Только мои</span>
          <span className="sm:hidden">Мои</span>
        </Button>

        <Button
          type="button"
          variant={sortBy === 'votes' ? 'default' : 'outline'}
          size="sm"
          className="h-8 gap-1.5 text-xs transition-transform active:scale-95"
          onClick={() => onSortByChange(sortBy === 'order' ? 'votes' : 'order')}
        >
          {sortBy === 'votes' ? (
            <ArrowDownWideNarrow className="h-3.5 w-3.5" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5" />
          )}
          <span className="max-sm:sr-only">{sortBy === 'votes' ? 'По голосам' : 'По порядку'}</span>
        </Button>

        {onColorFilterChange && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant={colorFilter ? 'secondary' : 'outline'}
                size="sm"
                className="h-8 gap-1.5 text-xs transition-transform active:scale-95"
                title="Фильтр по цвету карточек"
              >
                {colorFilter ? (
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-border"
                    style={{
                      backgroundColor:
                        CARD_COLOR_PRESETS.find((c) => c.id === colorFilter)?.accentDot ||
                        'transparent',
                    }}
                  />
                ) : (
                  <Palette className="h-3.5 w-3.5" />
                )}
                <span className="hidden md:inline">Цвет</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
              <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
                Фильтр по цвету
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onColorFilterChange(null)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs transition-colors',
                    !colorFilter
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  Все
                </button>
                {CARD_COLOR_PRESETS.map((c) => {
                  const active = colorFilter === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      title={c.name}
                      aria-label={`Фильтр по цвету: ${c.name}`}
                      onClick={() => onColorFilterChange(active ? null : c.id)}
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full border transition-transform hover:scale-110',
                        c.swatchClass,
                        active && 'ring-2 ring-primary ring-offset-2',
                      )}
                    >
                      {c.id !== 'default' && (
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: c.accentDot }}
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {hasGroups && onToggleCollapseAllGroups && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs transition-transform active:scale-95"
            onClick={onToggleCollapseAllGroups}
            title={allGroupsCollapsed ? 'Развернуть все группы' : 'Свернуть все группы'}
          >
            {allGroupsCollapsed ? (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            )}
            <span className="hidden lg:inline">
              {allGroupsCollapsed ? 'Развернуть группы' : 'Свернуть группы'}
            </span>
          </Button>
        )}

        {dragDisabledReason && (
          <span
            role="status"
            data-testid="drag-disabled-hint"
            title={`${dragDisabledReason}: порядок на экране не совпадает с порядком карточек на доске`}
            className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border border-dashed border-border px-2 text-[11px] text-muted-foreground"
          >
            <Hand className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{dragDisabledReason}</span>
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!readOnly && (
          <Popover open={colPopoverOpen} onOpenChange={setColPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs transition-transform active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Колонка</span>
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
                <div className="flex items-center gap-1.5" role="group" aria-label="Цвет колонки">
                  {COLUMN_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColColor(c)}
                      title={getColumnColorName(c)}
                      aria-label={`Цвет колонки: ${getColumnColorName(c)}`}
                      aria-pressed={colColor === c}
                      className={cn(
                        'h-5 w-5 rounded-full transition-transform hover:scale-110 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
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
          <span>Задачи</span>
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
