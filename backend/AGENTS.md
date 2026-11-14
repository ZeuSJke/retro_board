# backend/AGENTS.md

Область: каталог `backend/`. Общий процесс, DoD и сквозные инварианты — в корневом [AGENTS.md](../AGENTS.md).

## Команды (из `backend/` или через `Makefile` в корне)

```bash
# В корне: make setup создаёт backend/.venv с requirements-dev.txt
.venv/bin/ruff check .
.venv/bin/alembic heads --verbose
TESTING=true DATABASE_URL=sqlite:// .venv/bin/pytest -v
TESTING=true DATABASE_URL=sqlite:// .venv/bin/pytest -v tests/test_boards.py::test_name

# Миграции и локальный запуск
.venv/bin/alembic upgrade head
.venv/bin/alembic revision --autogenerate -m "description"
.venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

- **Зависимости**: прямые — в `requirements.in` и `requirements-dev.in`, полный набор с хешами — в `requirements.txt` и `requirements-dev.txt`. Lock-файлы руками не правим: меняем `.in` и запускаем `make lock` в корне (нужен `uv`), затем `make setup`. Проверка уязвимостей — `make audit`.
- **PostgreSQL локально без Docker**: пакет `pgserver` из PyPI поднимает встроенный сервер (`pgserver.get_server(<каталог>)`, подключение по unix-сокету из `get_uri()`); годится для проверки миграций и поведения, которого нет в SQLite (блокировки, длины строк, типы). Ставь его во временное окружение, не в `requirements*.in`.
- Конфигурация `ruff` лежит в [pyproject.toml](pyproject.toml) (`select = ["E4", "E7", "E9", "F", "B"]`, `B008` игнорируется для FastAPI `Depends`, `alembic/versions` исключены).
- Для локального запуска без `TESTING=true` нужен `backend/.env` на базе [backend/.env.example](.env.example) с валидными секретами (`Settings` проверяет длину и запрещает дефолты).

## Модели, soft delete и миграции

- **Иерархия** (`app/models.py`): `Workspace` → `Board` → `Column` → `CardGroup` / `Card`, плюс `ActionItem`, `BoardSummary`, `BoardMood` и темы команды `WorkspaceTheme` ↔ `BoardTheme`.
- **Soft delete и блокировка доски**: доски удаляются через `Board.deleted_at`. Во всех хендлерах досок и дочерних сущностей используйте `require_live_board()` и `require_unlocked_board()` из `app/utils.py` (`tests/test_audit_guards.py` проверяет `404` для удалённых досок и disambiguation slug, `tests/test_v3_features.py` — `423` для заблокированных досок).
- **Уникальность**: у `Board` составные ограничения `uq_board_workspace_name` и `uq_board_workspace_slug`; коллизия slug при разных именах должна разрешаться суффиксом, а не 500.
- **Драйвер PostgreSQL** — psycopg 3. `DATABASE_URL` в окружениях задан как `postgresql://…`; драйвер подставляет `settings.sqlalchemy_database_url` — в движке и в `alembic/env.py` используйте его, а не `settings.database_url`.
- **SQLite в тестах и Alembic**: `tests/conftest.py` подменяет `ARRAY` на `JSONEncodedList` и сбрасывает `ws_manager` между тестами. Любое изменение `models.py` требует миграции в `alembic/versions/` без неэкранированного Postgres-only DDL, ломающего SQLite-тесты.

## Auth, CSRF, Rate Limiting и WebSocket

