<p align="center">
  <img src="frontend/app/icon.svg" alt="RetroBoard" width="84" height="84" />
</p>

<h1 align="center">RetroBoard — Agile Ретро Доска</h1>

<p align="center">
  Веб-приложение с открытым исходным кодом для проведения командных Agile-ретроспектив в реальном времени.
</p>

**Стек:** Next.js 15 (App Router, TypeScript) · Tailwind CSS · shadcn/ui (Radix UI) · Zustand · `@dnd-kit` · FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL 16 · WebSocket · Docker · Kubernetes (Helm)

---

## Возможности

- **Workspaces и Admin-панель** — изолированные рабочие пространства команд (`/admin` для создания, переименования, смены ключа доступа и удаления)
- **Доски и шаблоны** — создание доски из 6 встроенных шаблонов (`classic`, `start_stop_continue`, `4ls`, `sailboat`, `mad_sad_glad`, `empty`), человекочитаемые slug, soft delete (`deleted_at`), блокировка изменений (`is_locked`), скрытие карточек до этапа раскрытия (`hide_cards_until_reveal`), анонимное голосование (`anonymous_votes`), множественные голоса на одну карточку (`allow_multiple_votes_per_card`), сброс голосов (`reset-votes`)
- **Колонки, карточки и группы** — настройка колонок и цветов, стикеры с поддержкой Markdown-ссылок и кода, фильтрация/поиск, голосование с лимитом на участника (`max_votes`), drag & drop карточек и целых групп (`@dnd-kit`), массовое редактирование/удаление (`bulk-update`, `bulk-delete`) и объединение карточек (`merge`)
- **Real-time и фасилитация** — WebSocket-синхронизация состояния доски и списка досок workspace (`/ws/{board_id}`, `/ws/workspace`), режим фасилитатора с фазами (`brainstorm` → `reveal` → `discuss` → `vote` → `summary`), общий таймер, статус готовности (`ready_toggle`), индикатор набора текста (`card_typing`), spotlight карточки, живые курсоры и быстрые реакции
- **AI-функции** *(опционально, через любой OpenAI-совместимый `/v1` API — OpenAI, LiteLLM, vLLM, Ollama и т.д.; при подключении задайте `AI_MODEL` и при необходимости `AI_DISABLE_THINKING=false`)*:
  - **Кластеризация** — автогруппировка похожих карточек в колонке и предпросмотр кластеров до применения (`auto-cluster`, `auto-cluster-preview`, `apply-clusters`)
  - **Резюме ретро** — генерация и перегенерация итогов, ключевых тем и рекомендаций (`summary`, `summary/regenerate`)
  - **Action Items** — генерация заголовков и подбор задач из карточек (`generate-title`, `suggest`)
  - **Кросс-спринт инсайты** — анализ повторяющихся тем по workspace (`workspace-insights`) с детерминистическим fallback при отсутствии AI
- **Итоги, Mood и Dashboard** — колонка Action Items на доске, перенос незакрытых задач между досками (`carry-forward`), оценка настроения участников (`mood`), графики трендов задач и настроения на `/dashboard`
- **Экспорт и UX** — экспорт доски в PDF и Markdown, палитра команд (`Ctrl+K` / `Cmd+K`), горячие клавиши, светлая и тёмная темы, настройка цветовых акцентов
- **Безопасность** — `httpOnly` JWT-куки, CSRF double-submit защита (`csrf_token` + `X-CSRF-Token`), rate limiting (`slowapi` + лимиты WebSocket), проверка `Origin` при подключении WebSocket, санитизация пользовательского текста для AI и security headers

---

## Быстрый старт (локальная разработка)

### Требования

- `Python 3.12+` (опционально `uv` для ускорения установки зависимостей)
- `Node.js 22+` и `npm`
- `PostgreSQL 16` (или контейнер `postgres:16-alpine`)

### 1. Установка зависимостей

```bash
make setup    # (алиас: make install) создаёт backend/.venv и устанавливает frontend/node_modules
```

Или вручную:

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cd ../frontend && npm ci
```

### 2. База данных и Backend

Поднимите PostgreSQL (например, через Docker):

```bash
docker run -d --name retroboard-pg \
  -e POSTGRES_USER=retro \
  -e POSTGRES_PASSWORD=retro \
  -e POSTGRES_DB=retroboard \
  -p 5432:5432 \
  postgres:16-alpine
