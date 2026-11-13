'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Layers, Sparkles } from 'lucide-react'
import {
  createActionItem,
  createColumn,
  generateActionItemTitle,
  getBoardSummary,
  updateActionItem,
} from '../api'
import { useAppStore } from '../store'
import { showToast } from '../store/toastStore'
import { useBoardDragDrop } from '../hooks/useBoardDragDrop'
import { useBoardWebSocket } from '../hooks/useBoardWebSocket'
import { useFacilitator } from '../hooks/useFacilitator'
import { useTimer } from '../hooks/useTimer'
import { downloadMarkdownFile, formatBoardMarkdown } from '@/lib/export-markdown'
import { getCardColorPreset } from '@/lib/board-themes'
import { exportBoardToPDF } from '../utils/exportPDF'
import { getApiErrorMessage } from '../utils/apiError'
import type {
  ActionItem,
  Board,
  BoardListItem,
  BoardMood,
  BoardSummary,
  Card,
  CardGroup,
  Column as ColumnType,
  WsBoardUpdatedData,
  WsMessage,
} from '../types'
import BoardSettingsDialog from './BoardSettingsDialog'
import BoardToolbar from './BoardToolbar'
import BoardsPanel from './BoardsPanel'
import Column from './Column'
import CommandPalette from './CommandPalette'
import CursorMarker from './CursorMarker'
import MasterColumn from './MasterColumn'
import MoodDialog from './MoodDialog'
import SessionBar from './SessionBar'
import SpotlightModal from './SpotlightModal'
import SummaryModal from './SummaryModal'
import Topbar from './Topbar'
import UserSettingsDialog from './UserSettingsDialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface BoardPageProps {
  board: Board
  boards: BoardListItem[]
  workspaceName: string
  onBoardUpdated: (board: Board) => void
  onBoardDeleted: (boardId: string) => void
  onSelectBoard: (board: BoardListItem) => void
  onOpenCreateBoard: () => void
  onBoardsListCreated: (board: BoardListItem) => void
  onBoardsListUpdated: (data: WsBoardUpdatedData) => void
  onBoardsListDeleted: (boardId: string) => void
}

function triggerConfetti() {
  if (typeof window === 'undefined') return
  import('canvas-confetti')
    .then((mod) => {
      mod.default?.({
        particleCount: 70,
        spread: 65,
        origin: { y: 0.65 },
      })
    })
    .catch(() => {})
}

