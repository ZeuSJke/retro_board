REGISTRY ?= registry.kirillbessonov.ru/fmrm/retro_board
TAG ?= dev
DEV_CONTEXT ?= k3s-dev
DEV_NS ?= retro-board
CHART := k8s/helm/retro-board

.PHONY: help helm-lint lint test-backend test-frontend dev-images dev-secrets dev-deploy

help:
	@echo "Targets:"
	@echo "  helm-lint     - helm lint + kubeconform + render guard gates"
	@echo "  lint          - frontend lint + next build"
	@echo "  test-backend  - backend pytest (SQLite in-memory)"
	@echo "  test-frontend - frontend vitest"
	@echo "  dev-images    - build & push api/web images via buildctl tunnel to .26"
	@echo "  dev-secrets   - idempotently ensure namespace, registry-pull & dev secret on $(DEV_CONTEXT)"
	@echo "  dev-deploy    - deploy chart with values-dev.yaml to $(DEV_CONTEXT)/$(DEV_NS)"

helm-lint:
	helm lint $(CHART) -f $(CHART)/values-dev.yaml
	helm lint $(CHART) -f $(CHART)/values-staging.yaml --set image.allowMutableTag=true
	bash scripts/helm-render-checks.sh

lint:
	cd frontend && npm run build && npm run lint

test-backend:
	cd backend && TESTING=true DATABASE_URL=sqlite:// pytest -v

test-frontend:
	cd frontend && npm test

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