- **Auth**: workspace JWT (`app/workspace_auth.py`, библиотека PyJWT, HS256) принимается из `X-Workspace-Token` или `httpOnly` cookie `workspace_token`; `/api/admin/*` использует отдельную cookie `admin_token`.
- **CSRF** (`CSRFMiddleware` в `main.py`): небезопасные методы (кроме `/ws/*`, `/api/admin/login`, `/api/workspaces/login`, `/health`, `/api/health`) проверяют совпадение cookie `csrf_token` и `X-CSRF-Token`. Отключается только при `CSRF_ENABLED=false`; для HTTP используйте `SECURE_COOKIES=false`.
- **Rate Limiting** (`app/limiter.py`): `slowapi` включён всегда, кроме `TESTING=true` (логика лимитов тестируется в `tests/test_rate_limiting.py`). Квоты считаются по IP, а команда обычно сидит за одним адресом, поэтому для совместной работы с доской используйте `TEAM_WRITE_LIMIT` / `TEAM_READ_LIMIT`; строгие собственные лимиты — только для редких действий, входа и запросов к AI.
- **Размер запросов**: `BodySizeLimitMiddleware` (`app/body_limit.py`) отвечает `413` на тело больше `MAX_REQUEST_BODY_BYTES` до CSRF и разбора; размер WebSocket-кадра ограничивает `--ws-max-size` в `entrypoint.sh`.
- **WebSocket** (`app/routers/websocket.py`, `app/ws_manager.py`):
  - эндпоинты `/ws/{board_id}` и `/ws/workspace`;
  - `_authenticate_ws` проверяет `Origin` по `CORS_ORIGINS` и JWT (`workspace_token` cookie в приоритете, query-параметр только для совместимости);
  - `assert_single_worker()` вызывается только в `lifespan` (не на уровне импорта);
  - рассылка событий — `await manager.broadcast(board_id, "event_name", data_dict)`. В `finally` grace-таймер фасилитатора планируется синхронно до любых `await`;
  - всё, что прислал клиент, недоверенное: новые входящие события очищайте функцией из `app/ws_payloads.py` и рассылайте/сохраняйте в `ConnectionManager` только очищенный словарь с известными полями, а не исходный `data`.

## AI-интеграция (`app/ai/`)

- `ai_client.py` использует **синхронный** `httpx.Client` к OpenAI-совместимому `/v1` шлюзу (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_DISABLE_THINKING`). **Все вызовы из async-эндпоинтов/WS обязаны быть обёрнуты в `asyncio.to_thread()`**. При сбое выбрасывается `RuntimeError` — обрабатывайте или используйте детерминистический fallback (`workspace_insights.py`).
- **Соединение с БД на время вызова модели не держим**: запрос идёт до трёх минут, а пул — 15 соединений. Прочитайте всё нужное, вызовите `release_connection(db)` из `app/database.py` и только потом обращайтесь к модели; после вызова объекты сессии отсоединены — перечитывайте их заново (`tests/test_hardening.py::TestConnectionReleasedDuringAI`).
- Одновременных запросов к шлюзу — не больше `AI_MAX_CONCURRENCY`; ответ модели — недоверенный ввод, приводите его к ожидаемым типам.
- **Qwen3 reasoning**: при `AI_DISABLE_THINKING=true` передаётся `chat_template_kwargs: {"enable_thinking": False}`; без этого `max_tokens` уходит в `reasoning_content` и `content` пустой.
- **Prompt injection**: входной текст карточек/досок санитизируется и обрезается (`sanitize_prompt_text` из `app/ai/sanitize.py`, `_sanitize_text`), в запросе прямо сказано не исполнять инструкции из данных, а ответы валидируются по whitelist ID (в `clustering.py` группы из `< 2` карточек расформировываются).
- **Темы команды** (`app/themes.py`): при генерации итогов модель получает темы workspace и должна переиспользовать их названия. Что считать той же темой, решает сервер (`resolve_candidates`: совпало название → id из показанного списка → иначе новая тема), а не модель. `apply_board_themes` заменяет набор тем доски той же транзакцией, что и итоги, и выстраивает запись тем одной команды в очередь блокировкой строки workspace. Счётчики (`boards_count`, `streak`) считаются по живым доскам с итогами в порядке `Board.created_at`; `BoardSummary.key_themes` хранит те же названия для совместимости.
