#!/usr/bin/env bash
# Helm chart render & schema verification gates (without cluster access).
# Verifies both positive manifests (counts + kubeconform) and negative guards
# (each invariant guard fails with its specific message).
set -euo pipefail

CHART="${CHART:-k8s/helm/retro-board}"
failed=0

render() {
  helm template retro-board "$CHART" -n retro-board "$@"
}

validate_manifests() {
  local name="$1"
  shift
  if ! command -v kubeconform >/dev/null 2>&1; then
    echo "FAIL $name: kubeconform not installed"
    failed=1
    return
  fi
  local args=(-strict -summary)
  if [ -n "${KUBECONFORM_SCHEMA_K8S:-}" ] && [ -n "${KUBECONFORM_SCHEMA_CRD:-}" ]; then
    args+=(-schema-location "$KUBECONFORM_SCHEMA_K8S" -schema-location "$KUBECONFORM_SCHEMA_CRD")
  else
    args+=(-ignore-missing-schemas)
  fi
  if render "$@" | kubeconform "${args[@]}"; then
    echo "ok   kubeconform ($name)"
  else
    echo "FAIL kubeconform ($name)"
    failed=1
  fi
}

expect_count() {
  local name="$1" pattern="$2" want="$3"
  shift 3
  local out got
  out="$(render "$@")"
  got="$(grep -cE -- "$pattern" <<<"$out" || true)"
  if [ "$got" = "$want" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: pattern '$pattern' matched $got times, expected $want"
    failed=1
  fi
}

expect_fail() {
  local name="$1" message="$2"
  shift 2
  local out
  if out="$(render "$@" 2>&1)"; then
    echo "FAIL $name: render succeeded unexpectedly"
    failed=1
  elif grep -qF -- "$message" <<<"$out"; then
    echo "ok   guard: $name"
  else
    echo "FAIL $name: failed with unexpected message:"
    echo "$out" | tail -n 5
    failed=1
  fi
}

echo "── Positive renders: values-dev.yaml"
DEV=(-f "$CHART/values-dev.yaml")
expect_count "dev: postgres/api/web single replica each" '^  replicas: 1$' 3 "${DEV[@]}"
expect_count "dev: api Recreate strategy" '^    type: Recreate$' 1 "${DEV[@]}"
expect_count "dev: skip migrations in main container" '^              value: "true"$' 1 "${DEV[@]}"
expect_count "dev: Traefik ServersTransport + Middleware" '^kind: (ServersTransport|Middleware)$' 2 "${DEV[@]}"
expect_count "dev: no CronJob when backup disabled" '^kind: CronJob$' 0 "${DEV[@]}"
expect_count "dev: no NetworkPolicy when disabled" '^kind: NetworkPolicy$' 0 "${DEV[@]}"
expect_count "dev: no Secret created with existingSecret" '^kind: Secret$' 0 "${DEV[@]}"
validate_manifests "dev" "${DEV[@]}"

echo "── Positive renders: values-staging.yaml (pinned tag)"
STAGING=(-f "$CHART/values-staging.yaml" --set image.tag=staging-1234abcd)
expect_count "staging: StatefulSet postgres" '^kind: StatefulSet$' 1 "${STAGING[@]}"
expect_count "staging: backup CronJob rendered" '^kind: CronJob$' 1 "${STAGING[@]}"
expect_count "staging: 4 NetworkPolicies (postgres, api, web, backup)" '^kind: NetworkPolicy$' 4 "${STAGING[@]}"
expect_count "staging: NFS mount on backup CronJob" 'server: "192.168.1.10"' 1 "${STAGING[@]}"
expect_count "staging: Ingress paths (/api, /ws, /)" '^          - path: /(api|ws)?$' 3 "${STAGING[@]}"
expect_count "staging: readOnlyRootFilesystem true on api/web/backup" 'readOnlyRootFilesystem: true' 5 "${STAGING[@]}"
validate_manifests "staging" "${STAGING[@]}"

echo "── Positive renders: inline strong secrets"
INLINE=(-f "$CHART/values-dev.yaml"
  --set image.tag=staging-1234abcd
  --set secrets.existingSecret=
  --set secrets.postgresPassword=strong-db-pass-123456
  --set secrets.adminLogin=retroadmin
  --set secrets.adminPassword=strong-admin-pass-123456
  --set secrets.workspaceJwtSecret=0123456789abcdef0123456789abcdef01234567
  --set secrets.adminJwtSecret=fedcba9876543210fedcba9876543210fedcba98)
expect_count "inline: Secret rendered once" '^kind: Secret$' 1 "${INLINE[@]}"
validate_manifests "inline-secrets" "${INLINE[@]}"

echo "── Negative renders: chart invariant guards"
expect_fail "api replicas > 1 rejected" "api.replicas must be 1" \
  "${STAGING[@]}" --set api.replicas=2
expect_fail "empty CORS rejected" "config.corsOrigins must be explicitly set" \
  "${STAGING[@]}" --set config.corsOrigins=
expect_fail "wildcard CORS rejected" "must not be '*'" \
  "${STAGING[@]}" --set "config.corsOrigins=*"
expect_fail "null CORS rejected (YAML null)" "config.corsOrigins must be explicitly set" \
  "${STAGING[@]}" --set "config.corsOrigins=null"
expect_fail "null CORS rejected (string null)" "config.corsOrigins must be explicitly set" \
  "${STAGING[@]}" --set-string "config.corsOrigins=null"
expect_fail "mutable latest tag without Always rejected" "image.tag cannot be mutable" \
  -f "$CHART/values-staging.yaml"
expect_fail "empty inline secret rejected" "secrets.postgresPassword must be set" \
  "${DEV[@]}" --set secrets.existingSecret=
expect_fail "placeholder secret rejected" "contains a placeholder value" \
  "${INLINE[@]}" --set secrets.adminPassword=changeme
expect_fail "short JWT secret rejected" "must be at least 32 characters" \
  "${INLINE[@]}" --set secrets.workspaceJwtSecret=short-secret
expect_fail "backup without NFS server rejected" "backup.nfs.server and backup.nfs.path must be non-empty" \
  "${DEV[@]}" --set backup.enabled=true
expect_fail "TESTING via extraEnv rejected" "config.extraEnv must not set TESTING" \
  "${STAGING[@]}" --set-string config.extraEnv.TESTING=true

if [ "$failed" -ne 0 ]; then
  exit 1
fi
echo "ALL HELM RENDER CHECKS PASSED"
