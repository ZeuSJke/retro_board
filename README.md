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
- Тема — Material Design 3, меняй акцентный цвет и тёмный/светлый режим
- Экспорт в PDF — сохрани содержимое доски одним кликом
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
├── .github/workflows/ci.yml     # CI: тесты бэкенда + линт фронтенда
├── docker-compose.yml
├── docker-compose.prod.yml      # Prod-оверрайд: без --reload, лимиты памяти
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                   # FastAPI app, CORS, миграции Alembic
│   ├── alembic.ini               # Конфигурация Alembic
│   ├── alembic/                  # Миграции базы данных
│   │   ├── env.py
│   │   └── versions/
│   ├── tests/                    # Тесты pytest
│   │   ├── conftest.py
│   │   ├── test_boards.py
│   │   ├── test_cards.py
│   │   ├── test_columns.py
│   │   └── test_groups.py
│   └── app/
│       ├── config.py             # Pydantic Settings
│       ├── database.py           # SQLAlchemy engine + сессия
│       ├── models.py             # ORM-модели: Board, Column, Card, CardGroup
│       ├── schemas.py            # Pydantic-схемы с валидацией цветов
│       ├── ws_manager.py         # WebSocket connection manager
│       └── routers/
│           ├── boards.py
│           ├── columns.py
│           ├── cards.py
│           ├── groups.py
│           └── websocket.py
│
└── frontend/
    ├── Dockerfile                # Multi-stage: builder -> runner + nginx
    ├── nginx.conf                # Проксирование /api и /ws на backend
    ├── next.config.mjs           # Next.js: standalone output, API rewrite
    ├── tsconfig.json             # TypeScript strict конфиг
    ├── .eslintrc.json            # ESLint + next/core-web-vitals
    ├── start.sh                  # Запуск node server.js + nginx
    ├── app/
    │   ├── layout.tsx            # Root layout: шрифты, глобальные стили
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
    │   ├── CardWidget.tsx        # Карточка заметки с DnD
    │   ├── CardWidget.module.css
    │   ├── Column.tsx            # Колонка с карточками
    │   ├── Column.module.css
    │   ├── CursorMarker.tsx      # Индикатор курсора участника
    │   ├── CursorMarker.module.css
    │   ├── Dialog.tsx            # Переиспользуемый диалог (+ danger-режим)
    │   ├── Dialog.module.css
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
    │   └── index.ts              # Zustand: username, theme, currentBoard
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

GitHub Actions запускается на push/PR в `main`:

- **backend-tests** — Python 3.12, `pytest -v` (SQLite in-memory)
- **frontend-lint** — Node 20, `npm run lint` (ESLint)

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
| `PATCH` | `/api/boards/{id}` | Переименовать доску |
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
| `POST` | `/api/cards/{id}/like` | Добавить / убрать лайк |
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

Prod-оверрайд убирает `--reload` и ограничивает память контейнеров:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

`deploy.sh` — вспомогательный скрипт под конкретную конфигурацию с TrueNAS + Nginx Proxy Manager (фронтенд на порту `3080`, NPM проксирует трафик с 80/443). Для других окружений скрипт нужно адаптировать.

```bash
sed -i 's/\r$//' deploy.sh
chmod +x deploy.sh

./deploy.sh            # запустить
./deploy.sh update     # git pull + пересборка
./deploy.sh logs       # логи
./deploy.sh stop       # остановить
```

Приложение будет доступно на `http://<IP-сервера>:3080`. NPM настраивается на проксирование к этому порту с включённой поддержкой WebSocket.

---

## Безопасность

- Файл `.env` добавлен в `.gitignore` — секреты не попадут в репозиторий
- `.env.example` показывает структуру без реальных значений
- Смени `POSTGRES_PASSWORD` перед деплоем на продакшн
- Настрой `CORS_ORIGINS` на реальный домен фронтенда
- В продакшне порт `5432` (PostgreSQL) не проброшен наружу
- Поля цвета валидируются паттерном hex (`#RRGGBB`)
