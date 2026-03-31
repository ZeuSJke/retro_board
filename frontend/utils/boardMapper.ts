import type { Board, BoardListItem } from '../types'

/**
 * Convert a Board (returned by createBoard) to a BoardListItem
 * (used in the boards list). A newly created board has zero action items.
 */
export function boardToBoardListItem(board: Board): BoardListItem {
  return {
    id: board.id,
    name: board.name,
    slug: board.slug,
    max_votes: board.max_votes,
    created_at: board.created_at,
    action_items_total: 0,
    action_items_open: 0,
    has_summary: board.has_summary ?? false,
  }
}
