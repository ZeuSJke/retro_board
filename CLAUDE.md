# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RetroBoard — real-time Agile retrospective board.
**Stack**: Next.js 15 (App Router, TypeScript) · FastAPI · PostgreSQL · WebSocket · Docker
**Language**: Project communication is in Russian; user-facing UI strings, prompts, and commit messages are typically Russian.

## Commands

### Docker (primary workflow)
```bash
docker compose up --build              # build & run (http://localhost:3080)
docker compose up db -d                # only the database
docker compose down -v                 # full reset including DB volumes
```

### Backend (from `backend/`)
```bash
pip install -r requirements.txt
pip install -r requirements-dev.txt    # for tests
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Migrations
alembic upgrade head
alembic revision --autogenerate -m "description"

# Tests run against SQLite in-memory — set both env vars
TESTING=true DATABASE_URL=sqlite:// pytest -v
TESTING=true DATABASE_URL=sqlite:// pytest -v tests/test_boards.py
TESTING=true DATABASE_URL=sqlite:// pytest -v tests/test_boards.py::test_name
```

### Frontend (from `frontend/`)
```bash
npm run dev                            # dev server (http://localhost:3000)
npm run build
npm run lint
npm test                               # Vitest (all)
npx vitest run tests/store/index.test.ts   # single Vitest file

# Playwright E2E — requires the full Docker stack running
ADMIN_LOGIN=testadmin ADMIN_PASSWORD=testpassword123 npx playwright test
```

## Architecture

### Frontend ↔ backend wiring
- **REST**: Axios client (`frontend/api/index.ts`) calls `/api/*`; `next.config.mjs` rewrites proxy to backend. Auto-injects `X-Workspace-Token` and `X-CSRF-Token` on mutations. Errors have shape `{ response: { status, data: { detail } } }`.
- **WebSocket**: Direct connection to `ws://HOST/ws/{board_id}?workspace_token=TOKEN` with auto-reconnect (2s backoff, 25s ping). Event format: `{ "event": "name", "data": { ... } }`.
- **Auth**: `X-Workspace-Token` JWT for board routes, separate admin JWT for `/api/admin/*`. CSRF cookie + header on all mutations.

### Backend
- **Models** (`app/models.py`): `Workspace → Board → Column → Card/CardGroup`, plus `ActionItem` and `BoardSummary` per board. Boards use **soft delete** via `deleted_at`; do not physically remove them. `Board` has a composite uniqueness on `(workspace_id, name)` and `(workspace_id, slug)`.
- **WebSocket manager** (`app/ws_manager.py`): in-memory singleton tracking rooms, usernames, facilitators, phases, timer state, and session_ids. **This requires a single uvicorn worker** — do not scale workers without moving state out of process. Broadcast with `await manager.broadcast(board_id, "event_name", data_dict)` (NOT `broadcast_to_board()`).
- **Auth dependencies** (`app/workspace_auth.py`): `get_current_workspace()` for board routes, `get_admin_user()` for admin routes.
- **Rate limiting** (`app/limiter.py`, slowapi): 100/min reads, 30/min writes, 5/min AI, 20 msg/sec WebSocket. **Disabled when `TESTING=true`** (unit tests and E2E) — E2E creates ~35 boards per minute and would trip the 30/min write limit; prod limits are unchanged. The limiter itself is verified in `tests/test_rate_limiting.py` (it flips `limiter.enabled = True` and asserts 429).
- **Config** (`app/config.py`): Pydantic Settings v2 — must keep `extra="ignore"` so extra Docker env vars don't blow up startup.

### AI (`app/ai/`)
- **`ai_client.py`**: shared **synchronous** httpx client against OpenRouter. `ai_client.generate()` blocks the event loop — **always wrap calls in `asyncio.to_thread()` from async endpoints**. May raise `RuntimeError`, `KeyError`, `IndexError`; catch broadly.
- **Default model**: `google/gemini-3-flash-preview` (set in `AIModelConfig`). All three call sites — `ai_client.py` default, `summary_generation.py`, `title_generation.py`, `clustering.py` — should stay on the same model unless one is intentionally diverged. When a hosted model disappears from OpenRouter, all of them break together; check `docker compose logs backend | grep -i openrouter` for 403/404 first.
- **`clustering.py`**: AI clustering for cards (`POST /api/groups/auto-cluster`). Validates AI response: card IDs are checked against a whitelist, groups with <2 cards are dissolved, card text is sanitized before insertion into the prompt (quotes stripped, control chars removed, truncated). Reuses existing WS events (`group_created`, `card_updated`) plus `auto_cluster_completed`.
- **`prompts/`**: summary generation (auto-triggered on phase change to `summary`) and action-item title generation. Prompts are mostly English even for Russian content — works better with the current model.
- **Prompt-injection defense**: always sanitize user-supplied text before inserting it into prompts; always validate AI output against whitelists or schemas.

### Tests
- **Backend** (pytest): `tests/conftest.py` sets `DATABASE_URL=sqlite://` and `TESTING=true`, then patches `ARRAY(String)` columns with a `JSONEncodedList` `TypeDecorator` so PostgreSQL array fields work on SQLite. Any new model column using `ARRAY` must be covered by this decorator path or tests will break.
- **Frontend unit**: Vitest + Testing Library in `frontend/tests/`.
- **E2E**: Playwright in `frontend/e2e/` runs against the live Docker stack.

### Database migrations
Every change to `models.py` requires an Alembic revision. Because tests run on SQLite, avoid Postgres-only DDL inside migrations unless gated; prefer SQLAlchemy types that the `JSONEncodedList` decorator already handles.

### Frontend patterns
- **Zustand store** (`frontend/store/index.ts`): persisted global state (username, theme, workspace token, current board).
- **WS event handling** (`hooks/useBoardWebSocket.ts`): all real-time events flow through a single switch-case inside the `setColumns` updater. New server events only need a new case there.
- **Dialog closing** (`components/Dialog.tsx`): uses an `onMouseDown`/`onMouseUp` pair on the overlay to avoid false closes when text selection drags off the dialog. Reuse this component for new modals.
- **Server Components by default**; add `'use client'` only when needed. Path alias: `@/*` → `frontend/`.
- **Toasts**: `import { showToast } from '../store/toastStore'` → `showToast('message', 'info' | 'error')`.

### CI/CD
- The repo lives on GitLab (`gitlab.kirillbessonov.ru/fmrm/retro_board`); GitHub is only a mirror. Work happens through **merge requests** (not pull requests), using **glab** instead of `gh`.
- **CI** (`.gitlab-ci.yml`, GitLab CI): backend pytest, frontend lint/build/test, Playwright E2E. Runner is self-hosted (tag `homelab`), base image `registry.kirillbessonov.ru/tools/ci-base` (tag via `variables.CI_BASE_IMAGE`). No Docker daemon on the stand: image builds would go through buildctl, E2E runs processes directly + a PostgreSQL GitLab CI service.
- **CD**: removed; deployment is performed manually through Dokploy. CI remains unchanged.

### GitLab workflow (glab)
```bash
# Создать merge request из текущей ветки в main
glab mr create --title "Краткое описание" --description "Что и зачем" --yes

# Статус пайплайна текущей ветки (--live — следить в реальном времени)
glab ci status --live
glab ci status --wait          # дождаться завершения и выйти

# Логи конкретной джобы (по имени или id)
glab ci trace e2e-tests

# Валидация .gitlab-ci.yml перед пушем
glab ci lint
```