```

Настройте переменные окружения, примените миграции и запустите FastAPI:

```bash
cd backend
cp .env.example .env          # отредактируйте секреты, POSTGRES/AI_* при необходимости
.venv/bin/alembic upgrade head
.venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

> При локальной работе по HTTP в `backend/.env` должно быть `SECURE_COOKIES=false`, иначе браузер не сохранит `workspace_token` / `admin_token` куки без HTTPS.

### 3. Frontend

В отдельном терминале (`next dev` проксирует только `/api/*`, поэтому для работы WebSocket без reverse proxy нужно явно указать `NEXT_PUBLIC_WS_HOST`):

```bash
cd frontend
printf "NEXT_PUBLIC_WS_HOST=localhost:8000\n" > .env.local
# Опционально, если бэкенд запущен не на localhost:8000: BACKEND_URL=http://localhost:8000
npm run dev                   # -> http://localhost:3000
```

После запуска откройте `http://localhost:3000/admin`, авторизуйтесь под `ADMIN_LOGIN` / `ADMIN_PASSWORD` из `backend/.env` и создайте первое рабочее пространство. Интерактивная OpenAPI-документация бэкенда доступна по адресу `http://localhost:8000/docs`.

### 4. Проверки и тесты

```bash
make verify         # полный прогон: helm-lint + lint + test-backend + test-frontend
make lint           # backend (ruff check .) + frontend (next build && typecheck && next lint)
make test-backend   # alembic heads --verbose + pytest -v (SQLite in-memory)
make test-frontend  # vitest run
make helm-lint      # helm lint + kubeconform + render-гарды чарта
make lock           # пересобрать backend/requirements*.txt из requirements*.in (нужен uv)
make audit          # известные уязвимости в зависимостях бэкенда и фронтенда
```

Для запуска сквозных Playwright E2E-тестов (`cd frontend && npx playwright install chromium && npx playwright test`) требуется запущенный за прокси стек (`http://localhost:3080` → `:3000` / `:8000`, образец конфига — [ci/e2e-nginx.conf](ci/e2e-nginx.conf)) с `TESTING=true` на бэкенде и корневым `.env` на базе `.env.example` (замените плейсхолдеры `ADMIN_LOGIN`/`ADMIN_PASSWORD` на реальные учётные данные бэкенда).

---

## Деплой (Docker и Kubernetes / Helm)

### Сборка контейнерных образов

```bash
docker build -t <registry>/retro-board/api:1.0.0 -f backend/Dockerfile backend
docker build -t <registry>/retro-board/web:1.0.0 -f frontend/Dockerfile frontend
```

Образ `web` запускает standalone Next.js на порту `:3000` и **не содержит** встроенного nginx.

### Архитектурные требования к окружению

1. **Единый Reverse Proxy / Ingress и сохранение `Host`**: прокси обязан направлять `/api` и `/ws` на `api:8000`, а `/` на `web:3000`, сохраняя оригинальный заголовок `Host`. Иначе редиректы FastAPI (`redirect_slashes`) уведут браузер мимо домена с cookie `csrf_token`.
2. **Single-worker backend (`api.replicas = 1`)**: `ConnectionManager` хранит активные комнаты, фасилитаторов, фазы и таймеры в памяти процесса. Бэкенд должен работать строго в одном процессе (`WEB_CONCURRENCY=1`, стратегия деплоя `Recreate`).
3. **Миграции до старта API**: в Kubernetes-чарте миграции `alembic upgrade head` запускаются в `initContainer` до поднятия `api`, а основной контейнер стартует с `SKIP_MIGRATIONS=true`.

### Деплой через Helm (`k8s/helm/retro-board`)

Чарт разворачивает `StatefulSet` PostgreSQL 16, Deployment'ы `api` и `web`, `Ingress` и ресурсы Traefik (`ServersTransport` `traefik.io/v1alpha1` и `Middleware` security headers — в кластере должны быть установлены CRD Traefik), а также опциональные `NetworkPolicy` и `CronJob` резервного копирования (`pg_dump` на NFS).

1. Создайте namespace и Kubernetes Secret (либо передайте секреты через `secrets.*` в values без `existingSecret`):

```bash
kubectl create namespace retro-board --dry-run=client -o yaml | kubectl apply -f -

kubectl -n retro-board create secret generic retro-board-secrets \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 20)" \
  --from-literal=ADMIN_LOGIN="retroadmin" \
  --from-literal=ADMIN_PASSWORD="$(openssl rand -hex 16)" \
  --from-literal=WORKSPACE_JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=ADMIN_JWT_SECRET="$(openssl rand -hex 32)"
```

