# RetroBoard — Agile Ретро Доска

Веб-приложение для проведения командных Agile-ретроспектив в реальном времени.

**Стек:** Next.js 15 (App Router, TypeScript) · Tailwind CSS · shadcn/ui (Radix UI) · Zustand · `@dnd-kit` · FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL 16 · WebSocket · Kubernetes (Helm + Traefik) · GitLab CI

---

## Возможности

- **Workspaces и Admin-панель** — изолированные рабочие пространства команд (`/admin` для создания, переименования, смены ключа и удаления)
- **Доски и шаблоны** — создание из 6 шаблонов (`classic`, `start_stop_continue`, `4ls`, `sailboat`, `mad_sad_glad`, `empty`), уникальные slug, soft delete (`deleted_at`), блокировка доски (`is_locked`), скрытие карточек до reveal (`hide_cards_until_reveal`), анонимное голосование (`anonymous_votes`), множественные голоса на карточку (`allow_multiple_votes_per_card`), сброс голосов (`reset-votes`)
- **Колонки, карточки и группы** — редактирование колонок и цветов, стикеры с rich-текстом, фильтрация/поиск, лайки с лимитом голосов на участника (`max_votes`), drag & drop карточек и целых групп между колонками (`@dnd-kit`), массовое обновление/удаление (`bulk-update`, `bulk-delete`) и объединение карточек (`merge`)
- **Real-time и фасилитация** — WebSocket-синхронизация состояния доски и списка досок workspace (`/ws/{board_id}`, `/ws/workspace`), режим фасилитатора с фазами (`brainstorm` → `reveal` → `discuss` → `vote` → `summary`), общий таймер, индикаторы готовности (`ready_toggle`), индикаторы набора (`card_typing`), spotlight карточки, курсоры участников и живые реакции поверх доски
- **AI-функции** (OpenAI-совместимый `/v1` шлюз, по умолчанию модель Qwen3.6 с `AI_DISABLE_THINKING=true`):
  - **Кластеризация** — автогруппировка похожих карточек в колонке и предпросмотр кластеров до применения (`auto-cluster`, `auto-cluster-preview`, `apply-clusters`)
  - **Резюме ретро** — автоматическая генерация и перегенерация summary, ключевых тем и рекомендаций (`summary`, `summary/regenerate`)
  - **Action Items** — генерация заголовков и AI-предложения задач из карточек (`generate-title`, `suggest`)
  - **Кросс-спринт инсайты** — аналитика повторяющихся тем по workspace (`workspace-insights`) с детерминистическим fallback при недоступности AI
- **Итоги, Mood и Dashboard** — мастер-колонка Action Items на доске, перенос незакрытых задач между досками (`carry-forward`), трекинг настроения участников (`mood`), графики трендов задач и настроения на `/dashboard`
- **Экспорт и UX** — экспорт доски в PDF и Markdown, палитра команд (`Ctrl+K` / `Cmd+K`), горячие клавиши, светлая/тёмная тема и цветовые акценты
- **Безопасность** — `httpOnly` JWT-куки, CSRF double-submit защита (`csrf_token` + `X-CSRF-Token`), rate limiting (`slowapi` + WS-лимиты), проверка `Origin` на WebSocket, санитизация пользовательского текста для AI и security headers

---

## Быстрый старт и разработка (Kubernetes-first)

Разработка и выверка ведутся на кластере `k3s-dev`, а ветка `main` автоматически катится на `k3s-stage` через GitLab CI.

### 1. Инициализация рабочего дерева (Orca / чистый клон)

```bash
make setup    # (алиас: make install) создаёт backend/.venv + ставит frontend/node_modules и проверяет CLI
```

### 2. Локальные проверки (DoD gate)

```bash
make verify         # helm-lint + lint (ruff + next build/lint) + test-backend + test-frontend
make helm-lint      # helm lint (dev + staging) + kubeconform + scripts/helm-render-checks.sh
make lint           # backend ruff check . + frontend next build && next lint
make test-backend   # alembic heads --verbose + pytest -v (SQLite in-memory)
make test-frontend  # vitest run
```

