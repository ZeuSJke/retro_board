# Deployment Workflow

## Применение

**Когда использовать:** Deploy в staging/production, release новой версии.

**Кто запускает:** DevOps или Tech Lead

---

## Последовательность

### Шаг 1 — @devops: Подготовка

**Цель:** Подготовить deploy

**Делает:**
- Проверяет что все тесты в CI пройдены
- Собирает Docker images
- Проверяет docker-compose конфигурацию
- Обновляет version если нужно

**Команды:**
```bash
docker compose build
docker compose config
```

**Выход:**
- Docker images собраны
- Конфигурация проверена

**Критерии завершения:**
- [ ] Все сервисы собраны без ошибок
- [ ] Конфигурация валидна

---

### Шаг 2 — @qa: Smoke Tests

**Цель:** Быстрая проверка что основные пути работают

**Делает:**
- Запускает critical path тесты
- Проверяет основные эндпоинты

**После завершения:**

```bash
cd backend && python -m pytest -v -k "critical"
cd frontend && npm run test:e2e -- --grep "smoke"
```

**Критерии завершения:**
- [ ] Smoke tests проходят
- [ ] Critical paths работают

---

### Шаг 3 — @devops: Деплой

**Цель:** Задеплоить в target environment

**Делает (staging):**
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose ps
```

**Делает (production):**
```bash
# Backup БД
docker compose exec db pg_dump -U retro retroboard > backup_$(date +%Y%m%d_%H%M%S).sql

# Деплой
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Healthcheck
docker compose ps
curl -f http://localhost:8000/health
```

**После деплоя:**
```bash
# Проверка логов
docker compose logs --tail=50

# Проверка healthchecks
docker compose ps
```

**Критерии завершения:**
- [ ] Все сервисы запущены
- [ ] Healthchecks pass
- [ ] Логи чистые (нет errors)

---

### Шаг 4 — @qa: Post-deploy Verification

**Цель:** Убедиться что всё работает

**Делает:**
- Smoke tests на production
- Проверяет основные фичи

**После завершения:**

```bash
curl -f http://localhost:8000/api/boards
curl -f http://localhost:3080
```

**Критерии завершения:**
- [ ] Приложение доступно
- [ ] API отвечает
- [ ] Нет критических ошибок

---

## Rollback Procedure

Если что-то пошло не так:

```bash
# Откат к предыдущей версии
docker compose down
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --scale backend=1

# Или из backup
docker compose exec -T db psql -U retro -d retroboard < backup_YYYYMMDD_HHMMSS.sql
docker compose restart
```

---

## Критерии завершения workflow

- [ ] Images собраны
- [ ] Smoke tests прошли
- [ ] Деплой успешен
- [ ] Healthchecks pass
- [ ] Post-deploy verification прошла

## Важно

**Production деплой** — только после успешного staging.

**Backup** — всегда делай backup БД перед production deploy.

**Healthchecks** — если healthcheck fails, rollback.
