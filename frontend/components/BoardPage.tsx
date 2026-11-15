'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type Announcements,
  type DragEndEvent,
  type DropAnimation,
  type ScreenReaderInstructions,
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
  getBoardSummary,
  mergeCards,
  resetBoardVotes,
  revealBoardCards,
  toggleLike,
  updateActionItem,
  updateColumn,
} from '../api'
import { useAppStore } from '../store'
import { showToast } from '../store/toastStore'
import { useBoardDragDrop } from '../hooks/useBoardDragDrop'
import { NO_FACILITATOR, useBoardWebSocket } from '../hooks/useBoardWebSocket'
import { shallowEqualRecords, useStableValue } from '../hooks/useStableValue'
import { useFacilitator } from '../hooks/useFacilitator'
import { useTimer } from '../hooks/useTimer'
import { downloadMarkdownFile, formatBoardMarkdown } from '@/lib/export-markdown'
import { getCardColorPreset } from '@/lib/board-themes'
import {
  applyActionItemDeleted,
  applyActionItemChanged,
  applyActionItemSaved,
  applyMoodUpdated,
  applyParticipantRenamedToMoods,
  countMaskedCards,
} from '@/lib/board-events'
import { blockingOverlay } from '@/lib/hotkeys'
import {
  canDeleteCard,
  canModerateBoard,
  mergeBlockedReason,
  countMyVotes,
  countMyVotesOnBoard,
} from '@/lib/participants'
import { getApiErrorMessage, getApiErrorStatus } from '../utils/apiError'
import type {
  ActionItem,
  AutoClusterPreviewResult,
  Board,
  BoardListItem,
  BoardMood,
  BoardSummary,
  Card,
  CardGroup,
  Column as ColumnType,
  ColumnInfo,
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
import ConnectionBanner from './ConnectionBanner'
import CursorMarker from './CursorMarker'
import { HEALTH_CHECK_OPEN_EVENT, openHealthCheck } from './HealthCheckButton'
import HiddenCollectBanner from './HiddenCollectBanner'
import MasterColumn from './MasterColumn'
import MoodDialog from './MoodDialog'
import SessionBar from './SessionBar'
import ShortcutsDialog from './ShortcutsDialog'
import SpotlightModal, { type SpotlightQueueItem } from './SpotlightModal'
import SummaryModal from './SummaryModal'
import Topbar from './Topbar'
import UserSettingsDialog from './UserSettingsDialog'
import {
  HEALTH_CHECK_START,
  HealthCheckDialog,
  RotiPrompt,
  useHealthCheck,
} from '@/components/health'
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
      // Без воркера: по умолчанию библиотека создаёт его из blob:, а CSP (script-src 'self')
      // это запрещает — браузер писал ошибку в консоль при каждом салюте
      void mod.default?.create(undefined, { resize: true })({
        particleCount: 70,
        spread: 65,
        origin: { y: 0.65 },
      })
    })
    .catch(() => {})
}

interface ColumnMeta {
  id: string
  title: string
  color: string
}

function sameColumnsMeta(a: ColumnMeta[], b: ColumnMeta[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => c.id === b[i].id && c.title === b[i].title && c.color === b[i].color)
  )
}

/** Как назвать то, что тащат или над чем оказались, в объявлениях для экранного диктора. */
function describeDragItem(data: Record<string, unknown> | undefined): string {
  if (data?.type === 'card') {
    const text = (data.card as Card | undefined)?.text?.trim()
    return text ? `карточка «${text.slice(0, 60)}»` : 'карточка'
  }
  if (data?.type === 'group') {
    return `группа «${(data.group as CardGroup | undefined)?.title ?? ''}»`
  }
  if (data?.type === 'column') return `колонка «${typeof data.title === 'string' ? data.title : ''}»`
  if (data?.type === 'master') return 'панель задач'
  return 'элемент доски'
}

// Перетаскивание с клавиатуры: подсказка и объявления для экранного диктора
const DND_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Чтобы взять элемент, нажмите пробел или Enter. Стрелками переместите его, пробелом или Enter отпустите, клавишей Escape отмените перенос.',
}

