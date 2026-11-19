# backend/AGENTS.md

Область: каталог `backend/`. Общий процесс, DoD и сквозные инварианты — в корневом [AGENTS.md](../AGENTS.md).

## Команды (из `backend/` или через `Makefile` в корне)

```bash
# В корне: make setup создаёт backend/.venv с requirements-dev.txt
.venv/bin/ruff check .
.venv/bin/mypy app main.py
.venv/bin/alembic heads --verbose
TESTING=true DATABASE_URL=sqlite:// .venv/bin/pytest -v
TESTING=true DATABASE_URL=sqlite:// .venv/bin/pytest -v tests/test_boards.py::test_name
# Тот же набор на настоящем PostgreSQL (пустая база; в CI — джоба backend-tests-pg)
TESTING=true DATABASE_URL=sqlite:// TEST_DATABASE_URL=postgresql://… .venv/bin/pytest -q

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

- **Иерархия** (`app/models.py`): `Workspace` → `Board` → `Column` → `CardGroup` / `Card`, плюс `ActionItem`, `BoardSummary`, `BoardMood`, `Participant` (участник команды) и темы команды `WorkspaceTheme` ↔ `BoardTheme`.
- **Участник и личность**: вход создаёт `Participant`, его `id` лежит в токене сессии. Автора, голосующего, владельца оценки и ведущего берите только из `Depends(get_current_participant)` (в WebSocket — из `manager.get_peer(ws)`), **никогда из тела запроса или сообщения клиента**. Имя участника — подпись: `Card.author` и `BoardMood.author` хранят его снимок, личность — в `author_id` / `participant_id` (у данных, созданных до участников, они пустые). `Card.likes` — идентификаторы участников, по одному на голос.
- **Вид для получателя** (`app/board_view.py`): карточки, доску и настроение отдавайте через `card_view` / `board_view` / `mood_view`, события о карточках — через `broadcast_card` (`manager.broadcast_each`). Они скрывают текст и автора чужих карточек, пока `cards_hidden(board)`, и имена в анонимном режиме. Не сериализуйте ORM-карточку напрямую и не кладите карточки в общие события (`column_updated` несёт только свойства колонки). Эндпоинты, читающие тексты всех карточек (AI), начинайте с `require_cards_visible(board)`.
- **Health check** (`app/health.py`, `app/routers/health.py`): вопросы зашиты в код — меняя их состав, ломаешь сравнение между спринтами; наружу отдаётся только сводка и собственные ответы участника. Роутер подключён раньше досок, чтобы статические пути не перехватил `/{board_id}`.
- **Права**: текст карточки правит автор (`can_edit_card_text`), удаляет автор или модератор (`can_delete_card`); доску и колонку с карточками удаляет модератор (`require_moderator`) — создатель доски или ведущий активной сессии; у досок без создателя (до участников) — любой.
- **Soft delete и блокировка доски**: доски удаляются через `Board.deleted_at`. Во всех хендлерах досок и дочерних сущностей используйте `require_live_board()` и `require_unlocked_board()` из `app/utils.py` (`tests/test_audit_guards.py` проверяет `404` для удалённых досок и disambiguation slug, `tests/test_v3_features.py` — `423` для заблокированных досок).
- **Уникальность и пагинация**: у `Board` частичные уникальные индексы `uq_board_workspace_name` и `uq_board_workspace_slug` (`WHERE deleted_at IS NULL`, миграция `0015`) — soft-deleted доски не мешают повторно использовать имя или slug, а коллизия slug при разных именах должна разрешаться суффиксом, а не 500. Списочные ручки с `limit`/`offset` (`/api/boards/`, `/api/action-items/all`, `/api/admin/workspaces`) возвращают заголовок `X-Total-Count` (проброшен через CORS `expose_headers`).
- **Драйвер PostgreSQL** — psycopg 3. `DATABASE_URL` в окружениях задан как `postgresql://…`; драйвер подставляет `settings.sqlalchemy_database_url` — в движке и в `alembic/env.py` используйте его, а не `settings.database_url`.
- **Журнал, пробы и метрики**: формат журнала с идентификатором запроса задаёт `app/request_context.py` (`LOG_FORMAT=text|json`, `X-Request-ID` в ответе и `[id]` / `"request_id"` в каждой записи); пишите через `logging`, не через `print`. `/api/health` — живость процесса, `/api/ready` — готовность с проверкой БД, `/metrics` (`app/observability.py`) — метрики Prometheus (`retro_*`).
- **Тесты на двух СУБД**: `tests/conftest.py` по умолчанию поднимает SQLite, а с `TEST_DATABASE_URL` — PostgreSQL; пишите тесты так, чтобы они проходили на обеих (без SQLite-специфики и без зависимости от порядка строк без `ORDER BY`). `alembic check` в CI сверяет модели со схемой: изменил модель — добавь миграцию.
- **SQLite в тестах и Alembic**: `tests/conftest.py` подменяет `ARRAY` на `JSONEncodedList` и сбрасывает `ws_manager` между тестами. Любое изменение `models.py` требует миграции в `alembic/versions/` без неэкранированного Postgres-only DDL, ломающего SQLite-тесты.

