from slowapi import Limiter
from slowapi.util import get_remote_address
from app.config import _is_testing

# В тестовом окружении (TESTING=true — юнит-тесты и E2E) лимитер выключен.
# Причина: E2E-сьют делает ~35 записей в минуту на один endpoint (beforeEach
# создаёт доску через API) и упирается в прод-лимит 30/мин, из-за чего тесты
# падали с 429. Прод-настройки (30/мин записи, 100/мин чтения и т.д.) не
# меняются: в проде TESTING не задан, и лимитер работает как раньше.
# Прицельно лимитер проверяется в tests/test_rate_limiting.py — он включает
# limiter.enabled = True и убеждается, что превышение даёт 429.
limiter = Limiter(key_func=get_remote_address, enabled=not _is_testing())