### 3. Выкат и проверка на `k3s-dev`

```bash
make dev            # dev-images (buildctl SSH tunnel -> .26) + dev-deploy (k3s-dev/retro-board)
```

- Стенд: `https://retro-dev.kirillbessonov.ru`
- При первом запуске `make dev-secrets` автоматически создаст namespace `retro-board`, скопирует `registry-pull` (из `stratum`, если есть) и сгенерирует `retro-board-secrets`.
- Для параллельных проверок можно переопределить тег: `make dev TAG=dev-mybranch`.

### 4. Локальный запуск процессов (опционально, без кластера)

Если нужен локальный `uvicorn` + `next dev` (например, против port-forward PostgreSQL или локальной БД):

```bash
# Backend
cd backend
cp .env.example .env          # при необходимости поправь DATABASE_URL / AI_*
.venv/bin/alembic upgrade head
.venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend (в отдельном терминале)
cd frontend
# .env.local (опционально): BACKEND_URL=http://localhost:8000
npm run dev                   # -> http://localhost:3000
```

Для локального запуска Playwright E2E (`cd frontend && npx playwright test`) требуется поднятый стек на `http://localhost:3080` и `http://localhost:8000` (с `TESTING=true` на бэкенде, чтобы не упираться в rate limiter) и корневой `.env` (см. `.env.example`).

---

## Структура репозитория

```text
retro_board/
├── .env.example                     # Шаблон env для локального E2E / справочник переменных
├── .gitattributes
├── .gitignore
├── .gitlab-ci.yml                   # GitLab CI/CD: тесты, E2E, helm-гейты, buildctl, deploy-staging
├── AGENTS.md                        # Инструкция по процессу, DoD и сквозным инвариантам
├── Makefile                         # setup/install, verify, helm-lint, lint, test-*, dev-*
├── README.md
├── ci/
│   └── e2e-nginx.conf               # nginx-прокси (:3080) для E2E-джобы в GitLab CI
├── scripts/
│   ├── build-image.sh               # Сборка образов через buildctl (SSH-туннель или $BUILDKIT_HOST)
│   └── helm-render-checks.sh        # kubeconform и негативные/позитивные render-гейты чарта
├── k8s/helm/retro-board/
│   ├── Chart.yaml
│   ├── values.yaml
│   ├── values-dev.yaml              # Профиль k3s-dev (retro-dev.kirillbessonov.ru)
│   ├── values-staging.yaml          # Профиль k3s-stage (retro.kirillbessonov.ru, NetworkPolicy, NFS-бэкапы)
│   └── templates/                   # api, web, postgres, configmap, secret, ingress, traefik, networkpolicy, backup-cronjob
├── backend/
│   ├── AGENTS.md                    # Правила и инварианты бэкенда
│   ├── Dockerfile                   # python:3.12-slim, не-root user 1000
│   ├── entrypoint.sh                # alembic upgrade head (если SKIP_MIGRATIONS != true) + uvicorn
│   ├── pyproject.toml               # Конфигурация ruff
│   ├── requirements.txt
│   ├── requirements-dev.txt         # pytest + ruff
│   ├── .env.example
│   ├── main.py                      # FastAPI app, lifespan, GlobalErrorMiddleware, CSRFMiddleware, CORS
│   ├── alembic.ini
│   ├── alembic/versions/            # Миграции 0001..0005
│   ├── app/
│   │   ├── config.py                # Pydantic Settings + валидаторы секретов/админки
│   │   ├── database.py
│   │   ├── limiter.py               # slowapi (отключён только при TESTING=true)
│   │   ├── models.py                # ORM: Workspace, Board, Column, CardGroup, Card, ActionItem, BoardSummary, BoardMood
│   │   ├── schemas.py
│   │   ├── utils.py                 # require_live_board(), require_unlocked_board()
│   │   ├── workspace_auth.py
│   │   ├── ws_manager.py            # In-memory ConnectionManager + assert_single_worker()
│   │   ├── ai/
│   │   │   ├── ai_client.py         # Синхронный httpx.Client к /v1 шлюзу
│   │   │   ├── clustering.py        # AI-кластеризация с санитизацией и валидацией ID
│   │   │   └── prompts/             # action_item_suggestions, summary_generation, title_generation, workspace_insights
│   │   └── routers/                 # boards, columns, cards, groups, action_items, workspaces, admin, websocket
│   └── tests/                       # pytest (SQLite in-memory)
└── frontend/
    ├── AGENTS.md                    # Правила и UI/Radix-инварианты фронтенда
    ├── Dockerfile                   # Multi-stage: pure standalone node:22-alpine (:3000, без nginx)
    ├── next.config.mjs              # standalone output, CSP/security headers, dev API rewrite
    ├── package.json
    ├── playwright.config.ts
    ├── vitest.config.ts
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── api/                         # index.ts (workspace/board Axios + CSRF/auth interceptors), admin.ts
    ├── app/                         # page.tsx, layout.tsx, globals.css, admin/, board/[id]/, dashboard/
    ├── components/                  # App, BoardPage, Dashboard, Topbar, Column, CardWidget, диалоги и components/ui/
    ├── hooks/                       # useWebSocket, useBoardWebSocket, useBoardDragDrop, useFacilitator, useTimer
    ├── lib/                         # board-themes, export-markdown, rich-text, utils
    ├── store/                       # index.ts (useAppStore), toastStore.ts (sonner)
    ├── types/index.ts
    ├── utils/                       # apiError, boardMapper, exportPDF, theme, wsData
    ├── tests/                       # Vitest + Testing Library
    └── e2e/                         # Playwright E2E-спеки
```