## Auth, CSRF, Rate Limiting и WebSocket

- **Сессия**: JWT содержит `pid` (участник) и `epoch` (поколение токенов команды); `resolve_session` отвечает 401 на токен без участника, чужого участника и устаревшее поколение. Смена ключа доступа увеличивает `Workspace.token_epoch` и перевыпускает ссылку-приглашение — так отзываются сессии участников и старые инвайты; токены агентов (`AgentToken`) при этом сохраняются, если не передан `revoke_agent_tokens=true` в `/api/admin/workspaces/{workspace_id}`. `GET /api/workspaces/me` продлевает сессию.
- **Auth**: workspace JWT (`app/workspace_auth.py`, библиотека PyJWT, HS256) принимается из `X-Workspace-Token` или `httpOnly` cookie `workspace_token`; `/api/admin/*` использует отдельную cookie `admin_token`.
- **CSRF** (`CSRFMiddleware` в `main.py`): небезопасные методы (кроме `/ws/*`, `/api/admin/login`, `/api/workspaces/login`, `/health`, `/api/health`) проверяют совпадение cookie `csrf_token` и `X-CSRF-Token`. Отключается только при `CSRF_ENABLED=false`; для HTTP используйте `SECURE_COOKIES=false`.
- **Rate Limiting** (`app/limiter.py`): `slowapi` включён всегда, кроме `TESTING=true` (логика лимитов тестируется в `tests/test_rate_limiting.py`). Квоты считаются по IP, а команда обычно сидит за одним адресом, поэтому для совместной работы с доской используйте `TEAM_WRITE_LIMIT` / `TEAM_READ_LIMIT`; строгие собственные лимиты — только для редких действий, входа и запросов к AI.
- **Размер запросов**: `BodySizeLimitMiddleware` (`app/body_limit.py`) отвечает `413` на тело больше `MAX_REQUEST_BODY_BYTES` до CSRF и разбора; размер WebSocket-кадра ограничивает `--ws-max-size` в `entrypoint.sh`.
- **WebSocket** (`app/routers/websocket.py`, `app/ws_manager.py`):
  - эндпоинты `/ws/{board_id}` и `/ws/workspace`;
  - `_authenticate_ws` проверяет `Origin` по `CORS_ORIGINS` и JWT (`workspace_token` cookie в приоритете, query-параметр только для совместимости);
  - `assert_single_worker()` вызывается только в `lifespan` (не на уровне импорта);
  - личность сокета — `Peer(id, name)` участника из сессии, фиксируется при подключении; `identify` её не меняет. Ведущий хранится по `participant_id`: роль переживает переподключение, передаётся (`facilitator_transfer`) и перехватывается у пропавшего ведущего (`facilitator_takeover`, порог `FACILITATOR_TAKEOVER_SECONDS`); сессия без ведущего завершается через `FACILITATOR_GRACE_SECONDS`, в том числе восстановленная из БД после рестарта;
  - события, меняющие данные доски, получают номер `seq` (список — `SEQUENCED_EVENTS` в `app/ws_manager.py`): новое событие с данными доски добавляйте в этот список, иначе клиент не заметит его потерю. Состояние таймера (серверное `ends_at_ms` только внутри БД), фокуса и свёрнутых групп (`groups_collapsed`) сохраняется в `Board.session_state` (`_persist_session_state`) и поднимается `manager.restore_state` один раз после рестарта;
  - рассылка событий — `await manager.broadcast(board_id, "event_name", data_dict)`; если разным получателям положены разные данные — `manager.broadcast_each`. В `finally` grace-таймер фасилитатора планируется синхронно до любых `await`;
  - всё, что прислал клиент, недоверенное: новые входящие события описывайте Pydantic-схемами в `app/ws_schemas.py` с опорой на общие ограничители из `app/ws_payloads.py`, передавая в обработчики и `ConnectionManager` только очищенный словарь с известными полями, а не исходный `data`.

## AI-интеграция (`app/ai/`)

