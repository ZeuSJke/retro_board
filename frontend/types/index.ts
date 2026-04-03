export interface Board {
  id: string
  name: string
  slug: string | null
  max_votes: number
  created_at: string
  has_summary: boolean
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
  has_summary: boolean
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

// ── Typed WS event payloads ────────────────────────────────────────────────
// These cover the most common WS events for type-safe access in handlers.

export interface WsCursorMoveData {
  username: string
  x: number
  y: number
}

export interface WsCursorLeaveData {
  username: string
}

export interface WsPresenceData {
  users: string[]
}

export interface WsFacilitatorData {
  facilitator: string | null
  phase: string | null
}

export interface WsPhaseData {
  phase: string
}

export interface WsTimerStartData {
  duration: number
  remaining: number
  ts: number
}

export interface WsTimerPauseData {
  duration?: number
  remaining: number
}

export interface WsTimerResetData {
  duration: number
}

export interface WsGroupCollapseData {
  group_id: string
  collapsed: boolean
}

export interface WsCardMovedData {
  card: Card
  old_column_id: string
}

export interface WsGroupMovedData {
  group: CardGroup
  old_column_id: string
  cards: Card[]
}

export interface WsDeletedData {
  id: string
}

export interface WsGroupDeletedData {
  id: string
  column_id: string
  card_ids?: string[]
}

export interface WsAutoClusterCompletedData {
  column_id: string
  username: string
  groups_count: number
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

export interface WorkspaceSession {
  token: string
  workspaceId: string
  workspaceSlug: string
  workspaceName: string
}

export interface BoardSummary {
  id: string
  board_id: string
  session_id: string | null
  summary_text: string
  key_themes: string[]
  recommendations: string[]
  created_at: string
}

export interface AppStore {
  username: string
  currentBoardId: string | null
  theme: Theme
  workspace: WorkspaceSession | null
  setUsername: (name: string) => void
  setCurrentBoard: (id: string) => void
  setTheme: (theme: Theme) => void
  setWorkspace: (ws: WorkspaceSession | null) => void
}
