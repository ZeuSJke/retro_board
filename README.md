# 🚀 RetroBoard — Agile Ретро Доска

Полноценное веб-приложение для проведения Agile-ретроспектив.

**Стек:** React + Vite · FastAPI · PostgreSQL · WebSocket · Docker

---

## ✨ Возможности

- 📋 **Несколько досок** — создавай, переключайся, удаляй
- 🗂️ **Колонки** — добавляй любое количество, меняй название и цвет
- 🗒️ **Заметки** — с именем автора, цветом, лайками
- 🖱️ **Drag & Drop** — перетаскивай карточки между колонками
- 🔄 **Real-time** — все участники видят изменения мгновенно через WebSocket
- 🎨 **Тема** — Material Design 3, меняй цвет и тёмный режим
- 💾 **PostgreSQL** — данные сохраняются

---

## 🐳 Запуск через Docker (рекомендуется)

```bash
# 1. Клонируй или распакуй проект
cd retroboard

# 2. Запусти всё одной командой
docker-compose up --build

# 3. Открой браузер
# Приложение: http://localhost
# API docs:   http://localhost:8000/docs
```

---

## 💻 Запуск для разработки

### База данных
```bash
docker-compose up db -d
```

### Бэкенд (FastAPI)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
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

---

## 📁 Структура проекта

```
retroboard/
├── backend/
│   ├── app/
│   │   ├── models.py        # SQLAlchemy модели
│   │   ├── schemas.py       # Pydantic схемы
│   │   ├── database.py      # Подключение к БД
│   │   ├── config.py        # Настройки
│   │   ├── ws_manager.py    # WebSocket менеджер
│   │   └── routers/
│   │       ├── boards.py
│   │       ├── columns.py
│   │       ├── cards.py
│   │       └── websocket.py
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/             # Axios клиент
│   │   ├── components/      # React компоненты
│   │   ├── pages/           # Страницы
│   │   ├── hooks/           # useWebSocket
│   │   ├── store/           # Zustand store
│   │   └── utils/           # Тема, цвета
│   ├── vite.config.js
│   ├── nginx.conf
│   └── Dockerfile
└── docker-compose.yml
```

---

## 🔌 API Endpoints

| Метод | URL | Описание |
|-------|-----|----------|
| GET | /api/boards/ | Список досок |
| POST | /api/boards/ | Создать доску |
| GET | /api/boards/{id} | Получить доску |
| PATCH | /api/boards/{id} | Обновить доску |
| DELETE | /api/boards/{id} | Удалить доску |
| POST | /api/columns/ | Создать колонку |
| PATCH | /api/columns/{id} | Обновить колонку |
| DELETE | /api/columns/{id} | Удалить колонку |
| POST | /api/cards/ | Создать карточку |
| POST | /api/cards/{id}/move | Переместить карточку |
| POST | /api/cards/{id}/like | Лайк/анлайк |
| DELETE | /api/cards/{id} | Удалить карточку |
| WS | /ws/{board_id} | WebSocket соединение |

---

## 🌐 WebSocket события

| Событие | Описание |
|---------|----------|
| `column_created` | Новая колонка |
| `column_updated` | Изменение колонки |
| `column_deleted` | Удаление колонки |
| `card_created` | Новая карточка |
| `card_updated` | Изменение карточки |
| `card_moved` | Перемещение карточки |
| `card_deleted` | Удаление карточки |
