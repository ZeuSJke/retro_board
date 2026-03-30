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

    # Jira integration (optional)
    jira_url: str = ""
    jira_email: str = ""
    jira_api_token: str = ""
    jira_verify_ssl: bool = (
        True  # False для on-premise Jira с самоподписанным сертификатом
    )

    # Workspace JWT secrets and admin credentials
    workspace_jwt_secret: str = "change-me-workspace-secret"
    workspace_jwt_expire_hours: int = 168  # 7 дней
    admin_login: str = "admin"
    admin_password: str = "changeme"
    admin_jwt_secret: str = "change-me-admin-secret"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
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
    def jira_configured(self) -> bool:
        return bool(self.jira_url and self.jira_email and self.jira_api_token)

    @property
    def cors_origins_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]


settings = Settings()  # type: ignore[call-arg]