2. Установите релиз с вашими параметрами (используйте иммутабельный тег образа, либо `image.pullPolicy=Always`; для публичного registry задайте `image.pullSecret=""`):

```bash
helm upgrade --install retro-board k8s/helm/retro-board \
  --namespace retro-board \
  --set image.registry=<registry>/retro-board \
  --set image.tag=1.0.0 \
  --set image.pullSecret="" \
  --set ingress.host=retro.example.com \
  --set config.corsOrigins=https://retro.example.com \
  --set secrets.existingSecret=retro-board-secrets \
  --wait --timeout 5m
```

Остальные параметры (`postgres.storageClassName`, `postgres.storageSize`, `<component>.resources`, `config.aiBaseUrl`, `config.aiModel`, `secrets.aiApiKey`, `networkPolicy.enabled`, `backup.*`) описаны в `k8s/helm/retro-board/values.yaml`. Сам чарт на этапе рендера/установки блокирует опасные конфигурации (`api.replicas != 1`, пустой или `*` `CORS_ORIGINS`, мутабельный тег без `Always`, слабые секреты), а `make helm-lint` дополнительно валидирует манифесты через `kubeconform` (требуется в `PATH`) и прогоняет тесты этих гардов.

---

## Структура репозитория

```text
retro_board/
├── .env.example                     # Шаблон переменных окружения для локального E2E
├── .gitlab-ci.yml                   # Пайплайн тестов, линтеров, E2E, helm-проверок и сборки
├── Makefile                         # setup/install, verify, helm-lint, lint, test-*
├── ci/
│   └── e2e-nginx.conf               # nginx-прокси (:3080) для E2E-тестов
├── scripts/
│   ├── build-image.sh               # Сборка образов через buildctl
│   └── helm-render-checks.sh        # kubeconform и негативные/позитивные render-проверки чарта
├── k8s/helm/retro-board/            # Helm-чарт (StatefulSet Postgres, api, web, Ingress, NetworkPolicy, CronJob)
├── backend/
│   ├── Dockerfile                   # python:3.12-slim, не-root пользователь
│   ├── entrypoint.sh                # alembic upgrade head (при SKIP_MIGRATIONS != true) + uvicorn
│   ├── pyproject.toml               # Конфигурация ruff
│   ├── requirements.in              # Прямые зависимости (правятся руками)
│   ├── requirements.txt             # Полный lock с хешами (make lock)
│   ├── requirements-dev.in          # Зависимости разработки: pytest, ruff, httpx2
│   ├── requirements-dev.txt         # Полный lock для разработки и тестов
│   ├── .env.example
│   ├── main.py                      # FastAPI app, lifespan, GlobalErrorMiddleware, CSRFMiddleware, лимит тела запроса, CORS
│   ├── alembic.ini
│   ├── alembic/versions/            # Миграции схемы БД
│   ├── app/
│   │   ├── body_limit.py            # Ответ 413 на слишком большое тело HTTP-запроса
│   │   ├── config.py                # Pydantic Settings + валидаторы секретов/админки
│   │   ├── database.py              # Движок с таймаутами PostgreSQL, get_db, release_connection
│   │   ├── limiter.py               # slowapi rate limiter (отключается при TESTING=true)
│   │   ├── models.py                # ORM: Workspace, Board, Column, CardGroup, Card, ActionItem, BoardSummary, BoardMood
│   │   ├── schemas.py
│   │   ├── utils.py                 # Проверки мягкого удаления и блокировки доски
│   │   ├── workspace_auth.py
│   │   ├── ws_manager.py            # In-memory ConnectionManager
│   │   ├── ws_payloads.py           # Проверка входящих WebSocket-сообщений
│   │   ├── ai/
│   │   │   ├── ai_client.py         # Синхронный httpx.Client к OpenAI-совместимому /v1 API
│   │   │   ├── clustering.py        # AI-кластеризация с санитизацией и валидацией ID
│   │   │   └── prompts/             # Промпты и fallback-аналитика
│   │   └── routers/                 # boards, columns, cards, groups, action_items, workspaces, admin, websocket
│   └── tests/                       # pytest (SQLite in-memory)
└── frontend/
    ├── Dockerfile                   # Multi-stage standalone node:22-alpine (:3000)
    ├── next.config.mjs              # standalone output, CSP/security headers, dev API rewrite
    ├── package.json
    ├── playwright.config.ts
    ├── vitest.config.ts
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── api/                         # HTTP-клиенты (workspace/board Axios + CSRF/auth interceptors, admin API)
    ├── app/                         # App Router: /, /admin, /board/[id], /dashboard
    ├── components/                  # UI-компоненты доски, дашборда, диалоги и shadcn/ui примитивы
    ├── hooks/                       # useWebSocket, useBoardWebSocket, useBoardDragDrop, useFacilitator, useTimer
    ├── lib/                         # board-themes, export-markdown, rich-text, utils
    ├── store/                       # Zustand-стор и уведомления (sonner)
    ├── types/index.ts
    ├── utils/                       # Обработка ошибок, мапперы, экспорт PDF, темы, WS-события
    ├── tests/                       # Vitest + Testing Library
    └── e2e/                         # Playwright E2E-тесты
```

