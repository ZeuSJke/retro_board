import { useCallback, useEffect, useMemo } from 'react'
import { blockingOverlay } from '@/lib/hotkeys'
import type { CommandBoardAction, CommandSearchCard } from '../components/CommandPalette'
import { openHealthCheck } from '../components/HealthCheckButton'
import type { Column as ColumnType } from '../types'

/** Сколько карточка остаётся подсвеченной после перехода к ней из палитры команд. */
const CARD_FLASH_MS = 2200

interface UseBoardShortcutsOptions {
  columns: ColumnType[]
  masterOpen: boolean
  hasGroups: boolean
  allGroupsCollapsed: boolean
  readOnly: boolean
  userTotalVotes: number
  aiEnabled: boolean | null
  isFacilitator: boolean
  selectedCount: number
  onFocusSearch: () => void
  onToggleMaster: () => void
  onToggleCollapseAllGroups: () => void
  onResetMyVotes: () => Promise<void>
  onOpenBoardSettings: () => void
  onOpenSummary: () => void
  onOpenMood: () => void
  onOpenShortcuts: () => void
  onToggleReactionsPopover: () => void
  onOpenReactionsPopover: () => void
  onClearSelection: () => void
  onSelectSpotlightCard: (cardId: string) => void
}

/** Палитра команд доски, поиск карточек и глобальные горячие клавиши доски. */
export function useBoardShortcuts({
  columns,
  masterOpen,
  hasGroups,
  allGroupsCollapsed,
  readOnly,
  userTotalVotes,
  aiEnabled,
  isFacilitator,
  selectedCount,
  onFocusSearch,
  onToggleMaster,
  onToggleCollapseAllGroups,
  onResetMyVotes,
  onOpenBoardSettings,
  onOpenSummary,
  onOpenMood,
  onOpenShortcuts,
  onToggleReactionsPopover,
  onOpenReactionsPopover,
  onClearSelection,
  onSelectSpotlightCard,
}: UseBoardShortcutsOptions) {
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
        onSelect: onFocusSearch,
      },
      {
        id: 'toggle-master',
        label: masterOpen ? 'Скрыть панель «Задачи»' : 'Показать панель «Задачи»',
        keywords: 'action items задачи итоги',
        shortcut: 'M',
        onSelect: onToggleMaster,
      },
      {
        id: 'open-reactions',
        label: 'Отправить быструю реакцию',
        keywords: 'эмодзи emoji reaction',
        shortcut: 'R',
        onSelect: onOpenReactionsPopover,
      },
    )
    if (hasGroups) {
      list.push({
        id: 'toggle-groups',
        label: allGroupsCollapsed ? 'Развернуть все группы' : 'Свернуть все группы',
        keywords: 'collapse expand groups кластеры',
        onSelect: onToggleCollapseAllGroups,
      })
    }
    if (!readOnly && userTotalVotes > 0) {
      list.push({
        id: 'reset-votes',
        label: 'Сбросить все мои голоса',
        keywords: 'reset votes лайки',
        onSelect: () => void onResetMyVotes(),
      })
    }
    list.push(
      {
        id: 'board-settings',
        label: 'Настройки доски',
        keywords: 'settings лимит голосов таймер слепой',
        onSelect: onOpenBoardSettings,
      },
      {
        id: 'ai-summary',
        label: aiEnabled === false ? 'Итоги ретроспективы и экспорт' : 'AI-резюме ретроспективы',
        keywords: 'summary итоги отчет',
        onSelect: onOpenSummary,
      },
      {
        id: 'mood-checkin',
        label: 'Чек-ин настроения',
        keywords: 'mood оценка',
        onSelect: onOpenMood,
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
        onSelect: onOpenShortcuts,
      },
    )
    return list
  }, [
    aiEnabled,
    allGroupsCollapsed,
    hasGroups,
    masterOpen,
    onFocusSearch,
    onOpenBoardSettings,
    onOpenMood,
    onOpenReactionsPopover,
    onOpenShortcuts,
    onOpenSummary,
    onResetMyVotes,
    onToggleCollapseAllGroups,
    onToggleMaster,
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
            if (isFacilitator) onSelectSpotlightCard(card.id)
          },
        })
      }
    }
    return items
  }, [columns, flashCard, isFacilitator, onSelectSpotlightCard])

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
        if (!overlay && selectedCount > 0) {
          onClearSelection()
        }
        return
      }

      if (overlay === 'modal' || overlay === 'menu') {
        return
      }

      if (e.key === '?') {
        e.preventDefault()
        onOpenShortcuts()
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
        onFocusSearch()
        return
      }

      if (e.code === 'KeyM') {
        e.preventDefault()
        onToggleMaster()
        return
      }

      if (e.code === 'KeyR') {
        e.preventDefault()
        onToggleReactionsPopover()
      }
    }

    // На фазе перехвата: поповер закрывается по Escape раньше, чем событие всплывёт до окна,
    // и к тому моменту уже не виден как открытый — Escape сбросил бы ещё и выделение
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    onClearSelection,
    onFocusSearch,
    onOpenShortcuts,
    onToggleMaster,
    onToggleReactionsPopover,
    readOnly,
    selectedCount,
  ])

  return { commandBoardActions, commandSearchCards }
}
