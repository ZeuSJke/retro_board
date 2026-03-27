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

**App.tsx** — root component, owns timer state, facilitator/phase state (synced from BoardPage via callbacks), board CRUD.

**BoardPage.tsx** — orchestrator: DnD context, columns, master column (action items), cursor tracking. Connects to WebSocket via `useBoardWebSocket` hook.

**Three custom hooks:**
- `useWebSocket` — low-level WS with auto-reconnect, ping keepalive, ref-based handler (no stale closures)
- `useBoardWebSocket` — board events: columns/cards/groups CRUD, cursors, presence, facilitator/phase, action items. Loads action items via REST on mount.
- `useBoardDragDrop` — @dnd-kit sensors, collision detection, optimistic card/group moves with rollback on API failure

**State:** Zustand store (`store/index.ts`) persists username, theme, currentBoardId to localStorage. Board data is local component state synced via WebSocket.

### Backend Architecture

**main.py** — FastAPI app with Alembic auto-migration on startup, global error middleware, CORS, rate limiter (slowapi).

**ws_manager.py** — `ConnectionManager` singleton: room-based WebSocket routing, per-connection username tracking, facilitator & phase state per board (in-memory, lost on restart). **IMPORTANT:** uvicorn must run with a single worker (no `--workers`). Multiple workers = separate `ConnectionManager` instances = WebSocket broadcasts don't reach all clients.

**Routers:** boards, columns, cards, groups, action_items, jira (proxy), websocket. Each mutation endpoint broadcasts via `manager.broadcast()`.

### WebSocket Events
All events follow `{ "event": "event_name", "data": { ... } }` format. Events: column/card/group CRUD, card_moved, cursor_move/leave, presence_update, timer_start/pause/reset, facilitator_update, phase_update, action_item CRUD (includes `status` field), group_collapse.

### Key Patterns
- **Optimistic UI + rollback:** DnD moves update UI immediately via `onDragOver`, then call API. On failure, `savedColumnsRef` restores previous state.
- **Facilitator/phase:** Stored in `ConnectionManager` memory. Sent to new clients on WS connect. Phase controls card visibility (brainstorm hides others' cards).
- **Card groups:** Column-scoped. Cards have nullable `group_id` FK (SET NULL on group delete). Groups can be moved between columns as units.
- **PDF export:** Pure HTML generation in `utils/exportPDF.ts`, opened in new tab with print dialog. Includes action items section.
- **Action item statuses:** `open` → `in_progress` → `done`. Status stored in DB (`String(20)`, not Enum — SQLite compat). `completed_at` auto-set on `done`, cleared on reopen. MasterColumn has clickable status toggle icon.
- **Dashboard (`/dashboard`):** REST-only page (no WebSocket). Shows board history with action item counts, cross-board action item list with filters (status, board, assignee), carry-forward to copy unresolved items between boards.
- **Board list counts:** `list_boards` endpoint uses `outerjoin(ActionItem)` + `group_by` with `func.count(case(...))` for `action_items_total` / `action_items_open`.

### Database
Alembic manages migrations. `create_all` does NOT add columns to existing tables — use `docker compose down -v && docker compose up --build` for schema changes during development. Tests use SQLite in-memory with a custom `JSONEncodedList` TypeDecorator patching the `likes` ARRAY column.

### Testing
- **Backend:** pytest + httpx, in-memory SQLite (`DATABASE_URL=sqlite://`), fixtures in `conftest.py`
- **Frontend:** Vitest + Testing Library + jsdom, setup in `tests/setup.ts`
- **CI:** GitHub Actions runs backend-tests (Python 3.12), frontend-lint (Node 20), frontend-tests (Node 20) on push/PR to main