---

## API Reference

Все пути (кроме `/health`, `/api/health`, `/api/workspaces/login`, `/api/workspaces/join`, `/api/workspaces/invite/{token}`, `/api/admin/*`) требуют действующую сессию: JWT в `httpOnly` cookie `workspace_token` (заголовок `X-Workspace-Token` — для неинтерактивных клиентов). Небезопасные HTTP-методы (кроме входов) защищены `CSRFMiddleware` (`csrf_token` cookie + заголовок `X-CSRF-Token`).

**Участник.** Вход создаёт на сервере участника команды; его идентификатор лежит в токене сессии. Автора карточки, голос, оценку настроения и роль ведущего сервер берёт из сессии — из тела запроса и WebSocket-сообщений они не принимаются. Имя — подпись: тёзки — разные участники, смена имени ничего не отвязывает. Аккаунтов нет, поэтому новое устройство или очищенные cookie дают нового участника.

**Что видит участник.** Ответы и события собираются для конкретного получателя: текст и автор чужой карточки до раскрытия (`masked: true`) и имена авторов в анонимном режиме не передаются. `likes` карточки — идентификаторы проголосовавших участников; в анонимном режиме чужие заменены на `"anon"`.

### Health

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/health` | Проверка здоровья бэкенда |
| `GET` | `/api/health` | То же (для Ingress / reverse proxy) |

### Workspaces

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/workspaces/login` | Вход в команду (`workspace_slug` + `access_key` + `name`): создаёт участника и выставляет `httpOnly` cookie `workspace_token`; в теле ответа токена нет |
| `POST` | `/api/workspaces/join` | Вход по ссылке-приглашению (`invite_token` + `name`) |
| `POST` | `/api/workspaces/logout` | Выход: сбрасывает cookie сессии |
| `GET` | `/api/workspaces/me` | Текущая сессия: команда, участник (`participant`), признак `ai_enabled`; продлевает сессию и обновляет `csrf_token` cookie |
| `PATCH` | `/api/workspaces/me/participant` | Сменить имя участника — карточки, голоса и роль ведущего остаются за ним |
| `GET` | `/api/workspaces/invite` | Токен ссылки-приглашения в команду (создаётся при первом обращении) |
| `GET` | `/api/workspaces/invite/{token}` | Название команды для страницы приглашения (без входа) |

