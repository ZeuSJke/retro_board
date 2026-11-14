#!/usr/bin/env bash
# Build container images without a local Docker daemon using buildctl over an SSH
# tunnel to rootless buildkitd (or directly via $BUILDKIT_HOST in GitLab CI).
#
# Usage:
#   scripts/build-image.sh [--push] [--no-cache] -t REF [-t REF...] \
#       -f DOCKERFILE [--build-arg K=V ...] [--target STAGE] CONTEXT
#
# Env vars:
#   BUILDKIT_HOST         Already-available buildkitd address (skips SSH tunnel)
#   BUILD_NODE            Build host (default: zeusjke@192.168.1.26)
#   BUILDKIT_SOCK         Remote socket path (default: /run/user/993/buildkit/buildkitd.sock)
#   BUILD_IMPORT_CACHE    Set to 0 to skip registry cache import (default: 1)
#   BUILD_EXPORT_CACHE    Set to 1 in main CI builds to publish registry cache (default: 0)
set -euo pipefail

BUILD_NODE="${BUILD_NODE:-zeusjke@192.168.1.26}"
BUILDKIT_SOCK="${BUILDKIT_SOCK:-/run/user/993/buildkit/buildkitd.sock}"

refs=()
build_args=()
dockerfile=""
context=""
push=0
no_cache=0

while [ $# -gt 0 ]; do
  case "$1" in
    --push)       push=1; shift ;;
    --no-cache)   no_cache=1; shift ;;
    -t|--tag)     refs+=("$2"); shift 2 ;;
    -f|--file)    dockerfile="$2"; shift 2 ;;
    --build-arg)  build_args+=(--opt "build-arg:$2"); shift 2 ;;
    --target)     build_args+=(--opt "target=$2"); shift 2 ;;
    -*)           echo "build-image.sh: unsupported flag: $1" >&2; exit 2 ;;
    *)            context="$1"; shift ;;
  esac
done

[ -n "$context" ]     || { echo "build-image.sh: missing build context" >&2; exit 2; }
[ -n "$dockerfile" ]  || { echo "build-image.sh: missing -f <Dockerfile>" >&2; exit 2; }
[ ${#refs[@]} -gt 0 ] || { echo "build-image.sh: missing -t <ref>" >&2; exit 2; }

command -v buildctl >/dev/null || {
  echo "build-image.sh: buildctl not found in PATH" >&2
  exit 1
}

tunnel_dir=""
ssh_pid=""
cleanup() {
  if [ -n "$ssh_pid" ]; then
    kill "$ssh_pid" 2>/dev/null || true
  fi
  if [ -n "$tunnel_dir" ]; then
    rm -rf "$tunnel_dir"
  fi
  return 0
}

if [ -z "${BUILDKIT_HOST:-}" ]; then
  tunnel_dir=$(mktemp -d)
  sock="$tunnel_dir/buildkitd.sock"
  ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -nNT \
      -L "$sock:$BUILDKIT_SOCK" "$BUILD_NODE" &
  ssh_pid=$!
  trap cleanup EXIT
  for _ in $(seq 1 15); do
    [ -S "$sock" ] && break
    kill -0 "$ssh_pid" 2>/dev/null || break
    sleep 1
  done
  [ -S "$sock" ] || {
    echo "build-image.sh: failed to open SSH tunnel to $BUILD_NODE ($BUILDKIT_SOCK)" >&2
    exit 1
  }
  export BUILDKIT_HOST="unix://$sock"
fi

cache_opts=()
ref_no_tag="${refs[0]%:*}"
cache_ref="${ref_no_tag%/*}/cache/${ref_no_tag##*/}:cache"
if [ "${BUILD_IMPORT_CACHE:-1}" = "1" ]; then
  cache_opts+=(--import-cache "type=registry,ref=$cache_ref")
fi
if [ "${BUILD_EXPORT_CACHE:-0}" = "1" ]; then
  cache_opts+=(--export-cache "type=registry,ref=$cache_ref,mode=max")
fi

out_opts=()
if [ "$push" = 1 ]; then
  joined=$(IFS=,; echo "${refs[*]}")
  out_opts=(--output "type=image,\"name=$joined\",push=true")
else
  echo "build-image.sh: --push not set; build-only smoke check" >&2
fi

no_cache_opt=()
if [ "$no_cache" = 1 ]; then
  no_cache_opt=(--no-cache)
fi

set -x
buildctl build --frontend dockerfile.v0 \
  --local "context=$context" \
  --local "dockerfile=$(dirname "$dockerfile")" \
  --opt "filename=$(basename "$dockerfile")" \
  "${no_cache_opt[@]}" \
  "${build_args[@]}" "${cache_opts[@]}" "${out_opts[@]}" || status=$?
set +x
exit "${status:-0}"
