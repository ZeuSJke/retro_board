from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.config import _is_testing


def rate_limit_key(request: Request) -> str:
    """Ключ лимита: участник сессии, а для запросов без сессии — IP-адрес.

    Команда обычно сидит за одним адресом (офис, VPN): общая квота на IP
    упиралась бы в лимит на первом же голосовании. Вход и прочие запросы
    без сессии по-прежнему считаются по адресу.
    """
    from app.workspace_auth import participant_key_from_token, token_from_request

    participant_id = participant_key_from_token(token_from_request(request))
    if participant_id:
        return f"participant:{participant_id}"
    return get_remote_address(request)


# В тестовом окружении (TESTING=true — юнит-тесты и E2E) лимитер выключен.
# Причина: E2E-сьют делает ~35 записей в минуту на один endpoint (beforeEach
# создаёт доску через API) и упирается в прод-лимит 30/мин, из-за чего тесты
# падали с 429. Прод-настройки (30/мин записи, 100/мин чтения и т.д.) не
# меняются: в проде TESTING не задан, и лимитер работает как раньше.
# Прицельно лимитер проверяется в tests/test_rate_limiting.py — он включает
# limiter.enabled = True и убеждается, что превышение даёт 429.
limiter = Limiter(key_func=rate_limit_key, enabled=not _is_testing())

# Лимиты на совместную работу с доской. Квота считается на участника, но
# оставлена с запасом: перетаскивание, голосование и массовые правки в разгар
# ретро дают десятки запросов в минуту с одного клиента.
# Редкие действия (создание и удаление досок и колонок, вход, запросы к AI)
# сохраняют собственные, более строгие лимиты рядом с эндпоинтами.
TEAM_WRITE_LIMIT = "300/minute"
TEAM_READ_LIMIT = "300/minute"
# Массовые операции затрагивают до сотни карточек за запрос — им хватает меньшего
TEAM_BULK_LIMIT = "60/minute"
# Вход по приглашению считается по IP (сессии ещё нет): команда в одной
# переговорке сканирует QR одновременно с одного адреса. Токен приглашения
# случаен (192 бита), подбор ему не грозит — лимит только от засорения участниками.
INVITE_LIMIT = "120/minute"
