REGISTRY ?= registry.kirillbessonov.ru/fmrm/retro_board
TAG ?= dev
DEV_CONTEXT ?= k3s-dev
DEV_NS ?= retro-board
CHART := k8s/helm/retro-board

BACKEND_PYTEST := $(shell [ -x backend/.venv/bin/pytest ] && echo .venv/bin/pytest || echo pytest)
BACKEND_RUFF := $(shell [ -x backend/.venv/bin/ruff ] && echo .venv/bin/ruff || echo ruff)
BACKEND_ALEMBIC := $(shell [ -x backend/.venv/bin/alembic ] && echo .venv/bin/alembic || echo alembic)

.PHONY: help setup install helm-lint lint lint-backend lint-frontend test-backend test-frontend verify dev-images dev-secrets dev-deploy dev

help:
	@echo "Targets:"
	@echo "  setup / install - init local worktree (backend/.venv + frontend/node_modules)"
	@echo "  helm-lint       - helm lint + kubeconform + render guard gates"
	@echo "  lint-backend    - backend ruff check"
	@echo "  lint-frontend   - frontend next build + next lint"
	@echo "  lint            - lint-backend + lint-frontend"
	@echo "  test-backend    - backend alembic heads + pytest (SQLite in-memory)"
	@echo "  test-frontend   - frontend vitest"
	@echo "  verify          - full local DoD gate (helm-lint + lint + test-backend + test-frontend)"
	@echo "  dev-images      - build & push api/web images via buildctl tunnel to .26"
	@echo "  dev-secrets     - idempotently ensure namespace, registry-pull & dev secret on $(DEV_CONTEXT)"
	@echo "  dev-deploy      - deploy chart with values-dev.yaml to $(DEV_CONTEXT)/$(DEV_NS)"
	@echo "  dev             - build images and deploy to $(DEV_CONTEXT)/$(DEV_NS)"

setup:
	@echo "── Setting up backend/.venv"
	@cd backend && if command -v uv >/dev/null 2>&1; then \
	  [ -d .venv ] || uv venv; \
	  uv pip install -r requirements-dev.txt; \
	else \
	  [ -d .venv ] || python3 -m venv .venv; \
	  .venv/bin/pip install -r requirements-dev.txt; \
	fi
	@echo "── Setting up frontend/node_modules"
	@cd frontend && npm ci --prefer-offline
	@echo "── Checking cluster/MR tools (optional for local tests)"
	@for tool in kubectl helm kubeconform buildctl glab; do \
	  if command -v "$$tool" >/dev/null 2>&1; then echo "  ok  $$tool"; else echo "  warn $$tool not in PATH"; fi; \
	done

install: setup

helm-lint:
	helm lint $(CHART) -f $(CHART)/values-dev.yaml
	helm lint $(CHART) -f $(CHART)/values-staging.yaml --set image.allowMutableTag=true
	bash scripts/helm-render-checks.sh

lint-backend:
	cd backend && $(BACKEND_RUFF) check .

lint-frontend:
	cd frontend && npm run build && npm run lint

lint: lint-backend lint-frontend

test-backend:
	cd backend && $(BACKEND_ALEMBIC) heads --verbose && TESTING=true DATABASE_URL=sqlite:// $(BACKEND_PYTEST) -v

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
