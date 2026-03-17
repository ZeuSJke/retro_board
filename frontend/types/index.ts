export interface Board {
  id: string
  name: string
  slug: string | null
  created_at: string
  columns: Column[]
}

export interface BoardListItem {
  id: string
  name: string
  slug: string | null
  created_at: string
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
