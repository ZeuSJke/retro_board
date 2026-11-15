import os

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator


def _is_testing() -> bool:
    return os.getenv("TESTING", "").lower() == "true"


class Settings(BaseSettings):
    # Required — set via environment variable or .env file
    database_url: str

    # Comma-separated list of allowed CORS origins
    # Example: "http://localhost:3000,http://localhost:5173"
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # CSRF protection (disable for E2E tests via CSRF_ENABLED=false)
    csrf_enabled: bool = True

    # Secure cookies (set SECURE_COOKIES=false for local HTTP dev)
    secure_cookies: bool = True

    # AI — self-hosted LiteLLM gateway (OpenAI-compatible /v1 API)
    ai_base_url: str = ""  # env AI_BASE_URL, e.g. https://llm-api.kirillbessonov.ru/v1
    ai_api_key: str = ""  # env AI_API_KEY (может быть пустым, если гейт без авторизации)
    ai_model: str = "qwen3.6-35b-a3b-mtp-ud-q8_k_xl"  # env AI_MODEL
    ai_disable_thinking: bool = True  # env AI_DISABLE_THINKING
    # Сколько запросов к модели идёт одновременно; остальные ждут ai_queue_timeout_s
    ai_max_concurrency: int = 4  # env AI_MAX_CONCURRENCY
    ai_queue_timeout_s: float = 15.0  # env AI_QUEUE_TIMEOUT_S
    ai_connect_timeout_s: float = 5.0  # env AI_CONNECT_TIMEOUT_S

    # Таймауты PostgreSQL: один зависший запрос не должен останавливать
    # единственный воркер. Для других СУБД (SQLite в тестах) не применяются.
    db_connect_timeout_s: int = 5  # env DB_CONNECT_TIMEOUT_S
    db_statement_timeout_ms: int = 30000  # env DB_STATEMENT_TIMEOUT_MS
    db_lock_timeout_ms: int = 10000  # env DB_LOCK_TIMEOUT_MS
    db_pool_timeout_s: int = 10  # env DB_POOL_TIMEOUT_S

    # Максимальный размер тела HTTP-запроса в байтах
    max_request_body_bytes: int = 1_048_576  # env MAX_REQUEST_BODY_BYTES

    # Workspace JWT secrets and admin credentials
    workspace_jwt_secret: str = "change-me-workspace-secret"
    # 30 дней: личность участника (автор карточек, создатель доски) привязана к
    # сессии, а ретро обычно раз в две недели — за неделю она бы терялась.
    # Сессия продлевается при каждом заходе и отзывается выходом или сменой ключа.
    workspace_jwt_expire_hours: int = 720
    admin_login: str = "admin"
    admin_password: str = "changeme"
    admin_jwt_secret: str = "change-me-admin-secret"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @field_validator("workspace_jwt_secret")
    @classmethod
    def validate_workspace_jwt_secret(cls, v: str) -> str:
        if _is_testing():
            return v
        if v == "change-me-workspace-secret":
            raise ValueError("WORKSPACE_JWT_SECRET must be changed from default value")
        if len(v) < 32:
            raise ValueError("WORKSPACE_JWT_SECRET must be at least 32 characters")
        return v

    @field_validator("admin_jwt_secret")
    @classmethod
    def validate_admin_jwt_secret(cls, v: str) -> str:
        if _is_testing():
            return v
        if v == "change-me-admin-secret":
            raise ValueError("ADMIN_JWT_SECRET must be changed from default value")
        if len(v) < 32:
            raise ValueError("ADMIN_JWT_SECRET must be at least 32 characters")
        return v

    @field_validator("admin_login")
    @classmethod
    def validate_admin_login(cls, v: str) -> str:
        if _is_testing():
            return v
        if v == "admin":
            raise ValueError("ADMIN_LOGIN must be changed from default 'admin'")
        if len(v) < 3:
            raise ValueError("ADMIN_LOGIN must be at least 3 characters")
        return v

    @field_validator("admin_password")
    @classmethod
    def validate_admin_password(cls, v: str) -> str:
        if _is_testing():
            return v
        if v == "changeme":
            raise ValueError("ADMIN_PASSWORD must be changed from default value")
        if len(v) < 8:
            raise ValueError("ADMIN_PASSWORD must be at least 8 characters")
        return v

    @property
    def ai_configured(self) -> bool:
        return bool(self.ai_base_url)

    @property
    def sqlalchemy_database_url(self) -> str:
        """DATABASE_URL с явным драйвером psycopg 3.

        В окружениях строка подключения задана как `postgresql://…` (чарт, CI,
        `.env`): без имени драйвера SQLAlchemy выбрал бы psycopg2, которого в
        образе больше нет. Приводим схему в одном месте, чтобы не менять её
        в каждом окружении; строки с явным драйвером и другие СУБД не трогаем.
        """
        url = self.database_url
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url

    @property
    def cors_origins_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]


settings = Settings()  # type: ignore[call-arg]
