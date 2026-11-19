"""Сервис настроек OpenAI-совместимого ИИ с хранением в БД и кэшем в процессе.

Настройки подключения хранятся только в таблице-синглтоне `ai_settings` и
управляются через `/admin` (API-ключ шифруется `Fernet` на ключе, производном
через `HKDF`). Активная конфигурация кэшируется в памяти единственного воркера,
чтобы горячий путь генерации и проверки `is_ai_configured()` не ходил в БД и
не выполнял криптооперации на каждый запрос.
"""

from __future__ import annotations

import base64
import ipaddress
import logging
import socket
import threading
import urllib.parse
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, cast

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.database import SessionLocal
from app.models import now_utc

logger = logging.getLogger(__name__)

ReasoningEffort = Literal["default", "none", "low", "medium", "high", "max"]

VALID_REASONING_EFFORTS: frozenset[str] = frozenset(
    {"default", "none", "low", "medium", "high", "max"}
)

_HKDF_SALT = b"retroboard-ai-settings-v1"
_HKDF_INFO = b"ai-api-key-fernet"
_SINGLETON_ID = 1

_fernet_lock = threading.Lock()
_cached_fernet_secret: str | None = None
_cached_fernet: Fernet | None = None

_write_lock = threading.Lock()
_cache_lock = threading.Lock()
_cache_loaded = False
_cache_generation = 0
_cached_db_config: EffectiveAIConfig | None = None

_session_factory: Callable[[], Session] = SessionLocal


@dataclass(frozen=True)
class EffectiveAIConfig:
    """Эффективные настройки ИИ, готовые к использованию без обращений к БД."""

    enabled: bool
    base_url: str
    api_key: str
    model: str
    reasoning_effort: ReasoningEffort
    updated_at: datetime | None = None
    key_decrypt_error: bool = False

    @property
    def is_configured(self) -> bool:
        return bool(self.enabled and self.base_url)


_EMPTY_AI_CONFIG = EffectiveAIConfig(
    enabled=False,
    base_url="",
    api_key="",
    model="",
    reasoning_effort="default",
    updated_at=None,
    key_decrypt_error=False,
)


def set_ai_settings_db_session_factory(factory: Callable[[], Session] | None) -> None:
    """Подменить фабрику DB-сессий (для изоляции тестов) и сбросить кэш."""
    global _session_factory
    _session_factory = factory if factory is not None else SessionLocal
    invalidate_ai_settings_cache()


@contextmanager
def _open_db_session() -> Iterator[Session]:
    db = _session_factory()
    try:
        yield db
    finally:
        db.close()


def _get_fernet() -> Fernet:
    """Вернуть кэшированный Fernet на ключе из `AI_SETTINGS_ENCRYPTION_KEY` или `ADMIN_JWT_SECRET`."""
    global _cached_fernet_secret, _cached_fernet
    secret = settings.ai_settings_encryption_key or settings.admin_jwt_secret
    with _fernet_lock:
        if _cached_fernet is not None and _cached_fernet_secret == secret:
            return _cached_fernet
        derived = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=_HKDF_SALT,
            info=_HKDF_INFO,
        ).derive(secret.encode("utf-8"))
        fernet = Fernet(base64.urlsafe_b64encode(derived))
        _cached_fernet_secret = secret
        _cached_fernet = fernet
        return fernet


def encrypt_api_key(plain: str) -> str:
    """Зашифровать API-ключ для хранения в БД."""
    return _get_fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_api_key(token: str) -> tuple[str, bool]:
    """Расшифровать API-ключ; при смене секрета не падает, а ставит флаг ошибки."""
    try:
        plain = _get_fernet().decrypt(token.encode("ascii")).decode("utf-8")
        return plain, False
    except (InvalidToken, ValueError, TypeError):
        logger.warning(
            "Не удалось расшифровать сохранённый API-ключ ИИ; введите или удалите ключ в /admin"
        )
        return "", True


def mask_api_key(plain: str) -> str | None:
    """Вернуть безопасную маску ключа для отображения в /admin (или None, если пусто)."""
    stripped = plain.strip()
    if not stripped:
        return None
    if len(stripped) <= 8:
        return "••••"
    if len(stripped) >= 10:
        return f"{stripped[:3]}••••{stripped[-4:]}"
    return f"••••{stripped[-4:]}"


def _is_forbidden_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return bool(
        ip.is_loopback or ip.is_link_local or ip.is_unspecified or ip.is_multicast
    )


def normalize_ai_base_url(raw: str) -> str:
    """Канонизировать URL (регистр схемы/хоста, стандартный порт :443/:80, хвостовой `/`)."""
    cleaned = raw.strip().rstrip("/")
    if not cleaned:
        return ""
    parsed = urllib.parse.urlsplit(cleaned)
    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if not scheme or not hostname:
        return cleaned
    try:
        port = parsed.port
    except ValueError:
        return cleaned
    host_part = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None and not (
        (scheme == "https" and port == 443) or (scheme == "http" and port == 80)
    ):
        netloc = f"{host_part}:{port}"
    else:
        netloc = host_part
    normalized_path = parsed.path.rstrip("/")
    return urllib.parse.urlunsplit((scheme, netloc, normalized_path, parsed.query, parsed.fragment))


