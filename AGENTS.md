# AGENTS.md

Руководство для ИИ-агентов и разработчиков, работающих с репозиторием RetroBoard / Stratum.

## 1. Обзор проекта и язык

**RetroBoard (Stratum)** — веб-приложение для командных Agile-ретроспектив в реальном времени.
- **Стек**: Next.js 15 (App Router, TypeScript, Tailwind CSS, shadcn/ui + Radix UI, Zustand, `@dnd-kit`, `motion`, `recharts`, `sonner`) · FastAPI (Python, SQLAlchemy 2, Alembic, slowapi) · PostgreSQL 16 · WebSocket · Kubernetes (Helm) / Docker / Nginx.
- **Язык**: общение в проекте, тексты UI, сообщения об ошибках, большинство промптов и commit/MR-сообщения — на русском языке.

## 2. Команды разработки и проверки

### Kubernetes / Helm (`k8s/helm/retro-board/` и `Makefile`)
```bash
make helm-lint   # helm lint (dev + staging) + kubeconform + scripts/helm-render-checks.sh
make dev-images  # сборка и push dev-образов через buildctl SSH-туннель к .26 (scripts/build-image.sh)
make dev-deploy  # создание dev-секретов при отсутствии + helm upgrade на k3s-dev
```
- В образе `web` nginx **не** используется (`node server.js` на `:3000`); маршрутизацию `/api` и `/ws` → `api:8000` и `/` → `web:3000` в k8s выполняет Traefik Ingress (`ServersTransport` + `Middleware` `security-headers`), а в локальном Compose — отдельный сервис `proxy` (`ci/compose-nginx.conf`).
- `api.replicas` обязан оставаться `1` со стратегией `Recreate` (stateful `ConnectionManager` в памяти); чарт падает при `api.replicas != 1`, пустом/`*`/`null` `CORS_ORIGINS` и при изменяемом теге без `pullPolicy=Always`.

### Docker (локальный стенд)
```bash
docker compose up --build        # сборка и запуск полного стека (http://localhost:3080)
docker compose up db -d          # только PostgreSQL
docker compose down -v           # остановка с удалением volumes БД
```
Схема локального стека: сервис `proxy` (`ci/compose-nginx.conf`, `:3080`) проксирует `/` → Next.js (`frontend:3000`), `/api/` и `/ws/` → FastAPI (`backend:8000`). `docker-compose.dokploy.yml` помечен deprecated на период миграции.

### Backend (`backend/`)
Контейнер при старте (`entrypoint.sh`) автоматически выполняет `alembic upgrade head` и запускает `uvicorn main:app`.
```bash
pip install -r requirements.txt -r requirements-dev.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Миграции
alembic upgrade head
alembic revision --autogenerate -m "description"

# Unit/API-тесты (SQLite in-memory; задавайте ОБЕ переменные окружения)
TESTING=true DATABASE_URL=sqlite:// pytest -v
TESTING=true DATABASE_URL=sqlite:// pytest -v tests/test_boards.py
TESTING=true DATABASE_URL=sqlite:// pytest -v tests/test_boards.py::test_name
```

### Frontend (`frontend/`)
```bash
npm run dev                      # dev-сервер (http://localhost:3000)
npm run lint                     # next lint
npm run build                    # next build (output: 'standalone')
npm test                         # Vitest (все unit/component-тесты в tests/)
npx vitest run tests/store/index.test.ts

# E2E (Playwright против запущенного стека http://localhost:3080; конфиг читает ../.env)
npx playwright test
```
> Примечание: в Playwright E2E перед каждым тестом часто создаётся много сущностей через API. В CI бэкенд запущен с `TESTING=true` (rate limiter отключён); на обычном локальном Docker без `TESTING=true` быстрые серии запросов могут упираться в `slowapi` (429).

## 3. Архитектура и ключевые инварианты

### Сеть, прокси, авторизация и CSRF
- **Workspace JWT** (`app/workspace_auth.py`): вход `POST /api/workspaces/login` выставляет `httpOnly` cookie `workspace_token` и возвращает токен для `useAppStore`; `get_current_workspace()` принимает `X-Workspace-Token` или cookie.
- **Admin JWT**: `/api/admin/*` использует отдельную `httpOnly` cookie `admin_token` (`get_admin_user()`).
- **CSRF** (`CSRFMiddleware` в `backend/main.py`): все небезопасные методы (кроме `/ws/*`, `/api/admin/login`, `/api/workspaces/login`, `/health`, `/api/health`) проверяют совпадение cookie `csrf_token` и заголовка `X-CSRF-Token`. В тестах отключается через `CSRF_ENABLED=false` / `settings.csrf_enabled = False`. Для локальной HTTP-разработки требуется `SECURE_COOKIES=false`.
- **REST-клиент** (`frontend/api/index.ts`): Axios с `baseURL: '/api'` автоматически подставляет `X-Workspace-Token` и `X-CSRF-Token` из cookies/store и обрабатывает 401/403/423/429/5xx. Отдельный админ-клиент — `frontend/api/admin.ts`.
- **Проксирование**: в dev `frontend/next.config.mjs` делает rewrite `/api/:path*` → `${BACKEND_URL || 'http://localhost:8000'}/api/:path*` (в production отключается, если `BACKEND_URL` не задан); в локальном Compose/E2E (`ci/compose-nginx.conf`, `ci/e2e-nginx.conf`) Nginx обязан передавать исходный `Host` (`$http_host` / `$host`), иначе редиректы FastAPI уведут на `:8000` мимо `csrf_token` cookie; в k8s эту роль выполняет Traefik Ingress (`k8s/helm/retro-board/templates/ingress.yaml`).
- **Backend entrypoint & proxy**: `backend/entrypoint.sh` запускает `uvicorn` с `--ws websockets-sansio --proxy-headers --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}"`; в k8s миграции выполняет initContainer `migrate`, а основной контейнер передаёт `SKIP_MIGRATIONS=true`.

