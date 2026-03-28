# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RetroBoard — real-time Agile retrospective web app. Russian-language project (UI, comments, commit messages in Russian).

**Stack:** Next.js 15 + TypeScript + React 18 + Zustand + @dnd-kit | FastAPI + SQLAlchemy + PostgreSQL + Alembic | WebSocket | Docker Compose

## Build & Run Commands

### Docker (primary workflow)
```bash
docker compose up --build          # Full stack (frontend:3080, backend:8000, db:5432)
docker compose up --build -d       # Detached
docker compose down -v             # Full reset including DB volume (needed after schema changes)
docker compose up db -d            # DB only (for local dev)
```

**Docker Compose override pattern:** `docker-compose.yml` is the base (no backend volume mount). `docker-compose.override.yml` adds `./backend:/app` volume for local dev hot-reload (auto-loaded by `docker compose`). `docker-compose.prod.yml` is used in CI/CD with explicit `-f` flags (skips override). Never put dev-only volume mounts in the base file — they override container contents in production.

### Backend (local dev)
```bash
cd backend
uvicorn main:app --reload                        # Dev server → localhost:8000
pytest -v                                        # Tests (SQLite in-memory)
pytest tests/test_cards.py -v                    # Single test file
alembic revision --autogenerate -m "description" # Create migration
alembic upgrade head                             # Apply migrations
```

### Frontend (local dev)
```bash
cd frontend
npm run dev           # Dev server → localhost:3000
npm run build         # Production build (standalone)
npm run lint          # ESLint
npm test              # Vitest (all tests)
npm run test:watch    # Watch mode
```

Requires `frontend/.env.local`:
```
BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_WS_HOST=localhost:8000
```

## Architecture

### Data Flow
```
Browser ──HTTP──→ Next.js (nginx in Docker) ──/api/* rewrite──→ FastAPI ──→ PostgreSQL
Browser ──WS────→ nginx ──/ws/* proxy──→ FastAPI WebSocket handler
```

All mutations (cards, columns, groups, action items) go through REST API. Backend broadcasts changes via WebSocket to all connected clients in the board room. No polling.

### Frontend Architecture

**App.tsx** — root component, delegates timer/facilitator state to dedicated hooks, owns board CRUD, welcome dialog flow.

**BoardPage.tsx** — orchestrator: DnD context, columns, master column (action items), cursor tracking. Connects to WebSocket via `useBoardWebSocket` hook. Tracks `source_card_ids` for card-to-action-item linkage.

**PhaseProgress.tsx** — visual phase stepper (brainstorm → reveal → discuss → vote). Shows done/current/future states with connector lines and pulse animation. Facilitator can click to switch phases.

**TimerWidget.tsx** — phase-aware timer with custom time input (MM:SS), presets (2/5/10/15 min), auto-advance checkbox (auto-transitions to next phase when timer expires).

**Five custom hooks:**
- `useWebSocket` — low-level WS with auto-reconnect, ping keepalive, ref-based handler (no stale closures)
- `useBoardWebSocket` — board events: columns/cards/groups CRUD, cursors, presence, facilitator/phase, action items. Loads action items via REST on mount. Uses typed WS payload interfaces.
- `useBoardDragDrop` — @dnd-kit sensors, collision detection, optimistic card/group moves with rollback on API failure
- `useTimer` — timer state, localStorage persistence, WS event handling, `restoreTimer(id)` for board load
- `useFacilitator` — facilitator/phase state, phase change logic, next phase with optional timer reset

**Utilities:**
- `utils/boardMapper.ts` — `boardToBoardListItem()` for safe type conversion (replaces unsafe `as unknown as` casts)
- `utils/apiError.ts` — `getApiErrorMessage(error, fallback)` for safe Axios error extraction
- `utils/theme.ts` — `isLight()`, `userColor()`, `initials()`, `applyTheme()`, `CARD_COLORS`
- `utils/wsData.ts` — `asCard()`, `asColumn()`, `asGroup()`, `asActionItem()` WS data converters
- `utils/exportPDF.ts` — HTML-based PDF export with print dialog

**State:** Zustand store (`store/index.ts`) persists username, theme, currentBoardId to localStorage. Uses atomic selectors pattern (`useAppStore((s) => s.username)`) to prevent unnecessary re-renders. Board data is local component state synced via WebSocket.

