# Architect Memory

## Архитектурные решения

### 2026-03-31: Почему ActionItem.status — String, не Enum?

**Проблема:** Нужен enum для статусов action items (open, in_progress, done)

**Решение:** Хранить как `String(20)` с валидацией в Pydantic

**Причины:**
- Тесты используют SQLite in-memory, который не поддерживает PostgreSQL ENUM
- Pydantic валидация даёт ту же type safety на уровне приложения
- backward compatibility проще

**Статус:** Принято

---

### 2026-03-31: Почему ConnectionManager — синглтон?

**Проблема:** Нужен central manager для WebSocket rooms

**Решение:** ConnectionManager как синглтон в `ws_manager.py`

**Причины:**
- uvicorn запущен с одним воркером
- Все connections хранятся в памяти процесса
- Простой паттерн для single-worker deployment

**Ограничения:**
- При переходе на multiple workers нужен Redis pub/sub
- Connections не shared между воркерами

**Статус:** Принято (временно)

---

### 2026-03-31: Почему ARRAY колонки требуют JSONEncodedList?

**Проблема:** PostgreSQL ARRAY columns не работают с SQLite

**Решение:** `JSONEncodedList` TypeDecorator в `tests/conftest.py`

**Причины:**
- Backend тесты используют SQLite in-memory для скорости
- В production PostgreSQL использует нативные ARRAY
- TypeDecorator автоматически конвертирует

**Статус:** Принято

---

## Известные проблемы масштабируемости

### N+1 queries в GET /api/boards/{id}

**Описание:** При загрузке доски с колонками и карточками происходит N+1 запросов

**Решение:** Использовать `joinedload` или `selectinload`

**Status:** Known, not fixed yet

---

## Планы на будущее

- [ ] Добавить Redis для WebSocket connections (для multi-worker)
- [ ] Спроектировать кэширование для `/api/boards/`
- [ ] Продумать версионирование API
- [ ] Добавить индексы для часто фильтруемых полей

---

## AI Модуль (2026-03-31)

### Структура

```
backend/app/ai/
├── __init__.py
├── ai_client.py           # Единый OpenRouter клиент
└── prompts/
    ├── __init__.py
    └── title_generation.py  # Промт для генерации title
```

### Решение

Создан централизованный AI модуль для всех AI-фич проекта.

**Провайдер:** OpenRouter (единый API для many моделей)

**Модель:** `qwen-qwen2.5-72b-instruct` (оптимально по цене/качество)

### Как добавлять новые AI фичи

1. Создать `prompts/new_feature.py` с промтом и конфигом
2. Добавить endpoint в соответствующий роутер
3. Использовать `ai_client.generate(prompt, config)`
