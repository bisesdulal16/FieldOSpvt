"""Hierarchical feedback router — the pilot star (PILOT_SCOPE_V2.md §3, §B6/B7).

Endpoints:
  POST /feedback                  submit feedback tied to a subject (any user)
  GET  /feedback                  list, department-scoped + anonymity-applied
  POST /feedback/{id}/ack         acknowledge (triage — manager/audit/HO)
  POST /feedback/{id}/comment     add a comment event
  POST /feedback/{id}/escalate    push up the ops chain (visibility -> up_chain)
  POST /feedback/{id}/status      change status (in_review/resolved/wont_fix)

Rollup rides the User.manager_id operations chain. Author identity is filtered
by department in app/services/feedback_access.py — a branch manager never sees
who wrote a piece of feedback (§7).
"""
import time
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, Department, DataScope
from app.models.feedback import (
    Feedback, FeedbackEvent, FeedbackCampaign,
    SubjectType, FeedbackCategory, FeedbackStatus, VisibilityScope, FeedbackEventAction,
)
from app.schemas.common import ApiResponse
from app.deps.auth_deps import get_current_user, require_department
from app.services.audit_helper import write_audit
from app.services.feedback_access import (
    serialize_feedback, viewer_scope_filter, department_can_see_identity,
)
from app.utils.nepal_time import now_nepal_iso, now_nepal

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/feedback", tags=["Feedback"])


def _ts() -> int:
    return int(time.time())


# Departments allowed to triage (act on) feedback. Field officers submit only;
# admin_it is walled off from operational content.
_TRIAGE_DEPARTMENTS = {
    Department.OPERATIONS.value,   # branch manager (scoped to own branch)
    Department.AUDIT.value,
    Department.HEAD_OFFICE.value,
}


# --------------------------------------------------------------------------- #
# Request models
# --------------------------------------------------------------------------- #
class FeedbackCreate(BaseModel):
    subject_type: str = Field(default=SubjectType.GENERAL.value)
    subject_ref: str | None = None
    category: str = Field(default=FeedbackCategory.REQUEST.value)
    severity: int = Field(default=3, ge=1, le=5)
    body_text: str | None = None
    body_ne: str | None = None
    voice_note_ref: str | None = None
    campaign_id: int | None = None


class CommentBody(BaseModel):
    note: str


class StatusBody(BaseModel):
    status: str
    note: str | None = None


class CampaignCreate(BaseModel):
    prompt_text: str
    prompt_ne: str | None = None
    target_role: str | None = None   # e.g. "field_officer"; None = everyone


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
async def _get_or_404(db: AsyncSession, feedback_id: int) -> Feedback:
    fb = (await db.execute(select(Feedback).where(Feedback.id == feedback_id))).scalar_one_or_none()
    if fb is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")
    return fb


def _require_triage(user: User) -> None:
    if getattr(user, "department", None) not in _TRIAGE_DEPARTMENTS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your department cannot triage feedback.",
        )


async def _add_event(db: AsyncSession, fb: Feedback, actor: User,
                     action: str, note: str | None = None, routed_to: str | None = None) -> None:
    db.add(FeedbackEvent(
        feedback_id=fb.id, at=now_nepal_iso(),
        actor_user_id=getattr(actor, "id", None),
        action=action, note=note, routed_to=routed_to,
    ))


