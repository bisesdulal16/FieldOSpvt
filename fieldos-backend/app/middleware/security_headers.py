"""
Security Headers Middleware — Phase 15 Compliance/Security Hardening

Adds security headers to every response:
  - Strict-Transport-Security (HSTS)
  - X-Frame-Options: DENY
  - X-Content-Type-Options: nosniff
  - X-XSS-Protection: 1; mode=block
  - Referrer-Policy: strict-origin-when-cross-origin
  - Content-Security-Policy (API: restrict to same-origin)
  - Removes server version headers
  - Enforces 10 MB request body size limit
"""
import time
import logging
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

# 10 MB max request body size
MAX_BODY_SIZE = 10 * 1024 * 1024  # 10 MB


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds security headers and enforces request body size limits."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # --- Request body size check ---
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                size = int(content_length)
                if size > MAX_BODY_SIZE:
                    logger.warning(
                        f"Rejected oversized request: {size} bytes "
                        f"(limit: {MAX_BODY_SIZE}) from {self._get_client_ip(request)}"
                    )
                    return JSONResponse(
                        status_code=413,
                        content={
                            "success": False,
                            "data": None,
                            "error": {
                                "code": "PAYLOAD_TOO_LARGE",
                                "message": f"Request body exceeds {MAX_BODY_SIZE // (1024 * 1024)} MB limit.",
                            },
                            "timestamp": int(time.time()),
                        },
                    )
            except (ValueError, TypeError):
                pass  # Let it proceed; Starlette will handle malformed headers

        # --- Process request ---
        response = await call_next(request)

        # --- Apply security headers ---
        # HSTS: enforce HTTPS for 1 year, include subdomains
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains; preload"
        )

        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Enable browser XSS filter
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Control referrer information
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Content-Security-Policy for API (restrict to same-origin)
        # For an API-only backend, default-src 'none' + specific allows
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )

        # Remove server version headers for security through obscurity
        if "server" in response.headers:
            del response.headers["server"]
        if "x-powered-by" in response.headers:
            del response.headers["x-powered-by"]

        # Add X-Content-Type-Options for good measure
        # (already set above, but some CDNs may override)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")

        # Cache control for API responses (no caching of sensitive data)
        if "/api/" in request.url.path:
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"

        return response

    @staticmethod
    def _get_client_ip(request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"
