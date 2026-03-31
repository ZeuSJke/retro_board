# Security Audit Workflow

## Применение

**Когда использовать:** Периодический аудит безопасности (weekly/monthly), после major changes, по требованию.

**Кто запускает:** Security Lead или Tech Lead

---

## Последовательность

### Шаг 1 — @security: Dependency Audit

**Цель:** Проверить зависимости на уязвимости

**Делает:**

**Backend (Python):**
```bash
cd backend
pip audit
safety check
pip list --outdated
```

**Frontend (Node.js):**
```bash
cd frontend
npm audit
npm outdated
```

**Выход:**
- Список уязвимых пакетов
- severity для каждой
- Версии для обновления

**Критерии завершения:**
- [ ] Все dependencies проверены
- [ ] Список уязвимостей составлен

---

### Шаг 2 — @security: Code Patterns Audit

**Цель:** Найти уязвимые паттерны в коде

**Делает:**

**SQL Injection:**
```bash
rg "execute|raw|text\(" --type py
rg "\.format|%s|concat\(" --type py
```

**XSS (если есть template rendering):**
```bash
rg "innerHTML|dangerouslySetInnerHTML" --type ts
rg "eval\(" --type ts
```

**Secrets in code:**
```bash
rg "password\s*=|token\s*=|secret\s*=" --type py
rg "api_key|apikey|private_key" --type py
rg "process\.env" --type ts
```

**Auth issues:**
```bash
rg "require_auth|skip_auth|@pytest.mark.skip" --type py
rg "if.*true.*return" --type py
```

**Выход:**
- Список найденных проблем
- Файл и строка
- Рекомендации

**Критерии завершения:**
- [ ] Все паттерны проверены
- [ ] Проблемы задокументированы

---

### Шаг 3 — @security: Architecture Review

**Цель:** Проверить архитектурные аспекты безопасности

**Делает:**
- Проверяет JWT implementation
- Проверяет CORS настройки
- Проверяет rate limiting
- Проверяет CSRF protection
- Проверяет error handling (не раскрывает internals)

**Ключевые файлы для проверки:**
- `backend/main.py` — middleware
- `backend/app/workspace_auth.py` — JWT
- `backend/app/config.py` — secrets
- `backend/app/limiter.py` — rate limiting

**Выход:**
- Architecture security assessment
- Recommendations

**Критерии завершения:**
- [ ] Архитектура проверена
- [ ] Recommendations составлены

---

### Шаг 4 — @devops: Infrastructure Audit

**Цель:** Проверить инфраструктурную безопасность

**Делает:**
- Проверяет Docker security
- Проверяет environment variables
- Проверяет network configuration
- Проверяет backup strategy

**Выход:**
- Infrastructure security issues
- Recommendations

**Критерии завершения:**
- [ ] Infrastructure проверен
- [ ] Issues задокументированы

---

## Отчёт

### Формат отчёта

```markdown
# Security Audit Report

**Дата:** YYYY-MM-DD
**Аудитор:** @security agent

## Executive Summary
Краткое описание (2-3 предложения)

## Vulnerabilities Found

### Critical
| ID | Description | File | Severity | Status |
|----|-------------|------|----------|--------|
| C-001 | Description | file.py:123 | Critical | Fixed/Open |

### High
...

### Medium
...

### Low
...

## Recommendations

1. ...
2. ...

## Action Items
- [ ] Fix C-001 (owner: @dev, due: YYYY-MM-DD)
- [ ] Fix H-001 (owner: @dev, due: YYYY-MM-DD)

## Sign-off
- [ ] Security Lead
- [ ] Tech Lead
```

---

## Критерии завершения workflow

- [ ] Dependencies проверены
- [ ] Code patterns проверены
- [ ] Architecture проверена
- [ ] Infrastructure проверен
- [ ] Отчёт составлен
- [ ] Action items назначены

## Важно

**Critical/High уязвимости** — исправить как можно скорее.

**Medium/Low** — в follow-up sprint.

**Отчёт** — сохранить в `.opencode/memory/security/` для traceability.