---

## CI/CD и деплой

Основной репозиторий — GitLab (`gitlab.kirillbessonov.ru/fmrm/retro_board`), GitHub — только зеркало.

### Джобы `.gitlab-ci.yml`

Пайплайн запускается на runner с тегом `homelab` в образе `$CI_BASE_IMAGE` для MR в `main` и пушей в `main`:

| Job | Триггер | Что делает |
|---|---|---|
| `backend-tests` | MR / `main` | `alembic heads --verbose`, `ruff check .`, `pytest -v` (SQLite in-memory) |
| `frontend-lint` | MR / `main` | `npm ci`, `npm run build`, `npm run lint` |
| `frontend-tests` | MR / `main` | `npm ci`, `npm test` (Vitest) |
| `e2e-tests` | MR / `main` | `postgres:16-alpine` service + `alembic upgrade head` + `uvicorn` + standalone Next `:3000` + `nginx` `:3080` (`ci/e2e-nginx.conf`) + `npx playwright test` |
| `helm` | MR / `main` | `helm lint` (`values-dev.yaml`, `values-staging.yaml`) + `scripts/helm-render-checks.sh` |
| `image-smoke` | MR (изменения сборки/зависимостей) | `buildctl` сборка `api` и `web` без пуша |
| `build-app-staging` | `push` в `main` | Сборка и пуш `$CI_REGISTRY_IMAGE/{api,web}:staging-$CI_COMMIT_SHORT_SHA` и `:latest` |
| `deploy-staging` | `push` в `main` | Деплой Helm-чарта (`values-staging.yaml`, иммутабельный тег `staging-$CI_COMMIT_SHORT_SHA`) в `k3s-stage` через GitLab Agent `fmrm/cluster-admins:k3s-stage` |

### Особенности Kubernetes-деплоя (`k8s/helm/retro-board`)

