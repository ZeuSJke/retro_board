/**
 * Сигналы о списке досок между компонентами, которые не связаны пропсами.
 *
 * Список досок команды хранит `App`, а панель досок и диалог настроек рисует `BoardPage`.
 * Чтобы не тянуть через неё ещё два обработчика, эти компоненты сообщают о событиях здесь:
 *
 * - панель досок открылась — список пора перечитать (иначе счётчики карточек и задач
 *   остаются такими, какими были при загрузке страницы);
 * - участник сам удаляет доску — событие `board_deleted` от сервера придёт раньше ответа
 *   на запрос, и без пометки удаляющий получил бы второй переход и лишнее уведомление.
 */

import { isOwnBoardDeletionInUiStore, useUiStore } from '@/store/uiStore'

type Listener = () => void

const refreshListeners = new Set<Listener>()

/** Попросить владельца списка досок перечитать его с сервера. */
export function requestBoardsRefresh(): void {
  useUiStore.getState().requestBoardsRefresh()
  refreshListeners.forEach((listener) => listener())
}

/** Подписаться на просьбы перечитать список досок. Возвращает функцию отписки. */
export function onBoardsRefreshRequested(listener: Listener): () => void {
  refreshListeners.add(listener)
  return () => {
    refreshListeners.delete(listener)
  }
}

/** Отметить доску, которую текущий участник сейчас удаляет сам (до запроса на сервер). */
export function markOwnBoardDeletion(boardId: string): void {
  useUiStore.getState().markOwnBoardDeletion(boardId)
}

/** Снять отметку: удаление не удалось, доска осталась. */
export function unmarkOwnBoardDeletion(boardId: string): void {
  useUiStore.getState().unmarkOwnBoardDeletion(boardId)
}

/** Удаляет ли эту доску сам текущий участник (тогда событие `board_deleted` — не новость). */
export function isOwnBoardDeletion(boardId: string): boolean {
  return isOwnBoardDeletionInUiStore(boardId)
}
