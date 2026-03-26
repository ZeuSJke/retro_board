# RetroBoard — Agile Ретро Доска

Веб-приложение для проведения Agile-ретроспектив в реальном времени.

**Стек:** Next.js 15 · TypeScript · FastAPI · PostgreSQL · Alembic · WebSocket · Docker

---

## Возможности

- Несколько досок — создавай, переключайся, удаляй; новая доска создаётся с тремя колонками по умолчанию
- Колонки — добавляй любое количество, меняй название (двойной клик) и цвет метки
- Заметки — с именем автора, цветом фона, лайками и drag & drop
- Группы карточек — объединяй карточки в именованные группы, перемещай группу целиком в другую колонку
- Drag & Drop — перетаскивай карточки и группы между колонками (@dnd-kit, мышь + тач)
- Таймер — обратный отсчёт для временных слотов ретро (старт / пауза / сброс), синхронизируется через WebSocket
- Real-time — все участники видят изменения мгновенно через WebSocket
- Курсоры участников — позиции курсоров транслируются в реальном времени
- Лимит голосов — настраиваемый лимит голосов на участника (по умолчанию 5), бейдж использования в топбаре
- Обработка ошибок — глобальный middleware на бэкенде, toast-уведомления и ErrorBoundary на фронтенде
- Rate Limiting — ограничение частоты запросов (100/мин чтение, 30/мин мутации, 20 сообщений/сек WebSocket)
- Тема — Material Design 3, меняй акцентный цвет и тёмный/светлый режим
- Итоги (Action Items) — мастер-колонка на доске для фиксации решений и задач: ответственные, редактирование, real-time синхронизация через WebSocket
- Jira-интеграция — создавай задачи в Jira прямо из итогов ретро (бэкенд-прокси, ключи не утекают в браузер)
- Экспорт в PDF — сохрани содержимое доски одним кликом; итоги выводятся отдельным блоком с детализацией (ответственный, дата, номер задачи Jira)
- Персистентность — данные хранятся в PostgreSQL
- Адаптивность — колонки масштабируются под размер экрана

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
├── docker-compose.prod.yml      # Prod-оверрайд: без --reload, лимиты памяти
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                   # FastAPI app, CORS, миграции, rate limiter, error middleware
│   ├── alembic.ini               # Конфигурация Alembic
│   ├── alembic/                  # Миграции базы данных
│   │   ├── env.py
│   │   └── versions/
│   ├── tests/                    # Тесты pytest
│   │   ├── conftest.py
│   │   ├── test_boards.py
│   │   ├── test_cards.py
│   │   ├── test_columns.py
│   │   ├── test_groups.py
│   │   ├── test_error_handling.py
│   │   ├── test_rate_limiting.py
│   │   └── test_websocket.py
│   └── app/
│       ├── config.py             # Pydantic Settings
│       ├── database.py           # SQLAlchemy engine + сессия
│       ├── limiter.py            # Конфигурация slowapi rate limiter
│       ├── models.py             # ORM-модели: Board, Column, Card, CardGroup, ActionItem
│       ├── schemas.py            # Pydantic-схемы с валидацией цветов
│       ├── ws_manager.py         # WebSocket connection manager
│       └── routers/
│           ├── boards.py
│           ├── columns.py
│           ├── cards.py
│           ├── groups.py
│           ├── action_items.py   # CRUD итогов (action items)
│           ├── jira.py           # Jira-интеграция (прокси)
│           └── websocket.py
│
└── frontend/
    ├── Dockerfile                # Multi-stage: builder -> runner + nginx
    ├── nginx.conf                # Проксирование /api и /ws на backend
    ├── next.config.mjs           # Next.js: standalone output, API rewrite
    ├── tsconfig.json             # TypeScript strict конфиг
    ├── .eslintrc.json            # ESLint + next/core-web-vitals
    ├── start.sh                  # Запуск node server.js + nginx
    ├── vitest.config.ts            # Конфигурация Vitest для тестов
    ├── tests/                      # Фронтенд-тесты (Vitest + Testing Library)
    │   ├── setup.ts
    │   ├── store/
    │   │   ├── index.test.ts
    │   │   └── toastStore.test.ts
    │   ├── api/
    │   │   └── index.test.ts
    │   └── components/
    │       ├── CardWidget.test.tsx
    │       └── Column.test.tsx
    ├── app/
    │   ├── layout.tsx            # Root layout: шрифты, ErrorBoundary, Toast
    │   ├── globals.css           # CSS-переменные MD3, глобальные стили
    │   ├── page.tsx              # Главная: список досок, редирект
    │   └── board/[id]/page.tsx   # Страница доски по ID/slug
    ├── components/
    │   ├── App.tsx               # Корневой компонент: состояние, таймер
    │   ├── App.module.css
    │   ├── BoardPage.tsx         # Доска с DnD-контекстом (оркестратор)
    │   ├── BoardPage.module.css
    │   ├── BoardsPanel.tsx       # Боковая панель со списком досок
    │   ├── BoardsPanel.module.css
    │   ├── CardGroupWidget.tsx   # Группа карточек с DnD
    │   ├── CardGroupWidget.module.css
    │   ├── CardWidget.tsx        # Карточка заметки с DnD, лимит голосов
    │   ├── CardWidget.module.css
    │   ├── Column.tsx            # Колонка с карточками
    │   ├── Column.module.css
    │   ├── MasterColumn.tsx      # Мастер-колонка итогов (action items + Jira)
    │   ├── MasterColumn.module.css
    │   ├── JiraDialog.tsx        # Диалог создания задачи в Jira
    │   ├── CursorMarker.tsx      # Индикатор курсора участника
    │   ├── CursorMarker.module.css
    │   ├── Dialog.tsx            # Переиспользуемый диалог (+ danger-режим)
    │   ├── Dialog.module.css
    │   ├── ErrorBoundary.tsx    # Обработка ошибок рендера (fallback UI)
    │   ├── Toast.tsx            # Toast-уведомления (ошибки, инфо)
    │   ├── Toast.module.css
    │   ├── ThemePanel.tsx        # Панель смены темы
    │   ├── ThemePanel.module.css
    │   ├── TimerWidget.tsx       # Таймер обратного отсчёта
    │   ├── TimerWidget.module.css
    │   ├── Topbar.tsx            # Верхняя панель навигации
    │   ├── Topbar.module.css
    │   ├── WelcomeDialog.tsx     # Диалог ввода имени при первом входе
    │   └── WelcomeDialog.module.css
    ├── hooks/
    │   ├── useWebSocket.ts       # WS с автореконнектом
    │   ├── useBoardWebSocket.ts  # WS доски: сообщения, курсоры, группы
    │   └── useBoardDragDrop.ts   # DnD сенсоры, коллизии, обработчики
    ├── store/
    │   ├── index.ts              # Zustand: username, theme, currentBoard
    │   └── toastStore.ts         # Standalone store для toast-уведомлений
    ├── api/
    │   └── index.ts              # Типизированный Axios-клиент
    ├── types/
    │   └── index.ts              # TypeScript интерфейсы
    └── utils/
        ├── exportPDF.ts          # Экспорт доски в PDF
        └── theme.ts              # Цвета, applyTheme, initials
