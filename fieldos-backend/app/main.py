import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import engine, Base
from app.middleware.rate_limiter import RateLimitMiddleware
from app.middleware.audit_middleware import AuditMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.routers import (
    auth,
    devices,
    bootstrap,
    sync,
    tasks,
    clients,
    collections,
    visit,
    promise,
    meetings,
    eod,
    audit,
    manager,
    cbs,
    ai,
    voice_ai,
    security,
    pilot,
    announcements,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("FieldOS Nepal backend starting up...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created/verified.")
    yield
    logger.info("FieldOS Nepal backend shutting down...")
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="FieldOS Nepal — Microfinance Field Officer Management System",
    version="1.0.0",
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
    lifespan=lifespan,
)

# CORS
cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if cors_origins != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom middleware (added in reverse order — last added runs first on request)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(AuditMiddleware)
app.add_middleware(RateLimitMiddleware)


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred."},
            "timestamp": int(time.time()),
        },
    )


# Include routers
app.include_router(auth.router, prefix=settings.API_V1_PREFIX, tags=["Authentication"])
app.include_router(devices.router, prefix=settings.API_V1_PREFIX, tags=["Devices"])
app.include_router(bootstrap.router, prefix=settings.API_V1_PREFIX, tags=["Mobile Bootstrap"])
app.include_router(sync.router, prefix=settings.API_V1_PREFIX, tags=["Sync"])
app.include_router(tasks.router, prefix=settings.API_V1_PREFIX, tags=["Tasks"])
app.include_router(clients.router, prefix=settings.API_V1_PREFIX, tags=["Clients"])
app.include_router(collections.router, prefix=settings.API_V1_PREFIX, tags=["Collections"])
app.include_router(visit.router, prefix=settings.API_V1_PREFIX, tags=["Visit Check-ins"])
app.include_router(promise.router, prefix=settings.API_V1_PREFIX, tags=["Promise to Pay"])
app.include_router(meetings.router, prefix=settings.API_V1_PREFIX, tags=["Meetings"])
app.include_router(eod.router, prefix=settings.API_V1_PREFIX, tags=["End of Day"])
app.include_router(audit.router, prefix=settings.API_V1_PREFIX, tags=["Audit"])
app.include_router(manager.router, prefix=settings.API_V1_PREFIX, tags=["Manager Dashboard"])
app.include_router(cbs.router, prefix=settings.API_V1_PREFIX, tags=["CBS Integration"])
app.include_router(ai.router, prefix=settings.API_V1_PREFIX, tags=["AI Intelligence v1"])
app.include_router(voice_ai.router, prefix=settings.API_V1_PREFIX, tags=["Voice AI v2"])
app.include_router(security.router, prefix=settings.API_V1_PREFIX, tags=["Security & Compliance"])
app.include_router(pilot.router, prefix=settings.API_V1_PREFIX, tags=["Pilot Management"])

# Announcements: two routers — manager (POST) + mobile (GET)
app.include_router(announcements.manager_router, prefix=settings.API_V1_PREFIX, tags=["Announcements"])
app.include_router(announcements.mobile_router, prefix=settings.API_V1_PREFIX, tags=["Announcements"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": settings.PROJECT_NAME, "db": "sqlite", "ai_v1": "enabled", "voice_ai_v2": "enabled", "pilot": "enabled"}




