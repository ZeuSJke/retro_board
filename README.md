# RetroBoard — Agile Ретро Доска

Веб-приложение для проведения Agile-ретроспектив в реальном времени.

**Стек:** Next.js 15 · TypeScript · FastAPI · PostgreSQL · Alembic · WebSocket · Docker

---

## Возможности

- **Несколько досок** — создавай, переключайся, удаляй; новая доска создаётся с тремя колонками по умолчанию
- **Колонки** — добавляй любое количество, меняй название (двойной клик) и цвет метки
- **Карточки** — с именем автора, цветом фона, лайками и drag & drop
- **Группы карточек** — объединяй карточки в именованные группы, перемещай группу целиком в другую колонку
- **AI-возможности** (OpenRouter):
  - **Кластеризация** — кнопка «Сгруппировать похожие (AI)» в заголовке колонки: AI автоматически находит семантически похожие карточки и создаёт группы
  - **Резюме ретро** — автоматическая генерация summary, ключевых тем и рекомендаций при переходе в фазу «Итоги»
  - **Генерация названий задач** — AI создаёт краткие заголовки для Action Items из текста карточек
- **Drag & Drop** — перетаскивай карточки и группы между колонками (@dnd-kit, мышь + тач)
- **Real-time** — все участники видят изменения мгновенно через WebSocket
- **Курсоры участников** — позиции курсоров транслируются в реальном времени
- **Фасилитатор** — режим ведущего: фазы ретро (мозговой штурм → обсуждение → голосование), управление таймером
- **Таймер** — обратный отсчёт для временных слотов ретро (старт / пауза / сброс), синхронизируется через WebSocket
- **Лимит голосов** — настраиваемый лимит голосов на участника (по умолчанию 5), бейдж использования в топбаре
- **Итоги (Action Items)** — мастер-колонка на доске для фиксации решений и задач (статус read-only); полное управление (редактирование, статусы, удаление, Jira) — на странице Dashboard; перенос незакрытых задач между досками (carry-forward)
- **Dashboard** — история ретро, кросс-доска список задач с фильтрами (статус, доска, ответственный), карточки задач с inline-редактированием, секция выполненных задач, график трендов, просмотр AI-резюме
- **Jira-интеграция** — создавай задачи в Jira из Dashboard (бэкенд-прокси, ключи не утекают в браузер)
- **Экспорт в PDF** — сохрани содержимое доски одним кликом
- **Workspaces** — изолированные рабочие пространства для разных команд, каждый с собственным набором досок
- **Admin-панель** — управление workspaces (создание, переименование, смена ключа доступа, удаление)
- **Тема** — Material Design 3, меняй акцентный цвет и тёмный/светлый режим
- **Обработка ошибок** — глобальный middleware на бэкенде, toast-уведомления и ErrorBoundary на фронтенде
- **Rate Limiting** — ограничение частоты запросов (100/мин чтение, 30/мин мутации, 20 сообщений/сек WebSocket)
- **Адаптивность** — колонки масштабируются под размер экрана
- **Мягкое удаление досок** — доски помечаются `deleted_at`, а не удаляются физически
- **CSRF-защита** — cookie token + заголовок `X-CSRF-Token` на мутациях
- **Персистентность** — данные хранятся в PostgreSQL

---

## Быстрый старт (Docker)

### 1. Подготовь переменные окружения

```bash
cp .env.example .env
```

Отредактируй `.env`:

```env
POSTGRES_DB=retroboard
POSTGRES_USER=retro
POSTGRES_PASSWORD=your_secure_password

CORS_ORIGINS=http://localhost:3080
```

### 2. Запусти

```bash
docker compose up --build
```

### 3. Открой браузер

| Адрес | Назначение |
|---|---|
| http://localhost:3080 | Приложение |
| http://localhost:8000/docs | Swagger UI (API) |
| http://localhost:8000/redoc | ReDoc (API) |
| http://localhost:3080/admin | Admin-панель (управление workspaces) |

---

## Разработка без Docker

### База данных

```bash
docker compose up db -d
```

### Бэкенд (FastAPI)

```bash
cd backend

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r requirements.txt
pip install -r requirements-dev.txt  # для тестов

cp .env.example .env
# Укажи DATABASE_URL для localhost в backend/.env

# Применить миграции
alembic upgrade head

# Запусти с hot reload
uvicorn main:app --reload
# -> http://localhost:8000
# -> Swagger: http://localhost:8000/docs
```