```

---

## CI/CD

### CI — тесты и линт (`.github/workflows/ci.yml`)

Запускается на push/PR в `main`:

| Job | Окружение | Команда | Что проверяет |
|---|---|---|---|
| **backend-tests** | Python 3.12 | `pytest -v` | API-эндпоинты, модели, WebSocket, обработка ошибок, rate limiting, лимит голосов (SQLite in-memory) |
| **frontend-lint** | Node 20 | `npm run lint` | ESLint + next/core-web-vitals |
| **frontend-tests** | Node 20 | `npm test` | Компоненты, store, API-клиент (Vitest + Testing Library + jsdom) |

### CD — автодеплой (`.github/workflows/deploy.yml`)

После успешного CI на `main` автоматически деплоит на сервер через SSH. Также можно запустить вручную через Actions → Deploy → Run workflow.

**Требуемые секреты в GitHub (Settings → Secrets → Actions):**

| Секрет | Описание |
|---|---|
| `TRUENAS_HOST` | IP или домен сервера |
| `TRUENAS_USER` | SSH-пользователь |
| `TRUENAS_SSH_KEY` | Приватный SSH-ключ (ed25519) |
| `TRUENAS_SSH_PORT` | Порт SSH (обычно 22) |
| `TRUENAS_PROJECT_DIR` | Путь к проекту на сервере |

---

## Миграции базы данных (Alembic)

```bash
cd backend

