"""
Authentication Service — FieldOS Nepal

Provides JWT token creation/verification, PIN hashing, and token management.

Token Rotation:
  - Access tokens include a `jti` (JWT ID) claim for unique tracking
  - Tokens can be blacklisted via `app.deps.auth_deps.blacklist_token(jti)`
  - In development: in-memory blacklist (dict)
  - In production: use Redis with TTL matching token expiry
"""
import uuid
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import bcrypt

from app.config import settings

logger = logging.getLogger(__name__)


def hash_pin(pin: str) -> str:
    """Hash a PIN using bcrypt."""
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_pin(pin: str, hashed_pin: str) -> bool:
    """Verify a PIN against its bcrypt hash."""
    try:
        return bcrypt.checkpw(pin.encode("utf-8"), hashed_pin.encode("utf-8"))
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """
    Create a signed access JWT token.

    Claims:
      - sub: User ID (string)
      - role: User role
      - exp: Expiration timestamp
      - type: "access"
      - jti: Unique token ID (for tracking/blacklisting)
      - iat: Issued-at timestamp
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    # Generate unique JTI (JWT ID) for token tracking and blacklist support
    jti = uuid.uuid4().hex
    to_encode.update({
        "exp": expire,
        "type": "access",
        "jti": jti,
        "iat": datetime.now(timezone.utc),
    })
    token = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    logger.debug(f"Access token created: jti={jti[:8]}... user={data.get('sub')}")
    return token


def create_refresh_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """
    Create a signed refresh JWT token.

    Claims:
      - sub: User ID (string)
      - exp: Expiration timestamp
      - type: "refresh"
      - jti: Unique token ID
      - iat: Issued-at timestamp
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    )
    jti = uuid.uuid4().hex
    to_encode.update({
        "exp": expire,
        "type": "refresh",
        "jti": jti,
        "iat": datetime.now(timezone.utc),
    })
    token = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    logger.debug(f"Refresh token created: jti={jti[:8]}... user={data.get('sub')}")
    return token


def verify_token(token: str) -> dict[str, Any] | None:
    """
    Verify a JWT token and return its payload.

    Returns None if:
      - Token is expired
      - Token signature is invalid
      - Token is malformed
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except jwt.ExpiredSignatureError:
        logger.debug("Token verification failed: expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.debug(f"Token verification failed: {e}")
        return None


def generate_receipt_id() -> str:
    """Generate a unique receipt ID: RCPT-YYYYMMDDHHmmss-XXXX."""
    now = datetime.now(timezone.utc)
    return f"RCPT-{now.strftime('%Y%m%d%H%M%S')}-{now.microsecond // 1000:04d}"