### Фронтенд (Next.js + TypeScript)

```bash
cd frontend
npm install
```

Создай файл `frontend/.env.local`:

```env
BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_WS_HOST=localhost:8000
```

```bash
npm run dev
# -> http://localhost:3000
```

> Next.js проксирует `/api/*` на `http://localhost:8000` через `next.config.mjs` (rewrites).
> WebSocket подключается напрямую к `localhost:8000` через `NEXT_PUBLIC_WS_HOST`.

---

## Структура проекта

```
retro_board/
├── .env.example                  # Шаблон переменных окружения
├── .github/workflows/ci.yml     # CI: тесты бэкенда + линт и тесты фронтенда
├── .github/workflows/deploy.yml # CD: автодеплой на сервер через SSH
├── docker-compose.yml
├── docker-compose.override.yml   # Dev-оверрайд: volume mount для hot-reload
├── docker-compose.prod.yml       # Prod-оверрайд: без --reload, лимиты памяти
│
├── backend/
│   ├── Dockerfile
│   ├── entrypoint.sh             # Docker entrypoint: миграции + запуск uvicorn
│   ├── requirements.txt
│   ├── requirements-dev.txt      # Зависимости для тестов (pytest, etc.)
│   ├── main.py                   # FastAPI app, CORS, миграции, rate limiter
│   ├── alembic.ini               # Конфигурация Alembic
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/             # Миграции БД
│   ├── tests/                    # Тесты pytest
│   │   ├── conftest.py
│   │   ├── test_boards.py
│   │   ├── test_cards.py
│   │   ├── test_columns.py
│   │   ├── test_groups.py
│   │   ├── test_action_items.py
│   │   ├── test_workspaces.py
│   │   ├── test_admin.py
│   │   ├── test_jira.py
│   │   ├── test_csrf.py
│   │   ├── test_websocket.py
│   │   ├── test_error_handling.py
│   │   ├── test_rate_limiting.py
│   │   ├── test_auto_cluster.py
│   │   └── test_summary.py
│   └── app/
│       ├── config.py             # Pydantic Settings
│       ├── database.py           # SQLAlchemy engine + сессия
│       ├── limiter.py            # Конфигурация slowapi rate limiter
│       ├── models.py             # ORM-модели
│       ├── schemas.py            # Pydantic-схемы с валидацией
│       ├── ws_manager.py         # WebSocket connection manager
│       ├── workspace_auth.py     # Валидация workspace токена
│       ├── ai/
│       │   ├── ai_client.py      # OpenRouter AI клиент
│       │   ├── clustering.py     # AI-кластеризация карточек
│       │   └── prompts/          # Промпты для summary, title generation
│       └── routers/
│           ├── boards.py
│           ├── columns.py
│           ├── cards.py
│           ├── groups.py
│           ├── action_items.py
│           ├── workspaces.py     # Вход в workspace
│           ├── admin.py          # Admin API (CRUD workspaces)
│           ├── jira.py           # Jira-интеграция (прокси)
│           └── websocket.py
│
└── frontend/
    ├── Dockerfile                # Multi-stage: builder -> runner + nginx
    ├── nginx.conf                # Проксирование /api и /ws на backend
    ├── next.config.mjs           # Next.js: standalone output, API rewrite
    ├── tsconfig.json             # TypeScript strict конфиг
    ├── .eslintrc.json            # ESLint + next/core-web-vitals
    ├── playwright.config.ts      # Playwright E2E конфиг
    ├── start.sh                  # Запуск node server.js + nginx
    ├── vitest.config.ts          # Конфигурация Vitest
    ├── .env.local                # Локальные env переменные
    ├── api/
    │   ├── index.ts              # Main API, workspace functions, interceptors
    │   └── admin.ts             # Admin API (separate axios instance)
    ├── app/
    │   ├── layout.tsx           # Root layout: шрифты, ErrorBoundary, Toast
    │   ├── globals.css           # CSS-переменные MD3, глобальные стили
    │   ├── page.tsx             # Главная: список досок, редирект
    │   ├── dashboard/page.tsx   # Dashboard: история ретро, задачи
    │   ├── board/[id]/page.tsx # Страница доски
    │   └── admin/
    │       ├── page.tsx         # Admin-панель: управление workspaces
    │       ├── layout.tsx
    │       └── admin.module.css
    ├── components/
    │   ├── App.tsx              # Корневой компонент
    │   ├── BoardPage.tsx        # Доска с DnD-контекстом
    │   ├── BoardsPanel.tsx      # Боковая панель со списком досок
    │   ├── CardGroupWidget.tsx  # Группа карточек с DnD
    │   ├── CardWidget.tsx       # Карточка с DnD, лайками
    │   ├── Column.tsx           # Колонка с карточками
    │   ├── Dashboard.tsx        # Dashboard: задачи, фильтры, Jira
    │   ├── MasterColumn.tsx     # Мастер-колонка итогов (read-only)
    │   ├── PhaseProgress.tsx    # Визуальный индикатор фаз ретро
    │   ├── TimerWidget.tsx      # Таймер обратного отсчёта
    │   ├── Topbar.tsx           # Верхняя панель навигации
    │   ├── WelcomeDialog.tsx    # Диалог входа (имя + workspace)
    │   ├── ThemePanel.tsx       # Панель смены темы
    │   ├── TrendChart.tsx       # График трендов на Dashboard
    │   ├── CursorMarker.tsx     # Индикатор курсора участника
    │   ├── JiraDialog.tsx       # Диалог создания задачи в Jira
    │   ├── SummaryModal.tsx     # Просмотр AI-резюме ретро
    │   ├── Dialog.tsx           # Переиспользуемый диалог
    │   ├── ErrorBoundary.tsx    # Обработка ошибок рендера
    │   └── Toast.tsx            # Toast-уведомления
    ├── hooks/
    │   ├── useWebSocket.ts      # WS с автореконнектом
    │   ├── useBoardWebSocket.ts # WS доски: CRUD, курсоры, фасилитатор
    │   ├── useBoardDragDrop.ts  # DnD сенсоры, коллизии
    │   ├── useTimer.ts          # Таймер с localStorage
    │   └── useFacilitator.ts    # Управление фазами
    ├── store/
    │   ├── index.ts             # Zustand: username, theme, workspace
    │   └── toastStore.ts        # Toast-уведомления
    ├── types/
    │   └── index.ts             # TypeScript интерфейсы, WS events
    ├── utils/
    │   ├── boardMapper.ts       # Преобразование типов
    │   ├── apiError.ts          # Обработка ошибок API
    │   ├── theme.ts             # Цвета, тема, initials
    │   ├── wsData.ts            # WS data converters
    │   └── exportPDF.ts         # Экспорт в PDF
    ├── tests/                   # Vitest + Testing Library
    │   ├── setup.ts
    │   ├── store/
    │   ├── api/
    │   ├── components/
    │   └── hooks/
    └── e2e/                      # Playwright E2E тесты
        ├── helpers.ts           # Утилиты для тестов
        ├── admin.spec.ts
        ├── board.spec.ts
        ├── workspace.spec.ts
        ├── dashboard.spec.ts
        ├── action-items.spec.ts
        ├── dnd.spec.ts
        └── home.spec.ts
```

