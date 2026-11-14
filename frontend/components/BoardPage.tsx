'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DragEndEvent,
  type DropAnimation,
} from '@dnd-kit/core'
import { AnimatePresence } from 'motion/react'
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import {
  applyAutoClusters,
  autoClusterPreview,
  bulkDeleteCards,
  bulkUpdateCards,
  createActionItem,
  createColumn,
  generateActionItemTitle,
  getBoard,
  getBoardSummary,
  mergeCards,
  resetBoardVotes,
  revealBoardCards,
  toggleLike,
  updateActionItem,
} from '../api'
import { useAppStore } from '../store'
import { showToast } from '../store/toastStore'
import { useBoardDragDrop } from '../hooks/useBoardDragDrop'
import { NO_FACILITATOR, useBoardWebSocket } from '../hooks/useBoardWebSocket'
import { useFacilitator } from '../hooks/useFacilitator'
import { useTimer } from '../hooks/useTimer'
import { downloadMarkdownFile, formatBoardMarkdown } from '@/lib/export-markdown'
import { getCardColorPreset } from '@/lib/board-themes'
import {
  applyColumnUpdated,
  applyMoodUpdated,
  applyParticipantRenamedToMoods,
  countMaskedCards,
} from '@/lib/board-events'
import {
  canDeleteCard,
  canModerateBoard,
  countMyVotes,
  countMyVotesOnBoard,
} from '@/lib/participants'
import { getApiErrorMessage, getApiErrorStatus } from '../utils/apiError'
import type {
  AutoClusterPreviewResult,
  Board,
  BoardListItem,
  BoardMood,
  BoardSummary,
  Card,
  CardGroup,
  Column as ColumnType,
  FacilitatorInfo,
  WsBoardUpdatedData,
  WsMessage,
} from '../types'
import AutoClusterPreviewDialog from './AutoClusterPreviewDialog'
import BoardSettingsDialog from './BoardSettingsDialog'
import BoardToolbar from './BoardToolbar'
import BoardsPanel from './BoardsPanel'
import BulkActionsBar from './BulkActionsBar'
import Column from './Column'
import { RichCardText } from './RichCardText'
import type { CommandBoardAction, CommandSearchCard } from './CommandPalette'
import CommandPalette from './CommandPaletteLazy'
import CursorMarker from './CursorMarker'
import HiddenCollectBanner from './HiddenCollectBanner'
import MasterColumn from './MasterColumn'
import MoodDialog from './MoodDialog'
import SessionBar from './SessionBar'
import ShortcutsDialog from './ShortcutsDialog'
import SpotlightModal, { type SpotlightQueueItem } from './SpotlightModal'
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

const MASTER_WIDTH_STORAGE_KEY = 'retro_master_width'
const MIN_MASTER_WIDTH = 280
const MAX_MASTER_WIDTH = 560

const BOARD_DROP_ANIMATION: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.45',
      },
    },
  }),
}