- Образ `web` не содержит nginx (`node server.js` на `:3000`). Маршрутизацию `/api` и `/ws` → `api:8000` и `/` → `web:3000` выполняет Traefik Ingress (`ServersTransport` + `Middleware` `security-headers`).
- `api.replicas` зафиксирован на `1` со стратегией `Recreate` (stateful `ConnectionManager` в памяти).
- Миграции `alembic upgrade head` выполняет initContainer `migrate` перед стартом `api`, а основной контейнер запускается с `SKIP_MIGRATIONS=true`.
- На `k3s-stage` включены `NetworkPolicy` (для `postgres`, `api`, `web`, `backup`) и ежедневный `CronJob` (`pg_dump --format=custom`) на NFS (`192.168.1.10:/tank/k8s-backup`, хранение 14 дней).
- В namespace `retro-board` должен существовать Secret `retro-board-secrets` (`POSTGRES_PASSWORD`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `WORKSPACE_JWT_SECRET`, `ADMIN_JWT_SECRET` и опционально `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`).

---

## API Reference

Все пути (кроме `/health`, `/api/health`, `/api/workspaces/login`, `/api/admin/*`) требуют валидный workspace JWT (`httpOnly` cookie `workspace_token` или заголовок `X-Workspace-Token`). Небезопасные HTTP-методы (кроме логинов) защищены `CSRFMiddleware` (`csrf_token` cookie + `X-CSRF-Token`).

### Health

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/health` | Проверка здоровья бэкенда |
| `GET` | `/api/health` | То же (для Ingress/прокси) |

### Workspaces

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/workspaces/login` | Вход в workspace (`workspace_slug` + `access_key`), выставляет `workspace_token` cookie |
| `GET` | `/api/workspaces/me` | Текущий workspace и обновление `csrf_token` cookie |