---

## CI/CD

### CI — тесты и линт (`.github/workflows/ci.yml`)

| Job | Окружение | Команда |
|---|---|---|
| **backend-tests** | Python 3.12 | `pytest -v` |
| **frontend-lint** | Node 20 | `npm run lint` |
| **frontend-tests** | Node 20 | `npm test` |
| **frontend-e2e** | Docker Compose | Playwright против полного стека |

### CD — автодеплой (`.github/workflows/deploy.yml`)

После успешного CI на `main` автоматически деплоит на сервер через SSH.

**Требуемые секреты:** `TRUENAS_HOST`, `TRUENAS_USER`, `TRUENAS_SSH_KEY`, `TRUENAS_SSH_PORT`, `TRUENAS_PROJECT_DIR`

---

## API Reference

### Boards

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/boards/` | Список всех досок |
| `POST` | `/api/boards/` | Создать доску (+ 3 колонки по умолчанию) |
| `GET` | `/api/boards/{id}` | Получить доску со всеми данными |
| `GET` | `/api/boards/by-slug/{slug}` | Получить доску по slug |
| `PATCH` | `/api/boards/{id}` | Обновить доску (название, лимит голосов) |
| `DELETE` | `/api/boards/{id}` | Удалить доску (soft delete) |
| `GET` | `/api/boards/{id}/summary` | Получить AI-резюме доски |

### Columns

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/columns/` | Создать колонку |
| `PATCH` | `/api/columns/{id}` | Обновить название / цвет / позицию |
| `DELETE` | `/api/columns/{id}` | Удалить колонку (каскадно) |

