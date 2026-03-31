# Agent Memory Template

## Описание

Это шаблон для памяти агентов. Каждый агент должен вести записи в своей папке.

## Структура папок

```
.opencode/
├── memory/
│   ├── architect/
│   │   └── notes.md
│   ├── backend-dev/
│   │   └── patterns.md
│   ├── frontend-dev/
│   │   └── components.md
│   ├── security/
│   │   └── vulnerabilities.md
│   ├── qa/
│   │   └── test-patterns.md
│   ├── refactorer/
│   │   └── code-smells.md
│   ├── devops/
│   │   └── infra-notes.md
│   ├── docs/
│   │   └── docs-status.md
│   └── explainer/
│       └── architecture.md
```

## Что записывать

### architect
- Принятые архитектурные решения и почему
- Известные проблемы с масштабируемостью
- Планы на будущее
- ADR (Architecture Decision Records)

### backend-dev
- Паттерны которые обнаружил
- Частые ошибки и их решения
- Особенности работы с SQLAlchemy

### frontend-dev
- Component patterns
- State management подходы
- Known issues с Next.js/React
- CSS подходы

### security
- Найденные уязвимости (и когда исправлены)
- Паттерны атак на этот проект
- Меры которые были приняты

### qa
- Тестовые паттерны
- Mock стратегии
- Edge cases которые нашли
- Проблемы с coverage

### refactorer
- Code smells которые нашли
- Что рефакторили и почему
- Результаты (улучшение метрик)

### devops
- Infrastructure особенности
- Known issues
- Troubleshooting guides
- Backup процедуры

### docs
- Что задокументировано
- Что нужно документировать
- Known issues с документацией

### explainer
- Архитектурные диаграммы
- Dependency graphs
- Problem -> Solution mappings

## Формат записей

### Запись о решении

```
## 2026-03-31: Решение

**Проблема/Вопрос:** ...

**Решение:** ...

**Причины:**
- ...

**Последствия:**
- ...

**Участники:** ...
```

### Запись о проблеме

```
## 2026-03-31: Проблема

**Описание:** ...

**Root cause:** ...

**Решение:** ...

**Статус:** Fixed/Open

**Дата:** ...
```

---

## ВАЖНО: Делегирование агентам

**Никогда не делай сам то что могут сделать агенты.**

### Правило:
1. Получил задачу → Определил кто делает (@architect, @backend-dev, etc.)
2. Вызвал агента с задачей
3. Агент сделал работу
4. Проверил результат

### Когда использовать агентов:
| Задача | Агент |
|--------|-------|
| Новая сущность/API | @architect → @backend-dev |
| Новый UI | @frontend-dev |
| Тесты | @qa |
| Рефакторинг | @refactorer |
| Аудит | @security |
| Документация | @docs |
| Анализ | @explainer |

### Исключения (можно делать самому):
- Мелкие правки (1-2 строки)
- Исследование кода
- Срочные hotfixes (но потом записать в memory)
```
