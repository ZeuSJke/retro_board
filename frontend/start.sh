#!/bin/sh
# Start Next.js standalone server in background
HOSTNAME=0.0.0.0 node server.js &
# Start nginx in foreground
nginx -g 'daemon off;'
