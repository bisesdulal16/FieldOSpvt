import time
import logging
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings

logger = logging.getLogger(__name__)

# Paths to skip from audit logging
SKIP_PATHS = {"/health", "/docs", "/redoc", "/openapi.json"}


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start_time = time.time()

        response = await call_next(request)

        duration_ms = (time.time() - start_time) * 1000

        if request.url.path not in SKIP_PATHS:
            self._log_request(request, response, duration_ms)

        return response

    @staticmethod
    def _log_request(request: Request, response: Response, duration_ms: float) -> None:
        client_ip = request.headers.get("x-forwarded-for", "")
        if not client_ip and request.client:
            client_ip = request.client.host

        log_data = {
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": round(duration_ms, 2),
            "client_ip": client_ip,
            "user_agent": request.headers.get("user-agent", "")[:200],
        }

        if settings.is_development:
            logger.info(
                f"[AUDIT] {log_data['method']} {log_data['path']} "
                f"-> {log_data['status']} ({log_data['duration_ms']}ms) "
                f"[{log_data['client_ip']}]"
            )
        else:
            logger.info(f"AUDIT_LOG: {log_data}")
