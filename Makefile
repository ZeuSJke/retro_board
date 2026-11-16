REGISTRY ?= registry.kirillbessonov.ru/fmrm/retro_board
TAG ?= dev
DEV_CONTEXT ?= k3s-dev
DEV_NS ?= retro-board
CHART := k8s/helm/retro-board

BACKEND_PYTEST = $(shell [ -x backend/.venv/bin/pytest ] && echo .venv/bin/pytest || echo pytest)
BACKEND_RUFF = $(shell [ -x backend/.venv/bin/ruff ] && echo .venv/bin/ruff || echo ruff)
BACKEND_MYPY = $(shell [ -x backend/.venv/bin/mypy ] && echo .venv/bin/mypy || echo mypy)
BACKEND_ALEMBIC = $(shell [ -x backend/.venv/bin/alembic ] && echo .venv/bin/alembic || echo alembic)

.PHONY: help setup install lock audit helm-lint lint lint-backend lint-frontend test-backend test-backend-pg test-frontend verify dev-images dev-secrets dev-deploy dev

help:
	@echo "Targets:"
	@echo "  setup / install - init local worktree (backend/.venv + frontend/node_modules)"
	@echo "  lock            - recompile backend lock files from requirements*.in (needs uv)"
	@echo "  audit           - check backend and frontend dependencies for known vulnerabilities"
	@echo "  helm-lint       - helm lint + kubeconform + render guard gates"
	@echo "  lint-backend    - backend ruff check"
	@echo "  lint-frontend   - frontend next build + tsc + eslint"
	@echo "  lint            - lint-backend + lint-frontend"
	@echo "  test-backend    - backend alembic heads + pytest (SQLite in-memory)"
	@echo "  test-backend-pg - same tests + alembic check on PostgreSQL (needs TEST_DATABASE_URL)"
	@echo "  test-frontend   - frontend vitest"
	@echo "  verify          - full local DoD gate (helm-lint + lint + test-backend + test-frontend)"
	@echo "  dev-images      - build & push api/web images via buildctl tunnel to .26"
	@echo "  dev-secrets     - idempotently ensure namespace, registry-pull & dev secret on $(DEV_CONTEXT)"
	@echo "  dev-deploy      - deploy chart with values-dev.yaml to $(DEV_CONTEXT)/$(DEV_NS)"
	@echo "  dev             - build images and deploy to $(DEV_CONTEXT)/$(DEV_NS)"

setup:
	@echo "── Setting up backend/.venv"
	@cd backend && if command -v uv >/dev/null 2>&1; then \
	  [ -d .venv ] || env -u VIRTUAL_ENV uv venv; \
	  env -u VIRTUAL_ENV uv pip sync --python .venv/bin/python requirements-dev.txt; \
	else \
	  [ -d .venv ] || python3 -m venv .venv; \
	  .venv/bin/pip install --require-hashes -r requirements-dev.txt; \
	fi
	@echo "── Setting up frontend/node_modules"
	@cd frontend && npm ci --prefer-offline
	@echo "── Checking cluster/MR tools (optional for local tests)"
	@for tool in kubectl helm kubeconform buildctl glab; do \
	  if command -v "$$tool" >/dev/null 2>&1; then echo "  ok  $$tool"; else echo "  warn $$tool not in PATH"; fi; \
	done

install: setup

# Lock-файлы собираются из requirements*.in и содержат полный набор пакетов с хешами.
# Версию Python держим равной образу backend/Dockerfile.
lock:
	cd backend && uv pip compile requirements.in --python-version 3.12 --generate-hashes \
	  --custom-compile-command "make lock" -q -o requirements.txt
	cd backend && uv pip compile requirements-dev.in --python-version 3.12 --generate-hashes \
	  --custom-compile-command "make lock" -c requirements.txt -q -o requirements-dev.txt

audit:
	uvx pip-audit --require-hashes --disable-pip -r backend/requirements.txt
	cd frontend && npm audit --omit=dev

helm-lint:
	helm lint $(CHART) -f $(CHART)/values-dev.yaml
	helm lint $(CHART) -f $(CHART)/values-staging.yaml --set image.allowMutableTag=true
	bash scripts/helm-render-checks.sh

