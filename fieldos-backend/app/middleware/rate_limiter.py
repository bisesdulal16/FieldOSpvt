import time
import threading
from collections import defaultdict
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import settings

# In-memory sliding window rate limiter
_request_counts: dict[str, list[float]] = defaultdict(list)
_lock = threading.Lock()

# Default: 100 requests per minute per IP
RATE_LIMIT = 100
WINDOW_SECONDS = 60


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        client_ip = self._get_client_ip(request)

        if not self._is_allowed(client_ip):
            return JSONResponse(
                status_code=429,
                content={
                    "success": False,
                    "data": None,
                    "error": {
                        "code": "RATE_LIMITED",
                        "message": "Too many requests. Please try again later.",
                    },
                    "timestamp": int(time.time()),
                },
            )

        response = await call_next(request)
        return response

    @staticmethod
    def _get_client_ip(request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    @staticmethod
    def _is_allowed(client_ip: str) -> bool:
        now = time.time()
        with _lock:
            timestamps = _request_counts[client_ip]
            # Remove timestamps outside the window
            _request_counts[client_ip] = [
                ts for ts in timestamps if now - ts < WINDOW_SECONDS
            ]
            current_count = len(_request_counts[client_ip])
            if current_count >= RATE_LIMIT:
                return False
            _request_counts[client_ip].append(now)
            return True
