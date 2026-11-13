import type { Board, BoardListItem } from '../types'

export function boardToBoardListItem(board: Board): BoardListItem {
  return {
    id: board.id,
    name: board.name,
    slug: board.slug,
    max_votes: board.max_votes,
    template: board.template,
    is_locked: board.is_locked,
    created_at: board.created_at,
    action_items_total: 0,
    action_items_open: 0,
    has_summary: board.has_summary ?? false,
    cards_count: board.columns?.reduce((acc, col) => acc + col.cards.length, 0) ?? 0,
    mood_avg: null,
    mood_count: 0,
  }
}