# --------------------------------------------------------------------------- #
# Submit (B6) — any authenticated user
# --------------------------------------------------------------------------- #
@router.post("", response_model=ApiResponse)
async def submit_feedback(
    body: FeedbackCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit feedback tied to a subject. Author + branch captured from the token."""
    fb = Feedback(
        submitted_at=now_nepal_iso(),
        author_user_id=current_user.id,
        author_role=current_user.role,
        branch_id=current_user.branch_id,
        subject_type=body.subject_type,
        subject_ref=body.subject_ref,
        category=body.category,
        severity=body.severity,
        body_text=body.body_text,
        body_ne=body.body_ne,
        voice_note_ref=body.voice_note_ref,
        status=FeedbackStatus.OPEN.value,
        visibility_scope=VisibilityScope.BRANCH.value,
        campaign_id=body.campaign_id,
    )
    db.add(fb)
    await db.flush()
    await _add_event(db, fb, current_user, FeedbackEventAction.CREATED.value)
    await write_audit(db, current_user, "feedback.submit", entity_type="feedback", entity_id=fb.id,
                      meta={"category": body.category, "subject_type": body.subject_type})
    await db.commit()
    return ApiResponse(success=True, data={"id": fb.id, "message": "Feedback submitted"}, timestamp=_ts())


# --------------------------------------------------------------------------- #
# List (B7) — department-scoped, anonymity-applied
# --------------------------------------------------------------------------- #
@router.get("", response_model=ApiResponse)
async def list_feedback(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List feedback the viewer is allowed to see, with author identity filtered
    per department (§7). Scope: own (officer) / branch (manager) / org (audit, HO)."""
    scope, branch_id = viewer_scope_filter(current_user)

    stmt = select(Feedback)
    if scope == DataScope.OWN.value:
        stmt = stmt.where(Feedback.author_user_id == current_user.id)
    elif scope == DataScope.BRANCH.value:
        # Branch manager: own branch, PLUS anything escalated up-chain to them.
        stmt = stmt.where(
            or_(Feedback.branch_id == branch_id,
                Feedback.visibility_scope == VisibilityScope.ORG.value)
        )
    # scope == org (audit/head_office): no filter — sees everything.
    stmt = stmt.order_by(Feedback.id.desc())

    rows = (await db.execute(stmt)).scalars().all()

    # Resolve author names only for identity-privileged viewers (avoid an extra
    # query when the viewer can't see them anyway).
    name_by_id: dict[int, str] = {}
    if department_can_see_identity(current_user):
        author_ids = {r.author_user_id for r in rows if r.author_user_id}
        if author_ids:
            urows = (await db.execute(select(User.id, User.name).where(User.id.in_(author_ids)))).all()
            name_by_id = {uid: name for uid, name in urows}

    items = [
        serialize_feedback(r, current_user, author_name=name_by_id.get(r.author_user_id))
        for r in rows
    ]
    return ApiResponse(success=True, data={"items": items, "count": len(items)}, timestamp=_ts())


# --------------------------------------------------------------------------- #
# Triage actions (B7)
# --------------------------------------------------------------------------- #
@router.post("/{feedback_id}/ack", response_model=ApiResponse)
async def ack_feedback(
    feedback_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_triage(current_user)
    fb = await _get_or_404(db, feedback_id)
    if fb.status == FeedbackStatus.OPEN.value:
        fb.status = FeedbackStatus.ACK.value
    await _add_event(db, fb, current_user, FeedbackEventAction.ACK.value)
    await db.commit()
    return ApiResponse(success=True, data={"id": fb.id, "status": fb.status}, timestamp=_ts())


@router.post("/{feedback_id}/comment", response_model=ApiResponse)
async def comment_feedback(
    feedback_id: int,
    body: CommentBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_triage(current_user)
    fb = await _get_or_404(db, feedback_id)
    await _add_event(db, fb, current_user, FeedbackEventAction.COMMENTED.value, note=body.note)
    await db.commit()
    return ApiResponse(success=True, data={"id": fb.id}, timestamp=_ts())


@router.post("/{feedback_id}/escalate", response_model=ApiResponse)
async def escalate_feedback(
    feedback_id: int,
    body: CommentBody | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Escalate up the operations chain. Sets visibility=up_chain and routes to the
    escalator's manager (or ORG-wide if there's no parent, e.g. already at HO)."""
    _require_triage(current_user)
    fb = await _get_or_404(db, feedback_id)

    parent_id = getattr(current_user, "manager_id", None)
    if parent_id:
        fb.visibility_scope = VisibilityScope.UP_CHAIN.value
        routed_to = f"user:{parent_id}"
    else:
        # No parent in the chain — surface org-wide (HO/audit will see it).
        fb.visibility_scope = VisibilityScope.ORG.value
        routed_to = "org"
    fb.status = FeedbackStatus.IN_REVIEW.value

    note = body.note if body else None
    await _add_event(db, fb, current_user, FeedbackEventAction.ESCALATED.value,
                     note=note, routed_to=routed_to)
    await write_audit(db, current_user, "feedback.escalate", entity_type="feedback",
                      entity_id=fb.id, meta={"routed_to": routed_to})
    await db.commit()
    return ApiResponse(success=True, data={"id": fb.id, "visibility_scope": fb.visibility_scope,
                                           "routed_to": routed_to}, timestamp=_ts())


# --------------------------------------------------------------------------- #
# Central aggregate (B8) — org-wide, audit / head_office only
# --------------------------------------------------------------------------- #
def _age_days(submitted_at: str | None) -> int | None:
    """Age in days of a nepal-ISO submission stamp, or None if unparseable."""
    if not submitted_at:
        return None
    try:
        dt = datetime.fromisoformat(submitted_at)
        return (now_nepal() - dt).days
    except (ValueError, TypeError):
        return None


@router.get("/aggregate", response_model=ApiResponse)
async def feedback_aggregate(
    current_user: User = Depends(require_department(
        Department.AUDIT.value, Department.HEAD_OFFICE.value,
    )),
    db: AsyncSession = Depends(get_db),
):
    """Org-wide rollup for the feedback-first audience (§3, §B8):
    counts by branch, by category (time-sink highlighted), and by age bucket,
    plus unresolved-by-age. Restricted to audit + head_office departments."""
    rows = (await db.execute(select(Feedback))).scalars().all()

    open_states = {FeedbackStatus.OPEN.value, FeedbackStatus.ACK.value, FeedbackStatus.IN_REVIEW.value}
    by_branch: dict[int | None, int] = {}
    by_category: dict[str, int] = {}
    age_buckets = {"0-2d": 0, "3-7d": 0, "8-30d": 0, "30d+": 0, "unknown": 0}
    unresolved_by_age = {"0-2d": 0, "3-7d": 0, "8-30d": 0, "30d+": 0, "unknown": 0}
    total = len(rows)
    time_sink_count = 0

    for r in rows:
        by_branch[r.branch_id] = by_branch.get(r.branch_id, 0) + 1
        by_category[r.category] = by_category.get(r.category, 0) + 1
        if r.category == FeedbackCategory.TIME_SINK.value:
            time_sink_count += 1

        age = _age_days(r.submitted_at)
        if age is None:
            bucket = "unknown"
        elif age <= 2:
            bucket = "0-2d"
        elif age <= 7:
            bucket = "3-7d"
        elif age <= 30:
            bucket = "8-30d"
        else:
            bucket = "30d+"
        age_buckets[bucket] += 1
        if r.status in open_states:
            unresolved_by_age[bucket] += 1

    data = {
        "total": total,
        "time_sink_count": time_sink_count,   # the headline consolidation signal
        "by_branch": [{"branch_id": k, "count": v} for k, v in sorted(by_branch.items(), key=lambda x: (x[0] is None, x[0]))],
        "by_category": [{"category": k, "count": v} for k, v in sorted(by_category.items(), key=lambda x: -x[1])],
        "by_age": age_buckets,
        "unresolved_by_age": unresolved_by_age,
    }
    return ApiResponse(success=True, data=data, timestamp=_ts())


@router.post("/{feedback_id}/status", response_model=ApiResponse)
async def change_status(
    feedback_id: int,
    body: StatusBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_triage(current_user)
    valid = {s.value for s in FeedbackStatus}
    if body.status not in valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Invalid status. One of: {', '.join(sorted(valid))}")
    fb = await _get_or_404(db, feedback_id)
    fb.status = body.status
    await _add_event(db, fb, current_user, FeedbackEventAction.STATUS_CHANGE.value, note=body.note)
    await db.commit()
    return ApiResponse(success=True, data={"id": fb.id, "status": fb.status}, timestamp=_ts())


# --------------------------------------------------------------------------- #
# Feedback campaigns (B9) — HO asks a question down a level, answers roll up
# --------------------------------------------------------------------------- #
@router.post("/campaigns", response_model=ApiResponse)
async def create_campaign(
    body: CampaignCreate,
    current_user: User = Depends(require_department(Department.HEAD_OFFICE.value)),
    db: AsyncSession = Depends(get_db),
):
    """Head Office pushes a prompt to a role level. This is the clearest demo of
    the feedback-first thesis — a listening tool, not just a ticket box (§3)."""
    camp = FeedbackCampaign(
        created_by_user_id=current_user.id,
        prompt_text=body.prompt_text,
        prompt_ne=body.prompt_ne,
        target_role=body.target_role,
        is_open=True,
        opened_at=now_nepal_iso(),
    )
    db.add(camp)
    await db.flush()
    await write_audit(db, current_user, "feedback.campaign.create", entity_type="feedback_campaign",
                      entity_id=camp.id, meta={"target_role": body.target_role})
    await db.commit()
    return ApiResponse(success=True, data={"id": camp.id, "message": "Campaign opened"}, timestamp=_ts())


@router.get("/campaigns", response_model=ApiResponse)
async def list_campaigns(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Open campaigns relevant to the caller. A user sees a campaign if it's open
    and either untargeted, targeted at their role, OR they created it (so the HO
    author who launches a campaign can still see it and its results)."""
    stmt = select(FeedbackCampaign).where(FeedbackCampaign.is_open == True)  # noqa: E712
    camps = (await db.execute(stmt)).scalars().all()
    items = [
        {
            "id": c.id, "prompt_text": c.prompt_text, "prompt_ne": c.prompt_ne,
            "target_role": c.target_role, "opened_at": c.opened_at,
            "created_by_me": c.created_by_user_id == current_user.id,
        }
        for c in camps
        if c.target_role is None
        or c.target_role == current_user.role
        or c.created_by_user_id == current_user.id
    ]
    return ApiResponse(success=True, data={"items": items, "count": len(items)}, timestamp=_ts())


@router.get("/campaigns/{campaign_id}/results", response_model=ApiResponse)
async def campaign_results(
    campaign_id: int,
    current_user: User = Depends(require_department(
        Department.AUDIT.value, Department.HEAD_OFFICE.value,
    )),
    db: AsyncSession = Depends(get_db),
):
    """Aggregate a campaign's answers by respondent role (§3). Audit/HO only."""
    camp = (await db.execute(
        select(FeedbackCampaign).where(FeedbackCampaign.id == campaign_id)
    )).scalar_one_or_none()
    if camp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")

    answers = (await db.execute(
        select(Feedback).where(Feedback.campaign_id == campaign_id)
    )).scalars().all()

    by_role: dict[str, int] = {}
    for a in answers:
        role = a.author_role or "unknown"
        by_role[role] = by_role.get(role, 0) + 1

    data = {
        "campaign": {"id": camp.id, "prompt_text": camp.prompt_text,
                     "target_role": camp.target_role, "is_open": camp.is_open},
        "total_answers": len(answers),
        "by_role": [{"role": k, "count": v} for k, v in sorted(by_role.items(), key=lambda x: -x[1])],
    }
    return ApiResponse(success=True, data=data, timestamp=_ts())
