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


# ---------------------------------------------------------------------------
# Pre-built department dependencies (org matrix — PILOT_SCOPE_V2.md §2b / §8-C)
# ---------------------------------------------------------------------------

# The financial-data wall. `admin_it` administers users/devices/config but must
# NOT read or write financial/client data (a system admin must not be able to
# silently read collections or alter a loan — this is itself part of the audit
# story). Attach this at the router level on every money/client-PII router so
# the boundary is enforced in PERMISSIONS, not merely hidden in the UI.
#   operations   → field/branch (write the money loop)
#   audit        → monitoring (read across all branches, flag)
#   head_office  → org-wide operational + strategic
# Everyone EXCEPT admin_it. Older users default to `operations` (A2 backfill),
# so this is safe on pre-migration accounts.
require_financial_access = require_department(
    Department.OPERATIONS.value,
    Department.AUDIT.value,
    Department.HEAD_OFFICE.value,
)


# ---------------------------------------------------------------------------
# Branch scoping — the ONE enforced place (CLAUDE.md hard-rule #5)
# ---------------------------------------------------------------------------

# Roles allowed to see across ALL branches (the consolidated head-office view).
# Everyone else (a branch manager) is pinned to their own branch_id. `admin` is
# the HO/consolidated role; area/branch managers are scoped. Keep this list here
# so the cross-branch boundary is defined in exactly one spot.
_CROSS_BRANCH_ROLES: frozenset[str] = frozenset({UserRole.ADMIN.value})


def can_see_all_branches(user: User) -> bool:
    """True if this user is allowed the consolidated cross-branch view."""
    return user.role in _CROSS_BRANCH_ROLES


def scope_to_branch(query, model, user: User):
    """
    Apply branch scoping to a SELECT so a branch manager only sees their own
    branch's rows, while admin/HO sees everything.

    `model` must expose a `branch_id` column (collections, visit_checkins,
    task_assignments — see migration 008). Usage:

        q = select(Collection).where(Collection.collected_at.like(f"{today}%"))
        q = scope_to_branch(q, Collection, current_user)

    Rules:
      - admin/HO (can_see_all_branches) → query returned unchanged (all branches).
      - a scoped user with a branch_id → filtered to that branch.
      - a scoped user with NO branch_id → filtered to an impossible value so they
        see nothing, rather than silently leaking every branch. A manager without
        a branch is a misconfiguration; fail closed, not open.
    """
    if can_see_all_branches(user):
        return query
    if user.branch_id is None:
        # Fail closed: no branch assigned → no rows (never "all rows").
        return query.where(model.branch_id == -1)
    return query.where(model.branch_id == user.branch_id)