export default function BoardPage({
  board,
  boards,
  workspaceName,
  onBoardUpdated,
  onBoardDeleted,
  onSelectBoard,
  onOpenCreateBoard,
  onBoardsListCreated,
  onBoardsListUpdated,
  onBoardsListDeleted,
}: BoardPageProps) {
  const router = useRouter()
  const username = useAppStore((s) => s.username)
  const dotGrid = useAppStore((s) => s.dotGrid)

  const [boardsPanelOpen, setBoardsPanelOpen] = useState(false)
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false)
  const [userSettingsOpen, setUserSettingsOpen] = useState(false)
  const [moodOpen, setMoodOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [masterOpen, setMasterOpen] = useState(true)
  const [mobileMasterOpen, setMobileMasterOpen] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [sortBy, setSortBy] = useState<'order' | 'votes'>('order')

  const [moods, setMoods] = useState<BoardMood[]>(board.moods || [])
  const [summary, setSummary] = useState<BoardSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const cursorNodeTick = useState(0)
  const forceCursorRender = cursorNodeTick[1]

  const sendMessageRef = useRef<(msg: WsMessage) => void>(() => {})
  const sendWs = useCallback((msg: WsMessage) => {
    sendMessageRef.current(msg)
  }, [])

  const {
    timer,
    autoAdvance,
    setAutoAdvance,
    soundMuted,
    toggleSoundMuted,
    restoreTimer,
    handleTimerWsEvent,
    handleTimerStart,
    handleTimerPause,
    handleTimerReset,
    handleAddTime,
  } = useTimer(board.id, sendWs)

  const {
    facilitator,
    phase,
    handleFacilitatorStart,
    handleFacilitatorStop,
    handlePhaseChange,
    handleNextPhase,
    handleFacilitatorChanged,
    handlePhaseChanged,
  } = useFacilitator(sendWs, timer.duration, handleTimerReset)

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    setSummaryError(null)
    try {
      const data = await getBoardSummary(board.id)
      setSummary(data)
    } catch (err) {
      setSummaryError(getApiErrorMessage(err, 'Не удалось загрузить AI-итоги'))
    } finally {
      setSummaryLoading(false)
    }
  }, [board.id])

  const handleSummaryGenerated = useCallback(() => {
    setSummaryOpen(true)
    loadSummary()
    triggerConfetti()
  }, [loadSummary])

  const handleSummaryFailed = useCallback((msg?: string) => {
    setSummaryLoading(false)
    setSummaryError(msg || 'Ошибка генерации AI-итогов')
    showToast(msg || 'Не удалось сгенерировать AI-итоги', 'error')
  }, [])

  const boardRef = useRef(board)
  boardRef.current = board

  const handleWsBoardUpdated = useCallback(
    (data: WsBoardUpdatedData) => {
      onBoardsListUpdated(data)
      const current = boardRef.current
      if (data.id === current.id) {
        onBoardUpdated({
          ...current,
          name: data.name ?? current.name,
          slug: data.slug ?? current.slug,
          max_votes: data.max_votes ?? current.max_votes,
          template: data.template ?? current.template,
          is_locked: data.is_locked ?? current.is_locked,
          hide_cards_until_reveal:
            data.hide_cards_until_reveal ?? current.hide_cards_until_reveal,
          anonymous_votes: data.anonymous_votes ?? current.anonymous_votes,
        })
      }
    },
    [onBoardUpdated, onBoardsListUpdated],
  )

  const handleWsMoodUpdated = useCallback((mood: BoardMood) => {
    setMoods((prev) => {
      const exists = prev.some((m) => m.author === mood.author)
      return exists
        ? prev.map((m) => (m.author === mood.author ? mood : m))
        : [...prev, mood]
    })
  }, [])

  const {
    columns,
    setColumns,
    cursorsRef,
    subscribeCursors,
    collapsedGroups,
    activeUsers,
    readyUsers,
    spotlightCardId,
    reactions,
    sessionSynced,
    connected,
    actionItems,
    setActionItems,
    sendMessage,
    handleMouseMove,
    handleMouseLeave,
  } = useBoardWebSocket({
    boardId: board.id,
    onTimerWsEvent: handleTimerWsEvent,
    onFacilitatorChanged: handleFacilitatorChanged,
    onPhaseChanged: handlePhaseChanged,
    onSummaryGenerated: handleSummaryGenerated,
    onSummaryFailed: handleSummaryFailed,
    onBoardCreated: onBoardsListCreated,
    onBoardUpdated: handleWsBoardUpdated,
    onBoardDeleted: onBoardsListDeleted,
    onMoodUpdated: handleWsMoodUpdated,
  })

  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

  const loadedBoardIdRef = useRef<string | null>(null)
  useEffect(() => {
    const initialBoard = boardRef.current
    const boardChanged = loadedBoardIdRef.current !== board.id
    loadedBoardIdRef.current = board.id
    if (!boardChanged) return

    setColumns(initialBoard.columns || [])
    setMoods(initialBoard.moods || [])
    setSummary(null)
    setSummaryError(null)
    restoreTimer(board.id)
    handleFacilitatorChanged(
      initialBoard.active_facilitator ?? null,
      initialBoard.active_phase ?? null,
    )
    if (initialBoard.has_summary) {
      getBoardSummary(board.id)
        .then((s) => s && setSummary(s))
        .catch(() => {})
    }
  }, [board.id, setColumns, restoreTimer, handleFacilitatorChanged])

  // Subscribe cursor arrivals to render CursorMarker components dynamically
  useEffect(() => {
    return subscribeCursors(() => {
      forceCursorRender((n) => n + 1)
    })
  }, [subscribeCursors, forceCursorRender])

  // Auto-advance timer when it hits 0 during active facilitation by current user
  const prevRemainingRef = useRef(timer.remaining)
  useEffect(() => {
    const prev = prevRemainingRef.current
    prevRemainingRef.current = timer.remaining
    if (
      prev > 0 &&
      timer.remaining === 0 &&
      autoAdvance &&
      facilitator === username &&
      phase
    ) {
      handleNextPhase()
    }
  }, [timer.remaining, autoAdvance, facilitator, username, phase, handleNextPhase])

  const {
    sensors,
    collisionDetection,
    activeCard,
    activeGroup,
    groupTargetId,
    onDragStart,
    onDragOver,
    onDragEnd,
  } = useBoardDragDrop({ columns, setColumns })

  const boardLocked = Boolean(board.is_locked)
  const effectiveFacilitator = sessionSynced
    ? facilitator
    : board.active_facilitator ?? null
  const effectivePhase = sessionSynced ? phase : board.active_phase ?? null
  const hideOtherCards =
    effectivePhase === 'brainstorm' ||
    (Boolean(board.hide_cards_until_reveal) &&
      (!effectivePhase || effectivePhase === 'brainstorm'))
  const anonymousMode = Boolean(board.anonymous_votes)
  const readOnly = boardLocked

  const userTotalVotes = useMemo(
    () =>
      columns.reduce(
        (sum, col) =>
          sum +
          col.cards.filter((c) => (c.likes || []).includes(username)).length,
        0,
      ),
    [columns, username],
  )

  const participants = useMemo(() => {
    const set = new Set<string>(activeUsers)
    columns.forEach((c) => c.cards.forEach((card) => set.add(card.author)))
    return Array.from(set).filter((name) => name && name !== 'Аноним')
  }, [activeUsers, columns])

  const createActionItemFromCards = useCallback(
    async (text: string, sourceCardIds: string[], authorHint?: string | null) => {
      try {
        const item = await createActionItem({
          board_id: board.id,
          title: 'Генерация...',
          text,
          assignee: !anonymousMode && authorHint ? authorHint : undefined,
          source_card_ids: sourceCardIds,
        })
        setActionItems((prev) =>
          prev.find((i) => i.id === item.id) ? prev : [...prev, item],
        )
        showToast('Добавлено в Action Items', 'success')
        generateActionItemTitle(text)
          .then((generatedTitle) =>
            updateActionItem(item.id, { title: generatedTitle }).then((updated) => {
              setActionItems((prev) =>
                prev.map((i) => (i.id === item.id ? updated : i)),
              )
            }),
          )
          .catch(() => {
            updateActionItem(item.id, {
              title: text.slice(0, 60) || 'Action Item',
            }).catch(() => {})
          })
      } catch (err) {
        showToast(getApiErrorMessage(err, 'Не удалось создать Action Item'), 'error')
      }
    },
    [anonymousMode, board.id, setActionItems],
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const overId = event.over ? String(event.over.id) : ''
      if (overId === 'master-col' && activeCard) {
        if (!readOnly) {
          await createActionItemFromCards(
            activeCard.text,
            [activeCard.id],
            activeCard.author,
          )
        }
        onDragEnd({ ...event, over: null } as DragEndEvent)
        return
      }

      if (overId === 'master-col' && activeGroup) {
        if (!readOnly) {
          const groupCards = columns
            .flatMap((col) => col.cards)
            .filter((c) => c.group_id === activeGroup.id)
          const combined = groupCards.map((c) => c.text).join(' ')
          await createActionItemFromCards(
            combined || activeGroup.title,
            groupCards.map((c) => c.id),
            groupCards[0]?.author ?? null,
          )
        }
        onDragEnd({ ...event, over: null } as DragEndEvent)
        return
      }

      onDragEnd(event)
    },
    [activeCard, activeGroup, columns, createActionItemFromCards, onDragEnd, readOnly],
  )

  const handleColumnUpdate = useCallback(
    (updated: ColumnType) =>
      setColumns((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
      ),
    [setColumns],
  )

  const handleColumnDelete = useCallback(
    (id: string) => setColumns((prev) => prev.filter((c) => c.id !== id)),
    [setColumns],
  )

  const handleCardCreated = useCallback(
    (colId: string, card: Card) =>
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId && !c.cards.find((x) => x.id === card.id)
            ? { ...c, cards: [...c.cards, card] }
            : c,
        ),
      ),
    [setColumns],
  )

  const handleCardUpdated = useCallback(
    (colId: string, card: Card) =>
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId
            ? { ...c, cards: c.cards.map((x) => (x.id === card.id ? card : x)) }
            : c,
        ),
      ),
    [setColumns],
  )

  const handleCardDeleted = useCallback(
    (colId: string, cardId: string) =>
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId
            ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) }
            : c,
        ),
      ),
    [setColumns],
  )

  const handleGroupCreated = useCallback(
    (colId: string, group: CardGroup, cardIds: string[]) =>
      setColumns((prev) =>
        prev.map((c) => {
          if (c.id !== colId) return c
          const groups = (c.groups || []).some((g) => g.id === group.id)
            ? c.groups
            : [...(c.groups || []), group]
          const cards = c.cards.map((card) =>
            cardIds.includes(card.id) ? { ...card, group_id: group.id } : card,
          )
          return { ...c, groups, cards }
        }),
      ),
    [setColumns],
  )

  const handleGroupUpdated = useCallback(
    (colId: string, group: CardGroup) =>
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId
            ? {
                ...c,
                groups: (c.groups || []).map((g) =>
                  g.id === group.id ? group : g,
                ),
              }
            : c,
        ),
      ),
    [setColumns],
  )

  const handleGroupDeleted = useCallback(
    (colId: string, groupId: string) =>
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId
            ? {
                ...c,
                groups: (c.groups || []).filter((g) => g.id !== groupId),
                cards: c.cards.map((card) =>
                  card.group_id === groupId ? { ...card, group_id: null } : card,
                ),
              }
            : c,
        ),
      ),
    [setColumns],
  )

  const handleToggleCollapse = useCallback(
    (groupId: string) => {
      const next = !collapsedGroups[groupId]
      sendMessage({
        event: 'group_collapse',
        data: { group_id: groupId, collapsed: next },
      })
    },
    [collapsedGroups, sendMessage],
  )

  const handleAddColumn = async (title: string, color: string) => {
    try {
      const col = await createColumn({ board_id: board.id, title, color })
      setColumns((prev) =>
        prev.some((c) => c.id === col.id) ? prev : [...prev, col],
      )
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось добавить колонку'), 'error')
    }
  }

  const handleSpotlight = (cardId: string) => {
    const next = spotlightCardId === cardId ? null : cardId
    sendMessage({ event: 'spotlight_card', data: { card_id: next } })
  }

  const spotlightData = useMemo(() => {
    if (!spotlightCardId) return null
    for (const col of columns) {
      const card = col.cards.find((c) => c.id === spotlightCardId)
      if (card) return { card, column: col }
    }
    return null
  }, [spotlightCardId, columns])

  const handleToggleMaster = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileMasterOpen((prev) => !prev)
    } else {
      setMasterOpen((prev) => !prev)
    }
  }

  const handleExportMarkdown = () => {
    const md = formatBoardMarkdown(
      { ...board, columns },
      actionItems,
      summary,
    )
    const filename = `retro-${board.name.replace(/[^а-яёa-z0-9]/gi, '_')}.md`
    downloadMarkdownFile(filename, md)
    showToast('Markdown экспортирован', 'success')
  }

  const handleExportPDF = () => {
    exportBoardToPDF(board, columns, actionItems)
  }

  const remoteCursors = Object.keys(cursorsRef.current).filter(
    (name) => name !== username,
  )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Topbar
        board={{ ...board, moods }}
        workspaceName={workspaceName}
        username={username}
        activeUsers={activeUsers}
        readyUsers={readyUsers}
        facilitator={effectiveFacilitator}
        connected={connected}
        openActionItemsCount={actionItems.filter((i) => i.status !== 'done').length}
        onOpenBoardsDrawer={() => setBoardsPanelOpen(true)}
        onOpenCommandPalette={() => setCommandOpen(true)}
        onOpenBoardSettings={() => setBoardSettingsOpen(true)}
        onOpenUserSettings={() => setUserSettingsOpen(true)}
        onOpenMood={() => setMoodOpen(true)}
        onOpenSummary={() => {
          setSummaryOpen(true)
          loadSummary()
        }}
        onExportMarkdown={handleExportMarkdown}
        onExportPDF={handleExportPDF}
      />

      <SessionBar
        facilitator={effectiveFacilitator}
        phase={effectivePhase}
        username={username}
        activeUsers={activeUsers}
        readyUsers={readyUsers}
        isLocked={boardLocked}
        usedVotes={userTotalVotes}
        maxVotes={board.max_votes}
        timer={timer}
        autoAdvance={autoAdvance}
        soundMuted={soundMuted}
        onToggleSoundMuted={toggleSoundMuted}
        onAutoAdvanceChange={setAutoAdvance}
        onTimerStart={handleTimerStart}
        onTimerPause={handleTimerPause}
        onTimerReset={handleTimerReset}
        onAddTime={handleAddTime}
        onFacilitatorStart={handleFacilitatorStart}
        onFacilitatorStop={(lock) => handleFacilitatorStop(lock)}
        onPhaseChange={handlePhaseChange}
        onNextPhase={handleNextPhase}
        onToggleReady={() => sendMessage({ event: 'ready_toggle', data: {} })}
        onSendReaction={(emoji) =>
          sendMessage({ event: 'reaction', data: { emoji } })
        }
      />

      <BoardToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onlyMine={onlyMine}
        onOnlyMineChange={setOnlyMine}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        readOnly={readOnly}
        masterOpen={masterOpen}
        onToggleMaster={handleToggleMaster}
        actionItemsCount={actionItems.length}
        onAddColumn={handleAddColumn}
      />

      {/* Board workspace */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={handleDragEnd}
      >
        <main
          className={cn(
            'relative flex min-h-0 flex-1 overflow-hidden',
            dotGrid && 'bg-dot-grid',
          )}
        >
          {/* Horizontal columns canvas */}
          <div
            ref={canvasRef}
            onMouseMove={(e) => handleMouseMove(e, canvasRef.current)}
            onMouseLeave={handleMouseLeave}
            className="relative flex flex-1 gap-4 overflow-x-auto overflow-y-hidden p-4 md:p-5"
          >
            {columns.map((col) => (
              <Column
                key={col.id}
                column={col}
                maxVotes={board.max_votes}
                userTotalVotes={userTotalVotes}
                currentUser={username}
                onUpdate={handleColumnUpdate}
                onDelete={handleColumnDelete}
                onCardCreated={(card) => handleCardCreated(col.id, card)}
                onCardUpdated={(card) => handleCardUpdated(col.id, card)}
                onCardDeleted={(cardId) => handleCardDeleted(col.id, cardId)}
                onGroupCreated={(group, ids) =>
                  handleGroupCreated(col.id, group, ids)
                }
                onGroupUpdated={(group) => handleGroupUpdated(col.id, group)}
                onGroupDeleted={(gid) => handleGroupDeleted(col.id, gid)}
                groupTargetId={groupTargetId}
                collapsedGroups={collapsedGroups}
                onToggleCollapse={handleToggleCollapse}
                hideOtherCards={hideOtherCards}
                anonymous={anonymousMode}
                readOnly={readOnly}
                cardCreationDisabled={readOnly}
                searchQuery={searchQuery}
                onlyMine={onlyMine}
                sortBy={sortBy}
                spotlightCardId={spotlightCardId}
                onSpotlight={handleSpotlight}
                onCreateActionItem={(card) =>
                  createActionItemFromCards(card.text, [card.id], card.author)
                }
              />
            ))}

            {/* Multiplayer cursors layer */}
            {remoteCursors.map((name) => (
              <CursorMarker key={name} username={name} posRef={cursorsRef} />
            ))}
          </div>

          {/* Desktop Action Items Sidebar */}
          {masterOpen && (
            <aside className="hidden w-[340px] shrink-0 flex-col border-l bg-background/90 backdrop-blur-sm lg:flex">
              <MasterColumn
                boardId={board.id}
                actionItems={actionItems}
                participants={participants}
                onCreated={(item) =>
                  setActionItems((prev) =>
                    prev.find((i) => i.id === item.id) ? prev : [...prev, item],
                  )
                }
                onUpdated={(item) =>
                  setActionItems((prev) =>
                    prev.map((i) => (i.id === item.id ? item : i)),
                  )
                }
                onDeleted={(id) =>
                  setActionItems((prev) => prev.filter((i) => i.id !== id))
                }
                dropDisabled={readOnly}
                readOnly={readOnly}
              />
            </aside>
          )}
        </main>

        <DragOverlay>
          {activeCard ? (
            <div
              className={cn(
                'w-[300px] rotate-1 rounded-xl border p-3.5 shadow-xl opacity-95',
                getCardColorPreset(activeCard.color).cardClass,
              )}
            >
              <p className="line-clamp-3 text-sm text-foreground">
                {activeCard.text}
              </p>
            </div>
          ) : activeGroup ? (
            <div className="flex w-[300px] items-center gap-2 rounded-xl border border-primary/40 bg-card p-3 shadow-xl">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold">{activeGroup.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Mobile Action Items Sheet */}
      <Sheet open={mobileMasterOpen} onOpenChange={setMobileMasterOpen}>
        <SheetContent side="right" className="w-[340px] p-0 sm:max-w-sm">
          <SheetHeader className="sr-only">
            <SheetTitle>Итоги доски</SheetTitle>
          </SheetHeader>
          <MasterColumn
            boardId={board.id}
            actionItems={actionItems}
            participants={participants}
            onCreated={(item) =>
              setActionItems((prev) =>
                prev.find((i) => i.id === item.id) ? prev : [...prev, item],
              )
            }
            onUpdated={(item) =>
              setActionItems((prev) =>
                prev.map((i) => (i.id === item.id ? item : i)),
              )
            }
            onDeleted={(id) =>
              setActionItems((prev) => prev.filter((i) => i.id !== id))
            }
            dropDisabled
            readOnly={readOnly}
          />
        </SheetContent>
      </Sheet>

      {/* Floating emoji reactions */}
      {reactions.length > 0 && (
        <div
          data-testid="reactions-overlay"
          className="pointer-events-none fixed inset-x-0 top-14 bottom-4 z-50 overflow-hidden"
          aria-hidden="true"
        >
          {reactions.map((r) => (
            <div
              key={r.id}
              style={{ left: `${r.xOffset}%` }}
              className="animate-float-up absolute bottom-2 flex -translate-x-1/2 flex-col items-center gap-1"
            >
              <span className="text-4xl drop-shadow-md">{r.emoji}</span>
              {r.username && (
                <span className="rounded-full border border-border/60 bg-background/90 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur-sm">
                  {r.username}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drawers & Dialogs */}
      <BoardsPanel
        open={boardsPanelOpen}
        onOpenChange={setBoardsPanelOpen}
        boards={boards}
        currentBoardId={board.id}
        onSelectBoard={onSelectBoard}
        onOpenCreateBoard={onOpenCreateBoard}
        onNavigateDashboard={() => router.push('/dashboard')}
      />

      <CommandPalette
        boards={boards}
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onSelectBoard={onSelectBoard}
        onCreateBoard={onOpenCreateBoard}
        onNavigateDashboard={() => router.push('/dashboard')}
      />

      <BoardSettingsDialog
        open={boardSettingsOpen}
        onOpenChange={setBoardSettingsOpen}
        board={board}
        onBoardUpdated={onBoardUpdated}
        onBoardDeleted={onBoardDeleted}
      />

      <UserSettingsDialog
        open={userSettingsOpen}
        onOpenChange={setUserSettingsOpen}
      />

      <MoodDialog
        open={moodOpen}
        onOpenChange={setMoodOpen}
        boardId={board.id}
        username={username}
        moods={moods}
        onMoodSubmitted={handleWsMoodUpdated}
      />

      <SummaryModal
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        board={{ ...board, columns }}
        actionItems={actionItems}
        summary={summary}
        loading={summaryLoading}
        error={summaryError}
        onSummaryUpdated={(updated) => {
          setSummary(updated)
          onBoardUpdated({ ...board, has_summary: true })
        }}
      />

      <SpotlightModal
        card={spotlightData?.card || null}
        column={spotlightData?.column}
        anonymous={anonymousMode}
        isFacilitator={!effectiveFacilitator || effectiveFacilitator === username}
        currentUser={username}
        readOnly={readOnly}
        maxVotes={board.max_votes}
        userTotalVotes={userTotalVotes}
        onClose={() => {
          if (!effectiveFacilitator || effectiveFacilitator === username) {
            sendMessage({ event: 'spotlight_card', data: { card_id: null } })
          }
        }}
        onCreateActionItem={(card) =>
          createActionItemFromCards(card.text, [card.id], card.author)
        }
        onLike={() => {
          if (!spotlightData || readOnly) return
          const targetCard = spotlightData.card
          const targetColId = spotlightData.column.id
          const alreadyLiked = (targetCard.likes || []).includes(username)
          if (!alreadyLiked && board.max_votes > 0 && userTotalVotes >= board.max_votes) {
            showToast(`Лимит голосов исчерпан (${userTotalVotes}/${board.max_votes})`, 'info')
            return
          }
          import('../api')
            .then(({ toggleLike }) => toggleLike(targetCard.id, username))
            .then((updated) => handleCardUpdated(targetColId, updated))
            .catch((err) => showToast(getApiErrorMessage(err, 'Не удалось обновить голос'), 'error'))
        }}
      />

      {/* Quick hint pill in brainstorm */}
      {effectivePhase === 'brainstorm' && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border bg-background/95 px-4 py-1.5 text-xs font-medium shadow-lg backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>Слепой режим: карточки других участников скрыты до фазы раскрытия</span>
          </div>
        </div>
      )}
    </div>
  )
}