### Admin (`/api/admin/*`, отдельная cookie `admin_token`)

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/admin/login` | Вход администратора |
| `POST` | `/api/admin/logout` | Выход администратора |
| `GET` | `/api/admin/workspaces` | Список всех workspaces |
| `POST` | `/api/admin/workspaces` | Создать workspace |
| `PATCH` | `/api/admin/workspaces/{workspace_id}` | Переименовать / сменить ключ доступа (смена ключа отзывает все сессии команды и ссылку-приглашение) |
| `GET` | `/api/admin/workspaces/{workspace_id}/invite` | Токен ссылки-приглашения команды |
| `POST` | `/api/admin/workspaces/{workspace_id}/invite/rotate` | Перевыпустить ссылку-приглашение (старая перестаёт работать) |
| `DELETE` | `/api/admin/workspaces/{workspace_id}` | Удалить workspace |

### Boards (`/api/boards/*`)

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/boards/templates` | Список шаблонов досок |
| `GET` | `/api/boards/mood-trends` | Динамика настроения, карточек и задач по доскам workspace |
| `POST` | `/api/boards/workspace-insights` | Кросс-спринт инсайты workspace (AI + fallback) |
| `GET` | `/api/boards/` | Список активных досок workspace |
| `POST` | `/api/boards/` | Создать доску (по шаблону / custom колонкам / с carry-forward) |
| `GET` | `/api/boards/by-slug/{slug}` | Получить доску по slug |
| `GET` | `/api/boards/{board_id}` | Получить доску со всеми колонками, группами, карточками и mood |
| `PATCH` | `/api/boards/{board_id}` | Обновить настройки доски (`name`, `max_votes`, `is_locked`, `hide_cards_until_reveal`, `anonymous_votes`, `allow_multiple_votes_per_card`) |
| `DELETE` | `/api/boards/{board_id}` | Удалить доску (soft delete через `deleted_at`); доступно создателю доски или ведущему |
| `POST` | `/api/boards/{board_id}/reveal` | Раскрыть карточки скрытого сбора вне сессии ведущего (создатель доски) |
| `POST` | `/api/boards/{board_id}/mood` | Сохранить / обновить оценку настроения участника сессии |
| `GET` | `/api/boards/health/questions` | Вопросы health check (фиксированный набор: темп, качество, процесс, атмосфера, ясность целей) |
| `GET` | `/api/boards/{board_id}/health` | Сводка health check по доске и собственные ответы участника |
| `POST` | `/api/boards/{board_id}/health` | Ответить на вопросы: `answers` — ключ вопроса → `1` (красный), `2` (жёлтый), `3` (зелёный) |
| `POST` | `/api/boards/{board_id}/roti` | Оценить встречу одним числом от `1` до `5` |
| `GET` | `/api/boards/health-trends` | Средние по вопросам и оценка встречи по доскам команды |
| `GET` | `/api/boards/themes` | Темы команды с числом досок и длиной текущей серии повторов |
| `GET` | `/api/boards/{board_id}/summary` | Получить последнее AI-резюме доски |
| `POST` | `/api/boards/{board_id}/summary/regenerate` | Перегенерировать AI-резюме доски |
| `POST` | `/api/boards/{board_id}/reset-votes` | Сбросить собственные голоса участника на доске |

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
| `POST` | `/api/cards/{card_id}/like` | Добавить / снять голос участника сессии (`action=toggle\|add\|remove`) |
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
| `GET` | `/api/action-items/all` | Все задачи workspace (для `/dashboard`); перенесённые оригиналы скрыты, пока не передан `include_carried=true` |
| `POST` | `/api/action-items/carry-forward` | Перенести незакрытые задачи с исходной доски на целевую: на целевой появляется копия, оригинал помечается перенесённым (`superseded_by_id`) и больше не считается открытым |
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
- Входящие сообщения проверяются (`backend/app/ws_payloads.py`): `data` обязан быть объектом, числа — конечными и в допустимом диапазоне, сообщение — не длиннее 4096 символов. Некорректное сообщение молча отбрасывается, а другим участникам рассылаются только известные поля.

### События от клиента к серверу

| Событие | Описание |
|---|---|
| `identify` | Личность сокета задаёт сессия, имя из сообщения не принимается; в ответ сервер присылает `presence_update` и `facilitator_update` |
| `cursor_move` / `cursor_leave` | Позиция курсора (`x`, `y`) и уход курсора |
| `facilitator_start` / `facilitator_stop` | Старт / завершение сессии фасилитации (опционально блокировка доски при стопе) |
| `facilitator_transfer` | Ведущий передаёт роль участнику на доске (`participant_id`); фаза и таймер сохраняются |
| `facilitator_takeover` | Участник забирает роль, если ведущий не в сети дольше 15 секунд |
| `health_check_start` | Запустить health check у всех участников (в сессии — только ведущий) |
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
| `presence_update` | Участники на доске: `users` (имена) и `participants` (`id` + `name`; тёзки — разные участники) |
| `facilitator_update` | Текущий ведущий (`facilitator`, `facilitator_id`, `facilitator_online`), фаза и `session_id` |
| `participant_renamed` | Участник сменил имя (`participant_id`, `name`) |
| `health_check_requested` / `health_updated` | Запрос пройти health check и обновлённая сводка по доске (без личных ответов) |
| `roti_requested` | Сессия завершена — запрос оценить встречу |
| `cards_visibility_changed` | Изменилась видимость чужих карточек (начало / конец «Штурма», раскрытие скрытого сбора) — клиент перечитывает доску |
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

### Backend (`backend/.env` или `ConfigMap` / `Secret` в Kubernetes)

| Переменная | Обязательна | Описание |
|---|---|---|
| `DATABASE_URL` | Да | Строка подключения PostgreSQL (`postgresql://...`; драйвер psycopg 3 подставляется автоматически) |
| `CORS_ORIGINS` | Для prod / Helm | Разрешённые origin'ы через запятую (локальный дефолт: `http://localhost:3000,http://localhost:5173`; в Helm запрещены пустое значение, `*` и `null`) |
| `ADMIN_LOGIN` | Да | Логин администратора (`/admin`, `>= 3` символов, не `"admin"`) |
| `ADMIN_PASSWORD` | Да | Пароль администратора (`>= 8` символов, не `"changeme"`) |
| `WORKSPACE_JWT_SECRET` | Да | Секрет подписи JWT workspace (`>= 32` символов) |
| `ADMIN_JWT_SECRET` | Да | Секрет подписи JWT администратора (`>= 32` символов) |
| `WORKSPACE_JWT_EXPIRE_HOURS` | Нет | Срок жизни workspace-токена в часах (по умолчанию: `168`) |
| `SECURE_COOKIES` | Нет | Флаг `Secure` на куках (по умолчанию: `true`; для локального HTTP — `false`) |
| `CSRF_ENABLED` | Нет | CSRF-защита (по умолчанию: `true`; `false` — только для тестовых стендов) |
| `AI_BASE_URL` | Нет | OpenAI-совместимый `/v1` эндпоинт AI-шлюза (без него AI-функции отключены) |
| `AI_API_KEY` | Нет | API-ключ AI-шлюза |
| `AI_MODEL` | При `AI_BASE_URL` | Имя модели в OpenAI-совместимом шлюзе (задайте явно под вашего провайдера) |
| `AI_DISABLE_THINKING` | Нет | Передавать `chat_template_kwargs: {"enable_thinking": false}` для reasoning-моделей (по умолчанию: `true`; для стандартного OpenAI API выставьте `false`) |
| `AI_MAX_CONCURRENCY` | Нет | Сколько запросов к модели выполняется одновременно (по умолчанию: `4`); остальные ждут `AI_QUEUE_TIMEOUT_S` секунд (по умолчанию: `15`) и получают отказ |
| `AI_CONNECT_TIMEOUT_S` | Нет | Таймаут установки соединения с AI-шлюзом в секундах (по умолчанию: `5`) |
| `DB_CONNECT_TIMEOUT_S` | Нет | Таймаут подключения к PostgreSQL в секундах (по умолчанию: `5`) |
| `DB_STATEMENT_TIMEOUT_MS` | Нет | Серверный таймаут одного запроса PostgreSQL (по умолчанию: `30000`) |
| `DB_LOCK_TIMEOUT_MS` | Нет | Серверный таймаут ожидания блокировки PostgreSQL (по умолчанию: `10000`) |
| `DB_POOL_TIMEOUT_S` | Нет | Сколько секунд запрос ждёт свободное соединение из пула (по умолчанию: `10`) |
| `MAX_REQUEST_BODY_BYTES` | Нет | Максимальный размер тела HTTP-запроса; больше — ответ `413` (по умолчанию: `1048576`) |
| `WS_MAX_SIZE` | Нет | Максимальный размер WebSocket-кадра в байтах для `--ws-max-size` в `uvicorn` (по умолчанию: `65536`) |
| `SKIP_MIGRATIONS` | Нет | Пропуск `alembic upgrade head` в `entrypoint.sh` (`true` при вынесении миграций в initContainer) |
| `FORWARDED_ALLOW_IPS` | Нет | Доверенные прокси для `--forwarded-allow-ips` в `uvicorn` (по умолчанию: `*`) |
| `TESTING` | Нет | Режим тестов (`true` отключает `slowapi` и прод-валидаторы `Settings`) |

### Frontend (`frontend/.env.local` при локальной разработке)

| Переменная | Описание |
|---|---|
| `BACKEND_URL` | URL бэкенда для dev-rewrite `/api/*` (по умолчанию `http://localhost:8000`; в production при отсутствии не используется) |
| `NEXT_PUBLIC_WS_HOST` | Явный хост WebSocket (если отличается от `location.host`) |