### Cards

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/cards/` | Создать карточку |
| `PATCH` | `/api/cards/{id}` | Обновить текст / цвет |
| `POST` | `/api/cards/{id}/move` | Переместить в другую колонку |
| `POST` | `/api/cards/{id}/like` | Добавить / убрать лайк |
| `DELETE` | `/api/cards/{id}` | Удалить карточку |

### Groups

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/groups/` | Создать группу |
| `PATCH` | `/api/groups/{id}` | Переименовать группу |
| `DELETE` | `/api/groups/{id}` | Удалить группу |
| `POST` | `/api/groups/{id}/set_card/{card_id}` | Добавить карточку в группу |
| `DELETE` | `/api/groups/{id}/remove_card/{card_id}` | Убрать из группы |
| `PATCH` | `/api/groups/{id}/move` | Переместить группу |
| `POST` | `/api/groups/auto-cluster` | AI-кластеризация карточек в колонке |

### Action Items

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/action-items/?board_id=...` | Список итогов доски |
| `GET` | `/api/action-items/all` | Все итоги со всех досок (для Dashboard) |
| `GET` | `/api/action-items/trends` | Данные для графика трендов |
| `POST` | `/api/action-items/` | Создать итог |
| `POST` | `/api/action-items/generate-title` | Сгенерировать название через AI |
| `POST` | `/api/action-items/carry-forward` | Перенести незакрытые итоги на другую доску |
| `PATCH` | `/api/action-items/{id}` | Обновить текст / ответственного / статус |
| `DELETE` | `/api/action-items/{id}` | Удалить итог |

### Workspaces

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/workspaces/login` | Вход в workspace (slug + access_key) |

### Admin

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/admin/login` | Вход администратора |
| `POST` | `/api/admin/logout` | Выход администратора |
| `GET` | `/api/admin/workspaces` | Список всех workspaces |
| `POST` | `/api/admin/workspaces` | Создать workspace |
| `PATCH` | `/api/admin/workspaces/{id}` | Обновить workspace |
| `DELETE` | `/api/admin/workspaces/{id}` | Удалить workspace |

### Jira

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/jira/status` | Проверить настройку Jira |
| `POST` | `/api/jira/create-issue` | Создать задачу в Jira |

