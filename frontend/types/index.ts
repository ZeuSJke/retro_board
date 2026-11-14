export interface BoardMood {
  id: string
  board_id: string
  author: string
  score: number
  note: string | null
  created_at: string
}

export interface ColumnSeed {
  title: string
  color: string
}

export interface BoardTemplateInfo {
  id: string
  name: string
  description: string
  columns: ColumnSeed[]
}

export interface Board {
  id: string
  name: string
  slug: string | null
  max_votes: number
  template?: string
  is_locked?: boolean
  hide_cards_until_reveal?: boolean
  anonymous_votes?: boolean
  allow_multiple_votes_per_card?: boolean
  active_facilitator?: string | null
  active_phase?: string | null
  active_session_id?: number | null
  created_at: string
  has_summary?: boolean
  columns: Column[]
  moods?: BoardMood[]
}

export interface BoardCreatePayload {
  name: string
  max_votes?: number
  template?: string
  custom_columns?: ColumnSeed[]
  source_board_id?: string | null
  carry_forward_items?: boolean
  hide_cards_until_reveal?: boolean
  anonymous_votes?: boolean
  allow_multiple_votes_per_card?: boolean
}

export interface BoardUpdatePayload {
  name?: string
  max_votes?: number
  is_locked?: boolean
  hide_cards_until_reveal?: boolean
  anonymous_votes?: boolean
  allow_multiple_votes_per_card?: boolean
}

export interface BoardListItem {
  id: string
  name: string
  slug: string | null
  max_votes: number
  template?: string
  is_locked?: boolean
  created_at: string
  action_items_total: number
  action_items_open: number
  has_summary: boolean
  cards_count?: number
  mood_avg?: number | null
  mood_count?: number
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

export interface MoodTrendPoint {
  board_id: string
  board_name: string
  created_at: string
  mood_avg: number | null
  mood_count: number
  cards_count: number
  action_items_total: number
  action_items_done: number
}

export interface WorkspaceInsights {
  recurring_themes: string[]
  recommendations: string[]
  summary_text: string
  boards_analyzed: number
  generated_by_ai: boolean
}

export interface ReactionBubble {
  id: string
  emoji: string
  username: string
  xOffset: number
}

export interface WsMessage {
  event: string
  data: Record<string, unknown>
}

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

export interface WsSummaryFailedData {
  message: string
}

export interface WsBoardUpdatedData {
  id: string
  name?: string
  slug?: string
  max_votes?: number
  template?: string
  is_locked?: boolean
  hide_cards_until_reveal?: boolean
  anonymous_votes?: boolean
  allow_multiple_votes_per_card?: boolean
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
  session_id: string | number | null
  summary_text: string
  key_themes: string[]
  recommendations: string[]
  created_at: string
}

export interface AppStore {
  username: string
  currentBoardId: string | null
  theme: Theme
  dotGrid: boolean
  workspace: WorkspaceSession | null
  _hasHydrated?: boolean
  setUsername: (name: string) => void
  setCurrentBoard: (id: string) => void
  setTheme: (theme: Theme) => void
  setDotGrid: (enabled: boolean) => void
  setWorkspace: (ws: WorkspaceSession | null) => void
  setHasHydrated?: (hydrated: boolean) => void
}

export interface TypingUser {
  username: string
  column_id: string
}

export interface ActionItemSuggestion {
  title: string
  text: string
  assignee_hint?: string | null
  source_card_ids: string[]
}

export interface AutoClusterPreviewGroup {
  title: string
  card_ids: string[]
}

export interface AutoClusterPreviewResult {
  column_id: string
  groups: AutoClusterPreviewGroup[]
  ungrouped_card_ids: string[]
}
