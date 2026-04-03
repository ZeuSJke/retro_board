# AGENTS.md — RetroBoard

## Описание проекта

RetroBoard — Agile ретроспективная доска для real-time совместной работы.
**Стек**: Next.js 15 · TypeScript · FastAPI · PostgreSQL · WebSocket · Docker · OpenRouter AI · Jira API

---

## 1. Команды сборки, линтинга и тестирования

### Фронтенд (директория `frontend/`)

```bash
cd frontend

# Установка зависимостей
npm install

# Development сервер (http://localhost:3000)
npm run dev

# Production build
npm run build

# Запуск продакшен сервера
npm start

# Линтинг (ESLint + Next.js rules)
npm run lint

# Unit тесты (Vitest)
npm test              # all tests, single run
npm run test:watch    # watch mode

# Один тест
npx vitest run tests/store/index.test.ts

# E2E тесты (Playwright)
# Важно: ADMIN_LOGIN/ADMIN_PASSWORD должны соответствовать .env
$env:ADMIN_LOGIN='testadmin'; $env:ADMIN_PASSWORD='testpassword123'; npx playwright test
```

### Бэкенд (директория `backend/`)

```bash
cd backend

# Виртуальное окружение
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Установка зависимостей
pip install -r requirements.txt
pip install -r requirements-dev.txt # для тестов

# Запуск сервера (dev, с hot-reload)
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Миграции Alembic
alembic upgrade head
alembic revision --autogenerate -m "description"

# Тесты (pytest)
# Для локального запуска используйте SQLite:
$env:TESTING='true'; $env:DATABASE_URL='sqlite://'; pytest -v
```

### Docker

```bash
# Сборка и запуск (с гарантированным применением изменений)
docker compose up -d --build --force-recreate

# Остановка + удаление данных
docker compose down

# Полная очистка (ВНИМАНИЕ: удаляет БД и тома)
docker compose down -v
```

---

## 2. Code Style Guidelines

### Фронтенд (TypeScript / React / Next.js)

#### Типизация
- **Строгий режим TypeScript** — `strict: true` в `tsconfig.json`
- **Никаких `any`** — используй `unknown` или proper types
- **Импортируй типы** — `import type { Board } from '../types'`
- Все функции с аннотациями типов

#### Именование
- **Компоненты**: PascalCase (`BoardPage.tsx`, `CardWidget.tsx`)
- **Хуки**: camelCase с префиксом `use` (`useWebSocket.ts`)
- **CSS Modules**: snake_case (`admin.module.css`)
- **Интерфейсы**: PascalCase, без префикса `I` (`Board`, `Card`)

#### Структура файлов
```
frontend/
├── app/                    # Next.js App Router страницы
│   ├── layout.tsx          # Root layout
│   ├── page.tsx           # Главная
│   ├── admin/             # Панель управления (admin.module.css)
│   └── board/[id]/page.tsx
├── components/             # React компоненты (+ .module.css файлы)
├── hooks/                  # Кастомные хуки (useTimer, useFacilitator)
├── store/                  # Zustand stores (index.ts, toastStore.ts)
├── types/                  # TypeScript интерфейсы (index.ts)
├── utils/                  # Утилиты (theme.ts, apiError.ts, boardMapper.ts)
└── tests/                  # Vitest unit тесты
    └── store/
    └── components/
└── e2e/                    # Playwright E2E спецификации
```

#### Импорты
- **Path alias**: `@/*` указывает на корень `frontend/`
- Порядок импортов: внешние → внутренние → типы → стили

#### Модальные окна и Оверлеи (ВАЖНО)
Чтобы избежать ложного закрытия окон при выделении текста:
- Используй комбинацию `onMouseDown` и `onMouseUp` на оверлее.
- Закрывай окно только если оба события произошли на `e.currentTarget`.
- Обязательно добавляй `e.stopPropagation()` на `onMouseDown/Up` контентной части окна.
- Пример реализации: `frontend/components/Dialog.tsx`.

#### React/Next.js паттерны
- **Server Components** по умолчанию — `'use client'` только при необходимости.
- **Обработка ошибок**: компонент `ErrorBoundary` и файлы `error.tsx`.
- **Loading states**: файлы `loading.tsx` для страниц и локальные спиннеры.

---

