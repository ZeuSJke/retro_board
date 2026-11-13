#!/bin/sh
set -eu

NODE_PID=""
NGINX_PID=""

cleanup() {
  [ -n "$NGINX_PID" ] && kill -TERM "$NGINX_PID" 2>/dev/null || true
  [ -n "$NODE_PID" ] && kill -TERM "$NODE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}

on_signal() {
  cleanup
  exit 0
}

is_alive() {
  pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  if [ -r "/proc/$pid/stat" ]; then
    IFS= read -r stat_line < "/proc/$pid/stat" 2>/dev/null || return 1
    state=${stat_line##*) }
    case "$state" in
      Z*|X*|x*) return 1 ;;
    esac
  fi
  return 0
}

trap on_signal TERM INT QUIT

# Start Next.js standalone server in background
HOSTNAME=0.0.0.0 node server.js &
NODE_PID=$!

# Start nginx in background so we can fail fast if either process dies
nginx -g 'daemon off;' &
NGINX_PID=$!

while is_alive "$NODE_PID" && is_alive "$NGINX_PID"; do
  sleep 1 &
  wait $! || true
done

if ! is_alive "$NODE_PID"; then
  echo "Next.js server process ($NODE_PID) exited unexpectedly" >&2
fi
if ! is_alive "$NGINX_PID"; then
  echo "Nginx process ($NGINX_PID) exited unexpectedly" >&2
fi

cleanup
exit 1
