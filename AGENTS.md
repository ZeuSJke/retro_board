# AGENTS.md — RetroBoard

## Описание проекта

RetroBoard — Agile ретроспективная доска для real-time совместной работы.
**Стек**: Next.js 15 · TypeScript · FastAPI · PostgreSQL · WebSocket · Docker

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
npx vitest run frontend/tests/store/toastStore.test.ts
npx vitest run --reporter=verbose tests/store/index.test.ts

# E2E тесты (Playwright)
npm run test:e2e
```

### Бэкенд (директория `backend/`)

```bash
cd backend

# Виртуальное окружение
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Установка зависимостей
pip install -r requirements.txt

# Запуск сервера (dev, с hot-reload)
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Запуск без hot-reload (ПРОДАКШЕН — один воркер!)
uvicorn main:app --host 0.0.0.0 --port 8000

# Миграции Alembic
alembic upgrade head
alembic revision --autogenerate -m "description"
alembic downgrade -1

# Тесты (pytest)
pytest -v                        # все тесты
pytest -v tests/test_boards.py  # один файл
pytest -v -k "test_name"        # один тест по имени
pytest --tb=short               # короткий traceback
```

### Docker

```bash
# Полный стек (frontend + backend + db)
docker compose up --build

# Только база данных
docker compose up db -d

# Остановка + удаление данных
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
- **Хуки**: camelCase с префиксом `use` (`useWebSocket.ts`, `useBoardDragDrop.ts`)
- **Утилиты/хелперы**: camelCase (`apiError.ts`, `wsData.ts`)
- **Store (Zustand)**: camelCase (`toastStore.ts`, `index.ts`)
- **Интерфейсы TypeScript**: PascalCase, без префикса `I` (`Board`, `Card`, `WsMessage`)
- **CSS Modules**: snake_case (`admin.module.css`)

#### Структура файлов
```
frontend/
├── app/                    # Next.js App Router страницы
│   ├── layout.tsx          # Root layout
│   ├── page.tsx           # Главная
│   └── board/[id]/page.tsx
├── components/             # React компоненты
├── hooks/                  # Кастомные хуки
├── store/                  # Zustand stores
├── types/                  # TypeScript интерфейсы
├── utils/                  # Утилиты
└── tests/                  # Vitest unit тесты
    └── store/
    └── components/
└── e2e/                    # Playwright E2E
```

#### Импорты
- **Path alias**: `@/*` указывает на корень `frontend/`
- Порядок импортов: внешние → внутренние → типы → стили
- Относительные импорты для соседних файлов

```typescript
import { useState, useEffect } from 'react'
import axios from 'axios'
import type { Card, Column } from '@/types'
import { useAppStore } from '@/store'
import { apiErrorHandler } from '@/utils/apiError'
import './CardWidget.css'
```

#### React/Next.js паттерны
- **Server Components по умолчанию** — добавляй `'use client'` только когда нужен browser API, event handlers или React state
- **Обработка ошибок**: компонент `ErrorBoundary` оборачивает критичные секции
- **Loading states**: создавай `loading.tsx` для каждой страницы
- **Error states**: создавай `error.tsx` для каждой страницы
- Используй `next/image`, `next/link`, `next/font` вместо нативных решений

#### Состояние и данные
- **Zustand** для глобального состояния (тема, username, workspace)
- **React Hooks** для локального состояния
- **API**: axios с interceptors для workspace token
- **WebSocket**: кастомный `useBoardWebSocket` hook

#### Тестирование
- **Vitest** + **Testing Library** для unit тестов
- **Playwright** для E2E тестов
- Путь к тестам: рядом с компонентом (`CardWidget.test.tsx`) или в `tests/`
- Моки: `vi.mock()`, `vi.spyOn()`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
```

#### CSS и стили
- **CSS Modules** для компонентов (`.module.css`)
- **CSS Variables** для темы (Material Design 3)
- **Глобальные стили**: `app/globals.css`

---

### Бэкенд (Python / FastAPI)

#### Типизация
- **Все функции с аннотациями типов**
- **Pydantic v2** для валидации данных и схем
- Используй `model_validator`, `field_validator` для бизнес-логики

#### Именование
- **Модули и функции**: snake_case (`ws_manager.py`, `workspace_auth.py`)
- **Pydantic схемы**: PascalCase с суффиксами `Base`, `Create`, `Update`, `Out`, `Response`
- **Таблицы БД**: множественное число (`boards`, `cards`, `action_items`)

#### Структура файлов
```
backend/
├── main.py                 # FastAPI app, CORS, middleware, rate limiter
├── app/
│   ├── config.py          # Pydantic Settings
│   ├── database.py        # SQLAlchemy engine + session
│   ├── models.py          # ORM модели
│   ├── schemas.py         # Pydantic схемы
│   ├── limiter.py         # slowapi rate limiter
│   ├── ws_manager.py      # WebSocket connection manager
│   ├── workspace_auth.py  # Workspace token validation
│   └── routers/           # API роутеры
│       ├── boards.py
│       ├── cards.py
│       ├── columns.py
│       └── ...
└── tests/                 # pytest тесты
    └── conftest.py