### Бэкенд (Python / FastAPI)

#### Настройки (Pydantic v2)
- В `app/config.py` всегда используй `extra="ignore"` в `model_config`. Это предотвращает ошибки при наличии лишних переменных окружения в Docker/CI.

#### Структура файлов
```
backend/
├── main.py                 # FastAPI app, CORS, middleware, rate limiter
├── app/
│   ├── config.py          # Pydantic Settings (extra="ignore")
│   ├── database.py        # SQLAlchemy engine + session
│   ├── models.py          # ORM модели (SQLAlchemy 2.0)
│   ├── schemas.py         # Pydantic схемы
│   ├── limiter.py         # slowapi rate limiter
│   ├── ws_manager.py      # WebSocket connection manager (RAM Singleton)
│   ├── workspace_auth.py  # Workspace token validation
│   ├── ai/                # Интеграция с OpenRouter (ai_client.py)
│   └── routers/           # API роутеры (boards, cards, jira, etc.)
└── tests/                 # pytest тесты (conftest.py)
```

#### Архитектурные правила
1. **Один воркер uvicorn**: `ConnectionManager` — синглтон в памяти.
2. **WebSocket формат**: `{ "event": "name", "data": { ... } }`.
3. **Миграции**: Каждое изменение `models.py` требует миграции Alembic.
4. **Action item statuses**: Хранятся как `String(20)` для совместимости.

---

## 3. Интеграции

### AI Интеграция (OpenRouter)
- **Функции**: Summary ретроспективы, Smart Titles для задач, AI-кластеризация карточек.
- **Модели**: `google/gemma-2-9b-it`, `qwen/qwen2.5-72b-instruct`.
- **Файлы**: `backend/app/ai/ai_client.py`, `backend/app/ai/clustering.py`, `backend/app/ai/prompts/`.
- **Важно**: `ai_client.generate()` — синхронный. В async-эндпоинтах оборачивать в `asyncio.to_thread()`.

### Jira Интеграция
- Создание Issue из Action Items и синхронизация статусов.
- Настройка через `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` в `.env`.

---

## 4. Переменные окружения

### Бэкенд (`backend/.env`)
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/retroboard
OPENROUTER_API_KEY=sk-or-v1-...
WORKSPACE_JWT_SECRET=your-secret...
ADMIN_JWT_SECRET=your-admin-secret...
ADMIN_LOGIN=admin
ADMIN_PASSWORD=password
```

---

## 5. CI/CD и Деплой

### GitHub Actions
- `backend-tests`: `pytest -v` (SQLite).
- `deploy`: SSH деплой с командой `up -d --build --force-recreate`.

---

## 6. AI Агенты (OpenCode)

### Структура
```
.opencode/
├── agents/           # Конфигурации агентов (9 штук)
├── workflows/        # Цепочки вызовов агентов (5 штук)
└── memory/           # Институциональные знания агентов
```

### Доступные агенты

| Агент | Описание | Модель |
|-------|----------|--------|
| `@architect` | Архитектура, схема БД, API дизайн | minimax-m2.7 |
| `@backend-dev` | FastAPI, SQLAlchemy, WebSocket | kimi-k2.5 |
| `@frontend-dev` | Next.js, React, TypeScript | kimi-k2.5 |
| `@security` | Аудит безопасности, OWASP | minimax-m2.7 |
| `@qa` | Тесты, coverage, edge cases | minimax-m2.5 |
| `@refactorer` | Code quality, оптимизация | minimax-m2.7 |
| `@devops` | Docker, CI/CD, deployment | minimax-m2.5 |
| `@docs` | Документация | minimax-m2.5 |
| `@explainer` | Анализ кода (read-only) | kimi-k2.5 |

### Workflows (цепочки агентов)

- **Feature Development**: `@architect → @backend-dev → @frontend-dev → @security → @qa → @docs`
- **Bug Fix**: `@explainer → @backend-dev/@frontend-dev → @qa`
- **Code Review**: `@security → @refactorer → @qa`
- **Deployment**: `@devops → @qa (smoke) → @devops (deploy)`
- **Security Audit**: `@security (full audit)`

### Agent Memory
Агенты сохраняют знания в `.opencode/memory/` (решения архитектора, паттерны фронтенда/бэкенда, найденные уязвимости).