# Создать новую миграцию после изменения моделей
alembic revision --autogenerate -m "описание"

# Применить миграции
alembic upgrade head

# Для существующих баз без таблицы alembic_version:
# Приложение автоматически определяет это и выполняет stamp head при старте
```

---

## API Reference

### Boards

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/boards/` | Список всех досок |
| `POST` | `/api/boards/` | Создать доску (+ 3 колонки по умолчанию) |
| `GET` | `/api/boards/{id}` | Получить доску со всеми колонками и карточками |
| `GET` | `/api/boards/by-slug/{slug}` | Получить доску по slug |
| `PATCH` | `/api/boards/{id}` | Обновить доску (название, лимит голосов) |
| `DELETE` | `/api/boards/{id}` | Удалить доску (каскадно) |

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
| `POST` | `/api/cards/{id}/like` | Добавить / убрать лайк (с проверкой лимита голосов) |
| `DELETE` | `/api/cards/{id}` | Удалить карточку |

### Groups

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/groups/` | Создать группу карточек |
| `PATCH` | `/api/groups/{id}` | Переименовать группу |
| `DELETE` | `/api/groups/{id}` | Удалить группу |
| `POST` | `/api/groups/{id}/set_card/{card_id}` | Добавить карточку в группу |
| `DELETE` | `/api/groups/{id}/remove_card/{card_id}` | Убрать карточку из группы |
| `PATCH` | `/api/groups/{id}/move` | Переместить группу в другую колонку |

### Action Items (Итоги)

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/action-items/?board_id=...` | Список итогов доски |
| `POST` | `/api/action-items/` | Создать итог (text, assignee) |
| `PATCH` | `/api/action-items/{id}` | Обновить текст / ответственного |
| `DELETE` | `/api/action-items/{id}` | Удалить итог |

### Jira

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/jira/status` | Проверить, настроена ли Jira-интеграция |
| `POST` | `/api/jira/create-issue` | Создать задачу в Jira из итога |

### WebSocket

```
ws://localhost/ws/{board_id}
```

Все изменения транслируются всем подключённым клиентам:

```json
{ "event": "card_created", "data": { ...card } }
```

| Событие | Когда |
|---|---|
| `column_created` | Создана новая колонка |
| `column_updated` | Изменено название или цвет колонки |
| `column_deleted` | Колонка удалена |
| `card_created` | Создана карточка |
| `card_updated` | Изменён текст, цвет или лайки |
| `card_moved` | Карточка перемещена |
| `card_deleted` | Карточка удалена |
| `group_created` | Создана группа карточек |
| `group_updated` | Переименована группа |
| `group_moved` | Группа перемещена в другую колонку |
| `group_deleted` | Группа удалена |
| `group_collapse` | Группа свёрнута / развёрнута |
| `cursor_move` | Обновлена позиция курсора участника |
| `cursor_leave` | Участник покинул доску |
| `action_item_created` | Создан итог |
| `action_item_updated` | Обновлён итог |
| `action_item_deleted` | Удалён итог |
| `timer_start` | Таймер запущен |
| `timer_pause` | Таймер приостановлен |
| `timer_reset` | Таймер сброшен |

---

## Переменные окружения

### Корневой `.env` (для Docker Compose)

| Переменная | Описание | Пример |
|---|---|---|
| `POSTGRES_DB` | Имя базы данных | `retroboard` |
| `POSTGRES_USER` | Пользователь PostgreSQL | `retro` |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL | `super_secret` |
| `CORS_ORIGINS` | Разрешённые CORS-источники (через запятую) | `http://localhost:3080` |
| `JIRA_URL` | URL Jira-инстанса (необязательно) | `https://org.atlassian.net` |
| `JIRA_EMAIL` | Email для Jira API (необязательно) | `user@example.com` |
| `JIRA_API_TOKEN` | API-токен Jira (необязательно) | `...` |

