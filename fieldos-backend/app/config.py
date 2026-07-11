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

    # ── White-label branding (single tenant) ──────────────────────────────
    # Set these per institution to rebrand the same build. Consumed by the
    # dashboard header/login and the mobile login via GET /api/v1/branding.
    ORG_NAME: str = os.getenv("ORG_NAME", "FieldOS")
    ORG_NAME_NE: str = os.getenv("ORG_NAME_NE", "फिल्डओएस")
    ORG_TAGLINE: str = os.getenv("ORG_TAGLINE", "Nepal")
    ORG_PRODUCT_SUFFIX: str = os.getenv("ORG_PRODUCT_SUFFIX", "Branch Manager Dashboard")
    ORG_PRIMARY_COLOR: str = os.getenv("ORG_PRIMARY_COLOR", "#0B1B3A")
    ORG_ACCENT_COLOR: str = os.getenv("ORG_ACCENT_COLOR", "#F59E0B")
    ORG_LOGO_URL: str = os.getenv("ORG_LOGO_URL", "")

    # ── SMS gateway (client receipt notifications) ────────────────────────
    # SMS_PROVIDER=log     → dev/demo: records the message, sends nothing (no gateway needed)
    # SMS_PROVIDER=sparrow → Nepal production via Sparrow SMS (needs token + credits)
    SMS_PROVIDER: str = os.getenv("SMS_PROVIDER", "log").lower()
    SMS_API_TOKEN: str = os.getenv("SMS_API_TOKEN", "")
    SMS_SENDER: str = os.getenv("SMS_SENDER", "FieldOS")  # Sparrow "from" identity
    SMS_SPARROW_URL: str = os.getenv("SMS_SPARROW_URL", "http://api.sparrowsms.com/v2/sms/")

    @property
    def branding(self) -> dict:
        return {
            "org_name": self.ORG_NAME,
            "org_name_ne": self.ORG_NAME_NE,
            "tagline": self.ORG_TAGLINE,
            "product_suffix": self.ORG_PRODUCT_SUFFIX,
            "primary_color": self.ORG_PRIMARY_COLOR,
            "accent_color": self.ORG_ACCENT_COLOR,
            "logo_url": self.ORG_LOGO_URL,
        }

    @property
    def is_development(self) -> bool:
        return self.APP_ENV == "development"

    @property
    def is_sqlite(self) -> bool:
        return DB_TYPE == "sqlite"


settings = Settings()
