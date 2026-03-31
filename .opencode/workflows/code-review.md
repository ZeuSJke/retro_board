# Code Review Workflow

## Применение

**Когда использовать:** Pull Request opened, Draft PR, перед merge в main.

**Кто запускает:** Автор PR или Tech Lead

---

## Последовательность

### Шаг 1 — @security: Security Audit

**Цель:** Найти уязвимости

**Делает:**
- Анализирует diff изменений
- Проверяет на OWASP Top 10
- Проверяет валидацию входных данных
- Проверяет аутентификацию и авторизацию
- Проверяет зависимости на уязвимости

**Команды для проверки:**
```bash
cd backend && pip audit
cd frontend && npm audit
```

**Выход:**
- Список уязвимостей (если найдены)
- severity для каждой (critical/high/medium/low)
- Рекомендации по исправлению

**Критерии завершения:**
- [ ] Уязвимостей нет ИЛИ
- [ ] Все critical/high исправлены

---

### Шаг 2 — @refactorer: Code Quality Review

**Цель:** Проверить качество кода

**Делает:**
- Анализирует diff
- Проверяет SOLID principles
- Проверяет DRY
- Ищет code smells
- Проверяет complexity
- Предлагает улучшения

**Выход:**
- Список проблем качества
- Предложения по улучшению

**Критерии завершения:**
- [ ] Нет critical code smells ИЛИ
- [ ] Все предложения документированы

---

### Шаг 3 — @qa: Tests Review

**Цель:** Проверить тестовое покрытие

**Делает:**
- Проверяет что новый код покрыт тестами
- Запускает существующие тесты
- Проверяет что тесты проходят

**После завершения:**

```bash
cd backend && python -m pytest -v
cd frontend && npm test
```

**Критерии завершения:**
- [ ] Все тесты проходят
- [ ] Coverage не упал

---

## Итоговое решение

### approve (все ок)
- security: нет critical/high
- refactorer: нет critical code smells
- qa: все тесты проходят

### request_changes (есть проблемы)
- security: есть неисправленные critical/high
- refactorer: есть неисправленные critical code smells
- qa: тесты падают

### comment (рекомендации)
- Есть suggestions но не blocking issues

---

## Критерии завершения workflow

- [ ] Security audit пройден
- [ ] Code quality review пройден
- [ ] Tests review пройден
- [ ] Есть итоговое решение (approve/request_changes/comment)

## Важно

Если найдены critical/high issues — они должны быть исправлены ДО merge.

Minor issues и suggestions могут быть записаны как follow-up tickets.
