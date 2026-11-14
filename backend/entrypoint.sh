#!/bin/sh
set -e

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "Running migrations..."
  alembic upgrade head
fi

echo "Starting uvicorn..."
exec uvicorn main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --ws websockets-sansio \
  --ws-max-size "${WS_MAX_SIZE:-65536}" \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}"