- `ai_client.py` использует **синхронный** `httpx.Client` к OpenAI-совместимому HTTPS `/v1` шлюзу; настройки подключения и уровень размышлений (`reasoning_effort`) задаются в `/admin` и хранятся в `AISettings` (`app/services/ai_settings.py`, ключ шифруется `Fernet` + `HKDF`, активная конфигурация кэшируется в памяти процесса). **Все вызовы из async-эндпоинтов/WS обязаны быть обёрнуты в `asyncio.to_thread()`**. При сбое выбрасывается `RuntimeError` — обрабатывайте или используйте детерминистический fallback (`workspace_insights.py`).
- **Соединение с БД на время вызова модели не держим**: запрос идёт до трёх минут, а пул — 15 соединений. Прочитайте всё нужное, вызовите `release_connection(db)` из `app/database.py` и только потом обращайтесь к модели; после вызова объекты сессии отсоединены — перечитывайте их заново (`tests/test_hardening.py::TestConnectionReleasedDuringAI`).
- Одновременных запросов к шлюзу — не больше `AI_MAX_CONCURRENCY`; ответ модели — недоверенный ввод, приводите его к ожидаемым типам.
- **Reasoning и Structured JSON**: `build_chat_payload` автоматически расширяет `max_tokens` (`effective_max_tokens`), пока `reasoning_effort != "none"`, для JSON-промптов передаёт `response_format={"type": "json_object"}` с автоматическим fallback при HTTP `400`/`422`, а ответ очищается от `<think>...</think>`.
- **Prompt injection**: входной текст карточек/досок санитизируется и обрезается (`sanitize_prompt_text` из `app/ai/sanitize.py`, `_sanitize_text`), в запросе прямо сказано не исполнять инструкции из данных, а ответы валидируются по whitelist ID (в `clustering.py` группы из `< 2` карточек расформировываются).
- **Темы команды** (`app/themes.py`): при генерации итогов модель получает темы workspace и должна переиспользовать их названия. Что считать той же темой, решает сервер (`resolve_candidates`: совпало название → id из показанного списка → иначе новая тема), а не модель. `apply_board_themes` заменяет набор тем доски той же транзакцией, что и итоги, и выстраивает запись тем одной команды в очередь блокировкой строки workspace. Счётчики (`boards_count`, `streak`) считаются по живым доскам с итогами в порядке `Board.created_at`; `BoardSummary.key_themes` хранит те же названия для совместимости.

## Общие сервисы, MCP (`/mcp`) и токены агентов

- **Единый сервисный слой (`app/services/`)**: REST-роутеры (`boards.py`, `cards.py`, `action_items.py`, `agent_tokens.py`) и MCP-инструменты вызывают общие функции из `app/services/`. Синхронные операции записи (`*_sync`) не рассылают WebSocket внутри транзакции, а возвращают пару `(результат, broadcasts: list[BroadcastAction])`: вызывающий закрывает/освобождает сессию БД (`release_connection(db)` или выход из `with open_db_session()` в `anyio.to_thread.run_sync`) **до** вызова `await dispatch_broadcasts(broadcasts)`. События карточек собираются через `card_broadcast_action`, снимающую нужные поля до закрытия транзакции.
- **Поиск досок по ID/slug (`app/services/common.py`)**: REST-эндпоинты обязаны использовать строгий режим (`lookup="id"` для `/{board_id}`, `lookup="slug"` для `/by-slug/{slug}`), чтобы коллизия `slug` одной доски с `id` другой не ломала открытие; MCP-инструменты используют `lookup="id_or_slug"`, где при совпадении детерминированно побеждает `Board.id`.
- **Соглашения MCP (`app/mcp/`)**:
  - Эндпоинт `/mcp` работает в режиме Streamable HTTP (`stateless_http=True`, `json_response=True`, GET/DELETE отклоняются со статусом `405`).
  - Каждый `@mcp.tool` обязан явно задавать `annotations` (`_READ_ANNOTATIONS`, `_WRITE_ADDITIVE_ANNOTATIONS`, `_WRITE_UPDATE_ANNOTATIONS`). `_WRITE_TOOLS` должен в точности совпадать с множеством инструментов без `readOnlyHint=True`, а каждый пишущий инструмент первым делом вызывает `_require_write_scope(ctx, "<name>")`. Тест `test_mcp_tool_annotations_and_write_tools_match` проверяет это автоматически.
  - Приватность доски соблюдается через `card_view` / `board_view` / `require_cards_visible` / `cards_hidden`: скрытые чужие карточки приходят агенту замаскированными (`masked=True`), а карточки агента сохраняют `author_kind="agent"` и имя агента в анонимном режиме.
  - В тестах БД для MCP переключается через `set_db_session_factory(...)` (`app/mcp/context.py`), без привязки к FastAPI `app.dependency_overrides`.
- **Токены агентов (`AgentToken`, `app/services/agent_tokens.py`)**:
  - Bearer-токен формата `rba_...` хранится в виде SHA-256 хэша (`token_hash`) и префикса; выпускается и отзывается любым участником команды (или администратором), связан с бот-`Participant` (`author_kind="agent"` на карточках) и **независим от смены `access_key` / `Workspace.token_epoch`** (в `/api/admin/workspaces/{workspace_id}` администратор может отозвать все токены вместе со сменой ключа явным флагом `revoke_agent_tokens=true`).
  - Ограничитель `app/mcp/rate_limit.py` держит независимые корзины по `token_id` (общий лимит 120/мин и отдельный 30/мин для `create_board`) и cooldown по IP: `is_auth_failure_blocked(client_ip)` проверяется **до** обращения к БД/threadpool (`_authenticate_agent_sync`), неудача записывается через `record_auth_failure(client_ip)`.
  - `ActionItem.external_url` валидируется схемой (только `http`/`https` с непустым доменом); на заблокированной доске (`is_locked=True`) агент может обновлять только `status` и `external_url`.
