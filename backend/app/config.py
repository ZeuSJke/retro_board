from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Required — set via environment variable or .env file
    database_url: str

    # Comma-separated list of allowed CORS origins
    # Example: "http://localhost:3000,http://localhost:5173"
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # Jira integration (optional)
    jira_url: str = ""
    jira_email: str = ""
    jira_api_token: str = ""
    jira_verify_ssl: bool = True  # False для on-premise Jira с самоподписанным сертификатом

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    @property
    def jira_configured(self) -> bool:
        return bool(self.jira_url and self.jira_email and self.jira_api_token)

    @property
    def cors_origins_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]


settings = Settings()  # type: ignore[call-arg]