function triggerConfetti() {
  if (typeof window === 'undefined') return
  import('canvas-confetti')
    .then((mod) => {
      void mod.default?.({
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
  // «Я» на доске — участник сессии: свои карточки, голоса и роль ведущего определяются
  // по его идентификатору, имя — только подпись
  const participant = useAppStore((s) => s.participant)
  const savedName = useAppStore((s) => s.username)
  const aiEnabled = useAppStore((s) => s.aiEnabled)
  const myId = participant?.id ?? ''
  const username = participant?.name ?? savedName
  const dotGrid = useAppStore((s) => s.dotGrid)

  const [boardsPanelOpen, setBoardsPanelOpen] = useState(false)
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false)
  const [userSettingsOpen, setUserSettingsOpen] = useState(false)
  const [moodOpen, setMoodOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [masterOpen, setMasterOpen] = useState(true)
  const [masterWidth, setMasterWidth] = useState<number | null>(null)
  const [resizingMaster, setResizingMaster] = useState(false)
  const [mobileMasterOpen, setMobileMasterOpen] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(MASTER_WIDTH_STORAGE_KEY))
      if (!Number.isNaN(saved) && saved >= MIN_MASTER_WIDTH && saved <= MAX_MASTER_WIDTH) {
        setMasterWidth(saved)
      }
    } catch {
      // ignore storage restrictions
    }
  }, [])

  const [searchQuery, setSearchQuery] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [sortBy, setSortBy] = useState<'order' | 'votes'>('order')
  const [colorFilter, setColorFilter] = useState<string | null>(null)
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(() => new Set())
  const lastSelectedCardIdRef = useRef<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [reactionsPopoverOpen, setReactionsPopoverOpen] = useState(false)
  const [resettingVotes, setResettingVotes] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [spotlightQueueMode, setSpotlightQueueMode] = useState<'all' | 'top_votes'>('all')
  const [clusterPreviewState, setClusterPreviewState] = useState<{
    column: ColumnType
    preview: AutoClusterPreviewResult
  } | null>(null)
  const [applyingClusters, setApplyingClusters] = useState(false)

  const [moods, setMoods] = useState<BoardMood[]>(board.moods || [])
  const [summary, setSummary] = useState<BoardSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const typingStateRef = useRef<Record<string, boolean>>({})
  const cursorNodeTick = useState(0)
  const forceCursorRender = cursorNodeTick[1]

  const updateCanvasScrollState = useCallback(() => {
    const el = canvasRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    setCanScrollLeft(el.scrollLeft > 8)
    setCanScrollRight(maxScroll > 8 && el.scrollLeft < maxScroll - 8)
  }, [])

  const scrollCanvasBy = (delta: number) => {
    canvasRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  const startMasterResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setResizingMaster(true)
    const onMove = (moveEvent: PointerEvent) => {
      const raw = window.innerWidth - moveEvent.clientX
      const clamped = Math.max(MIN_MASTER_WIDTH, Math.min(MAX_MASTER_WIDTH, raw))
      setMasterWidth(clamped)
    }
    const onUp = (upEvent: PointerEvent) => {
      setResizingMaster(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const raw = window.innerWidth - upEvent.clientX
      const clamped = Math.max(MIN_MASTER_WIDTH, Math.min(MAX_MASTER_WIDTH, raw))
      try {
        window.localStorage.setItem(MASTER_WIDTH_STORAGE_KEY, String(clamped))
      } catch {
        // ignore storage errors
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const resetMasterWidth = () => {
    setMasterWidth(null)
    try {
      window.localStorage.removeItem(MASTER_WIDTH_STORAGE_KEY)
    } catch {
      // ignore storage errors
    }
  }

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
    handleFacilitatorTransfer,
    handleFacilitatorTakeover,
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
    void loadSummary()
    triggerConfetti()
  }, [loadSummary])

  const handleSummaryFailed = useCallback((msg?: string) => {
    setSummaryLoading(false)
    // Без настроенного AI это не сбой, а ожидаемое состояние: причина написана в окне итогов
    if (useAppStore.getState().aiEnabled === false) {
      showToast('AI не настроен: итоги ретро доступны без AI-резюме', 'info')
      return
    }
    setSummaryError(msg || 'Ошибка генерации AI-итогов')
    showToast(msg || 'Не удалось сгенерировать AI-итоги', 'error')
  }, [])

  const boardRef = useRef(board)
  boardRef.current = board

  // Перечитать доску с сервера. Что показывать участнику, решает сервер: при смене
  // видимости (начало штурма, раскрытие) он присылает cards_visibility_changed,
  // и карточки заново приходят уже в нужном виде — скрытые или раскрытые.
  const setColumnsRef = useRef<(cols: ColumnType[]) => void>(() => {})
  const reloadSeqRef = useRef(0)
  const reloadBoard = useCallback(async () => {
    const seq = ++reloadSeqRef.current
    const boardId = boardRef.current.id
    try {
      const fresh = await getBoard(boardId)
      // Применяем только ответ на последний запрос: более ранний снимок мог устареть
      if (seq !== reloadSeqRef.current || boardRef.current.id !== boardId) return
      setColumnsRef.current(fresh.columns || [])
      setMoods(fresh.moods || [])
      onBoardUpdated({ ...boardRef.current, ...fresh })
    } catch (err) {
      // 401: сессия сброшена, приложение само покажет экран входа
      if (getApiErrorStatus(err) === 401) return
      showToast(getApiErrorMessage(err, 'Не удалось обновить доску'), 'error')
    }
  }, [onBoardUpdated])

  const handleWsBoardUpdated = useCallback(
    (data: WsBoardUpdatedData) => {
      onBoardsListUpdated(data)
      const current = boardRef.current
      if (data.id === current.id) {
        // Анонимный режим переключили: авторов и голоса сервер теперь отдаёт иначе,
        // а отдельного события о видимости при этом нет — перечитываем доску
        const anonymityChanged =
          data.anonymous_votes !== undefined &&
          Boolean(data.anonymous_votes) !== Boolean(current.anonymous_votes)
        if (anonymityChanged) void reloadBoard()
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
          allow_multiple_votes_per_card:
            data.allow_multiple_votes_per_card ?? current.allow_multiple_votes_per_card,
          created_by_id:
            data.created_by_id !== undefined ? data.created_by_id : current.created_by_id,
          cards_revealed: data.cards_revealed ?? current.cards_revealed,
          cards_hidden: data.cards_hidden ?? current.cards_hidden,
        })
      }
    },
    [onBoardUpdated, onBoardsListUpdated, reloadBoard],
  )

  const handleWsMoodUpdated = useCallback((mood: BoardMood) => {
    setMoods((prev) => applyMoodUpdated(prev, mood))
  }, [])

  const handleCardsVisibilityChanged = useCallback(() => {
    void reloadBoard()
  }, [reloadBoard])

  // Настройки сохранены этим участником. Ответ сервера — доска в его виде: если изменился
  // скрытый сбор или анонимный режим, карточки и оценки в ответе уже собраны по-новому.
  const handleSettingsSaved = useCallback(
    (updated: Board) => {
      const current = boardRef.current
      const viewChanged =
        Boolean(updated.cards_hidden) !== Boolean(current.cards_hidden) ||
        Boolean(updated.anonymous_votes) !== Boolean(current.anonymous_votes)
      if (viewChanged) {
        // Не даём более раннему запросу перечитывания затереть этот ответ
        reloadSeqRef.current += 1
        setColumnsRef.current(updated.columns || [])
        setMoods(updated.moods || [])
      }
      onBoardUpdated({ ...current, ...updated })
    },
    [onBoardUpdated],
  )

  const handleParticipantRenamed = useCallback((participantId: string, name: string) => {
    setMoods((prev) => applyParticipantRenamedToMoods(prev, participantId, name))
    // Имя сменили в другой вкладке или на другом устройстве с той же сессией
    const store = useAppStore.getState()
    if (store.participant?.id === participantId && store.participant.name !== name) {
      store.setParticipant({ id: participantId, name })
    }
  }, [])

  const {
    columns,
    setColumns,
    cursorsRef,
    subscribeCursors,
    collapsedGroups,
    setCollapsedGroups,
    participants: onlineParticipants,
    knownNames,
    readyIds,
    spotlightCardId,
    typingUsers,
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
    onCardsVisibilityChanged: handleCardsVisibilityChanged,
    onParticipantRenamed: handleParticipantRenamed,
  })

  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

  useEffect(() => {
    setColumnsRef.current = setColumns
  }, [setColumns])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    updateCanvasScrollState()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => updateCanvasScrollState())
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateCanvasScrollState, columns.length, masterOpen, masterWidth])

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
    setColorFilter(null)
    setSelectedCardIds(new Set())
    lastSelectedCardIdRef.current = null
    setClusterPreviewState(null)
    typingStateRef.current = {}
    restoreTimer(board.id)
    handleFacilitatorChanged(
      initialBoard.active_facilitator_id
        ? {
            id: initialBoard.active_facilitator_id,
            name: initialBoard.active_facilitator ?? null,
            online: true,
          }
        : null,
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
      Boolean(myId) &&
      facilitator.id === myId &&
      phase
    ) {
      handleNextPhase()
    }
  }, [timer.remaining, autoAdvance, facilitator.id, myId, phase, handleNextPhase])

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
  // До первого facilitator_update от сокета сессию берём из снимка доски
  const snapshotFacilitatorId = board.active_facilitator_id ?? null
  const snapshotFacilitatorName = board.active_facilitator ?? null
  const effectiveFacilitator = useMemo<FacilitatorInfo>(() => {
    if (sessionSynced) return facilitator
    return snapshotFacilitatorId
      ? { id: snapshotFacilitatorId, name: snapshotFacilitatorName, online: true }
      : NO_FACILITATOR
  }, [sessionSynced, facilitator, snapshotFacilitatorId, snapshotFacilitatorName])
  const effectivePhase = sessionSynced ? phase : board.active_phase ?? null
  const isFacilitator = Boolean(myId) && effectiveFacilitator.id === myId
  // Вне сессии таймером и фокусом управляет любой, в сессии — только ведущий
  const canControlSession = !effectiveFacilitator.id || isFacilitator
  // Модератор: создатель доски или ведущий (у доски без создателя — любой участник)
  const isModerator = canModerateBoard(board, effectiveFacilitator.id, myId)
  // Скрыты ли чужие карточки, решает сервер: карточки приходят уже с признаком masked
  const cardsHidden = Boolean(board.cards_hidden)
  const maskedCardsCount = useMemo(() => countMaskedCards(columns), [columns])
  const anonymousMode = Boolean(board.anonymous_votes)
  const readOnly = boardLocked

  const userTotalVotes = useMemo(() => countMyVotesOnBoard(columns, myId), [columns, myId])

  // Имена для подсказок при назначении ответственного
  const participants = useMemo(() => {
    const set = new Set<string>(onlineParticipants.map((p) => p.name))
    // В анонимном режиме авторы чужих карточек скрыты — подсказывать нечего
    if (!anonymousMode) {
      columns.forEach((c) =>
        c.cards.forEach((card) => {
          if (!card.masked) set.add(card.author)
        }),
      )
    }
    return Array.from(set).filter((name) => name && name !== 'Аноним')
  }, [anonymousMode, onlineParticipants, columns])

  // Имена участников по идентификатору — для подписи голосов: кто сейчас на доске,
  // кого мы видели раньше и авторы карточек
  const voterNames = useMemo(() => {
    const names: Record<string, string> = { ...knownNames }
    for (const col of columns) {
      for (const card of col.cards) {
        if (card.author_id && card.author) names[card.author_id] = card.author
      }
    }
    return names
  }, [knownNames, columns])

  // В анонимном режиме чужие голоса обезличены ("anon"): посчитать проголосовавших нельзя
  const votedParticipantsCount = useMemo(() => {
    if (anonymousMode) return undefined
    const voters = new Set<string>()
    for (const col of columns) {
      for (const card of col.cards) {
        for (const voterId of card.likes || []) {
          if (voterId) voters.add(voterId)
        }
      }
    }
    const onlineIds = onlineParticipants.length > 0 ? onlineParticipants.map((p) => p.id) : [myId]
    return onlineIds.filter((id) => voters.has(id)).length
  }, [anonymousMode, onlineParticipants, columns, myId])

  const allCardsMap = useMemo(() => {
    const map = new Map<string, Card>()
    columns.forEach((col) => col.cards.forEach((card) => map.set(card.id, card)))
    return map
  }, [columns])

  const selectedCards = useMemo(
    () =>
      Array.from(selectedCardIds)
        .map((id) => allCardsMap.get(id))
        .filter((card): card is Card => Boolean(card)),
    [selectedCardIds, allCardsMap],
  )

  useEffect(() => {
    if (readOnly) {
      setSelectedCardIds(new Set())
    }
  }, [readOnly])

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
        showToast('Добавлено в задачи', 'success')
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
              title: text.slice(0, 60) || 'Задача',
            }).catch(() => {})
          })
      } catch (err) {
        showToast(getApiErrorMessage(err, 'Не удалось создать задачу'), 'error')
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
        void onDragEnd({ ...event, over: null })
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
        void onDragEnd({ ...event, over: null })
        return
      }

      void onDragEnd(event)
    },
    [activeCard, activeGroup, columns, createActionItemFromCards, onDragEnd, readOnly],
  )

  // Обновляются только свойства колонки: карточки и группы могли измениться, пока шёл запрос
  const handleColumnUpdate = useCallback(
    (updated: ColumnType) => setColumns((prev) => applyColumnUpdated(prev, updated)),
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
    (colId: string, cardId: string) => {
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId
            ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) }
            : c,
        ),
      )
      setSelectedCardIds((prev) => {
        if (!prev.has(cardId)) return prev
        const next = new Set(prev)
        next.delete(cardId)
        return next
      })
    },
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

  const handleSpotlight = useCallback(
    (cardId: string) => {
      const next = spotlightCardId === cardId ? null : cardId
      sendMessage({ event: 'spotlight_card', data: { card_id: next } })
    },
    [sendMessage, spotlightCardId],
  )

  const handleSelectSpotlightCard = useCallback(
    (cardId: string) => {
      sendMessage({ event: 'spotlight_card', data: { card_id: cardId } })
    },
    [sendMessage],
  )

  const spotlightData = useMemo(() => {
    if (!spotlightCardId) return null
    for (const col of columns) {
      const card = col.cards.find((c) => c.id === spotlightCardId)
      // Чужая карточка до раскрытия: показывать в фокусе нечего
      if (card) return card.masked ? null : { card, column: col }
    }
    return null
  }, [spotlightCardId, columns])

  const spotlightQueue = useMemo<SpotlightQueueItem[]>(() => {
    const items: SpotlightQueueItem[] = []
    for (const col of columns) {
      const sortedColCards = [...col.cards].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0),
      )
      for (const card of sortedColCards) {
        if (card.masked) continue
        items.push({ card, columnTitle: col.title })
      }
    }
    if (spotlightQueueMode === 'top_votes') {
      return [...items].sort(
        (a, b) => (b.card.likes?.length || 0) - (a.card.likes?.length || 0),
      )
    }
    return items
  }, [columns, spotlightQueueMode])

  const handleToggleMaster = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileMasterOpen((prev) => !prev)
    } else {
      setMasterOpen((prev) => !prev)
    }
  }, [])

  const columnsMeta = useMemo(
    () => columns.map((c) => ({ id: c.id, title: c.title, color: c.color })),
    [columns],
  )

  const allGroupIds = useMemo(
    () => columns.flatMap((c) => (c.groups || []).map((g) => g.id)),
    [columns],
  )
  const hasGroups = allGroupIds.length > 0
  const allGroupsCollapsed =
    hasGroups && allGroupIds.every((id) => Boolean(collapsedGroups[id]))

  const handleToggleCollapseAllGroups = useCallback(() => {
    if (!hasGroups) return
    const nextCollapsed = !allGroupsCollapsed
    setCollapsedGroups((prev) => {
      const next = { ...prev }
      allGroupIds.forEach((id) => {
        next[id] = nextCollapsed
      })
      return next
    })
    allGroupIds.forEach((id) => {
      sendMessage({
        event: 'group_collapse',
        data: { group_id: id, collapsed: nextCollapsed },
      })
    })
  }, [allGroupIds, allGroupsCollapsed, hasGroups, sendMessage, setCollapsedGroups])

  // Кто печатает в колонке, кроме меня. Запись на участника, а не на имя: тёзки — двое
  const typingByColumn = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const t of typingUsers) {
      if (!t.column_id || !t.participant_id || t.participant_id === myId) continue
      if (!map[t.column_id]) map[t.column_id] = []
      map[t.column_id].push(t.username || 'Участник')
    }
    return map
  }, [typingUsers, myId])

  const handleTypingChange = useCallback(
    (columnId: string, isTyping: boolean) => {
      if (typingStateRef.current[columnId] === isTyping) return
      typingStateRef.current[columnId] = isTyping
      sendMessage({
        event: 'card_typing',
        data: { column_id: columnId, is_typing: isTyping },
      })
    },
    [sendMessage],
  )

  const handleCardMovedToColumn = useCallback(
    (sourceColId: string, updatedCard: Card, targetColumnId: string) => {
      setColumns((prev) =>
        prev.map((col) => {
          if (col.id === sourceColId && sourceColId !== targetColumnId) {
            return {
              ...col,
              cards: col.cards.filter((c) => c.id !== updatedCard.id),
            }
          }
          if (col.id === targetColumnId) {
            const rest = col.cards.filter((c) => c.id !== updatedCard.id)
            return {
              ...col,
              cards: [updatedCard, ...rest],
            }
          }
          return col
        }),
      )
    },
    [setColumns],
  )

  const handleResetMyVotes = useCallback(async () => {
    if (readOnly || resettingVotes || userTotalVotes <= 0) return
    setResettingVotes(true)
    try {
      await resetBoardVotes(board.id)
      setColumns((prev) =>
        prev.map((col) => ({
          ...col,
          cards: col.cards.map((card) =>
            countMyVotes(card, myId) > 0
              ? { ...card, likes: card.likes.filter((voterId) => voterId !== myId) }
              : card,
          ),
        })),
      )
      showToast('Все ваши голоса сброшены', 'success')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось сбросить голоса'), 'error')
    } finally {
      setResettingVotes(false)
    }
  }, [board.id, readOnly, resettingVotes, setColumns, userTotalVotes, myId])

  // Раскрыть скрытый сбор вне сессии. В сессии карточки раскрывает переход ведущего
  // из фазы «Штурм». Остальные участники узнают о раскрытии по cards_visibility_changed.
  const handleRevealCards = useCallback(async () => {
    if (revealing) return
    setRevealing(true)
    try {
      const fresh = await revealBoardCards(board.id)
      setColumns(fresh.columns || [])
      setMoods(fresh.moods || [])
      onBoardUpdated({ ...boardRef.current, ...fresh })
      showToast('Карточки раскрыты для всей команды', 'success')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось раскрыть карточки'), 'error')
    } finally {
      setRevealing(false)
    }
  }, [board.id, onBoardUpdated, revealing, setColumns])

  const handleToggleSelectCard = useCallback(
    (cardId: string, shiftKey = false) => {
      if (readOnly) return
      // Скрытые до раскрытия чужие карточки в диапазон не попадают: выбрать их нельзя
      const orderedIds = columns.flatMap((c) =>
        c.cards.filter((card) => !card.masked).map((card) => card.id),
      )
      setSelectedCardIds((prev) => {
        const next = new Set(prev)
        if (shiftKey && lastSelectedCardIdRef.current) {
          const startIdx = orderedIds.indexOf(lastSelectedCardIdRef.current)
          const endIdx = orderedIds.indexOf(cardId)
          if (startIdx !== -1 && endIdx !== -1) {
            const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
            for (let i = lo; i <= hi; i += 1) {
              next.add(orderedIds[i])
            }
            return next
          }
        }
        if (next.has(cardId)) {
          next.delete(cardId)
        } else {
          next.add(cardId)
        }
        return next
      })
      lastSelectedCardIdRef.current = cardId
    },
    [columns, readOnly],
  )

  const applyBulkUpdatedCards = useCallback(
    (updatedCards: Card[], extraGroup?: CardGroup) => {
      const updatedMap = new Map(updatedCards.map((c) => [c.id, c]))
      setColumns((prev) =>
        prev.map((col) => {
          const retained: Card[] = []
          for (const existing of col.cards) {
            const replacement = updatedMap.get(existing.id)
            if (!replacement) {
              retained.push(existing)
            } else if (replacement.column_id === col.id) {
              retained.push(replacement)
            }
          }
          const incoming = updatedCards.filter(
            (c) =>
              c.column_id === col.id &&
              !col.cards.some((existing) => existing.id === c.id),
          )
          const groups =
            extraGroup &&
            extraGroup.column_id === col.id &&
            !(col.groups || []).some((g) => g.id === extraGroup.id)
              ? [...(col.groups || []), extraGroup]
              : col.groups
          return {
            ...col,
            groups,
            cards: [...retained, ...incoming],
          }
        }),
      )
    },
    [setColumns],
  )

  const runBulkAction = useCallback(
    async (fallbackError: string, fn: (cardIds: string[]) => Promise<void>) => {
      if (readOnly || bulkBusy || selectedCards.length === 0) return
      setBulkBusy(true)
      try {
        await fn(selectedCards.map((c) => c.id))
      } catch (err) {
        showToast(getApiErrorMessage(err, fallbackError), 'error')
      } finally {
        setBulkBusy(false)
      }
    },
    [bulkBusy, readOnly, selectedCards],
  )

  const handleBulkGroup = useCallback(
    (title: string) =>
      runBulkAction('Не удалось сгруппировать карточки', async (ids) => {
        const updated = await bulkUpdateCards({ card_ids: ids, group_title: title })
        const newGroupId = updated[0]?.group_id
        const targetColId = updated[0]?.column_id
        const syntheticGroup: CardGroup | undefined =
          newGroupId && targetColId
            ? {
                id: newGroupId,
                column_id: targetColId,
                title: title.trim() || 'Новая группа',
                position: 999,
              }
            : undefined
        applyBulkUpdatedCards(updated, syntheticGroup)
        setSelectedCardIds(new Set())
        showToast('Карточки объединены в группу', 'success')
      }),
    [applyBulkUpdatedCards, runBulkAction],
  )

  const handleBulkColor = useCallback(
    (hex: string) =>
      runBulkAction('Не удалось изменить цвет карточек', async (ids) => {
        const updated = await bulkUpdateCards({ card_ids: ids, color: hex })
        applyBulkUpdatedCards(updated)
        setSelectedCardIds(new Set())
      }),
    [applyBulkUpdatedCards, runBulkAction],
  )

  const handleBulkMove = useCallback(
    (columnId: string) =>
      runBulkAction('Не удалось переместить карточки', async (ids) => {
        const updated = await bulkUpdateCards({ card_ids: ids, column_id: columnId })
        applyBulkUpdatedCards(updated)
        setSelectedCardIds(new Set())
        showToast('Карточки перемещены', 'success')
      }),
    [applyBulkUpdatedCards, runBulkAction],
  )

  const handleBulkCreateActionItem = useCallback(
    () =>
      runBulkAction('Не удалось создать задачу', async (ids) => {
        const combinedText = selectedCards
          .map((c) => c.text.trim())
          .filter(Boolean)
          .join('\n')
        const firstAuthor = selectedCards[0]?.author ?? null
        await createActionItemFromCards(combinedText, ids, firstAuthor)
        setSelectedCardIds(new Set())
      }),
    [createActionItemFromCards, runBulkAction, selectedCards],
  )

  const handleBulkDelete = useCallback(
    () =>
      runBulkAction('Не удалось удалить карточки', async (ids) => {
        await bulkDeleteCards(ids)
        const idSet = new Set(ids)
        setColumns((prev) =>
          prev.map((col) => ({
            ...col,
            cards: col.cards.filter((c) => !idSet.has(c.id)),
          })),
        )
        setSelectedCardIds(new Set())
        showToast(`Удалено карточек: ${ids.length}`, 'success')
      }),
    [runBulkAction, setColumns],
  )

  const handleMergeCards = useCallback(
    (targetText: string) =>
      runBulkAction('Не удалось объединить карточки', async (ids) => {
        const merged = await mergeCards(ids, targetText)
        const removedSet = new Set(ids.slice(1))
        setColumns((prev) =>
          prev.map((col) => ({
            ...col,
            cards: col.cards
              .filter((c) => !removedSet.has(c.id))
              .map((c) => (c.id === merged.id ? merged : c)),
          })),
        )
        setSelectedCardIds(new Set())
        showToast('Дубли объединены, голоса суммированы', 'success')
      }),
    [runBulkAction, setColumns],
  )

  const handleOpenClusterPreview = useCallback(
    async (col: ColumnType) => {
      if (readOnly) return
      try {
        const preview = await autoClusterPreview(col.id)
        if (!preview.groups || preview.groups.length === 0) {
          showToast('AI не нашёл похожих карточек для группировки', 'info')
          return
        }
        setClusterPreviewState({ column: col, preview })
      } catch (err: unknown) {
        // Одно сообщение по делу: причину («AI не настроен», «временно недоступен»,
        // «карточки ещё скрыты») сообщает сервер
        showToast(getApiErrorMessage(err, 'Не удалось выполнить AI-кластеризацию'), 'error')
      }
    },
    [readOnly],
  )

  const handleApplyClusterPreview = useCallback(
    async (groupsToApply: { title: string; card_ids: string[] }[]) => {
      if (!clusterPreviewState || applyingClusters || readOnly) return
      setApplyingClusters(true)
      try {
        const colId = clusterPreviewState.column.id
        const result = await applyAutoClusters({
          column_id: colId,
          groups: groupsToApply,
        })
        for (const entry of result.created_groups || []) {
          if (entry?.group) {
            handleGroupCreated(colId, entry.group, entry.card_ids || [])
          }
        }
        setClusterPreviewState(null)
        showToast(
          `Создано групп: ${(result.created_groups || []).length}`,
          'success',
        )
      } catch (err) {
        showToast(getApiErrorMessage(err, 'Не удалось применить группы'), 'error')
      } finally {
        setApplyingClusters(false)
      }
    },
    [applyingClusters, clusterPreviewState, handleGroupCreated, readOnly],
  )

  const commandBoardActions = useMemo<CommandBoardAction[]>(() => {
    const list: CommandBoardAction[] = []
    if (!readOnly) {
      list.push({
        id: 'new-card',
        label: 'Добавить карточку в первую колонку',
        keywords: 'создать карточку стикер add card',
        shortcut: 'N',
        onSelect: () => {
          const btn = document.querySelector<HTMLButtonElement>('[data-column-add-btn="true"]')
          btn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
          btn?.click()
        },
      })
    }
    list.push(
      {
        id: 'search-cards',
        label: 'Поиск по карточкам на доске',
        keywords: 'фильтр найти search',
        shortcut: 'F',
        onSelect: () => {
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        },
      },
      {
        id: 'toggle-master',
        label: masterOpen ? 'Скрыть панель «Итоги»' : 'Показать панель «Итоги»',
        keywords: 'action items задачи итоги',
        shortcut: 'M',
        onSelect: handleToggleMaster,
      },
      {
        id: 'open-reactions',
        label: 'Отправить быструю реакцию',
        keywords: 'эмодзи emoji reaction',
        shortcut: 'R',
        onSelect: () => setReactionsPopoverOpen(true),
      },
    )
    if (hasGroups) {
      list.push({
        id: 'toggle-groups',
        label: allGroupsCollapsed ? 'Развернуть все группы' : 'Свернуть все группы',
        keywords: 'collapse expand groups кластеры',
        onSelect: handleToggleCollapseAllGroups,
      })
    }
    if (!readOnly && userTotalVotes > 0) {
      list.push({
        id: 'reset-votes',
        label: 'Сбросить все мои голоса',
        keywords: 'reset votes лайки',
        onSelect: () => void handleResetMyVotes(),
      })
    }
    list.push(
      {
        id: 'board-settings',
        label: 'Настройки доски',
        keywords: 'settings лимит голосов таймер слепой',
        onSelect: () => setBoardSettingsOpen(true),
      },
      {
        id: 'ai-summary',
        label: aiEnabled === false ? 'Итоги ретро и экспорт' : 'AI-резюме спринта',
        keywords: 'summary итоги отчет',
        onSelect: () => {
          setSummaryOpen(true)
          void loadSummary()
        },
      },
      {
        id: 'mood-checkin',
        label: 'Чек-ин настроения',
        keywords: 'mood оценка',
        onSelect: () => setMoodOpen(true),
      },
      {
        id: 'shortcuts-help',
        label: 'Шпаргалка горячих клавиш',
        keywords: 'keyboard shortcuts help помощь',
        shortcut: '?',
        onSelect: () => setShortcutsOpen(true),
      },
    )
    return list
  }, [
    aiEnabled,
    allGroupsCollapsed,
    handleResetMyVotes,
    handleToggleCollapseAllGroups,
    handleToggleMaster,
    hasGroups,
    loadSummary,
    masterOpen,
    readOnly,
    userTotalVotes,
  ])

  const commandSearchCards = useMemo<CommandSearchCard[]>(() => {
    const items: CommandSearchCard[] = []
    for (const col of columns) {
      for (const card of col.cards) {
        if (card.masked) continue
        items.push({
          id: card.id,
          text: card.text,
          columnTitle: col.title,
          likesCount: (card.likes || []).length,
          onSelect: () => {
            const el = document.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`)
            el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
            if (canControlSession) {
              handleSpotlight(card.id)
            }
          },
        })
      }
    }
    return items
  }, [columns, canControlSession, handleSpotlight])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      if (e.key === 'Escape') {
        if (selectedCardIds.size > 0) {
          setSelectedCardIds(new Set())
        }
        return
      }

      if (document.querySelector('[role="dialog"][data-state="open"]')) {
        return
      }

      if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen(true)
        return
      }

      if (e.code === 'KeyN' && !readOnly) {
        const firstAddBtn = document.querySelector<HTMLButtonElement>(
          '[data-column-add-btn="true"]',
        )
        if (firstAddBtn) {
          e.preventDefault()
          firstAddBtn.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center',
          })
          firstAddBtn.click()
        }
        return
      }

      if (e.code === 'KeyF' || e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }

      if (e.code === 'KeyM') {
        e.preventDefault()
        handleToggleMaster()
        return
      }

      if (e.code === 'KeyR') {
        e.preventDefault()
        setReactionsPopoverOpen((prev) => !prev)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleToggleMaster, readOnly, selectedCardIds.size])

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
    // Генератор отчёта (~700 строк шаблона) грузится отдельным чанком по первому клику.
    import('../utils/exportPDF')
      .then(({ exportBoardToPDF }) => exportBoardToPDF(board, columns, actionItems, summary))
      .catch(() => showToast('Не удалось подготовить отчёт для печати', 'error'))
  }

  // Курсоры других участников; свой (из второй вкладки той же сессии) не показываем
  const remoteCursors = Object.entries(cursorsRef.current).filter(([id]) => id !== myId)

  // Удалять выбранные карточки можно, если каждая из них своя, либо я модератор
  const canDeleteSelection = selectedCards.every((card) =>
    canDeleteCard(card, myId, { anonymous: anonymousMode, moderator: isModerator }),
  )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Topbar
        board={{ ...board, moods }}
        workspaceName={workspaceName}
        username={username}
        myId={myId}
        participants={onlineParticipants}
        readyIds={readyIds}
        facilitatorId={effectiveFacilitator.id}
        onTransferFacilitator={isFacilitator ? handleFacilitatorTransfer : undefined}
        connected={connected}
        openActionItemsCount={actionItems.filter((i) => i.status !== 'done').length}
        onOpenBoardsDrawer={() => setBoardsPanelOpen(true)}
        onOpenCommandPalette={() => setCommandOpen(true)}
        onOpenBoardSettings={() => setBoardSettingsOpen(true)}
        onOpenUserSettings={() => setUserSettingsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenMood={() => setMoodOpen(true)}
        onOpenSummary={() => {
          setSummaryOpen(true)
          void loadSummary()
        }}
        onExportMarkdown={handleExportMarkdown}
        onExportPDF={handleExportPDF}
      />

      <SessionBar
        facilitator={effectiveFacilitator}
        phase={effectivePhase}
        myId={myId}
        onlineCount={onlineParticipants.length}
        readyIds={readyIds}
        onFacilitatorTakeover={handleFacilitatorTakeover}
        isLocked={boardLocked}
        usedVotes={userTotalVotes}
        maxVotes={board.max_votes}
        votedParticipantsCount={votedParticipantsCount}
        onResetMyVotes={handleResetMyVotes}
        resettingVotes={resettingVotes}
        reactionsOpen={reactionsPopoverOpen}
        onReactionsOpenChange={setReactionsPopoverOpen}
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
        colorFilter={colorFilter}
        onColorFilterChange={setColorFilter}
        hasGroups={hasGroups}
        allGroupsCollapsed={allGroupsCollapsed}
        onToggleCollapseAllGroups={handleToggleCollapseAllGroups}
        searchInputRef={searchInputRef}
        readOnly={readOnly}
        masterOpen={masterOpen}
        onToggleMaster={handleToggleMaster}
        actionItemsCount={actionItems.length}
        onAddColumn={handleAddColumn}
      />

      {cardsHidden && (
        <HiddenCollectBanner
          inSession={Boolean(effectivePhase)}
          maskedCount={maskedCardsCount}
          canReveal={isModerator}
          locked={boardLocked}
          revealing={revealing}
          onReveal={handleRevealCards}
        />
      )}

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
            resizingMaster && 'select-none',
          )}
        >
          {/* Canvas viewport wrapper so scroll buttons align with visible columns edge */}
          <div className="relative flex min-w-0 flex-1 overflow-hidden">
            {/* Left scroll hint */}
            {canScrollLeft && (
              <button
                type="button"
                onClick={() => scrollCanvasBy(-340)}
                aria-label="Прокрутить колонки влево"
                className="no-print absolute left-2 top-1/2 z-20 hidden -translate-y-1/2 sm:flex h-9 w-9 items-center justify-center rounded-full border bg-background/90 text-foreground shadow-md backdrop-blur-xs transition-all hover:scale-105 hover:bg-background"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}

            {/* Right scroll hint */}
            {canScrollRight && (
              <button
                type="button"
                onClick={() => scrollCanvasBy(340)}
                aria-label="Прокрутить колонки вправо"
                className="no-print absolute right-2 top-1/2 z-20 hidden -translate-y-1/2 sm:flex h-9 w-9 items-center justify-center rounded-full border bg-background/90 text-foreground shadow-md backdrop-blur-xs transition-all hover:scale-105 hover:bg-background"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}

            {/* Horizontal columns canvas */}
            <div
              ref={canvasRef}
              onScroll={updateCanvasScrollState}
              onMouseMove={(e) => handleMouseMove(e, canvasRef.current)}
              onMouseLeave={handleMouseLeave}
              className="relative flex flex-1 items-stretch gap-3 sm:gap-4 overflow-x-auto overflow-y-hidden p-3 sm:p-4 snap-x snap-mandatory md:snap-none"
            >
              {columns.map((col, idx) => (
                <Column
                  key={col.id}
                  index={idx}
                  className={cn(
                    idx === 0 && 'md:ml-auto',
                    idx === columns.length - 1 && 'md:mr-auto',
                  )}
                  column={col}
                  maxVotes={board.max_votes}
                  userTotalVotes={userTotalVotes}
                  currentUserId={myId}
                  isModerator={isModerator}
                  voterNames={voterNames}
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
                  cardsHidden={cardsHidden}
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
                  onPreviewAutoCluster={handleOpenClusterPreview}
                  allowMultipleVotes={Boolean(board.allow_multiple_votes_per_card)}
                  selectedCardIds={selectedCardIds}
                  onToggleSelectCard={handleToggleSelectCard}
                  otherColumns={columnsMeta.filter((c) => c.id !== col.id)}
                  onCardMoved={(updatedCard, targetColId) =>
                    handleCardMovedToColumn(col.id, updatedCard, targetColId)
                  }
                  colorFilter={colorFilter}
                  typingUsernames={typingByColumn[col.id]}
                  onTypingChange={handleTypingChange}
                />
              ))}

              {/* Multiplayer cursors layer */}
              <AnimatePresence>
                {remoteCursors.map(([id, cursor]) => (
                  <CursorMarker
                    key={id}
                    cursorId={id}
                    username={cursor.name || 'Участник'}
                    posRef={cursorsRef}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Desktop Action Items Sidebar (adaptive + resizable + smooth slide) */}
          <aside
            aria-hidden={!masterOpen}
            style={{
              width: masterOpen
                ? masterWidth
                  ? `${masterWidth}px`
                  : 'clamp(300px, 23vw, 420px)'
                : '0px',
            }}
            className={cn(
              'relative hidden shrink-0 overflow-hidden bg-background/90 backdrop-blur-xs lg:flex',
              !resizingMaster && 'transition-[width,opacity,border-width] duration-200 ease-out',
              masterOpen ? 'border-l opacity-100' : 'pointer-events-none invisible border-l-0 opacity-0',
            )}
          >
            {masterOpen && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Изменить ширину панели Итоги"
                title="Потяните для изменения ширины (двойной клик — сброс)"
                onPointerDown={startMasterResize}
                onDoubleClick={resetMasterWidth}
                className="group/resize absolute inset-y-0 left-0 z-20 flex w-2 -translate-x-1/2 cursor-col-resize items-center justify-center"
              >
                <span className="h-10 w-0.5 rounded-full bg-transparent transition-colors group-hover/resize:bg-primary/60" />
              </div>
            )}
            <div className="h-full w-full min-w-[280px]">
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
                cardsHidden={cardsHidden}
              />
            </div>
          </aside>
        </main>

        <DragOverlay dropAnimation={BOARD_DROP_ANIMATION}>
          {activeCard ? (
            <div
              className={cn(
                'w-[300px] rotate-2 scale-[1.02] rounded-xl border p-3.5 shadow-2xl opacity-95',
                getCardColorPreset(activeCard.color).cardClass,
              )}
            >
              <p className="line-clamp-3 text-sm text-foreground">
                <RichCardText text={activeCard.text} />
              </p>
            </div>
          ) : activeGroup ? (
            <div className="flex w-[300px] rotate-1 scale-[1.02] items-center gap-2 rounded-xl border border-primary/40 bg-card p-3 shadow-2xl">
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
        onOpenChange={setBoardsPanelOpen}
        boards={boards}
        currentBoardId={board.id}
        onSelectBoard={onSelectBoard}
        onOpenCreateBoard={onOpenCreateBoard}
        onNavigateDashboard={() => router.push('/dashboard')}
      />

      <BulkActionsBar
        selectedCards={readOnly ? [] : selectedCards}
        columns={columns}
        busy={bulkBusy}
        onClear={() => setSelectedCardIds(new Set())}
        onBulkGroup={handleBulkGroup}
        onBulkColor={handleBulkColor}
        onBulkMove={handleBulkMove}
        onBulkCreateActionItem={handleBulkCreateActionItem}
        onBulkDelete={handleBulkDelete}
        canDelete={canDeleteSelection}
        onMergeCards={handleMergeCards}
      />

      <CommandPalette
        boards={boards}
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onSelectBoard={onSelectBoard}
        onCreateBoard={onOpenCreateBoard}
        onNavigateDashboard={() => router.push('/dashboard')}
        boardActions={commandBoardActions}
        searchableCards={commandSearchCards}
      />

      <BoardSettingsDialog
        open={boardSettingsOpen}
        onOpenChange={setBoardSettingsOpen}
        board={board}
        canModerate={isModerator}
        onBoardUpdated={handleSettingsSaved}
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
        anonymous={anonymousMode}
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

      <AutoClusterPreviewDialog
        open={Boolean(clusterPreviewState)}
        onOpenChange={(open) => {
          if (!open) setClusterPreviewState(null)
        }}
        columnTitle={clusterPreviewState?.column.title || ''}
        preview={clusterPreviewState?.preview || null}
        cards={clusterPreviewState?.column.cards || []}
        applying={applyingClusters}
        onApply={handleApplyClusterPreview}
      />

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

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
        onQueueModeChange={setSpotlightQueueMode}
        onSelectCard={handleSelectSpotlightCard}
        onClose={() => {
          if (canControlSession) {
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
          const allowMulti = Boolean(board.allow_multiple_votes_per_card)
          const alreadyLiked = countMyVotes(targetCard, myId) > 0
          const adding = allowMulti || !alreadyLiked
          if (adding && board.max_votes > 0 && userTotalVotes >= board.max_votes) {
            showToast(`Лимит голосов исчерпан (${userTotalVotes}/${board.max_votes})`, 'info')
            return
          }
          toggleLike(targetCard.id, allowMulti ? 'add' : 'toggle')
            .then((updated) => handleCardUpdated(targetColId, updated))
            .catch((err) => showToast(getApiErrorMessage(err, 'Не удалось обновить голос'), 'error'))
        }}
      />

    </div>
  )
}
