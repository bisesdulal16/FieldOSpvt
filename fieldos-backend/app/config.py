import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Determine database type
DB_TYPE = os.getenv("DB_TYPE", "sqlite").lower()


class Settings:
    if DB_TYPE == "postgres":
        DATABASE_URL: str = os.getenv(
            "DATABASE_URL",
            "postgresql+asyncpg://fieldos:fieldos@localhost:5432/fieldos_nepal",
        )
    else:
        # SQLite mode — single file, no server needed
        _db_path = os.getenv("SQLITE_PATH", "/tmp/fieldos_nepal.db")
        DATABASE_URL: str = f"sqlite+aiosqlite:///{_db_path}"

    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "fieldos-nepal-dev-secret-key-2024")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
    APP_ENV: str = os.getenv("APP_ENV", "development")
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "*")
    PROJECT_NAME: str = "FieldOS Nepal"
    API_V1_PREFIX: str = "/api/v1"

    @property
    def is_development(self) -> bool:
        return self.APP_ENV == "development"

    @property
    def is_sqlite(self) -> bool:
        return DB_TYPE == "sqlite"


settings = Settings()