lint-backend:
	cd backend && $(BACKEND_RUFF) check . && $(BACKEND_MYPY) app main.py

lint-frontend:
	cd frontend && npm run build && npm run typecheck && npm run lint

lint: lint-backend lint-frontend

test-backend:
	cd backend && $(BACKEND_ALEMBIC) heads --verbose && TESTING=true DATABASE_URL=sqlite:// $(BACKEND_PYTEST) -v

# Тот же набор на настоящем PostgreSQL. База из TEST_DATABASE_URL должна быть пустой:
# тесты создают и удаляют в ней таблицы. Локально без Docker её даёт пакет pgserver.
test-backend-pg:
	@[ -n "$(TEST_DATABASE_URL)" ] || { echo "TEST_DATABASE_URL is not set (postgresql://user:pass@host/empty_db)"; exit 1; }
	cd backend && DATABASE_URL="$(TEST_DATABASE_URL)" TESTING=true $(BACKEND_ALEMBIC) upgrade head
	cd backend && DATABASE_URL="$(TEST_DATABASE_URL)" TESTING=true $(BACKEND_ALEMBIC) check
	cd backend && TESTING=true DATABASE_URL=sqlite:// TEST_DATABASE_URL="$(TEST_DATABASE_URL)" $(BACKEND_PYTEST) -q

test-frontend:
	cd frontend && npm test

verify: helm-lint lint test-backend test-frontend

dev-images:
	bash scripts/build-image.sh --push -t $(REGISTRY)/api:$(TAG) -f backend/Dockerfile backend
	bash scripts/build-image.sh --push -t $(REGISTRY)/web:$(TAG) -f frontend/Dockerfile frontend

dev-secrets:
	@kubectl --context $(DEV_CONTEXT) create namespace $(DEV_NS) --dry-run=client -o yaml | kubectl --context $(DEV_CONTEXT) apply -f -
	@if ! kubectl --context $(DEV_CONTEXT) -n $(DEV_NS) get secret registry-pull >/dev/null 2>&1; then \
	  if kubectl --context $(DEV_CONTEXT) -n stratum get secret registry-pull >/dev/null 2>&1; then \
	    kubectl --context $(DEV_CONTEXT) -n stratum get secret registry-pull -o json \
	      | python3 -c 'import json,sys; s=json.load(sys.stdin); s["metadata"]={"name":"registry-pull","namespace":sys.argv[1]}; json.dump(s,sys.stdout)' $(DEV_NS) \
	      | kubectl --context $(DEV_CONTEXT) apply -f -; \
	  else \
	    echo "ERROR: registry-pull not found in $(DEV_NS) or stratum; create docker-registry secret registry-pull manually"; \
	    exit 1; \
	  fi; \
	fi
	@if ! kubectl --context $(DEV_CONTEXT) -n $(DEV_NS) get secret retro-board-secrets >/dev/null 2>&1; then \
	  kubectl --context $(DEV_CONTEXT) -n $(DEV_NS) create secret generic retro-board-secrets \
	    --from-literal=POSTGRES_PASSWORD="$$(openssl rand -hex 20)" \
	    --from-literal=ADMIN_LOGIN="devadmin" \
	    --from-literal=ADMIN_PASSWORD="$$(openssl rand -hex 16)" \
	    --from-literal=WORKSPACE_JWT_SECRET="$$(openssl rand -hex 32)" \
	    --from-literal=ADMIN_JWT_SECRET="$$(openssl rand -hex 32)"; \
	  echo "Created random dev retro-board-secrets in $(DEV_CONTEXT)/$(DEV_NS)"; \
	fi

dev-deploy: dev-secrets
	helm upgrade --install retro-board $(CHART) \
	  --kube-context $(DEV_CONTEXT) \
	  --namespace $(DEV_NS) \
	  --create-namespace \
	  -f $(CHART)/values-dev.yaml \
	  --set image.tag=$(TAG) \
	  --wait --timeout 5m

dev: dev-images dev-deploy