### WebSocket и ограничение на один воркер
- **Эндпоинты** (`app/routers/websocket.py`):
  - `/ws/{board_id}` — события доски (`identify`, курсоры, фазы, таймер, фасилитатор, ready/spotlight, реакции, CRUD-апдейты).
  - `/ws/workspace` — live-обновления списка досок команды на `/dashboard`.
- **Аутентификация WS** (`_authenticate_ws`): проверяет заголовок `Origin` по `CORS_ORIGINS` и JWT (в приоритете `httpOnly` cookie `workspace_token`, query-параметр `workspace_token` оставлен только для совместимости со старыми клиентами/тестами). Фронтенд (`frontend/hooks/useWebSocket.ts`) подключается к `${protocol}://${NEXT_PUBLIC_WS_HOST || location.host}/ws/${boardId}` без токена в URL (`Dashboard.tsx` передаёт `'workspace'`).
- **Single-worker constraint** (`app/ws_manager.py`): `ConnectionManager` хранит комнаты, `facilitators`, `phases`, `timers`, `session_ids`, `ready_users`, `spotlights` и grace-таймеры в памяти процесса. `assert_single_worker()` в `lifespan` запрещает `WEB_CONCURRENCY != 1`. **Нельзя масштабировать uvicorn на несколько воркеров** без выноса состояния в Redis. Рассылка событий на бэкенде выполняется через `await manager.broadcast(board_id, "event_name", data_dict)`.

### Модели БД, soft delete и миграции
- **Иерархия моделей** (`app/models.py`): `Workspace` → `Board` → `Column` → `CardGroup` / `Card`, плюс `ActionItem`, `BoardSummary`, `BoardMood`.
- **Soft delete**: доски удаляются через `Board.deleted_at` (не физически). Во всех write/read-хендлерах досок и дочерних сущностей используйте `require_live_board()` и `require_unlocked_board()` из `app/utils.py` (`test_audit_guards.py` проверяет 404 для удалённых досок).
- **Уникальность**: у `Board` составные ограничения `uq_board_workspace_name` и `uq_board_workspace_slug`; коллизия slug при разных именах должна разрешаться суффиксом, а не 500 (проверяется в `test_audit_guards.py`).
- **SQLite в тестах и Alembic**: `backend/tests/conftest.py` автоматически заменяет все колонки `ARRAY` на `JSONEncodedList` (`TypeDecorator` над `Text`) и сбрасывает `ws_manager` между тестами. Любое изменение `models.py` требует миграции в `backend/alembic/versions/`; избегайте Postgres-only DDL, несовместимого с моделями в SQLite-тестах, или экранируйте по диалекту.

### Rate Limiting и Config
- `slowapi` (`app/limiter.py`) включён в проде (`100/minute` чтение, `30/minute` запись, `5/minute` авто-кластеризация, `10/minute` AI-резюме/заголовки/логин админа, `15/minute` кросс-спринт инсайты) и выключен при `TESTING=true`. Сама логика лимитов тестируется в `tests/test_rate_limiting.py`.
- `Settings` (`app/config.py`) использует `pydantic-settings` с `extra="ignore"` (лишние env из Docker не должны ломать старт) и строгими прод-валидаторами секретов/админ-учётки (отключаются только при `TESTING=true`).

