'use client'

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { toggleLike } from '../api'
import { showToast } from '../store/toastStore'
import { countMyVotes } from '@/lib/participants'
import { getApiErrorMessage } from '../utils/apiError'
import type {
  ActionItem,
  AutoClusterPreviewResult,
  Board,
  BoardListItem,
  BoardSummary,
  Card,
  Column as ColumnType,
  ReactionBubble,
  WsMessage,
} from '../types'
import AutoClusterPreviewDialog from './AutoClusterPreviewDialog'
import BoardSettingsDialog from './BoardSettingsDialog'
import BoardsPanel from './BoardsPanel'
import BulkActionsBar from './BulkActionsBar'
import type { CommandBoardAction, CommandSearchCard } from './CommandPalette'
import CommandPalette from './CommandPaletteLazy'
import MasterColumn from './MasterColumn'
import ShortcutsDialog from './ShortcutsDialog'
import SpotlightModal, { type SpotlightQueueItem } from './SpotlightModal'
import SummaryModal from './SummaryModal'
import UserSettingsDialog from './UserSettingsDialog'
import {
  HEALTH_CHECK_START,
  HealthCheckDialog,
  RotiPrompt,
  type useHealthCheck,
} from '@/components/health'

export interface BoardDialogsProps {
  board: Board
  boards: BoardListItem[]
  columns: ColumnType[]
  actionItems: ActionItem[]
  participants: string[]
  myId: string
  isModerator: boolean
  canControlSession: boolean
  readOnly: boolean
  cardsHidden: boolean
  anonymousMode: boolean
  userTotalVotes: number
  reactions: ReactionBubble[]

  // Mobile action items drawer
  mobileMasterOpen: boolean
  onMobileMasterOpenChange: (open: boolean) => void
  onActionItemSaved: (item: ActionItem) => void
  onActionItemChanged: (item: ActionItem) => void
  onActionItemDeleted: (id: string) => void

  // Boards switcher
  boardsPanelOpen: boolean
  onBoardsPanelOpenChange: (open: boolean) => void
  onSelectBoard: (board: BoardListItem) => void
  onOpenCreateBoard: () => void
  onNavigateDashboard: () => void

  // Bulk selection bar
  selectedCards: Card[]
  bulkBusy: boolean
  canDeleteSelection: boolean
  mergeBlockedReason: string | null
  onClearSelection: () => void
  onBulkGroup: (title: string) => Promise<void>
  onBulkColor: (hex: string) => Promise<void>
  onBulkMove: (columnId: string) => Promise<void>
  onBulkCreateActionItem: () => Promise<void>
  onBulkDelete: () => Promise<void>
  onMergeCards: (targetText: string) => Promise<void>

  // Command palette
  commandOpen: boolean
  onCommandOpenChange: (open: boolean) => void
  commandBoardActions: CommandBoardAction[]
  commandSearchCards: CommandSearchCard[]

  // Board & user settings
  boardSettingsOpen: boolean
  onBoardSettingsOpenChange: (open: boolean) => void
  onSettingsSaved: (updated: Board) => void
  onBoardDeleted: (boardId: string) => void
  userSettingsOpen: boolean
  onUserSettingsOpenChange: (open: boolean) => void

  // AI Summary
  summaryOpen: boolean
  onSummaryOpenChange: (open: boolean) => void
  summary: BoardSummary | null
  summaryLoading: boolean
  summaryError: string | null
  onSummaryUpdated: (updated: BoardSummary) => void

  // AI auto-cluster preview
  clusterPreviewState: {
    column: ColumnType
    preview: AutoClusterPreviewResult
  } | null
  onCloseClusterPreview: () => void
  applyingClusters: boolean
  onApplyClusterPreview: (groups: { title: string; card_ids: string[] }[]) => Promise<void>

  // Shortcuts & Spotlight
  shortcutsOpen: boolean
  onShortcutsOpenChange: (open: boolean) => void
  spotlightData: { card: Card; column: ColumnType } | null
  spotlightQueue: SpotlightQueueItem[]
  spotlightQueueMode: 'all' | 'top_votes'
  onSpotlightQueueModeChange: (mode: 'all' | 'top_votes') => void
  onSelectSpotlightCard: (cardId: string) => void
  onCreateActionItemFromCard: (text: string, sourceCardIds: string[], authorHint?: string | null) => void
  onSpotlightCardUpdated: (card: Card) => void

  // Health Check & WS
  health: ReturnType<typeof useHealthCheck>
  sendMessage: (msg: WsMessage) => void
}