const DND_ANNOUNCEMENTS: Announcements = {
  onDragStart: ({ active }) => `Взято: ${describeDragItem(active.data.current)}.`,
  onDragOver: ({ active, over }) =>
    over
      ? `${describeDragItem(active.data.current)} — над: ${describeDragItem(over.data.current)}.`
      : `${describeDragItem(active.data.current)} — вне доски.`,
  onDragEnd: ({ active, over }) =>
    over
      ? `Перенесено: ${describeDragItem(active.data.current)} — ${describeDragItem(over.data.current)}.`
      : `Перенос отменён: ${describeDragItem(active.data.current)} возвращается на место.`,
  onDragCancel: ({ active }) =>
    `Перенос отменён: ${describeDragItem(active.data.current)} возвращается на место.`,
}

const DND_ACCESSIBILITY = {
  announcements: DND_ANNOUNCEMENTS,
  screenReaderInstructions: DND_INSTRUCTIONS,
}

/** Сколько карточка остаётся подсвеченной после перехода к ней из палитры команд. */
const CARD_FLASH_MS = 2200

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

  // Что делать, когда таймер дошёл до нуля: задаётся ниже, когда известны ведущий и фаза
  const timerExpiredRef = useRef<() => void>(() => {})
  const handleTimerExpired = useCallback(() => timerExpiredRef.current(), [])

  const {
    timer,
    autoAdvance,
    setAutoAdvance,
    soundMuted,
    toggleSoundMuted,
    handleTimerWsEvent,
    handleTimerAbsent,
    handleTimerStart,
    handleTimerPause,
    handleTimerReset,
    handleAddTime,
  } = useTimer(sendWs, { onExpire: handleTimerExpired })

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

  const loadSummary = useCallback(async (known = Boolean(board.has_summary)) => {
    // Итогов у доски нет и события о них не было: запрос вслепую вернул бы 404
    if (!known) return
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
  }, [board.id, board.has_summary])

  const boardRef = useRef(board)
  boardRef.current = board

  const handleSummaryGenerated = useCallback((regenerated: boolean) => {
    void loadSummary(true)
    if (!board.has_summary) onBoardUpdated({ ...board, has_summary: true })
    // Итоги пересоздали кнопкой: у остальных окно не открываем, только обновляем содержимое
    if (regenerated) return
    setSummaryOpen(true)
    triggerConfetti()
  }, [board, loadSummary, onBoardUpdated])

  // Открыть окно итогов; запрашивать ли сами итоги, решает loadSummary (по has_summary)
  const openSummary = useCallback(() => {
    setSummaryOpen(true)
    void loadSummary()
  }, [loadSummary])

  const handleSummaryFailed = useCallback((msg?: string) => {
    setSummaryLoading(false)
    // Не одинокий тост: окно итогов объясняет, что случилось, и предлагает повторить или
    // открыть экспорт. Без настроенного AI это не сбой — причина написана в самом окне
    if (useAppStore.getState().aiEnabled !== false) {
      setSummaryError(msg || 'Не удалось сгенерировать итоги')
    }
    setSummaryOpen(true)
  }, [])

  // Доска перечитана с сервера (после переподключения, пропуска событий, смены видимости
  // карточек). Колонки заменил хук сокета; здесь — настройки доски и настроение.
  const handleBoardSnapshot = useCallback(
    (fresh: Board) => {
      setMoods(fresh.moods || [])
      onBoardUpdated({ ...boardRef.current, ...fresh })
    },
    [onBoardUpdated],
  )

  const handleWsBoardUpdated = useCallback(
    (data: WsBoardUpdatedData) => {
      onBoardsListUpdated(data)
      const current = boardRef.current
      if (data.id === current.id) {
        // Если изменилось то, что видит участник (скрытый сбор, анонимный режим), сервер
        // следом пришлёт cards_visibility_changed — и доска перечитается
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
    [onBoardUpdated, onBoardsListUpdated],
  )

  const handleWsMoodUpdated = useCallback((mood: BoardMood) => {
    setMoods((prev) => applyMoodUpdated(prev, mood))
  }, [])

  const applySnapshotRef = useRef<(board: Board) => void>(() => {})

  // Настройки сохранены этим участником. Ответ сервера — доска в его виде: если изменился
  // скрытый сбор или анонимный режим, карточки и оценки в ответе уже собраны по-новому,
  // и ответ применяется как снимок доски.
  const handleSettingsSaved = useCallback(
    (updated: Board) => {
      const current = boardRef.current
      const viewChanged =
        Boolean(updated.cards_hidden) !== Boolean(current.cards_hidden) ||
        Boolean(updated.anonymous_votes) !== Boolean(current.anonymous_votes)
      if (viewChanged) applySnapshotRef.current(updated)
      onBoardUpdated({ ...current, ...updated })
    },
    [onBoardUpdated],
  )

  // Health check и оценка встречи: состояние здесь, окна — в разметке ниже
  const health = useHealthCheck(board.id)
  const healthRef = useRef(health)
  useEffect(() => {
    healthRef.current = health
  }, [health])
  const handleServerEvent = useCallback(
    (msg: WsMessage) => healthRef.current.handleServerEvent(msg),
    [],
  )

  // Доски больше нет (удалена, пока участник был не в сети): уходим к списку досок
  const handleBoardGone = useCallback(() => {
    onBoardsListDeleted(boardRef.current.id)
  }, [onBoardsListDeleted])

  const handleResynced = useCallback((reason: string) => {
    // Событие health_updated могло пройти мимо, пока связи не было
    if (reason === 'reconnect') healthRef.current.refresh()
  }, [])

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
    applyChange,
    resetBoard,
    applySnapshot,
    resync,
    holdRemoteChanges,
    releaseRemoteChanges,
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
    connection,
    reconnect,
    actionItems,
    setActionItems,
    sendMessage,
    handleMouseMove,
    handleMouseLeave,
  } = useBoardWebSocket({
    boardId: board.id,
    onTimerWsEvent: handleTimerWsEvent,
    onTimerAbsent: handleTimerAbsent,
    onFacilitatorChanged: handleFacilitatorChanged,
    onPhaseChanged: handlePhaseChanged,
    onSummaryGenerated: handleSummaryGenerated,
    onSummaryFailed: handleSummaryFailed,
    onBoardCreated: onBoardsListCreated,
    onBoardUpdated: handleWsBoardUpdated,
    onBoardDeleted: onBoardsListDeleted,
    onMoodUpdated: handleWsMoodUpdated,
    onParticipantRenamed: handleParticipantRenamed,
    onBoardSnapshot: handleBoardSnapshot,
    onResynced: handleResynced,
    onBoardGone: handleBoardGone,
    onServerEvent: handleServerEvent,
  })

  useEffect(() => {
    sendMessageRef.current = sendMessage
    applySnapshotRef.current = applySnapshot
  }, [sendMessage, applySnapshot])

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

    resetBoard(initialBoard)
    setMoods(initialBoard.moods || [])
    setSummary(null)
    setSummaryError(null)
    setColorFilter(null)
    setSelectedCardIds(new Set())
    lastSelectedCardIdRef.current = null
    setClusterPreviewState(null)
    typingStateRef.current = {}
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
  }, [board.id, resetBoard, handleFacilitatorChanged])

  // Subscribe cursor arrivals to render CursorMarker components dynamically
  useEffect(() => {
    return subscribeCursors(() => {
      forceCursorRender((n) => n + 1)
    })
  }, [subscribeCursors, forceCursorRender])

  // Авто-переход: таймер дошёл до нуля у ведущего — переходим к следующей фазе
  useEffect(() => {
    timerExpiredRef.current = () => {
      if (autoAdvance && Boolean(myId) && facilitator.id === myId && phase) handleNextPhase()
    }
  }, [autoAdvance, facilitator.id, myId, phase, handleNextPhase])

  // Сервер не принял изменение, локальное состояние уже возвращено. Отказ с ответом (4xx)
  // значит, что наше представление о доске разошлось с сервером: сверяемся с ним.
  const handleMutationRejected = useCallback(
    (err: unknown, options?: { resync?: boolean }) => {
      const status = getApiErrorStatus(err)
      const refused = status !== undefined && status >= 400 && status < 500
      if (options?.resync || (refused && status !== 401 && status !== 429)) resync('rejected')
    },
    [resync],
  )

  // Пока участник тащит карточку, чужие изменения копятся и применяются, когда он отпустит
  const handleDragActiveChange = useCallback(
    (active: boolean) => {
      if (active) holdRemoteChanges()
      else releaseRemoteChanges()
    },
    [holdRemoteChanges, releaseRemoteChanges],
  )

  const {
    sensors,
    collisionDetection,
    activeCard,
    activeGroup,
    groupTargetId,
    onDragStart,
    onDragOver,
    onDragCancel,
    onDragEnd,
  } = useBoardDragDrop({
    columns,
    applyChange,
    onDragActiveChange: handleDragActiveChange,
    onRejected: handleMutationRejected,
  })

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
  // кого мы видели раньше и авторы карточек. Словарь пересчитывается при любом изменении
  // доски, но объект меняется, только когда изменились сами имена: от него зависят карточки.
  const voterNames = useStableValue(
    useMemo(() => {
      const names: Record<string, string> = { ...knownNames }
      for (const col of columns) {
        for (const card of col.cards) {
          if (card.author_id && card.author) names[card.author_id] = card.author
        }
      }
      return names
    }, [knownNames, columns]),
    shallowEqualRecords,
  )

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
      // Задачи видны всей команде (сервер их не скрывает): пока идёт скрытый сбор,
      // текст карточки не должен попасть в «Итоги» и экспорт в обход раскрытия
      if (cardsHidden && sourceCardIds.length > 0) {
        showToast('Карточки ещё скрыты: задачу из карточки можно создать после раскрытия', 'info')
        return
      }
      try {
        const item = await createActionItem({
          board_id: board.id,
          title: 'Генерация...',
          text,
          assignee: !anonymousMode && authorHint ? authorHint : undefined,
          source_card_ids: sourceCardIds,
        })
        setActionItems((prev) => (prev.some((i) => i.id === item.id) ? prev : applyActionItemSaved(prev, item)))
        showToast('Добавлено в задачи', 'success')
        generateActionItemTitle(text)
          .then((generatedTitle) =>
            updateActionItem(item.id, { title: generatedTitle }).then((updated) => {
              setActionItems((prev) => applyActionItemSaved(prev, updated))
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
    [anonymousMode, board.id, cardsHidden, setActionItems],
  )

  const handleCreateActionItemFromCard = useCallback(
    (card: Card) => void createActionItemFromCards(card.text, [card.id], card.author),
    [createActionItemFromCards],
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const overId = event.over ? String(event.over.id) : ''
      // Бросили на панель задач: карточка возвращается на место сразу, задача создаётся следом
      if (overId === 'master-col' && activeCard) {
        const source = activeCard
        void onDragEnd({ ...event, over: null })
        if (!readOnly) {
          await createActionItemFromCards(source.text, [source.id], source.author)
        }
        return
      }

      if (overId === 'master-col' && activeGroup) {
        const source = activeGroup
        const groupCards = columns
          .flatMap((col) => col.cards)
          .filter((c) => c.group_id === source.id)
        void onDragEnd({ ...event, over: null })
        if (!readOnly) {
          const combined = groupCards.map((c) => c.text).join(' ')
          await createActionItemFromCards(
            combined || source.title,
            groupCards.map((c) => c.id),
            groupCards[0]?.author ?? null,
          )
        }
        return
      }

      void onDragEnd(event)
    },
    [activeCard, activeGroup, columns, createActionItemFromCards, onDragEnd, readOnly],
  )

  // ── Изменения доски ───────────────────────────────────────────────────────
  // Всё идёт через applyChange: ответы REST (`rest`) не затирают более свежие события
  // сокета, оптимистичные правки и откаты (`local`) применяются всегда. Обработчики не
  // зависят от состояния доски — на их неизменности держится мемоизация колонок.

  const columnsRef = useRef(columns)
  useEffect(() => {
    columnsRef.current = columns
  }, [columns])

  // Обновляются только свойства колонки: карточки и группы могли измениться, пока шёл запрос
  const handleColumnUpdate = useCallback(
    (column: Partial<ColumnInfo> & { id: string }, source?: 'rest') =>
      applyChange({ type: 'column_updated', column }, source ?? 'local'),
    [applyChange],
  )

  const handleColumnDelete = useCallback(
    (id: string) => applyChange({ type: 'column_deleted', id }),
    [applyChange],
  )

  // Сервер колонку не удалил: возвращаем её на место вместе с карточками
  const handleColumnRestore = useCallback(
    (column: ColumnType, err?: unknown) => {
      applyChange({ type: 'column_restored', column })
      if (err !== undefined) handleMutationRejected(err)
    },
    [applyChange, handleMutationRejected],
  )

  // Соседние колонки меняются местами. Сервер считает перестановкой только запрос, где
  // новое место отличается от сохранённой позиции колонки, а после удаления колонок позиции
  // идут с пропусками — поэтому двигаем ту из двух колонок, чей запрос сервер примет.
  const handleMoveColumn = useCallback(
    async (columnId: string, direction: -1 | 1) => {
      const list = columnsRef.current
      const index = list.findIndex((c) => c.id === columnId)
      const neighborIndex = index + direction
      if (index < 0 || neighborIndex < 0 || neighborIndex >= list.length) return
      const direct = list[index].position !== neighborIndex
      const moving = direct ? list[index] : list[neighborIndex]
      const target = direct ? neighborIndex : index
      const before = Object.fromEntries(list.map((c) => [c.id, c.position]))
      applyChange({ type: 'column_updated', column: { id: moving.id, position: target } })
      try {
        const updated = await updateColumn(moving.id, { position: target })
        applyChange({ type: 'column_updated', column: updated }, 'rest')
      } catch (err) {
        showToast(getApiErrorMessage(err, 'Не удалось переставить колонку'), 'error')
        applyChange({ type: 'columns_arranged', positions: before })
        handleMutationRejected(err)
      }
    },
    [applyChange, handleMutationRejected],
  )

  const handleCardCreated = useCallback(
    (card: Card) => applyChange({ type: 'card_created', card }, 'rest'),
    [applyChange],
  )

  const handleCardUpdated = useCallback(
    (card: Card) => applyChange({ type: 'card_updated', card }, 'rest'),
    [applyChange],
  )

  // Оптимистичная правка карточки или её откат: меняется одно поле текущего состояния
  const handleCardPatched = useCallback(
    (cardId: string, patch: (card: Card) => Card) =>
      applyChange({ type: 'card_patched', id: cardId, patch }),
    [applyChange],
  )

  const handleCardDeleted = useCallback(
    (cardId: string) => {
      applyChange({ type: 'card_deleted', id: cardId })
      setSelectedCardIds((prev) => {
        if (!prev.has(cardId)) return prev
        const next = new Set(prev)
        next.delete(cardId)
        return next
      })
    },
    [applyChange],
  )

  // Сервер карточку не удалил: она встаёт на прежнее место по своей позиции
  const handleCardRestored = useCallback(
    (card: Card, err?: unknown) => {
      applyChange({ type: 'card_created', card })
      if (err !== undefined) handleMutationRejected(err)
    },
    [applyChange, handleMutationRejected],
  )

  // Сервер отклонил изменение карточки (голос, цвет): локальная правка уже снята
  const handleCardRejected = useCallback(
    (err: unknown) => handleMutationRejected(err),
    [handleMutationRejected],
  )

  const handleCardMovedToColumn = useCallback(
    (card: Card) => applyChange({ type: 'card_moved', card }, 'rest'),
    [applyChange],
  )

  const handleGroupCreated = useCallback(
    (group: CardGroup, cardIds: string[]) =>
      applyChange({ type: 'group_created', group, card_ids: cardIds }, 'rest'),
    [applyChange],
  )

  const handleGroupUpdated = useCallback(
    (group: CardGroup) => applyChange({ type: 'group_updated', group }),
    [applyChange],
  )

  const handleGroupDeleted = useCallback(
    (groupId: string) => applyChange({ type: 'group_deleted', id: groupId }),
    [applyChange],
  )

  // Сервер группу не расформировал: возвращаем её вместе с карточками
  const handleGroupRestored = useCallback(
    (group: CardGroup, cardIds: string[], err?: unknown) => {
      applyChange({ type: 'group_restored', group, card_ids: cardIds })
      if (err !== undefined) handleMutationRejected(err)
    },
    [applyChange, handleMutationRejected],
  )

  // Задачи: сохранение (создание, возврат после неудачного удаления), правка и удаление
  const handleActionItemSaved = useCallback(
    (item: ActionItem) => setActionItems((prev) => applyActionItemSaved(prev, item)),
    [setActionItems],
  )
  // Правка и её откат не возвращают задачу, которую коллега успел удалить
  const handleActionItemChanged = useCallback(
    (item: ActionItem) => setActionItems((prev) => applyActionItemChanged(prev, item)),
    [setActionItems],
  )

  const handleActionItemDeleted = useCallback(
    (id: string) => setActionItems((prev) => applyActionItemDeleted(prev, id)),
    [setActionItems],
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
      applyChange({ type: 'column_created', column: col }, 'rest')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось добавить колонку'), 'error')
    }
  }

  const spotlightCardIdRef = useRef(spotlightCardId)
  useEffect(() => {
    spotlightCardIdRef.current = spotlightCardId
  }, [spotlightCardId])

  const handleSpotlight = useCallback(
    (cardId: string) => {
      const next = spotlightCardIdRef.current === cardId ? null : cardId
      sendMessage({ event: 'spotlight_card', data: { card_id: next } })
    },
    [sendMessage],
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

  // Куда можно перенести карточку из её меню. Массив меняется, только когда меняется
  // состав, название или цвет колонок, — не при каждом лайке.
  const columnsMeta = useStableValue(
    useMemo(() => columns.map((c) => ({ id: c.id, title: c.title, color: c.color })), [columns]),
    sameColumnsMeta,
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

  const handleResetMyVotes = useCallback(async () => {
    if (readOnly || resettingVotes || userTotalVotes <= 0) return
    setResettingVotes(true)
    try {
      await resetBoardVotes(board.id)
      applyChange({ type: 'votes_reset', participant_id: myId })
      showToast('Все ваши голоса сброшены', 'success')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось сбросить голоса'), 'error')
    } finally {
      setResettingVotes(false)
    }
  }, [applyChange, board.id, readOnly, resettingVotes, userTotalVotes, myId])

  // Раскрыть скрытый сбор вне сессии. В сессии карточки раскрывает переход ведущего
  // из фазы «Штурм». Остальные участники узнают о раскрытии по cards_visibility_changed.
  const handleRevealCards = useCallback(async () => {
    if (revealing) return
    setRevealing(true)
    try {
      const fresh = await revealBoardCards(board.id)
      // Ответ — доска в новом виде: применяется как снимок (с номером событий)
      applySnapshot(fresh)
      onBoardUpdated({ ...boardRef.current, ...fresh })
      showToast('Карточки раскрыты для всей команды', 'success')
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Не удалось раскрыть карточки'), 'error')
    } finally {
      setRevealing(false)
    }
  }, [applySnapshot, board.id, onBoardUpdated, revealing])

  const handleToggleSelectCard = useCallback(
    (cardId: string, shiftKey = false) => {
      if (readOnly) return
      // Скрытые до раскрытия чужие карточки в диапазон не попадают: выбрать их нельзя
      const orderedIds = columnsRef.current.flatMap((c) =>
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
    [readOnly],
  )

  // Ответ массовой операции: карточки с новыми колонкой, группой или цветом
  const applyBulkUpdatedCards = useCallback(
    (updatedCards: Card[], extraGroup?: CardGroup) => {
      if (extraGroup) applyChange({ type: 'group_created', group: extraGroup }, 'rest')
      for (const card of updatedCards) applyChange({ type: 'card_updated', card }, 'rest')
    },
    [applyChange],
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
        // Группу ответ не содержит (она придёт событием): пока собираем её сами — в конец колонки
        const lastGroupPosition = (
          columnsRef.current.find((c) => c.id === targetColId)?.groups || []
        ).reduce((max, g) => Math.max(max, g.position), -1)
        const syntheticGroup: CardGroup | undefined =
          newGroupId && targetColId
            ? {
                id: newGroupId,
                column_id: targetColId,
                title: title.trim() || 'Новая группа',
                position: lastGroupPosition + 1,
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
        applyChange({ type: 'cards_deleted', ids })
        setSelectedCardIds(new Set())
        showToast(`Удалено карточек: ${ids.length}`, 'success')
      }),
    [applyChange, runBulkAction],
  )

  const handleMergeCards = useCallback(
    (targetText: string) =>
      runBulkAction('Не удалось объединить карточки', async (ids) => {
        const merged = await mergeCards(ids, targetText)
        applyChange({ type: 'cards_deleted', ids: ids.filter((id) => id !== merged.id) })
        applyChange({ type: 'card_updated', card: merged }, 'rest')
        setSelectedCardIds(new Set())
        showToast('Дубли объединены, голоса суммированы', 'success')
      }),
    [applyChange, runBulkAction],
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
            handleGroupCreated(entry.group, entry.card_ids || [])
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
        label: masterOpen ? 'Скрыть панель «Задачи»' : 'Показать панель «Задачи»',
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
        onSelect: openSummary,
      },
      {
        id: 'mood-checkin',
        label: 'Чек-ин настроения',
        keywords: 'mood оценка',
        onSelect: () => setMoodOpen(true),
      },
      {
        id: 'health-check',
        label: 'Health check команды',
        keywords: 'health опрос чек-ин светофор здоровье команды',
        onSelect: openHealthCheck,
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
    masterOpen,
    openSummary,
    readOnly,
    userTotalVotes,
  ])

  // Перейти к карточке на своём экране: прокрутить и ненадолго подсветить
  const flashCard = useCallback((cardId: string) => {
    const el = document.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    el.setAttribute('data-flash', 'true')
    window.setTimeout(() => el.removeAttribute('data-flash'), CARD_FLASH_MS)
  }, [])

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
            flashCard(card.id)
            // Поиск карточки — личное действие: фокус всей команде включает только ведущий
            if (isFacilitator) handleSelectSpotlightCard(card.id)
          },
        })
      }
    }
    return items
  }, [columns, flashCard, handleSelectSpotlightCard, isFacilitator])

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

      // Окно или меню забирают клавиатуру целиком; поповер (таймер, реакции, участники) —
      // только Escape, которым он закрывается. Остальные клавиши доски при нём работают.
      const overlay = blockingOverlay()

      if (e.key === 'Escape') {
        if (!overlay && selectedCardIds.size > 0) {
          setSelectedCardIds(new Set())
        }
        return
      }

      if (overlay === 'modal' || overlay === 'menu') {
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

    // На фазе перехвата: поповер закрывается по Escape раньше, чем событие всплывёт до окна,
    // и к тому моменту уже не виден как открытый — Escape сбросил бы ещё и выделение
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [handleToggleMaster, readOnly, selectedCardIds.size])

  useEffect(() => {
    const open = () => healthRef.current.openDialog()
    window.addEventListener(HEALTH_CHECK_OPEN_EVENT, open)
    return () => window.removeEventListener(HEALTH_CHECK_OPEN_EVENT, open)
  }, [])

  // Сортировка по голосам и фильтры показывают карточки не в том порядке, в котором они
  // лежат на сервере: перенос записал бы место «среди видимых». На это время он отключён.
  const dragDisabledReason =
    sortBy === 'votes'
      ? 'Перетаскивание отключено, пока карточки отсортированы по голосам'
      : searchQuery.trim() || onlyMine || colorFilter
        ? 'Перетаскивание отключено, пока включён поиск или фильтр'
        : null

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
  // Объединение — и правка, и удаление: чужие карточки объединяет только модератор
  const mergeBlocked = mergeBlockedReason(selectedCards, myId, {
    anonymous: anonymousMode,
    moderator: isModerator,
    cardsHidden,
  })

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
        onOpenBoardsDrawer={() => setBoardsPanelOpen(true)}
        onOpenCommandPalette={() => setCommandOpen(true)}
        onOpenBoardSettings={() => setBoardSettingsOpen(true)}
        onOpenUserSettings={() => setUserSettingsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenMood={() => setMoodOpen(true)}
        onOpenSummary={openSummary}
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
        dragDisabledReason={readOnly ? null : dragDisabledReason}
      />

      <ConnectionBanner connection={connection} onReconnect={reconnect} />

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
        accessibility={DND_ACCESSIBILITY}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragCancel={onDragCancel}
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
                  onRestore={handleColumnRestore}
                  onMove={isModerator && !readOnly ? handleMoveColumn : undefined}
                  canMoveLeft={idx > 0}
                  canMoveRight={idx < columns.length - 1}
                  onCardCreated={handleCardCreated}
                  onCardUpdated={handleCardUpdated}
                  onCardPatched={handleCardPatched}
                  onCardDeleted={handleCardDeleted}
                  onCardRestored={handleCardRestored}
                  onCardRejected={handleCardRejected}
                  onGroupCreated={handleGroupCreated}
                  onGroupUpdated={handleGroupUpdated}
                  onGroupDeleted={handleGroupDeleted}
                  onGroupRestored={handleGroupRestored}
                  groupTargetId={groupTargetId}
                  collapsedGroups={collapsedGroups}
                  onToggleCollapse={handleToggleCollapse}
                  cardsHidden={cardsHidden}
                  anonymous={anonymousMode}
                  readOnly={readOnly}
                  cardCreationDisabled={readOnly}
                  dragDisabled={Boolean(dragDisabledReason)}
                  dragDisabledReason={dragDisabledReason}
                  searchQuery={searchQuery}
                  onlyMine={onlyMine}
                  sortBy={sortBy}
                  spotlightCardId={spotlightCardId}
                  // Фокус обсуждения — инструмент ведущего: остальным кнопка не показывается
                  onSpotlight={isFacilitator ? handleSpotlight : undefined}
                  onCreateActionItem={cardsHidden ? undefined : handleCreateActionItemFromCard}
                  onPreviewAutoCluster={handleOpenClusterPreview}
                  allowMultipleVotes={Boolean(board.allow_multiple_votes_per_card)}
                  selectedCardIds={selectedCardIds}
                  onToggleSelectCard={handleToggleSelectCard}
                  otherColumns={columnsMeta}
                  onCardMoved={handleCardMovedToColumn}
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
                aria-label="Изменить ширину панели задач"
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
                onCreated={handleActionItemSaved}
                onUpdated={handleActionItemChanged}
                onRestored={handleActionItemSaved}
                onDeleted={handleActionItemDeleted}
                dropDisabled={readOnly || cardsHidden}
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
            <SheetTitle>Задачи доски</SheetTitle>
          </SheetHeader>
          <MasterColumn
            boardId={board.id}
            actionItems={actionItems}
            participants={participants}
            onCreated={handleActionItemSaved}
            onUpdated={handleActionItemChanged}
            onRestored={handleActionItemSaved}
            onDeleted={handleActionItemDeleted}
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
        mergeBlockedReason={mergeBlocked}
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
          const allowMulti = Boolean(board.allow_multiple_votes_per_card)
          const alreadyLiked = countMyVotes(targetCard, myId) > 0
          const adding = allowMulti || !alreadyLiked
          if (adding && board.max_votes > 0 && userTotalVotes >= board.max_votes) {
            showToast(`Лимит голосов исчерпан (${userTotalVotes}/${board.max_votes})`, 'info')
            return
          }
          toggleLike(targetCard.id, allowMulti ? 'add' : 'toggle')
            .then((updated) => handleCardUpdated(updated))
            .catch((err) => showToast(getApiErrorMessage(err, 'Не удалось обновить голос'), 'error'))
        }}
      />

      {/* Health check: запустить опрос у всех может ведущий, а вне сессии — любой участник */}
      <HealthCheckDialog
        health={health}
        onStartForTeam={
          canControlSession ? () => sendMessage(HEALTH_CHECK_START) : undefined
        }
      />
      <RotiPrompt health={health} />
    </div>
  )
}