### `backend/.env` (для локальной разработки без Docker)

| Переменная | Описание | Пример |
|---|---|---|
| `DATABASE_URL` | Строка подключения к PostgreSQL | `postgresql://retro:pass@localhost:5432/retroboard` |
| `CORS_ORIGINS` | Разрешённые CORS-источники | `http://localhost:3000` |

### `frontend/.env.local` (для локальной разработки без Docker)

| Переменная | Описание | Пример |
|---|---|---|
| `BACKEND_URL` | URL бэкенда для серверных rewrites | `http://localhost:8000` |
| `NEXT_PUBLIC_WS_HOST` | Хост WebSocket (доступен в браузере) | `localhost:8000` |

---

## Полезные команды

```bash
# Запустить только базу данных
docker compose up db -d

# Пересобрать и запустить всё
docker compose up --build

# Посмотреть логи бэкенда
docker compose logs -f backend

# Запустить тесты бэкенда
cd backend && pytest -v

# Запустить тесты фронтенда
cd frontend && npm test

# Запустить тесты фронтенда в watch-режиме
cd frontend && npm run test:watch

# Запустить линтер фронтенда
cd frontend && npm run lint

# Остановить все контейнеры
docker compose down

# Полный сброс (включая данные БД)
docker compose down -v

# Бэкап базы данных
docker compose exec db pg_dump -U retro retroboard > backup_$(date +%Y%m%d).sql
```

---

## Деплой на домашний сервер (TrueNAS + Nginx Proxy Manager)

Деплой происходит автоматически через GitHub Actions (см. CI/CD выше). При пуше в `main` после прохождения тестов сервер обновляется по SSH.

Prod-оверрайд (`docker-compose.prod.yml`) убирает `--reload` и ограничивает память контейнеров.

### Ручное управление на сервере

`deploy.sh` — утилита для управления контейнерами на сервере:

```bash
./deploy.sh            # собрать и запустить
./deploy.sh stop       # остановить
./deploy.sh restart    # перезапустить без пересборки
./deploy.sh logs       # логи в реальном времени
./deploy.sh status     # статус контейнеров
./deploy.sh update     # git pull + пересборка
```

Приложение доступно на `http://<IP-сервера>:3080`. NPM проксирует трафик с 80/443 на этот порт с включённой поддержкой WebSocket.

---

## Безопасность

- Файл `.env` добавлен в `.gitignore` — секреты не попадут в репозиторий
- `.env.example` показывает структуру без реальных значений
- Смени `POSTGRES_PASSWORD` перед деплоем на продакшн
- Настрой `CORS_ORIGINS` на реальный домен фронтенда
- В продакшне порт `5432` (PostgreSQL) не проброшен наружу
- Поля цвета валидируются паттерном hex (`#RRGGBB`)
- Rate Limiting — slowapi ограничивает частоту HTTP-запросов по IP (100/мин GET, 30/мин мутации)
- WebSocket Rate Limiting — скользящее окно: максимум 20 сообщений/сек, лишние отбрасываются
- Лимит голосов — серверная проверка: при превышении лимита возвращается HTTP 403
- Jira-интеграция — запросы к Jira API проксируются через бэкенд; токен и email не попадают в браузер
- Глобальный обработчик ошибок — необработанные исключения логируются, клиенту возвращается generic JSON-ответ без стектрейса
