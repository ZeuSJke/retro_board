from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://retro:retro@db:5432/retroboard"

    class Config:
        env_file = ".env"


settings = Settings()