### Health

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/health` | Проверка здоровья бэкенда |

### WebSocket

```
ws://localhost/ws/{board_id}?workspace_token={token}
```

#### События от клиента к серверу

| Событие | Описание |
|---|---|
| `identify` | Регистрация пользователя (username) |
| `cursor_move` | Позиция курсора (x, y) |
| `cursor_leave` | Пользователь убрал курсор |
| `facilitator_start` | Начать фасилитацию |
| `facilitator_stop` | Завершить фасилитацию (закрывает доску) |
| `phase_change` | Сменить фазу (brainstorm → reveal → discuss → vote → summary) |
| `timer_start` | Запустить таймер (duration, remaining) |
| `timer_pause` | Пауза таймера |
| `timer_reset` | Сброс таймера |
| `group_collapse` | Свернуть / развернуть группу |

#### События от сервера к клиентам

| Событие | Описание |
|---|---|
| `presence_update` | Список активных пользователей |
| `facilitator_update` | Статус фасилитатора и текущая фаза |
| `phase_update` | Смена фазы ретро |
| `cursor_move` / `cursor_leave` | Курсоры других участников |
| `timer_start` / `timer_pause` / `timer_reset` | Синхронизация таймера |
| `card_created` / `card_updated` / `card_deleted` | CRUD карточек |
| `card_moved` | Перемещение карточки между колонками |
| `column_created` / `column_updated` / `column_deleted` | CRUD колонок |
| `group_created` / `group_updated` / `group_deleted` | CRUD групп |
| `group_moved` | Перемещение группы между колонками |
| `group_collapse` | Свернуть/развернуть группу |
| `action_item_created` / `action_item_updated` / `action_item_deleted` | CRUD итогов |
| `summary_generated` | AI-резюме сгенерировано |
| `auto_cluster_completed` | AI-кластеризация завершена |

---

## Переменные окружения

### Корневой `.env` (Docker Compose)

| Переменная | Описание |
|---|---|
| `POSTGRES_DB` | Имя базы данных |
| `POSTGRES_USER` | Пользователь PostgreSQL |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL |
| `CORS_ORIGINS` | Разрешённые CORS-источники |
| `ADMIN_LOGIN` | Логин админа (по умолчанию: admin) |
| `ADMIN_PASSWORD` | Пароль админа (по умолчанию: changeme) |
| `JIRA_URL` | URL Jira-инстанса (опционально) |
| `JIRA_EMAIL` | Email для Jira API (опционально) |
| `JIRA_API_TOKEN` | API-токен Jira (опционально) |
| `OPENROUTER_API_KEY` | API-ключ OpenRouter для AI-функций (опционально) |
| `WORKSPACE_JWT_SECRET` | Секрет для JWT токенов workspace (обязательно, 32+ символов) |
| `ADMIN_JWT_SECRET` | Секрет для JWT токенов админа (обязательно, 32+ символов) |
| `WORKSPACE_JWT_EXPIRE_HOURS` | Срок жизни workspace токена (по умолчанию: 168 = 7 дней) |
| `JIRA_VERIFY_SSL` | Проверка SSL при подключении к Jira (по умолчанию: true) |

### `backend/.env` (локальная разработка)

| Переменная | Описание |
|---|---|
| `DATABASE_URL` | Строка подключения к PostgreSQL |
| `CORS_ORIGINS` | Разрешённые CORS-источники |
| `WORKSPACE_JWT_SECRET` | Секрет для JWT токенов workspace |
| `ADMIN_JWT_SECRET` | Секрет для JWT токенов админа |
| `OPENROUTER_API_KEY` | API-ключ OpenRouter (опционально) |

### `frontend/.env.local` (локальная разработка)

| Переменная | Описание |
|---|---|
| `BACKEND_URL` | URL бэкенда |
| `NEXT_PUBLIC_WS_HOST` | Хост WebSocket |

---

## Полезные команды

```bash
# Docker
docker compose up --build          # Собрать и запустить (dev с hot-reload)
docker compose up --build -d       # Фоновый режим
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build  # Production
docker compose up db -d           # Только БД
docker compose down -v             # Полный сброс (включая данные)

# Бэкенд
cd backend && pytest -v             # Тесты
cd backend && alembic upgrade head  # Миграции

# Фронтенд
cd frontend && npm run dev          # Dev сервер
cd frontend && npm run build        # Production build
cd frontend && npm run lint         # ESLint
cd frontend && npm test             # Vitest тесты
cd frontend && npm run test:e2e    # Playwright E2E

# Бэкап БД
docker compose exec db pg_dump -U retro retroboard > backup_$(date +%Y%m%d).sql
```

---

## Деплой

Деплой автоматический через GitHub Actions. При пуше в `main` после прохождения тестов сервер обновляется по SSH.

### Ручное управление на сервере

```bash
./deploy.sh            # собрать и запустить
./deploy.sh stop       # остановить
./deploy.sh restart    # перезапустить
./deploy.sh logs       # логи
./deploy.sh update     # git pull + пересборка
```

Приложение доступно на `http://<IP>:3080`.

---

## Безопасность

- `.env` добавлен в `.gitignore` — секреты не попадут в репозиторий
- `.env.example` показывает структуру без реальных значений
- **CSRF-защита** — cookie token + заголовок `X-CSRF-Token` на всех мутациях
- **JWT-аутентификация** — workspace и admin токены с настраиваемым сроком жизни
- **Rate Limiting** — slowapi: 100/мин чтение, 30/мин мутации, 5/мин AI-вызовы
- **WebSocket Rate Limiting** — максимум 20 сообщений/сек на соединение
- **Лимит голосов** — серверная проверка
- **Jira-интеграция** — запросы проксируются через бэкенд, ключи не утекают
- **Workspace изоляция** — JWT токен в каждом запросе, данные изолированы
- **AI-безопасность** — санитизация текста карточек перед отправкой в AI, валидация ответов по белому списку ID
