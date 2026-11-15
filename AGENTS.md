# AGENTS.md

Руководство для ИИ-агентов и разработчиков в репозитории **RetroBoard** (`fmrm/retro_board`).

- **Продукт**: веб-приложение для командных Agile-ретроспектив в реальном времени (`Next.js 16` + `FastAPI` + `PostgreSQL 16` + `WebSocket` + `Kubernetes/Helm`).
- **Язык**: общение, тексты UI, сообщения об ошибках, большинство промптов и commit/MR-сообщения — на русском языке.

## Карта репозитория и вложенные инструкции

Перед чтением или правкой кода в `backend/` или `frontend/` **сначала прочитай соответствующий вложенный `AGENTS.md`**:
- `backend/` → [backend/AGENTS.md](backend/AGENTS.md) (FastAPI, SQLAlchemy, Alembic, SQLite-тесты, ruff, WS, AI)
- `frontend/` → [frontend/AGENTS.md](frontend/AGENTS.md) (Next.js App Router, shadcn/Radix, Zustand, WS, Vitest, Playwright)
- `k8s/helm/retro-board/` — Helm-чарт для `k3s-dev` и `k3s-stage` (`values-dev.yaml`, `values-staging.yaml`)
- `ci/` — конфиг `ci/e2e-nginx.conf` для E2E-джобы в GitLab CI
- `scripts/` — `build-image.sh` (BuildKit over SSH / CI), `helm-render-checks.sh` (kubeconform + render-гейты)

## Процесс доработки и Definition of Done (DoD)

1. **Скоуп до кода**: для любой нетривиальной задачи сначала проговорить/зафиксировать границы («что делаем» и «что не трогаем»), затрагиваемые слои и изменения контрактов/БД. Не бросаться править код без согласованного скоупа.
2. **Ветка от `main`**: работа ведётся в отдельной ветке (`feat/...`, `fix/...`, `chore/...`, `docs/...`) — прямые пуши в `main` запрещены.
3. **Локальный gate**:
   - профильные проверки по ходу работы и полный прогон перед ревью: `make verify` (`helm-lint` + `lint` + `test-backend` + `test-frontend`).
4. **Выверка на `k3s-dev`** (`https://retro-dev.kirillbessonov.ru`):
   - обязательна для изменений UI/UX, вёрстки, WebSocket/CSRF/cookie, `Dockerfile`, Helm-чарта или миграций БД (`make dev`);
   - проверять живой стенд (desktop + mobile, светлая/тёмная тема, консоль браузера и WS/сетевые запросы).
5. **Обязательное ревью ветки с нулевым контекстом**:
   - запускается **после зелёных локальных гейтов** отдельным агентом (свежая сессия / субагент без контекста разработки) по всему диффу `git diff origin/main...HEAD`;
   - **максимум 2 прогона ревью**, пока все замечания уровня `critical` и `blocker` не будут исправлены и перепроверены;
   - некритичные / отложенные замечания фиксируются в описании или комментарии MR и оформляются как action items / follow-up задачи.
6. **Merge Request и CI gate**:
   - основной репозиторий — GitLab (`gitlab.kirillbessonov.ru/fmrm/retro_board`), GitHub — только зеркало. Работа ведётся через **MR** и CLI `glab` (не `gh`);
   - в описании MR указать суть изменений, результаты локальных проверок/выверки на dev, итог ревью и оставшиеся action items (если есть);
   - дождаться 100% зелёного пайплайна MR (`backend-tests`, `backend-tests-pg`, `frontend-lint`, `frontend-tests`, `e2e-tests`, `helm`, а при правках сборки — `image-smoke`).
7. **Post-merge контроль**: после мерджа в `main` дождаться завершения `build-app-staging` и `deploy-staging`, затем убедиться, что `https://retro.kirillbessonov.ru/api/health` отвечает `200`.

## Сквозные архитектурные инварианты

- **Single-worker backend**: `ConnectionManager` хранит комнаты, фасилитаторов, фазы, таймеры и состояния сессии в памяти процесса. `api.replicas` обязан оставаться `1` со стратегией `Recreate`, `WEB_CONCURRENCY=1` — нельзя масштабировать `uvicorn` на несколько воркеров без выноса состояния в Redis.
- **Прокси, Host, Auth и CSRF**: в образе `web` нет nginx (`node server.js` на `:3000`). В k8s `/api`, `/mcp` и `/ws` на `api:8000` и `/` на `web:3000` маршрутизирует Traefik Ingress (`ServersTransport` + `Middleware` `security-headers`), в CI E2E — `ci/e2e-nginx.conf`, локально в `next dev` — rewrites `/api/:path*` и `/mcp` в `frontend/next.config.mjs`. Прокси обязан сохранять исходный `Host`, иначе редиректы FastAPI уведут на `:8000` мимо `csrf_token` cookie. `/mcp` работает без cookie/CSRF (stateless Bearer auth `AgentToken`), проверка Host/Origin выполняется Transport Security настройками MCP.
- **Helm render-гейты**: `scripts/helm-render-checks.sh` блокирует `api.replicas != 1`, пустой/`*`/`null` `CORS_ORIGINS`, изменяемый тег образа без `pullPolicy=Always`, плейсхолдеры секретов и включённый `backup` без NFS-сервера/пути, `TESTING` в `config.extraEnv`, а также расхождение CSP между `frontend/next.config.mjs` и Traefik-middleware чарта.
- **CSP**: политика задаётся одной строкой в двух местах — константа `CSP` в `frontend/next.config.mjs` (локально и в E2E) и `contentSecurityPolicy` в `k8s/helm/retro-board/templates/traefik.yaml` (стенды). Менять обе сразу; `connect-src` разрешает только свой хост (`'self'` покрывает WebSocket того же origin).

## Основные команды

```bash
# Инициализация свежего worktree (Orca / чистый клон): backend/.venv + frontend/node_modules
make setup                # алиас: make install

# Проверки и полный локальный DoD gate
make verify               # helm-lint + lint (ruff + next build/tsc/lint) + test-backend + test-frontend
make helm-lint            # helm lint (dev + staging) + kubeconform + scripts/helm-render-checks.sh

# Сборка и деплой на k3s-dev (https://retro-dev.kirillbessonov.ru)
make dev                  # dev-images (buildctl SSH tunnel -> .26) + dev-deploy (k3s-dev)

# GitLab MR и CI
glab ci lint
glab mr create --title "Краткое описание" --description "Что и зачем" --yes
glab ci status --wait
glab ci trace <job>
```
