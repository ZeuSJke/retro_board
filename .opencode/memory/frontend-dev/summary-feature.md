# Feature: Резюме ретроспективы (Summary)

## Описание
Реализована фича "Генерация резюме ретро" - UI для отображения summary ретроспективы.

## Изменённые файлы

### Типы
- `types/index.ts`:
  - Добавлен `has_summary: boolean` в `Board`
  - Добавлен `has_summary: boolean` в `BoardListItem`
  - Добавлен интерфейс `BoardSummary`

### API
- `api/index.ts`:
  - Добавлена функция `getBoardSummary(boardId: string): Promise<BoardSummary | null>`

### Компоненты
- **Новый файл** `components/SummaryModal.tsx` - модальное окно с результатом summary
- **Новый файл** `components/SummaryModal.module.css` - стили для модалки
- `components/Topbar.tsx`:
  - Добавлены пропсы `hasSummary` и `onSummaryClick`
  - Добавлена кнопка Summary между "История ретро" и "Экспорт в PDF"
- `components/Dashboard.tsx`:
  - Добавлена кнопка Summary в карточку каждой доски
  - Интегрирован SummaryModal
- `components/App.tsx`:
  - Добавлено состояние `summaryOpen`
  - Добавлен обработчик `handleSummaryGenerated`
  - Интегрирован SummaryModal
- `components/BoardPage.tsx`:
  - Добавлен пропс `onSummaryGenerated`
  - Передача в `useBoardWebSocket`

### Хуки
- `hooks/useFacilitator.ts`:
  - Добавлена фаза `'summary'` в `PHASE_ORDER`
- `hooks/useBoardWebSocket.ts`:
  - Добавлен пропс `onSummaryGenerated`
  - Добавлена обработка события `summary_generated`

### Прогресс фаз
- `components/PhaseProgress.tsx`:
  - Добавлена фаза `summary` с иконкой и названием "Итоги"

### Утилиты
- `utils/boardMapper.ts`:
  - Добавлено поле `has_summary` в `boardToBoardListItem`

## UX Требования (выполнены)

1. ✅ **Кнопка Summary всегда видна** в Topbar (между "История ретро" и "Экспорт в PDF")
2. ✅ **Состояния кнопки:**
   - 🟢 Зелёный (filled иконка) — summary есть в БД
   - ⚪ Серый (outlined иконка) — summary нет
3. ✅ **При клике** — открывается модальное окно с результатом
4. ✅ **В Dashboard** — в карточке каждой доски есть кнопка Summary
5. ✅ **WS событие** `summary_generated` — обновляет состояние UI

## Стили

Используются существующие CSS модули и дизайн-система Material Design 3:
- CSS Variables из `globals.css`
- Цвета: `--md-primary`, `--md-tertiary`, `--md-surface-*`
- Анимации: `transition`, `@keyframes`
- Material Symbols иконки

## Тестирование

```bash
cd frontend && npm run build  # ✅ Success
cd frontend && npm run lint   # ✅ No new errors
```
