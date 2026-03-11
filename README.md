# 🚀 RetroBoard — Agile Ретро Доска

Полноценное веб-приложение для проведения Agile-ретроспектив в реальном времени.

**Стек:** React 18 + Vite · FastAPI · PostgreSQL · WebSocket · Docker

---

## ✨ Возможности

- 📋 **Несколько досок** — создавай, переключайся, удаляй; новая доска создаётся с тремя колонками по умолчанию
- 🗂️ **Колонки** — добавляй любое количество, меняй название (двойной клик) и цвет метки
- 🗒️ **Заметки** — с именем автора, цветом фона, лайками и drag & drop
- 🖱️ **Drag & Drop** — перетаскивай карточки между колонками (@dnd-kit)
- 🔄 **Real-time** — все участники видят изменения мгновенно через WebSocket
- 🎨 **Тема** — Material Design 3, меняй акцентный цвет и тёмный/светлый режим
- 💾 **Персистентность** — данные хранятся в PostgreSQL
- 📱 **Адаптивность** — колонки масштабируются под размер экрана

---

## 🐳 Быстрый старт (Docker)

### 1. Подготовь переменные окружения

```bash
cp .env.example .env
```

Отредактируй `.env`:

```env
POSTGRES_DB=retroboard
POSTGRES_USER=retro
POSTGRES_PASSWORD=your_secure_password

CORS_ORIGINS=http://localhost:3000,http://localhost:5173
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

## 💻 Разработка без Docker

### База данных

```bash
docker compose up db -d
```

### Бэкенд (FastAPI)

```bash
cd backend

# Создай виртуальное окружение
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# Установи зависимости
pip install -r requirements.txt

# Настрой переменные окружения
cp .env.example .env
# Укажи DATABASE_URL для localhost в backend/.env

# Запусти с hot reload
uvicorn main:app --reload
# → http://localhost:8000
# → Swagger: http://localhost:8000/docs
```

### Фронтенд (React + Vite)

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

> Vite автоматически проксирует `/api` и `/ws` на `http://localhost:8000` (см. `vite.config.js`)

---

## 📁 Структура проекта

```
retro_board/
├── .env.example                  # Шаблон переменных окружения
├── .env                          # Локальные переменные (не в git!)
├── .gitattributes                # Принудительные LF-переносы для sh/yml/py
├── docker-compose.yml            # Основной compose (dev + prod)
├── docker-compose.prod.yml       # Prod-оверрайд: без --reload, лимиты памяти
│
├── backend/
│   ├── .env.example              # Шаблон для локальной разработки
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                   # FastAPI app, CORS, роутеры
│   └── app/
│       ├── config.py             # Pydantic Settings (читает .env)
│       ├── database.py           # SQLAlchemy engine + сессия
│       ├── models.py             # ORM-модели: Board, Column, Card
│       ├── schemas.py            # Pydantic схемы (In/Out)
│       ├── ws_manager.py         # WebSocket connection manager
│       └── routers/
│           ├── boards.py
│           ├── columns.py
│           ├── cards.py
│           └── websocket.py
│
└── frontend/
    ├── Dockerfile                # Multi-stage: builder → nginx
    ├── nginx.conf                # Proxy /api и /ws на backend
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css             # CSS-переменные MD3, глобальные стили
        ├── api/                  # Axios-клиент для всех эндпоинтов
        ├── components/
        │   ├── BoardsPanel.jsx   # Боковая панель со списком досок
        │   ├── CardWidget.jsx    # Карточка заметки с DnD
        │   ├── Column.jsx        # Колонка с карточками
        │   ├── Dialog.jsx        # Переиспользуемый диалог (+ danger-режим)
        │   ├── ThemePanel.jsx    # Панель смены темы
        │   └── Topbar.jsx        # Верхняя панель навигации
        ├── hooks/
        │   └── useWebSocket.js   # WS с автореконнектом и защитой от StrictMode
        ├── pages/
        │   └── BoardPage.jsx     # Доска с DnD-контекстом
        ├── store/
        │   └── index.js          # Zustand: username, theme, currentBoard
        └── utils/
            └── theme.js          # Цвета, applyTheme, initials
```

---

## 🔌 API Reference

### Boards

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/boards/` | Список всех досок |
| `POST` | `/api/boards/` | Создать доску (+ 3 колонки по умолчанию) |
| `GET` | `/api/boards/{id}` | Получить доску со всеми колонками и карточками |
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

### WebSocket

```
ws://localhost/ws/{board_id}
```

Клиент подключается к каналу доски. Все изменения транслируются всем подключённым клиентам:

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

---

## ⚙️ Переменные окружения

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
| `CORS_ORIGINS` | Разрешённые CORS-источники | `http://localhost:3000,http://localhost:5173` |

---

## 🛠️ Полезные команды

```bash
# Запустить только базу данных
docker compose up db -d

# Пересобрать и запустить всё
docker compose up --build

# Посмотреть логи бэкенда
docker compose logs -f backend

# Остановить все контейнеры
docker compose down

# Полный сброс (включая данные БД)
docker compose down -v

# Бэкап базы данных
docker compose exec db pg_dump -U retro retroboard > backup_$(date +%Y%m%d).sql
```

---

## 🏠 Деплой на домашний сервер (TrueNAS + Nginx Proxy Manager)

Проект содержит `docker-compose.prod.yml` — оверрайд для запуска поверх основного compose:
убирает `--reload`, ограничивает память контейнеров.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Также в репозитории есть `deploy.sh` — вспомогательный скрипт, написанный **под конкретную
конфигурацию с TrueNAS + Nginx Proxy Manager** (frontend на порту `3080`, NPM проксирует
трафик с 80/443). Для других окружений скрипт нужно адаптировать под себя.

```bash
# Исправить переносы строк после копирования с Windows
sed -i 's/\r$//' deploy.sh
chmod +x deploy.sh

./deploy.sh            # запустить
./deploy.sh update     # git pull + пересборка
./deploy.sh logs       # логи
./deploy.sh stop       # остановить
```

Приложение будет доступно на `http://<IP-сервера>:3080`. NPM настраивается
на проксирование к этому порту с включённой поддержкой WebSocket.

---

## 🔒 Безопасность

- Файл `.env` добавлен в `.gitignore` — секреты не попадут в репозиторий
- `.env.example` показывает структуру без реальных значений — его можно и нужно коммитить
- Смени `POSTGRES_PASSWORD` перед деплоем на продакшн
- Настрой `CORS_ORIGINS` на реальный домен фронтенда
- В продакшне порт `5432` (PostgreSQL) не проброшен наружу