def validate_ai_base_url(raw: str, *, allow_empty: bool = False) -> str:
    """Проверить и канонизировать Base URL OpenAI-совместимого API (только HTTPS)."""
    cleaned = raw.strip().rstrip("/")
    if not cleaned:
        if allow_empty:
            return ""
        raise ValueError("Укажите Base URL")
    if len(cleaned) > 500:
        raise ValueError("Base URL не должен превышать 500 символов")
    if any(ch.isspace() or ord(ch) < 32 for ch in cleaned):
        raise ValueError("URL не должен содержать пробелы или управляющие символы")
    if "?" in cleaned or "#" in cleaned:
        raise ValueError("URL не должен содержать query-параметры или фрагмент")

    parsed = urllib.parse.urlsplit(cleaned)
    if parsed.scheme.lower() != "https":
        raise ValueError("Поддерживается только HTTPS (https://...)")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("URL не должен содержать логин или пароль")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Укажите корректный хост в Base URL")

    try:
        _ = parsed.port
    except ValueError as err:
        raise ValueError("Некорректный порт в Base URL") from err

    host_check = hostname.lower().rstrip(".")
    if (
        not host_check
        or host_check == "localhost"
        or host_check.endswith(".localhost")
        or host_check == "localhost.localdomain"
    ):
        raise ValueError("Локальный адрес localhost запрещён")

    if "%" in host_check:
        raise ValueError("Адрес link-local запрещён")

    try:
        ip: ipaddress.IPv4Address | ipaddress.IPv6Address | None = ipaddress.ip_address(
            host_check
        )
    except ValueError:
        ip = None

    if ip is not None:
        if _is_forbidden_ip(ip):
            raise ValueError("Адрес loopback или link-local запрещён")
    else:
        # Блокируем hex/octal/decimal/сокращённые IPv4-записи вроде 0x7f000001, 0177.0.0.1, 127.1
        try:
            socket.inet_aton(host_check)
        except OSError:
            pass
        else:
            raise ValueError("Нестандартная запись IP-адреса запрещена")

        if not any("a" <= ch <= "z" for ch in host_check):
            raise ValueError("Укажите корректный домен или IP-адрес")

    normalized = normalize_ai_base_url(cleaned)
    if len(normalized) > 500:
        raise ValueError("Base URL не должен превышать 500 символов")
    return normalized


def assert_safe_resolved_host(url: str) -> None:
    """Проверить через DNS, что хост не резолвится в loopback/link-local/unspecified/multicast IP."""
    parsed = urllib.parse.urlsplit(url)
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Укажите корректный хост в Base URL")
    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)

    infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    for _family, _socktype, _proto, _canonname, sockaddr in infos:
        raw_ip = str(sockaddr[0]).split("%", 1)[0]
        try:
            ip = ipaddress.ip_address(raw_ip)
        except ValueError:
            continue
        if _is_forbidden_ip(ip):
            raise ValueError(
                "Адрес хоста разрешается в запрещённый loopback или link-local IP"
            )


def _config_from_row(row: models.AISettings) -> EffectiveAIConfig:
    effort: ReasoningEffort = (
        cast(ReasoningEffort, row.reasoning_effort)
        if row.reasoning_effort in VALID_REASONING_EFFORTS
        else "default"
    )
    if row.api_key_encrypted:
        api_key, decrypt_error = decrypt_api_key(row.api_key_encrypted)
    else:
        api_key, decrypt_error = "", False
    return EffectiveAIConfig(
        enabled=bool(row.enabled),
        base_url=normalize_ai_base_url(row.base_url),
        api_key=api_key,
        model=row.model,
        reasoning_effort=effort,
        updated_at=row.updated_at,
        key_decrypt_error=decrypt_error,
    )


def invalidate_ai_settings_cache() -> None:
    """Сбросить кэш настроек ИИ в памяти процесса."""
    global _cache_loaded, _cache_generation, _cached_db_config
    with _cache_lock:
        _cache_generation += 1
        _cache_loaded = False
        _cached_db_config = None


def _store_cached_db_config(
    cfg: EffectiveAIConfig | None, *, expected_generation: int | None = None
) -> None:
    global _cache_loaded, _cache_generation, _cached_db_config
    with _cache_lock:
        if expected_generation is not None and _cache_generation != expected_generation:
            return
        _cache_generation += 1
        _cached_db_config = cfg
        _cache_loaded = True


def _reset_shared_http_client() -> None:
    from app.ai.ai_client import ai_client

    ai_client.reset_shared_client()


