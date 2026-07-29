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

    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "REDACTED_ROTATED_SECRET")
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

    # ── Day-start office-network gate (master switch) ─────────────────────
    # OFF for the pilot: officers may start their day from any network. The
    # per-branch `Branch.office_ip` gate is only enforced when this is enabled,
    # so a stray/re-seeded office_ip can never lock a pilot officer out. Set
    # DAY_START_IP_GATE=true (and register the branch's real public IP) to enforce.
    DAY_START_IP_GATE: bool = os.getenv("DAY_START_IP_GATE", "false").strip().lower() in ("1", "true", "yes", "on")

    # ── Day-start face-match gate (master switch) ─────────────────────────
    # OFF by default (face-match stays informational — recorded for the manager
    # but never blocks). When enabled, an officer whose on-device face-match
    # fails (client sends face_verified=false) is blocked from starting the day
    # with a 403 — the server enforces it so a tampered client can't skip it.
    # A device that couldn't run the model (face_verified=None) is NOT blocked:
    # it falls back to the selfie photo-proof, same as the IP gate's opt-in shape.
    DAY_START_FACE_GATE: bool = os.getenv("DAY_START_FACE_GATE", "false").strip().lower() in ("1", "true", "yes", "on")

    # ── Client Protection / communication ledger ─────────────────────────
    # Disabled-by-default for dispatch. The ledger/outbox can still be created
    # transactionally so collection verification state is durable before any
    # worker/provider is available.
    CLIENT_PROTECTION_ENABLED: bool = os.getenv("CLIENT_PROTECTION_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    VERIFICATION_SMS_ENABLED: bool = os.getenv("VERIFICATION_SMS_ENABLED", "true").strip().lower() in ("1", "true", "yes", "on")
    VERIFICATION_IVR_ENABLED: bool = os.getenv("VERIFICATION_IVR_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    VERIFICATION_AI_CALL_ENABLED: bool = os.getenv("VERIFICATION_AI_CALL_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    VERIFICATION_RANDOM_SAMPLE_PERCENT: float = float(os.getenv("VERIFICATION_RANDOM_SAMPLE_PERCENT", "0"))
    VERIFICATION_HIGH_VALUE_THRESHOLD: float = float(os.getenv("VERIFICATION_HIGH_VALUE_THRESHOLD", "0"))
    VERIFICATION_MAX_SMS_ATTEMPTS: int = int(os.getenv("VERIFICATION_MAX_SMS_ATTEMPTS", "3"))
    VERIFICATION_MAX_CALL_ATTEMPTS: int = int(os.getenv("VERIFICATION_MAX_CALL_ATTEMPTS", "3"))
    VERIFICATION_ESCALATION_HOURS: int = int(os.getenv("VERIFICATION_ESCALATION_HOURS", "24"))
    VERIFICATION_DEFAULT_LANGUAGE: str = os.getenv("VERIFICATION_DEFAULT_LANGUAGE", "en")
    VERIFICATION_DEFAULT_PRIORITY: str = os.getenv("VERIFICATION_DEFAULT_PRIORITY", "normal")
    CALL_PROVIDER: str = os.getenv("CALL_PROVIDER", "log").lower()

    # ── Communication outbox worker (Phase 2, safe-off by default) ─────────
    COMMUNICATION_WORKER_ENABLED: bool = os.getenv("COMMUNICATION_WORKER_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    COMMUNICATION_DISPATCH_MODE: str = os.getenv("COMMUNICATION_DISPATCH_MODE", "postgres").strip().lower()
    OUTBOX_POLL_INTERVAL_SECONDS: float = float(os.getenv("OUTBOX_POLL_INTERVAL_SECONDS", "2"))
    OUTBOX_BATCH_SIZE: int = int(os.getenv("OUTBOX_BATCH_SIZE", "50"))
    OUTBOX_LOCK_TIMEOUT_SECONDS: int = int(os.getenv("OUTBOX_LOCK_TIMEOUT_SECONDS", "300"))
    OUTBOX_MAX_ATTEMPTS: int = int(os.getenv("OUTBOX_MAX_ATTEMPTS", "5"))
    OUTBOX_BASE_RETRY_SECONDS: int = int(os.getenv("OUTBOX_BASE_RETRY_SECONDS", "30"))
    OUTBOX_MAX_RETRY_SECONDS: int = int(os.getenv("OUTBOX_MAX_RETRY_SECONDS", "3600"))
    OUTBOX_LOG_PROVIDER_FAIL_PERCENT: float = float(os.getenv("OUTBOX_LOG_PROVIDER_FAIL_PERCENT", "0"))

    # ── RabbitMQ broker dispatch (Phase 8, safe-off by default) ───────────
    RABBITMQ_ENABLED: bool = os.getenv("RABBITMQ_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    RABBITMQ_URL: str = os.getenv("RABBITMQ_URL", "")
    RABBITMQ_VHOST: str = os.getenv("RABBITMQ_VHOST", "/fieldos")
    RABBITMQ_EXCHANGE: str = os.getenv("RABBITMQ_EXCHANGE", "fieldos.communication")
    RABBITMQ_PREFETCH: int = int(os.getenv("RABBITMQ_PREFETCH", "20"))
    RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_SECONDS: int = int(os.getenv("RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_SECONDS", "10"))
    RABBITMQ_RECONNECT_SECONDS: int = int(os.getenv("RABBITMQ_RECONNECT_SECONDS", "5"))
    RABBITMQ_MAX_RETRIES: int = int(os.getenv("RABBITMQ_MAX_RETRIES", "5"))

    # ── Dedicated Redis for short-lived communication coordination only ───
    REDIS_ENABLED: bool = os.getenv("REDIS_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    REDIS_URL: str = os.getenv("REDIS_URL", "")
    REDIS_KEY_PREFIX: str = os.getenv("REDIS_KEY_PREFIX", "fieldos")
    REDIS_MAXMEMORY: str = os.getenv("REDIS_MAXMEMORY", "256mb")

    # ── SMS gateway (client receipt notifications) ────────────────────────
    # SMS_PROVIDER=log          → dev/demo: records the message, sends nothing
    # SMS_PROVIDER=sparrow_http → Nepal production via Sparrow HTTP
    # SMS_PROVIDER=jasmin_http  → Jasmin HTTP API/SMPP bridge
    SMS_PROVIDER: str = os.getenv("SMS_PROVIDER", "log").lower()
    SMS_API_TOKEN: str = os.getenv("SMS_API_TOKEN", "")
    SMS_SENDER: str = os.getenv("SMS_SENDER", "FieldOS")  # Sparrow "from" identity
    SMS_SPARROW_URL: str = os.getenv("SMS_SPARROW_URL", "https://api.sparrowsms.com/v2/sms/")
    SMS_REQUEST_TIMEOUT_SECONDS: float = float(os.getenv("SMS_REQUEST_TIMEOUT_SECONDS", "10"))
    SMS_CALLBACK_SECRET: str = os.getenv("SMS_CALLBACK_SECRET", "")
    SMS_CALLBACK_TIMESTAMP_TOLERANCE_SECONDS: int = int(os.getenv("SMS_CALLBACK_TIMESTAMP_TOLERANCE_SECONDS", "300"))
    JASMIN_HTTP_URL: str = os.getenv("JASMIN_HTTP_URL", "http://jasmin:1401/send")

    # ── Scheduled client communication reminders (Phase 5, safe-off) ───────
    REMINDERS_ENABLED: bool = os.getenv("REMINDERS_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    REMINDER_DUE_DAYS_BEFORE: int = int(os.getenv("REMINDER_DUE_DAYS_BEFORE", "1"))
    REMINDER_OVERDUE_DAYS: str = os.getenv("REMINDER_OVERDUE_DAYS", "1,3,7")
    REMINDER_QUIET_HOURS_START: str = os.getenv("REMINDER_QUIET_HOURS_START", "20:00")
    REMINDER_QUIET_HOURS_END: str = os.getenv("REMINDER_QUIET_HOURS_END", "08:00")
    REMINDER_MAX_PER_CLIENT_PER_DAY: int = int(os.getenv("REMINDER_MAX_PER_CLIENT_PER_DAY", "1"))
    REMINDER_MAX_PER_CLIENT_PER_WEEK: int = int(os.getenv("REMINDER_MAX_PER_CLIENT_PER_WEEK", "3"))
    REMINDER_DEFAULT_LANGUAGE: str = os.getenv("REMINDER_DEFAULT_LANGUAGE", "ne")
    REMINDER_TIMEZONE: str = os.getenv("REMINDER_TIMEZONE", "Asia/Kathmandu")
    REMINDER_LOOKAHEAD_DAYS: int = int(os.getenv("REMINDER_LOOKAHEAD_DAYS", "7"))

    # ── n8n Client Protection orchestration (Phase 7, safe-off) ───────────
    N8N_INTEGRATION_ENABLED: bool = os.getenv("N8N_INTEGRATION_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    N8N_WEBHOOK_URL: str = os.getenv("N8N_WEBHOOK_URL", "")
    N8N_SHARED_SECRET: str = os.getenv("N8N_SHARED_SECRET", "")
    N8N_REQUEST_TIMEOUT_SECONDS: int = int(os.getenv("N8N_REQUEST_TIMEOUT_SECONDS", "10"))
    N8N_TIMESTAMP_TOLERANCE_SECONDS: int = int(os.getenv("N8N_TIMESTAMP_TOLERANCE_SECONDS", "300"))
    N8N_DAILY_REPORT_HOUR: int = int(os.getenv("N8N_DAILY_REPORT_HOUR", "8"))
    N8N_TIMEZONE: str = os.getenv("N8N_TIMEZONE", "Asia/Kathmandu")
    N8N_RANDOM_SAMPLE_PERCENT: float = float(os.getenv("N8N_RANDOM_SAMPLE_PERCENT", "0"))
    N8N_PROVIDER_FAILURE_THRESHOLD: int = int(os.getenv("N8N_PROVIDER_FAILURE_THRESHOLD", "10"))
    N8N_BACKLOG_AGE_THRESHOLD_SECONDS: int = int(os.getenv("N8N_BACKLOG_AGE_THRESHOLD_SECONDS", "900"))
    N8N_REPLAY_STORE: str = os.getenv("N8N_REPLAY_STORE", "memory").strip().lower()
    N8N_REPLAY_TTL_SECONDS: int = int(os.getenv("N8N_REPLAY_TTL_SECONDS", "330"))

    # ── Error monitoring (Sentry) ─────────────────────────────────────────
    # Set SENTRY_DSN in production to capture exceptions. Unset = disabled (no-op).
    SENTRY_DSN: str = os.getenv("SENTRY_DSN", "")

    # ── AI summaries (server-side LLM — works on every phone) ─────────────
    # LLM_PROVIDER=heuristic (default, no LLM) | ollama (homelab) | openai
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "heuristic").lower()
    LLM_MODEL: str = os.getenv("LLM_MODEL", "llama3.2")
    OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

    # ── Voice notes: speech-to-text ───────────────────────────────────────
    # STT_PROVIDER=off (default) | whisper_api (OpenAI Whisper) | ollama
    STT_PROVIDER: str = os.getenv("STT_PROVIDER", "off").lower()
    STT_MODEL: str = os.getenv("STT_MODEL", "whisper-1")

    # ── Face verification for attendance (server-side match) ──────────────
    # FACE_PROVIDER=off (default, photo-proof only) | deepface (homelab, real match)
    FACE_PROVIDER: str = os.getenv("FACE_PROVIDER", "off").lower()
    FACE_MATCH_THRESHOLD: float = float(os.getenv("FACE_MATCH_THRESHOLD", "0.55"))
    DEEPFACE_MODEL: str = os.getenv("DEEPFACE_MODEL", "Facenet")

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