**Types:** `types/index.ts` includes typed WS message payload interfaces (WsCursorMoveData, WsFacilitatorData, WsPhaseData, WsPresenceData, WsCardMovedData, WsGroupMovedData, WsDeletedData, WsGroupDeletedData, WsGroupCollapseData).

### Backend Architecture

**main.py** — FastAPI app with Alembic auto-migration on startup, global error middleware, CORS, rate limiter (slowapi).

**ws_manager.py** — `ConnectionManager` singleton: room-based WebSocket routing, per-connection username tracking, facilitator & phase state per board (in-memory, lost on restart). **IMPORTANT:** uvicorn must run with a single worker (no `--workers`). Multiple workers = separate `ConnectionManager` instances = WebSocket broadcasts don't reach all clients.

**Routers:** boards, columns, cards, groups, action_items, jira (proxy), websocket. Each mutation endpoint broadcasts via `manager.broadcast()`.

**WS message validation:** `websocket.py` validates incoming events against `KNOWN_EVENTS` frozenset, checks cursor coordinate bounds (0–10000), and validates username length (max 100).

**Async/sync trade-off:** Router handlers are `async def` because they `await manager.broadcast()`. However, they use synchronous SQLAlchemy sessions, which block the event loop during DB queries. This is acceptable because uvicorn runs with a single worker and the DB queries are fast. If this becomes a bottleneck, migrate to async SQLAlchemy (`AsyncSession` + `async_sessionmaker`) — do NOT convert handlers to `def` (sync) as that would break the broadcast await.

### WebSocket Events
All events follow `{ "event": "event_name", "data": { ... } }` format. Events: column/card/group CRUD, card_moved, cursor_move/leave, presence_update, timer_start/pause/reset, facilitator_update, phase_update, action_item CRUD (includes `status` field), group_collapse.

### Key Patterns
- **Optimistic UI + rollback:** DnD moves update UI immediately via `onDragOver`, then call API. On failure, `savedColumnsRef` restores previous state.
- **Zustand atomic selectors:** Always use `useAppStore((s) => s.field)` pattern, never destructure. Prevents re-renders when unrelated fields change.
- **Facilitator/phase:** Stored in `ConnectionManager` memory. Sent to new clients on WS connect. Phase controls card visibility (brainstorm hides others' cards). Visual stepper in `PhaseProgress.tsx`.
- **Timer per phase:** Timer is phase-aware. Auto-advance option transitions to next phase when timer expires (1.5s delay). Custom time input supports MM:SS format. Timer state persisted to localStorage.
- **Card groups:** Column-scoped. Cards have nullable `group_id` FK (SET NULL on group delete). Groups can be moved between columns as units.
- **Source card linkage:** Action items have `source_card_ids: ARRAY(String)` linking them to originating cards/groups. Used to highlight cards that already have associated action items. Set when dragging cards to MasterColumn.
- **PDF export:** Pure HTML generation in `utils/exportPDF.ts`, opened in new tab with print dialog. Includes action items section.
- **Action item statuses:** `open` → `in_progress` → `done`. Status stored in DB (`String(20)`, not Enum — SQLite compat). `completed_at` auto-set on `done`, cleared on reopen. MasterColumn shows status as read-only icon; full status management (edit title/description/assignee, change status, delete, Jira integration) is on Dashboard.
- **Dashboard (`/dashboard`):** REST-only page (no WebSocket). Shows board history with action item counts, cross-board action item list with filters (status, board, assignee). Full task card UI: inline editing of title/description/assignee, status toggle, delete, Jira integration. Done items collapse into a separate section. **Trend chart computed client-side** via `useMemo` from items + boards — updates in real-time when statuses change.
- **Board list counts:** `list_boards` endpoint uses `outerjoin(ActionItem)` + `group_by` with `func.count(case(...))` for `action_items_total` / `action_items_open`.

### Database
Alembic manages migrations. `create_all` does NOT add columns to existing tables — use `docker compose down -v && docker compose up --build` for schema changes during development. Tests use SQLite in-memory with a custom `JSONEncodedList` TypeDecorator patching ARRAY columns (`likes`, `source_card_ids`).

### Testing
- **Backend:** pytest + httpx, in-memory SQLite (`DATABASE_URL=sqlite://`), fixtures in `conftest.py`
- **Frontend:** Vitest + Testing Library + jsdom, setup in `tests/setup.ts`
- **CI:** GitHub Actions runs backend-tests (Python 3.12), frontend-lint (Node 20), frontend-tests (Node 20) on push/PR to main
