"""
Append-only audit logging for sensitive actions.

Call `write_audit(...)` inside the same transaction as the action it records, so the
audit row commits atomically with the change. The authenticated user is the source of
truth for who/what/where — never the request body.
"""
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)


async def write_audit(
    db: AsyncSession,
    user,
    action_type: str,
    entity_type: str | None = None,
    entity_id=None,
    meta: dict | None = None,
) -> AuditLog:
    """Add an audit row for `user` performing `action_type`. Does not commit."""
    row = AuditLog(
        user_id=getattr(user, "id", None),
        role=getattr(user, "role", None),
        branch_id=getattr(user, "branch_id", None),
        action_type=action_type,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
    )
    if meta:
        row.set_meta(meta)
    db.add(row)
    logger.info(
        "AUDIT user=%s role=%s action=%s entity=%s:%s",
        getattr(user, "staff_id", getattr(user, "id", "?")),
        getattr(user, "role", "?"),
        action_type,
        entity_type,
        entity_id,
    )
    return row
