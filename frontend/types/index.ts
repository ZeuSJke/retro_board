export interface Board {
  id: string
  name: string
  slug: string | null
  max_votes: number
  created_at: string
  columns: Column[]
}

export interface BoardListItem {
  id: string
  name: string
  slug: string | null
  max_votes: number
  created_at: string
  action_items_total: number
  action_items_open: number
}

export interface Column {
  id: string
  board_id: string
  title: string
  color: string
  position: number
  cards: Card[]
  groups: CardGroup[]
}

export interface Card {
  id: string
  column_id: string
  group_id: string | null
  text: string
  author: string
  color: string
  position: number
  likes: string[]
  created_at: string
}

export interface CardGroup {
  id: string
  column_id: string
  title: string
  position: number
}

export type ActionItemStatus = 'open' | 'in_progress' | 'done'

export interface ActionItem {
  id: string
  board_id: string
  title: string
  text: string
  assignee: string | null
  jira_issue_key: string | null
  source_card_ids: string[]
  status: ActionItemStatus
  completed_at: string | null
  created_at: string
}

export interface DashboardActionItem extends ActionItem {
  board_name: string
}

export interface CarryForwardRequest {
  source_board_id: string
  target_board_id: string
}

export interface TrendPoint {
  board_id: string
  board_name: string
  created_at: string
  open: number
  in_progress: number
  done: number
  total: number
}

export interface WsMessage {
  event: string
  data: Record<string, unknown>
}

export interface TimerState {
  duration: number
  remaining: number
  running: boolean
}

export interface Theme {
  primary: string
  dark: boolean
}

export interface AppStore {
  username: string
  currentBoardId: string | null
  theme: Theme
  setUsername: (name: string) => void
  setCurrentBoard: (id: string) => void
  setTheme: (theme: Theme) => void
}