def load_ai_settings_cache(db: Session | None = None) -> EffectiveAIConfig:
    """Прочитать настройки ИИ из БД, обновить кэш и вернуть эффективный конфиг."""
    with _cache_lock:
        gen = _cache_generation

    try:
        if db is not None:
            row = db.get(models.AISettings, _SINGLETON_ID)
        else:
            with _open_db_session() as session:
                row = session.get(models.AISettings, _SINGLETON_ID)
    except SQLAlchemyError:
        if db is not None:
            raise
        logger.warning(
            "Не удалось прочитать таблицу ai_settings; ИИ временно считается выключенным",
            exc_info=True,
        )
        return _EMPTY_AI_CONFIG

    db_cfg = _config_from_row(row) if row is not None else None
    _store_cached_db_config(db_cfg, expected_generation=gen)
    return db_cfg if db_cfg is not None else _EMPTY_AI_CONFIG


def get_effective_ai_config(db: Session | None = None) -> EffectiveAIConfig:
    """Вернуть эффективный конфиг ИИ (из памяти процесса; при холодном старте — из БД)."""
    with _cache_lock:
        if _cache_loaded:
            return (
                _cached_db_config
                if _cached_db_config is not None
                else _EMPTY_AI_CONFIG
            )
    return load_ai_settings_cache(db=db)


def is_ai_configured(db: Session | None = None) -> bool:
    """Проверить, включён и настроен ли ИИ в `/admin`."""
    return get_effective_ai_config(db=db).is_configured


def build_admin_ai_settings_out(cfg: EffectiveAIConfig) -> dict:
    """Собрать словарь ответа API для экрана `/admin` без раскрытия сырого ключа."""
    return {
        "enabled": cfg.enabled,
        "base_url": cfg.base_url,
        "model": cfg.model,
        "reasoning_effort": cfg.reasoning_effort,
        "has_api_key": bool(cfg.api_key) or cfg.key_decrypt_error,
        "api_key_masked": None if cfg.key_decrypt_error else mask_api_key(cfg.api_key),
        "key_decrypt_error": cfg.key_decrypt_error,
        "updated_at": cfg.updated_at,
    }


def get_admin_ai_settings(db: Session) -> dict:
    """Получить текущие настройки ИИ для `/admin` (обновляя кэш по БД)."""
    cfg = load_ai_settings_cache(db=db)
    return build_admin_ai_settings_out(cfg)


def save_admin_ai_settings(
    db: Session,
    *,
    enabled: bool,
    base_url: str,
    model: str,
    reasoning_effort: str,
    api_key: str | None,
    clear_api_key: bool,
) -> dict:
    """Провалидировать и сохранить настройки ИИ в БД."""
    if reasoning_effort not in VALID_REASONING_EFFORTS:
        raise ValueError("Неподдерживаемый уровень размышлений")

    normalized_url = validate_ai_base_url(base_url, allow_empty=not enabled)
    normalized_model = model.strip()
    if len(normalized_model) > 200:
        raise ValueError("Имя модели не должно превышать 200 символов")
    if enabled and not normalized_model:
        raise ValueError("Укажите имя модели")

    new_key = api_key.strip() if api_key is not None else ""
    if len(new_key) > 500:
        raise ValueError("API-ключ не должен превышать 500 символов")

    with _write_lock:
        row = db.get(models.AISettings, _SINGLETON_ID)
        prev_url = normalize_ai_base_url(row.base_url) if row is not None else None

        if row is None:
            row = models.AISettings(id=_SINGLETON_ID)
            db.add(row)

        if clear_api_key:
            row.api_key_encrypted = None
        elif new_key:
            row.api_key_encrypted = encrypt_api_key(new_key)
        elif prev_url is None or prev_url != normalized_url:
            # При первом сохранении без ключа или при смене Base URL старый ключ не переносится
            row.api_key_encrypted = None

        row.enabled = bool(enabled)
        row.base_url = normalized_url
        row.model = normalized_model
        row.reasoning_effort = reasoning_effort
        row.updated_at = now_utc()

        db.commit()
        db.refresh(row)

        cfg = _config_from_row(row)
        _store_cached_db_config(cfg)
        _reset_shared_http_client()
        return build_admin_ai_settings_out(cfg)


def resolve_probe_credentials(
    db: Session,
    *,
    base_url: str,
    api_key: str | None,
    clear_api_key: bool,
) -> tuple[str, str]:
    """Подготовить `(base_url, api_key)` для пробного вызова из `/admin`.

    Сохранённый ключ подставляется только при точном совпадении канонизированного
    `base_url` с текущей конфигурацией, чтобы ключ не ушёл на другой хост.
    """
    normalized_url = validate_ai_base_url(base_url, allow_empty=False)
    new_key = api_key.strip() if api_key is not None else ""

    if clear_api_key:
        return normalized_url, ""
    if new_key:
        return normalized_url, new_key

    effective = get_effective_ai_config(db=db)
    if (
        effective.base_url
        and normalize_ai_base_url(effective.base_url) == normalized_url
        and not effective.key_decrypt_error
    ):
        return normalized_url, effective.api_key
    return normalized_url, ""