/** Боковые панели, оверлей реакций и модальные диалоги доски. */
export default function BoardDialogs({
  board,
  boards,
  columns,
  actionItems,
  participants,
  myId,
  isModerator,
  canControlSession,
  readOnly,
  cardsHidden,
  anonymousMode,
  userTotalVotes,
  reactions,
  mobileMasterOpen,
  onMobileMasterOpenChange,
  onActionItemSaved,
  onActionItemChanged,
  onActionItemDeleted,
  boardsPanelOpen,
  onBoardsPanelOpenChange,
  onSelectBoard,
  onOpenCreateBoard,
  onNavigateDashboard,
  selectedCards,
  bulkBusy,
  canDeleteSelection,
  mergeBlockedReason,
  onClearSelection,
  onBulkGroup,
  onBulkColor,
  onBulkMove,
  onBulkCreateActionItem,
  onBulkDelete,
  onMergeCards,
  commandOpen,
  onCommandOpenChange,
  commandBoardActions,
  commandSearchCards,
  boardSettingsOpen,
  onBoardSettingsOpenChange,
  onSettingsSaved,
  onBoardDeleted,
  userSettingsOpen,
  onUserSettingsOpenChange,
  summaryOpen,
  onSummaryOpenChange,
  summary,
  summaryLoading,
  summaryError,
  onSummaryUpdated,
  clusterPreviewState,
  onCloseClusterPreview,
  applyingClusters,
  onApplyClusterPreview,
  shortcutsOpen,
  onShortcutsOpenChange,
  spotlightData,
  spotlightQueue,
  spotlightQueueMode,
  onSpotlightQueueModeChange,
  onSelectSpotlightCard,
  onCreateActionItemFromCard,
  onSpotlightCardUpdated,
  health,
  sendMessage,
}: BoardDialogsProps) {
  return (
    <>
      {/* Mobile Action Items Sheet */}
      <Sheet open={mobileMasterOpen} onOpenChange={onMobileMasterOpenChange}>
        <SheetContent side="right" className="w-[340px] p-0 sm:max-w-sm">
          <SheetHeader className="sr-only">
            <SheetTitle>Задачи доски</SheetTitle>
          </SheetHeader>
          <MasterColumn
            boardId={board.id}
            actionItems={actionItems}
            participants={participants}
            onCreated={onActionItemSaved}
            onUpdated={onActionItemChanged}
            onRestored={onActionItemSaved}
            onDeleted={onActionItemDeleted}
            dropDisabled
            readOnly={readOnly}
            cardsHidden={cardsHidden}
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
                <span className="rounded-full border border-border/60 bg-background/90 px-2 py-0.5 text-[10px] font-medium shadow-xs backdrop-blur-xs">
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
        onOpenChange={onBoardsPanelOpenChange}
        boards={boards}
        currentBoardId={board.id}
        onSelectBoard={onSelectBoard}
        onOpenCreateBoard={onOpenCreateBoard}
        onNavigateDashboard={onNavigateDashboard}
      />

      <BulkActionsBar
        selectedCards={readOnly ? [] : selectedCards}
        columns={columns}
        busy={bulkBusy}
        onClear={onClearSelection}
        onBulkGroup={onBulkGroup}
        onBulkColor={onBulkColor}
        onBulkMove={onBulkMove}
        onBulkCreateActionItem={onBulkCreateActionItem}
        onBulkDelete={onBulkDelete}
        canDelete={canDeleteSelection}
        onMergeCards={onMergeCards}
        mergeBlockedReason={mergeBlockedReason}
      />

      <CommandPalette
        boards={boards}
        open={commandOpen}
        onOpenChange={onCommandOpenChange}
        onSelectBoard={onSelectBoard}
        onCreateBoard={onOpenCreateBoard}
        onNavigateDashboard={onNavigateDashboard}
        boardActions={commandBoardActions}
        searchableCards={commandSearchCards}
      />

      <BoardSettingsDialog
        open={boardSettingsOpen}
        onOpenChange={onBoardSettingsOpenChange}
        board={board}
        canModerate={isModerator}
        onBoardUpdated={onSettingsSaved}
        onBoardDeleted={onBoardDeleted}
      />

      <UserSettingsDialog
        open={userSettingsOpen}
        onOpenChange={onUserSettingsOpenChange}
      />

      <SummaryModal
        open={summaryOpen}
        onOpenChange={onSummaryOpenChange}
        board={{ ...board, columns }}
        actionItems={actionItems}
        summary={summary}
        loading={summaryLoading}
        error={summaryError}
        onSummaryUpdated={onSummaryUpdated}
      />

      <AutoClusterPreviewDialog
        open={Boolean(clusterPreviewState)}
        onOpenChange={(open) => {
          if (!open) onCloseClusterPreview()
        }}
        columnTitle={clusterPreviewState?.column.title || ''}
        preview={clusterPreviewState?.preview || null}
        cards={clusterPreviewState?.column.cards || []}
        applying={applyingClusters}
        onApply={onApplyClusterPreview}
      />

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={onShortcutsOpenChange} />

      <SpotlightModal
        card={spotlightData?.card || null}
        column={spotlightData?.column}
        anonymous={anonymousMode}
        isFacilitator={canControlSession}
        currentUserId={myId}
        readOnly={readOnly}
        maxVotes={board.max_votes}
        userTotalVotes={userTotalVotes}
        allowMultipleVotes={Boolean(board.allow_multiple_votes_per_card)}
        queueCards={spotlightQueue}
        queueMode={spotlightQueueMode}
        onQueueModeChange={onSpotlightQueueModeChange}
        onSelectCard={onSelectSpotlightCard}
        onClose={() => {
          if (canControlSession) {
            sendMessage({ event: 'spotlight_card', data: { card_id: null } })
          }
        }}
        onCreateActionItem={(card) =>
          onCreateActionItemFromCard(card.text, [card.id], card.author)
        }
        onLike={() => {
          if (!spotlightData || readOnly) return
          const targetCard = spotlightData.card
          const allowMulti = Boolean(board.allow_multiple_votes_per_card)
          const alreadyLiked = countMyVotes(targetCard, myId) > 0
          const adding = allowMulti || !alreadyLiked
          if (adding && board.max_votes > 0 && userTotalVotes >= board.max_votes) {
            showToast(`Лимит голосов исчерпан (${userTotalVotes}/${board.max_votes})`, 'info')
            return
          }
          toggleLike(targetCard.id, allowMulti ? 'add' : 'toggle')
            .then((updated) => onSpotlightCardUpdated(updated))
            .catch((err) => showToast(getApiErrorMessage(err, 'Не удалось обновить голос'), 'error'))
        }}
      />

      {/* Здоровье команды: запустить опрос у всех может ведущий, а вне сессии — любой участник */}
      <HealthCheckDialog
        health={health}
        onStartForTeam={
          canControlSession ? () => sendMessage(HEALTH_CHECK_START) : undefined
        }
      />
      <RotiPrompt health={health} />
    </>
  )
}
