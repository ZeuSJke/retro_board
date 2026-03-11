#!/bin/sh
# =============================================================================
# deploy.sh — вспомогательный скрипт для TrueNAS + Nginx Proxy Manager
#
# ⚠️  ВАЖНО: этот скрипт написан под конкретное окружение:
#     - TrueNAS SCALE (или любой Linux-сервер)
#     - Nginx Proxy Manager уже запущен и занимает порты 80/443
#     - Frontend выставлен на порт 3080 (см. docker-compose.yml)
#
# Для стандартного VPS без NPM используй напрямую:
#     docker compose up -d --build
#
# Использование:
#   ./deploy.sh            — собрать и запустить
#   ./deploy.sh stop       — остановить
#   ./deploy.sh restart    — перезапустить без пересборки
#   ./deploy.sh logs       — логи в реальном времени
#   ./deploy.sh status     — статус контейнеров
#   ./deploy.sh update     — git pull + пересборка
# =============================================================================

set -e

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

case "${1:-up}" in
  up)
    echo "▶ Запуск RetroBoard..."
    $COMPOSE up -d --build
    echo "✔ Готово. Приложение доступно на http://$(hostname -I | awk '{print $1}'):3080"
    ;;
  stop)
    echo "■ Остановка..."
    $COMPOSE down
    ;;
  restart)
    echo "↺ Перезапуск..."
    $COMPOSE restart
    ;;
  logs)
    $COMPOSE logs -f
    ;;
  status)
    $COMPOSE ps
    ;;
  update)
    echo "⟳ Обновление из git..."
    git pull
    echo "▶ Пересборка и запуск..."
    $COMPOSE up -d --build
    echo "✔ Обновление завершено."
    ;;
  *)
    echo "Использование: $0 {up|stop|restart|logs|status|update}"
    exit 1
    ;;
esac