```

#### Архитектурные правила
1. **Один воркер uvicorn** — НИКОГДА не добавляй `--workers`. `ConnectionManager` — синглтон.
2. **Async/sync**: Роутеры — `async def` (для `await manager.broadcast()`), SQLAlchemy сессии — синхронные.
3. **WebSocket события**: формат `{ "event": "event_name", "data": { ... } }`
4. **WS валидация**: все события проверяются против `KNOWN_EVENTS` frozenset в `websocket.py`
5. **Миграции**: ВСЕГДА создавай Alembic миграцию при изменении схемы БД
6. **Action item statuses**: хранятся как `String(20)`, не Enum (SQLite совместимость)
7. **Rate limiter**: slowapi — не добавляй дублирующей защиты
8. **CORS**: настроен в `main.py` — не дублируй в роутерах

#### HTTP статусы
- `201` — создание ресурса
- `200` — успешное получение/обновление
- `404` с `detail` — ресурс не найден
- `422` — валидация (автоматически от Pydantic)

#### Зависимости и DI
- Используй `Depends(get_db)` паттерн
- Сессия передаётся через dependency injection

#### Тестирование
- **pytest** + **httpx** + **TestClient**
- **SQLite in-memory** для тестов (`DATABASE_URL=sqlite://`)
- `JSONEncodedList` TypeDecorator для ARRAY колонок (SQLite)
- Фикстуры в `conftest.py` — используй существующие, не дублируй

```python
import pytest
from fastapi.testclient import TestClient

def test_create_board(client, workspace_headers):
    response = client.post("/api/boards/", json={"name": "Test"}, headers=workspace_headers)
    assert response.status_code == 201
```

---

## 3. Язык проекта

- **Комментарии, commit messages, UI тексты** — на **русском языке**
- **Переменные и функции** — на английском (snake_case/camelCase)

---

## 4. Переменные окружения

### Фронтенд (`frontend/.env.local`)
```env
BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_WS_HOST=localhost:8000
```

### Бэкенд (`backend/.env`)
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/retroboard
CORS_ORIGINS=http://localhost:3080
WORKSPACE_JWT_SECRET=your-secret-at-least-32-chars
ADMIN_JWT_SECRET=your-admin-secret-at-least-32-chars
ADMIN_LOGIN=admin
ADMIN_PASSWORD=changeme
```

### Корневой `.env` (Docker Compose)
```env
POSTGRES_DB=retroboard
POSTGRES_USER=retro
POSTGRES_PASSWORD=your_secure_password
CORS_ORIGINS=http://localhost:3080
```

---

## 5. Полезные ресурсы

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **Приложение**: http://localhost:3080
- **Admin панель**: http://localhost:3080/admin

---

## 6. CI/CD

GitHub Actions (`.github/workflows/ci.yml`):
- `backend-tests`: `pytest -v`
- `frontend-lint`: `npm run lint`
- `frontend-tests`: `npm test`
- `frontend-e2e`: `npm run test:e2e`

---

## 7. AI Агенты (OpenCode)

Проект использует систему специализированных AI агентов для разных задач разработки.

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

### Как использовать

```bash
# Вызвать агента через @
@architect Спроектируй API для экспорта доски

# Или в чате opencode:
@backend-dev Реализуй эндпоинт для /api/boards/{id}/export

# Security аудит
@security Аудит изменений в cards.py
```

### Workflows (цепочки агентов)

Используйте workflows для структурированных задач:

#### Feature Development
```
@architect → @backend-dev → @frontend-dev → @security → @qa
```
**Когда:** Новая функциональность, новая сущность, новый API.

#### Bug Fix
```
@explainer → @backend-dev/@frontend-dev → @qa
```
**Когда:** Исправление бага.

#### Code Review
```
@security → @refactorer → @qa
```
**Когда:** Pull Request opened, перед merge.

#### Deployment
```
@devops → @qa (smoke) → @devops (deploy)
```
**Когда:** Деплой в staging/production.

#### Security Audit
```
@security (full audit)
```
**Когда:** Периодический аудит (weekly/monthly).

### Agent Memory

Агенты сохраняют институциональные знания в `.opencode/memory/`:

- `architect/notes.md` — принятые архитектурные решения
- `backend-dev/patterns.md` — паттерны бэкенда
- `frontend-dev/components.md` — паттерны фронтенда
- `security/vulnerabilities.md` — найденные уязвимости
- `qa/test-patterns.md` — тестовые паттерны
- `refactorer/code-smells.md` — code smells
- `devops/infra-notes.md` — особенности инфраструктуры
- `docs/docs-status.md` — статус документации
- `explainer/architecture.md` — архитектурные диаграммы

### CI/CD интеграция

Рекомендуемый подход — **гибридный**:

1. **Workflow файлы** — как документация для команды (mnemonics)
2. **Ручной запуск** агентов — через `@agent` в чате opencode
3. **Автоматические тесты** — GitHub Actions CI запускается автоматически

Пример ручного использования:
```bash
@workflow feature-dev "добавить экспорт в PDF"
```

### Подробная документация

Полное описание каждого агента и workflow находится в:
- `.opencode/agents/*.md` — детальные инструкции агентов
- `.opencode/workflows/*.md` — процедуры workflow
