"""
RBAC Auth Dependencies — Phase 15 Compliance/Security Hardening

Provides dependency injection functions for role-based access control:
  - get_current_user: Extract user from Bearer JWT token
  - require_role: Factory that returns a dependency checking user role
  - require_admin: Shortcut for admin-only endpoints
  - require_manager_or_admin: For manager/dashboard endpoints
  - require_any_role: For field officer level and above
"""
import logging
from typing import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User, UserRole, Department
from app.services.auth_service import verify_token

logger = logging.getLogger(__name__)

# Bearer token scheme
bearer_scheme = HTTPBearer(auto_error=False)

# ---------------------------------------------------------------------------
# Token blacklist (in-memory for development)
# Production: use Redis with TTL matching token expiry
# ---------------------------------------------------------------------------
_token_blacklist: set[str] = set()


def blacklist_token(jti: str) -> None:
    """Add a token's JTI to the blacklist. Use when logging out or rotating."""
    _token_blacklist.add(jti)
    logger.info(f"Token {jti[:8]}... blacklisted (total blacklisted: {len(_token_blacklist)})")


def is_token_blacklisted(jti: str) -> bool:
    """Check if a token's JTI is in the blacklist."""
    return jti in _token_blacklist


def get_blacklist_size() -> int:
    """Return the number of blacklisted tokens (for monitoring)."""
    return len(_token_blacklist)


# ---------------------------------------------------------------------------
# get_current_user — extract user from Bearer token
# ---------------------------------------------------------------------------

async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Extract and validate the current user from the Authorization: Bearer header.

    Returns the User ORM object if the token is valid and the user is active.
    Raises 401 if:
      - No token provided
      - Token is invalid/expired
      - Token is blacklisted
      - User not found or inactive
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header with Bearer token required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    payload = verify_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check token type
    token_type = payload.get("type")
    if token_type != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type — access token required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check token blacklist (by jti)
    jti = payload.get("jti")
    if jti and is_token_blacklisted(jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Look up user
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user identifier",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        uid = int(user_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user identifier in token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is disabled",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


# ---------------------------------------------------------------------------
# require_role — factory for role-checking dependencies
# ---------------------------------------------------------------------------

def require_role(*allowed_roles: str) -> Callable:
    """
    Returns a dependency that checks if the current user has one of the
    allowed roles.

    Usage:
        @router.get("/admin-only", dependencies=[Depends(require_role("admin"))])
        @router.get("/manager+", dependencies=[Depends(require_role("branch_manager", "area_manager", "admin"))])
    """

    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: {', '.join(allowed_roles)}. "
                       f"Your role: {current_user.role}.",
            )
        return current_user

    return role_checker


# ---------------------------------------------------------------------------
# require_department — factory for the org-matrix department axis
# ---------------------------------------------------------------------------

def require_department(*allowed_departments: str) -> Callable:
    """
    Returns a dependency that checks the current user's `department` (the org
    matrix axis from PILOT_SCOPE_V2.md §2), independent of `role`.

    This is what enforces boundaries a single role enum can't express — e.g.
    walling `admin_it` off from financial data, or restricting feedback triage
    to operations/audit/head_office. Older rows default to `operations`
    (see the A2 backfill), so this is safe on pre-migration users.

    Usage:
        @router.get("/x", dependencies=[Depends(require_department("audit", "head_office"))])
    """

    async def dept_checker(current_user: User = Depends(get_current_user)) -> User:
        user_dept = getattr(current_user, "department", None)
        if user_dept not in allowed_departments:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required department: {', '.join(allowed_departments)}. "
                       f"Your department: {user_dept}.",
            )
        return current_user

    return dept_checker


# ---------------------------------------------------------------------------
# Pre-built role dependencies
# ---------------------------------------------------------------------------

# Admin-only access
require_admin = require_role(UserRole.ADMIN.value)

# Branch manager, area manager, or admin
require_manager_or_admin = require_role(
    UserRole.BRANCH_MANAGER.value,
    UserRole.AREA_MANAGER.value,
    UserRole.ADMIN.value,
)

# Any authenticated user (all roles)
require_any_role = require_role(
    UserRole.FIELD_OFFICER.value,
    UserRole.BRANCH_MANAGER.value,
    UserRole.AREA_MANAGER.value,
    UserRole.ADMIN.value,
)