### AI-интеграция (`backend/app/ai/`)
- `ai_client.py`: **синхронный** `httpx.Client` к OpenAI-совместимому `/v1` шлюзу (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_DISABLE_THINKING`). **Все вызовы из async-эндпоинтов/WS обязаны быть обёрнуты в `asyncio.to_thread()`** (`groups.py`, `boards.py`, `action_items.py`, `websocket.py`). При сбое выбрасывается `RuntimeError("AI request failed ...")` — обрабатывайте или используйте детерминистический fallback (`workspace_insights.py`).
- **Reasoning-модели (Qwen3)**: по умолчанию `settings.ai_model = "qwen3.6-35b-a3b-mtp-ud-q8_k_xl"`. При `AI_DISABLE_THINKING=true` клиент передаёт `chat_template_kwargs: {"enable_thinking": False}`; без этого бюджет `max_tokens` уходит в `reasoning_content`, и `content` возвращается пустым.
- **Защита от prompt-injection**: пользовательский текст перед вставкой в промпт санитизируется и обрезается (`_sanitize_card_text` в `clustering.py`, `_sanitize_text` в `workspace_insights.py`), а JSON-ответ модели валидируется по whitelist ID (в `clustering.py` группы из `< 2` карточек расформировываются). Промпты находятся в `app/ai/clustering.py` и `app/ai/prompts/{summary_generation,title_generation,workspace_insights}.py`.

### Паттерны фронтенда (`frontend/`)
- **Алиас и компоненты**: `@/*` ведёт в корень `frontend/` (`tsconfig.json`, `vitest.config.ts`). Страницы в `app/` по умолчанию Server Components; добавляйте `'use client'` там, где есть состояние/браузерные API.
- **UI-примитивы (`components/ui/`)**: переиспользуйте компоненты на базе shadcn/ui и Radix UI (`dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `select.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `tooltip.tsx`, `tabs.tsx`, `scroll-area.tsx`, `button.tsx`). Глобальные провайдеры настроены в `components/Providers.tsx` (`MotionConfig`, `ThemeProvider`, `<TooltipProvider delayDuration={250}>`, `sonner` `<Toaster />`).
- **Инвариант scroll-lock и оверлеев**:
  - В `app/globals.css` задавайте `overflow-x: clip` только на `body` (не ставьте `height: 100%` и `overflow-x: hidden` на `html, body`). Иначе вертикальный скролл уходит с корневого viewport, и компенсация `margin-right` в `react-remove-scroll` (при открытии `Dialog` / `Select` / модального `DropdownMenu`) смещает шапку и контент по горизонтали.
  - Не вкладывайте лишние корневые `TooltipProvider` поверх `Providers.tsx` (`tooltip.tsx` использует `InsideTooltipProviderContext` и создаёт fallback-провайдер только для изолированных рендеров в тестах).
  - Выпадающие меню в шапке, которые по первому клику открывают другой диалог или ведут на другую страницу (`Topbar.tsx`), делайте `<DropdownMenu modal={false}>`, чтобы pointer-guard не глотал первый клик. Для меню поверх drag-and-drop зон (`CardWidget.tsx`) оставляйте `modal={true}`.
  - Кнопки-переключатели с `absolute`-иконками внутри (`Sun`/`Moon` и т.п.) обязаны иметь класс `relative`.
- **Состояние и уведомления**:
  - Глобальное состояние в `frontend/store/index.ts` (`useAppStore`, ключ localStorage `retroboard-app`).
  - WebSocket-события доски маршрутизируются в `frontend/hooks/useBoardWebSocket.ts` — новые серверные события добавляйте туда.
  - Тосты вызываются через `showToast(message, type?: 'error' | 'info' | 'success')` (`frontend/store/toastStore.ts` → `sonner`).

## 4. GitLab CI/CD и рабочий процесс с MR

- Основной репозиторий находится в GitLab (`gitlab.kirillbessonov.ru/fmrm/retro_board.git`); GitHub является зеркалом. Работа ведётся через **Merge Requests** и CLI **`glab`** (не `gh`).
- Конвейер описан в `.gitlab-ci.yml`: runner с тегом `homelab`, базовый образ `$CI_BASE_IMAGE` (переменная инстанса GitLab; без Docker-демона; `e2e-tests` поднимает сервис `postgres:16-alpine`, `uvicorn`, standalone Next `:3000` и `nginx` `:3080` по `ci/e2e-nginx.conf`, сборки образов идут через `buildctl`).
- Джобы CI: `backend-tests`, `frontend-lint` (`npm run build` + `npm run lint`), `frontend-tests` (`npm test`), `e2e-tests` (`npx playwright test`), `helm` (`make helm-lint`), `image-smoke` (на MR при изменении Dockerfile/зависимостей), `build-app-staging` и `deploy-staging` (на `main` — публикация в `$CI_REGISTRY_IMAGE` и выкат в `k3s-stage` через shared GitLab Agent `fmrm/cluster-admins:k3s-stage`).
- **Обязательное правило**: после создания/обновления MR дождитесь прохождения пайплайна и убедитесь, что все джобы завершились успешно (`success`). Перед деплоем на `k3s-stage` в namespace `retro-board` должен существовать Secret `retro-board-secrets`.

```bash
# Создать MR из текущей ветки в main
glab mr create --title "Краткое описание" --description "Что и зачем" --yes

# Проверить и дождаться завершения пайплайна
glab ci status --wait
glab ci status --live

# Посмотреть логи упавшей джобы
glab ci trace e2e-tests

# Проверить синтаксис .gitlab-ci.yml до пуша
glab ci lint
```