### Admin (`/api/admin/*`, отдельная cookie `admin_token`)

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/admin/login` | Вход администратора |
| `POST` | `/api/admin/logout` | Выход администратора |
| `GET` | `/api/admin/workspaces` | Список всех workspaces |
| `POST` | `/api/admin/workspaces` | Создать workspace |
| `PATCH` | `/api/admin/workspaces/{workspace_id}` | Переименовать / сменить ключ доступа |
| `DELETE` | `/api/admin/workspaces/{workspace_id}` | Удалить workspace |

### Boards (`/api/boards/*`)

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/boards/templates` | Список шаблонов досок |
| `GET` | `/api/boards/mood-trends` | Динамика настроения, карточек и задач по доскам workspace |
| `POST` | `/api/boards/workspace-insights` | Кросс-спринт инсайты workspace (AI + fallback) |
| `GET` | `/api/boards/` | Список живых досок workspace |
| `POST` | `/api/boards/` | Создать доску (по шаблону / custom колонкам / с carry-forward) |
| `GET` | `/api/boards/by-slug/{slug}` | Получить доску по slug |
| `GET` | `/api/boards/{board_id}` | Получить доску со всеми колонками, группами, карточками и mood |
| `PATCH` | `/api/boards/{board_id}` | Обновить настройки доски (`name`, `max_votes`, `is_locked`, `hide_cards_until_reveal`, `anonymous_votes`, `allow_multiple_votes_per_card`) |
| `DELETE` | `/api/boards/{board_id}` | Удалить доску (soft delete через `deleted_at`) |
| `POST` | `/api/boards/{board_id}/mood` | Сохранить / обновить оценку настроения участника |
| `GET` | `/api/boards/{board_id}/summary` | Получить последнее AI-резюме доски |
| `POST` | `/api/boards/{board_id}/summary/regenerate` | Перегенерировать AI-резюме доски |
| `POST` | `/api/boards/{board_id}/reset-votes` | Сбросить голоса пользователя на доске |

### Columns (`/api/columns/*`)

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/columns/` | Создать колонку |
| `PATCH` | `/api/columns/{column_id}` | Обновить название / цвет / позицию |
| `DELETE` | `/api/columns/{column_id}` | Удалить колонку (каскадно с карточками и группами) |

### Cards (`/api/cards/*`)

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/cards/` | Создать карточку |
| `PATCH` | `/api/cards/{card_id}` | Обновить текст / цвет / группу |
| `POST` | `/api/cards/{card_id}/move` | Переместить карточку между колонками / позициями |
| `POST` | `/api/cards/{card_id}/like` | Добавить / снять голос (лайк) |
| `POST` | `/api/cards/bulk-update` | Массовое перемещение / смена цвета / группировка карточек |
| `POST` | `/api/cards/bulk-delete` | Массовое удаление карточек |
| `POST` | `/api/cards/merge` | Объединить несколько карточек в одну |
| `DELETE` | `/api/cards/{card_id}` | Удалить карточку |

### Groups (`/api/groups/*`)

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/groups/` | Создать группу карточек |
| `PATCH` | `/api/groups/{group_id}` | Переименовать группу |
| `DELETE` | `/api/groups/{group_id}` | Удалить группу (карточки остаются в колонке) |
| `POST` | `/api/groups/{group_id}/set_card/{card_id}` | Привязать карточку к группе |
| `PATCH` | `/api/groups/{group_id}/move` | Переместить группу целиком |
| `DELETE` | `/api/groups/{group_id}/remove_card/{card_id}` | Убрать карточку из группы |
| `POST` | `/api/groups/auto-cluster` | AI-кластеризация и немедленное создание групп в колонке |
| `POST` | `/api/groups/auto-cluster-preview` | AI-предпросмотр кластеризации без сохранения |
| `POST` | `/api/groups/apply-clusters` | Применить подтверждённые кластеры |

### Action Items (`/api/action-items/*`)

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/action-items/trends` | Данные для графика трендов задач |
| `GET` | `/api/action-items/all` | Все задачи workspace (для `/dashboard`) |
| `POST` | `/api/action-items/carry-forward` | Перенести незакрытые задачи с исходной доски на целевую |
| `GET` | `/api/action-items/` | Задачи конкретной доски (`?board_id=...`) |
| `POST` | `/api/action-items/generate-title` | Сгенерировать заголовок задачи через AI |
| `POST` | `/api/action-items/suggest` | Предложить список Action Items по итогам доски через AI |
| `POST` | `/api/action-items/` | Создать задачу |
| `PATCH` | `/api/action-items/{item_id}` | Обновить заголовок / текст / ответственного / статус |
| `DELETE` | `/api/action-items/{item_id}` | Удалить задачу |

---

## WebSocket Protocol

- `/ws/{board_id}` — события конкретной доски; аутентификация по `Origin` (`CORS_ORIGINS`) и JWT (`httpOnly` cookie `workspace_token` в приоритете, query `?workspace_token=...` — fallback для совместимости).
- `/ws/workspace` — live-события списка досок workspace для `/dashboard` (`board_created`, `board_updated`, `board_deleted`).
- Лимиты входящих сообщений на соединение: `20` управляющих сообщений/сек и `30` `cursor_move`/сек. Формат JSON: `{ "event": "<name>", "data": { ... } }` (плюс текстовый heartbeat `"ping"`).

### События от клиента к серверу

| Событие | Описание |
|---|---|
| `identify` | Регистрация имени участника (`username`) |
| `cursor_move` / `cursor_leave` | Позиция курсора (`x`, `y`) и уход курсора |
| `facilitator_start` / `facilitator_stop` | Старт / завершение сессии фасилитации (опционально блокировка доски при стопе) |
| `phase_change` | Смена фазы (`brainstorm`, `reveal`, `discuss`, `vote`, `summary`) |
| `timer_start` / `timer_pause` / `timer_reset` | Управление таймером (в активной сессии — только фасилитатор) |
| `group_collapse` | Свернуть / развернуть группу |
| `ready_toggle` | Переключить статус готовности участника |
| `spotlight_card` | Выделить карточку в фокус (или сбросить) |
| `reaction` | Отправить быструю реакцию (`❤️`, `👍`, `🔥`, `🎉`, `💡`, `👏`, `😂`) |
| `card_typing` | Индикатор набора карточки в колонке |

### События от сервера к клиентам

| Событие | Описание |
|---|---|
| `presence_update` | Список активных участников доски |
| `facilitator_update` | Текущий фасилитатор, фаза и `session_id` |
| `phase_update` | Смена фазы ретро |
| `cursor_move` / `cursor_leave` | Позиции курсоров других участников |
| `timer_start` / `timer_pause` / `timer_reset` | Синхронизация таймера |
| `ready_update` | Список участников, отметивших готовность |
| `spotlight_update` | Текущая карточка в фокусе |
| `typing_update` | Активные участники, набирающие текст по колонкам |
| `reaction` | Быстрая реакция участника |
| `mood_updated` | Обновление оценки настроения на доске |
| `board_created` / `board_updated` / `board_deleted` | Изменения досок (на доске и в `/ws/workspace`) |
| `column_created` / `column_updated` / `column_deleted` | CRUD колонок |
| `card_created` / `card_updated` / `card_moved` / `card_deleted` | CRUD и перемещение карточек |
| `group_created` / `group_updated` / `group_moved` / `group_deleted` / `group_collapse` | CRUD, перемещение и сворачивание групп |
| `action_item_created` / `action_item_updated` / `action_item_deleted` | CRUD Action Items |
| `auto_cluster_completed` | Завершение AI-кластеризации |
| `summary_generated` / `summary_failed` | Результат генерации AI-резюме |

---

## Переменные окружения

### Backend (`ConfigMap` / `Secret` в Helm или `backend/.env`)

| Переменная | Обязательна | Описание |
|---|---|---|
| `DATABASE_URL` | Да | Строка подключения PostgreSQL (в Helm собирается из `PG_*`) |
| `CORS_ORIGINS` | Да | Разрешённые origin'ы через запятую (в Helm запрещены пустое значение, `*` и `null`) |
| `ADMIN_LOGIN` | Да | Логин администратора (`/admin`, >= 3 символов, не `"admin"`) |
| `ADMIN_PASSWORD` | Да | Пароль администратора (>= 8 символов, не `"changeme"`) |
| `WORKSPACE_JWT_SECRET` | Да | Секрет подписи JWT workspace (>= 32 символов) |
| `ADMIN_JWT_SECRET` | Да | Секрет подписи JWT администратора (>= 32 символов) |
| `WORKSPACE_JWT_EXPIRE_HOURS` | Нет | Срок жизни workspace-токена в часах (по умолчанию: `168`) |
| `SECURE_COOKIES` | Нет | Флаг `Secure` на куках (по умолчанию: `true`; для локального HTTP — `false`) |
| `CSRF_ENABLED` | Нет | CSRF-защита (по умолчанию: `true`; `false` — только для тестовых стендов) |
| `AI_BASE_URL` | Нет | OpenAI-совместимый `/v1` эндпоинт AI-шлюза (без него AI-функции отключены) |
| `AI_API_KEY` | Нет | API-ключ AI-шлюза |
| `AI_MODEL` | Нет | Модель AI-шлюза (по умолчанию: `qwen3.6-35b-a3b-mtp-ud-q8_k_xl`) |
| `AI_DISABLE_THINKING` | Нет | Передавать `enable_thinking=false` для Qwen3 (по умолчанию: `true`) |
| `SKIP_MIGRATIONS` | Нет | Пропуск `alembic upgrade head` в `entrypoint.sh` (`true` в k8s, т.к. миграции идут в initContainer) |
| `FORWARDED_ALLOW_IPS` | Нет | Доверенные прокси для `--forwarded-allow-ips` в `uvicorn` (по умолчанию: `*`) |
| `TESTING` | Нет | Режим тестов (`true` отключает `slowapi` и прод-валидаторы `Settings`) |

### Frontend (`frontend/.env.local` при локальной разработке)

| Переменная | Описание |
|---|---|
| `BACKEND_URL` | URL бэкенда для dev-rewrite `/api/*` (по умолчанию `http://localhost:8000`; в production при отсутствии не используется) |
| `NEXT_PUBLIC_WS_HOST` | Явный хост WebSocket (если отличается от `location.host`) |
