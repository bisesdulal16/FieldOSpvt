"""
AI v1 — Rule-Based Intelligence Router (Phase 13)

Pure rule-based scoring — no ML, no autonomous decisions.
AI can SUGGEST. Human ACTS.

4 endpoints:
  1. GET /manager/ai/priority-queue  — Clients sorted by priority score
  2. GET /manager/ai/suggestions     — AI-generated actionable suggestions
  3. GET /manager/ai/eod-summary     — Auto-generated EOD summary per officer
  4. GET /manager/ai/branch-summary  — Branch-wide daily summary

Priority Score Formula:
  overdue_days * 3
  + (promised_today ? 20 : 0)
  + (high_amount >= 50000 ? 10 : 0)
  + (missed_today_visit ? 5 : 0)
  + (npa_risk ? 30 : 0)
  + (missed_ptp ? 25 : 0)

Human-in-the-Loop Rules:
  AI must NEVER:
    - Approve loans
    - Adjust collections
    - Confirm payments
    - Submit compliance reports
    - Discipline staff
"""
import json
import time
import logging
from datetime import date, timedelta, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_

from app.database import get_db
from app.deps.auth_deps import require_manager_or_admin
from app.models.user import User
from app.models.client import Client
from app.models.collection import Collection
from app.models.visit_checkin import VisitCheckin
from app.models.promise_to_pay import PromiseToPay
from app.models.end_of_day import EndOfDayReport
from app.models.sync_event import SyncEvent
from app.models.task import TaskAssignment
from app.models.cbs import CollectionEvent
from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/manager/ai",
    tags=["AI Intelligence v1"],
    dependencies=[Depends(require_manager_or_admin)],
)


def _ts() -> int:
    return int(time.time())


def _today_str() -> str:
    return str(date.today())


# ---------------------------------------------------------------------------
# Priority Score Engine
# ---------------------------------------------------------------------------

def _compute_priority_score(
    overdue_days: int = 0,
    promised_today: bool = False,
    high_amount: float = 0.0,
    missed_visit: bool = False,
    npa_risk: bool = False,
    missed_ptp: bool = False,
) -> dict[str, Any]:
    """
    Rule-based priority score calculation.

    Score formula:
      overdue_days * 3
      + promised_today * 20
      + high_amount >= 50000 ? 10 : 0
      + missed_visit * 5
      + npa_risk * 30
      + missed_ptp * 25
    """
    score = 0
    factors: list[dict[str, Any]] = []

    if overdue_days > 0:
        pts = overdue_days * 3
        score += pts
        factors.append({
            "factor": "overdue_days",
            "label": f"{overdue_days} days overdue",
            "points": pts,
            "severity": "critical" if overdue_days >= 30 else ("high" if overdue_days >= 14 else "medium"),
        })

    if promised_today:
        pts = 20
        score += pts
        factors.append({"factor": "promised_today", "label": "Promise-to-pay due today", "points": pts, "severity": "high"})

    if high_amount >= 50000:
        pts = 10
        score += pts
        factors.append({"factor": "high_amount", "label": f"High outstanding NPR {high_amount:,.0f}", "points": pts, "severity": "medium"})

    if missed_visit:
        pts = 5
        score += pts
        factors.append({"factor": "missed_visit", "label": "Scheduled visit missed today", "points": pts, "severity": "medium"})

    if npa_risk:
        pts = 30
        score += pts
        factors.append({"factor": "npa_risk", "label": "NPA risk — 30+ days overdue", "points": pts, "severity": "critical"})

    if missed_ptp:
        pts = 25
        score += pts
        factors.append({"factor": "missed_ptp", "label": "Previous promise broken/missed", "points": pts, "severity": "high"})

    factors.sort(key=lambda f: f["points"], reverse=True)

    if score >= 50:
        tier = "critical"
    elif score >= 30:
        tier = "high"
    elif score >= 15:
        tier = "medium"
    elif score > 0:
        tier = "low"
    else:
        tier = "normal"

    return {"score": score, "tier": tier, "factors": factors}


def _generate_client_suggestion(
    client: Client,
    priority: dict,
    promised_today: bool,
    missed_visit: bool,
    npa_risk: bool,
    missed_ptp: bool,
) -> str:
    """Generate a human-readable suggestion for a specific client."""
    suggestions = []

    if npa_risk:
        suggestions.append(f"URGENT: {client.name} is at NPA risk with {client.overdue_days} days overdue. Immediate escalation recommended.")
    if missed_ptp:
        suggestions.append(f"Previous payment promise was broken. Consider in-person follow-up and restructuring for {client.name}.")
    if promised_today:
        suggestions.append(f"Payment promise due today (NPR {client.due_amount:,.0f}). Confirm collection by EOD.")
    if missed_visit:
        suggestions.append("Scheduled visit was not completed today. Check with assigned officer.")
    if (client.overdue_days or 0) >= 14 and not npa_risk:
        suggestions.append(f"Overdue {client.overdue_days} days (NPR {client.outstanding_balance:,.0f}). Schedule follow-up and consider PTP.")
    if (client.outstanding_balance or 0) >= 50000:
        suggestions.append(f"High outstanding balance NPR {client.outstanding_balance:,.0f}. Monitor repayment capacity.")

    if not suggestions:
        if (client.overdue_days or 0) > 0:
            suggestions.append(f"Mildly overdue ({client.overdue_days}d). Routine follow-up sufficient.")
        else:
            suggestions.append("On track — no immediate action needed.")

    return " | ".join(suggestions)


# ---------------------------------------------------------------------------
# 1. GET /manager/ai/priority-queue
# ---------------------------------------------------------------------------

@router.get("/priority-queue", response_model=ApiResponse)
async def get_priority_queue(
    limit: int = Query(100, ge=1, le=500),
    officer_id: int | None = Query(None, description="Filter by assigned officer ID"),
    db: AsyncSession = Depends(get_db),
):
    """Returns clients sorted by AI priority score (highest first). Optionally filtered by officer."""
    try:
        today = _today_str()

        # Batch: All active clients
        all_clients = (await db.execute(
            select(Client).where(Client.status == "active")
        )).scalars().all()

        # Batch: PTP due today
        ptp_today = (await db.execute(
            select(PromiseToPay.client_id).where(PromiseToPay.expected_payment_date == today)
        )).scalars().all()
        ptp_today_set = set(ptp_today)

        # Batch: Missed PTP
        missed_ptp = (await db.execute(
            select(PromiseToPay.client_id).where(
                and_(PromiseToPay.expected_payment_date < today, PromiseToPay.status != "fulfilled")
            )
        )).scalars().all()
        missed_ptp_set = set(missed_ptp)

        # Batch: Today's visited client IDs
        visited = (await db.execute(
            select(VisitCheckin.client_id).where(VisitCheckin.checked_in_at.like(f"{today}%"))
        )).scalars().all()
        visited_set = set(visited)

        # Batch: Pending (uncompleted) tasks today
        pending_tasks = (await db.execute(
            select(TaskAssignment).where(
                and_(TaskAssignment.task_date == today, TaskAssignment.is_completed == False)  # noqa: E712
            )
        )).scalars().all()
        pending_task_clients = {t.client_id for t in pending_tasks}

        # Batch: Latest task per client (officer assignment)
        latest_tasks = (await db.execute(
            select(TaskAssignment.client_id, TaskAssignment.user_id)
            .distinct(TaskAssignment.client_id)
            .order_by(TaskAssignment.client_id, TaskAssignment.created_at.desc())
        )).all()
        task_officer_map: dict[int, int] = {r[0]: r[1] for r in latest_tasks}

        # Batch: Officer names
        officers = (await db.execute(
            select(User.id, User.name).where(User.role == "field_officer")
        )).all()
        officer_map = {o[0]: o[1] for o in officers}

        # Save the param before loop (it gets shadowed)
        _filter_officer_id = officer_id

        # Compute all priority scores in-memory (no more DB queries)
        priority_queue = []
        for client in all_clients:
            client_officer_id = task_officer_map.get(client.id)
            officer_name = officer_map.get(client_officer_id) if client_officer_id else None
            missed_visit = client.id in pending_task_clients and client.id not in visited_set

            priority = _compute_priority_score(
                overdue_days=client.overdue_days or 0,
                promised_today=client.id in ptp_today_set,
                high_amount=client.outstanding_balance or 0,
                missed_visit=missed_visit,
                npa_risk=(client.overdue_days or 0) >= 30,
                missed_ptp=client.id in missed_ptp_set,
            )

            priority_queue.append({
                "client_id": client.id,
                "member_id": client.member_id,
                "client_name": client.name,
                "center_name": client.center_name,
                "assigned_officer": officer_name,
                "officer_id": client_officer_id,
                "overdue_days": client.overdue_days or 0,
                "due_amount_npr": round(client.due_amount or 0, 2),
                "outstanding_npr": round(client.outstanding_balance or 0, 2),
                "status": client.status,
                "promised_today": client.id in ptp_today_set,
                "missed_visit": missed_visit,
                "npa_risk": (client.overdue_days or 0) >= 30,
                "missed_ptp": client.id in missed_ptp_set,
                "priority_score": priority["score"],
                "priority_tier": priority["tier"],
                "priority_factors": priority["factors"],
                "suggestion": _generate_client_suggestion(
                    client, priority, client.id in ptp_today_set,
                    missed_visit, (client.overdue_days or 0) >= 30,
                    client.id in missed_ptp_set,
                ),
            })

        # Filter by officer if requested
        if _filter_officer_id:
            priority_queue = [p for p in priority_queue if p.get("officer_id") == _filter_officer_id]

        priority_queue.sort(key=lambda x: x["priority_score"], reverse=True)

        tier_counts: dict[str, int] = {}
        for item in priority_queue:
            tier_counts[item["priority_tier"]] = tier_counts.get(item["priority_tier"], 0) + 1

        return ApiResponse(success=True, data={
            "total_clients": len(priority_queue),
            "tier_counts": tier_counts,
            "queue": priority_queue[:limit],
        }, timestamp=_ts())
    except Exception as e:
        logger.error(f"Priority queue error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to compute priority queue")


# ---------------------------------------------------------------------------
# 2. GET /manager/ai/suggestions
# ---------------------------------------------------------------------------

@router.get("/suggestions", response_model=ApiResponse)
async def get_suggestions(
    category: str | None = Query(None, description="Filter: overdue, ptp, par, missing_data, all"),
    officer_id: int | None = Query(None, description="Filter by assigned officer ID"),
    db: AsyncSession = Depends(get_db),
):
    """Returns AI-generated suggestions grouped by category with transparent reasoning."""
    try:
        today = _today_str()
        suggestions: list[dict[str, Any]] = []
        sid = 0

        # ── Pre-load all needed data in batch ──
        # Overdue clients (> 7 days)
        overdue_clients = (await db.execute(
            select(Client).where(and_(Client.overdue_days > 7, Client.status == "active"))
            .order_by(Client.overdue_days.desc())
        )).scalars().all()

        # Recently visited client IDs (last 3 days)
        three_days_ago = str(date.today() - timedelta(days=3))
        recently_visited = set((await db.execute(
            select(VisitCheckin.client_id).where(VisitCheckin.checked_in_at >= three_days_ago)
        )).scalars().all())

        # PTP due today (pending)
        ptp_due_today = (await db.execute(
            select(PromiseToPay, Client.name, Client.member_id, Client.center_name)
            .outerjoin(Client, PromiseToPay.client_id == Client.id)
            .where(and_(PromiseToPay.expected_payment_date == today, PromiseToPay.status == "pending"))
        )).all()

        # Missed PTP (broken or still pending past due)
        missed_ptps = (await db.execute(
            select(PromiseToPay, Client.name, Client.member_id, Client.center_name, Client.overdue_days)
            .outerjoin(Client, PromiseToPay.client_id == Client.id)
            .where(and_(
                PromiseToPay.expected_payment_date < today,
                or_(PromiseToPay.status == "broken", PromiseToPay.status == "pending"),
            ))
            .order_by(PromiseToPay.expected_payment_date)
        )).all()

        # PAR warning (21-29 days)
        par_warning = (await db.execute(
            select(Client).where(and_(Client.overdue_days >= 21, Client.overdue_days < 30, Client.status == "active"))
            .order_by(Client.overdue_days.desc())
        )).scalars().all()

        # NPA clients (30+ days)
        npa_clients = (await db.execute(
            select(Client).where(and_(Client.overdue_days >= 30, Client.status == "active"))
            .order_by(Client.overdue_days.desc())
        )).scalars().all()

        # Pending tasks today (for missed visit detection)
        pending_task_client_ids = set((await db.execute(
            select(TaskAssignment.client_id).where(
                and_(TaskAssignment.task_date == today, TaskAssignment.is_completed == False)  # noqa: E712
            )
        )).scalars().all())

        # Visited today
        visited_today = set((await db.execute(
            select(VisitCheckin.client_id).where(VisitCheckin.checked_in_at.like(f"{today}%"))
        )).scalars().all())

        # High-value unverified collections today
        unverified_collections = (await db.execute(
            select(Collection, Client.name, Client.member_id)
            .outerjoin(Client, Collection.client_id == Client.id)
            .where(and_(
                Collection.is_high_value == True,  # noqa: E712
                Collection.cbs_verified == False,  # noqa: E712
                Collection.collected_at.like(f"{today}%"),
            ))
        )).all()

        # ── OVERDUE SUGGESTIONS ──
        if not category or category in ("overdue", "all"):
            for client in overdue_clients:
                if client.id not in recently_visited:
                    sid += 1
                    urgency = "critical" if client.overdue_days >= 21 else "high"
                    suggestions.append({
                        "id": sid, "category": "overdue", "urgency": urgency,
                        "title": f"{client.name} — {client.overdue_days} days overdue",
                        "description": (
                            f"{client.name} ({client.member_id}) is {client.overdue_days} days overdue "
                            f"with NPR {client.outstanding_balance:,.0f} outstanding. No visit in 3 days."
                        ),
                        "client_id": client.id, "member_id": client.member_id,
                        "client_name": client.name, "center_name": client.center_name,
                        "due_amount_npr": round(client.due_amount or 0, 2),
                        "outstanding_npr": round(client.outstanding_balance or 0, 2),
                        "action": "schedule_visit", "ai_rule": "overdue_no_recent_visit", "can_auto_act": False,
                    })

        # ── PTP SUGGESTIONS ──
        if not category or category in ("ptp", "all"):
            for ptp, cname, mid, center in ptp_due_today:
                sid += 1
                suggestions.append({
                    "id": sid, "category": "ptp", "urgency": "high",
                    "title": f"PTP due today — {cname or 'Unknown'} (NPR {ptp.promised_amount:,.0f})",
                    "description": f"Payment promise of NPR {ptp.promised_amount:,.0f} from {cname or 'Unknown'} ({mid or '?'}) is due today.",
                    "client_id": ptp.client_id, "member_id": mid,
                    "client_name": cname, "center_name": center,
                    "promised_amount_npr": round(ptp.promised_amount, 2),
                    "action": "confirm_collection", "ai_rule": "ptp_due_today", "can_auto_act": False,
                })

            for ptp, cname, mid, center, od in missed_ptps:
                sid += 1
                days_missed = (date.today() - date.fromisoformat(ptp.expected_payment_date)).days
                suggestions.append({
                    "id": sid, "category": "ptp",
                    "urgency": "critical" if days_missed >= 7 else "high",
                    "title": f"Missed PTP — {cname or 'Unknown'} ({days_missed}d ago)",
                    "description": f"PTP NPR {ptp.promised_amount:,.0f} from {cname or 'Unknown'} was due {days_missed}d ago. {od or 0}d overdue.",
                    "client_id": ptp.client_id, "member_id": mid,
                    "client_name": cname, "center_name": center,
                    "promised_amount_npr": round(ptp.promised_amount, 2),
                    "days_missed": days_missed, "action": "escalate_followup",
                    "ai_rule": "ptp_missed", "can_auto_act": False,
                })

        # ── PAR THRESHOLD ALERTS ──
        if not category or category in ("par", "all"):
            for client in par_warning:
                sid += 1
                days_to_npa = 30 - client.overdue_days
                suggestions.append({
                    "id": sid, "category": "par", "urgency": "critical",
                    "title": f"NPA threshold — {client.name} ({days_to_npa}d to NPA)",
                    "description": (
                        f"{client.name} ({client.member_id}) is {client.overdue_days}d overdue — "
                        f"{days_to_npa} days until NPA. Outstanding: NPR {client.outstanding_balance:,.0f}."
                    ),
                    "client_id": client.id, "member_id": client.member_id,
                    "client_name": client.name, "center_name": client.center_name,
                    "outstanding_npr": round(client.outstanding_balance or 0, 2),
                    "days_to_npa": days_to_npa, "action": "urgent_intervention",
                    "ai_rule": "par_threshold_warning", "can_auto_act": False,
                })

            for client in npa_clients:
                sid += 1
                suggestions.append({
                    "id": sid, "category": "par", "urgency": "critical",
                    "title": f"NPA classified — {client.name} ({client.overdue_days}d overdue)",
                    "description": (
                        f"{client.name} ({client.member_id}) crossed NPA threshold ({client.overdue_days}d). "
                        f"Outstanding: NPR {client.outstanding_balance:,.0f}. Recovery action required."
                    ),
                    "client_id": client.id, "member_id": client.member_id,
                    "client_name": client.name, "center_name": client.center_name,
                    "outstanding_npr": round(client.outstanding_balance or 0, 2),
                    "action": "npa_recovery", "ai_rule": "npa_classified", "can_auto_act": False,
                })

        # ── MISSING DATA ALERTS ──
        if not category or category in ("missing_data", "all"):
            missed_visit_clients = pending_task_client_ids - visited_today
            if missed_visit_clients:
                # Get client details in batch
                missed_client_details = (await db.execute(
                    select(Client).where(Client.id.in_(missed_visit_clients))
                )).scalars().all()
                for client in missed_client_details:
                    sid += 1
                    suggestions.append({
                        "id": sid, "category": "missing_data", "urgency": "medium",
                        "title": f"Missed visit — {client.name}",
                        "description": f"{client.name} ({client.member_id}) has a task but no visit check-in. Due: NPR {client.due_amount or 0:,.0f}.",
                        "client_id": client.id, "member_id": client.member_id,
                        "client_name": client.name, "center_name": client.center_name,
                        "action": "check_officer_status", "ai_rule": "missed_visit_today",
                        "can_auto_act": False,
                    })

            for coll, cname, mid in unverified_collections:
                sid += 1
                suggestions.append({
                    "id": sid, "category": "missing_data", "urgency": "high",
                    "title": f"Unverified high-value — {cname or 'Unknown'} (NPR {coll.amount:,.0f})",
                    "description": f"High-value collection NPR {coll.amount:,.0f} from {cname or 'Unknown'} not CBS verified. Receipt: {coll.receipt_id}.",
                    "client_id": coll.client_id, "member_id": mid,
                    "client_name": cname, "receipt_id": coll.receipt_id,
                    "amount_npr": round(coll.amount, 2),
                    "action": "verify_collection", "ai_rule": "high_value_unverified",
                    "can_auto_act": False,
                })

        # Sort by urgency
        urgency_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        suggestions.sort(key=lambda s: urgency_order.get(s["urgency"], 99))

        # Filter by officer if requested — only keep suggestions for clients assigned to this officer
        if officer_id:
            officer_client_ids = set(
                r[0] for r in (await db.execute(
                    select(TaskAssignment.client_id)
                    .where(TaskAssignment.user_id == officer_id)
                    .distinct(TaskAssignment.client_id)
                )).all()
            )
            suggestions = [s for s in suggestions if s.get("client_id") in officer_client_ids]

        cat_counts: dict[str, int] = {}
        urg_counts: dict[str, int] = {}
        for s in suggestions:
            cat_counts[s["category"]] = cat_counts.get(s["category"], 0) + 1
            urg_counts[s["urgency"]] = urg_counts.get(s["urgency"], 0) + 1

        return ApiResponse(success=True, data={
            "total_suggestions": len(suggestions),
            "category_counts": cat_counts,
            "urgency_counts": urg_counts,
            "suggestions": suggestions,
            "disclaimer": "Rule-based recommendations only. AI cannot approve loans, adjust collections, confirm payments, or discipline staff.",
        }, timestamp=_ts())
    except Exception as e:
        logger.error(f"Suggestions error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate suggestions")


# ---------------------------------------------------------------------------
# 3. GET /manager/ai/eod-summary
# ---------------------------------------------------------------------------

def _generate_officer_narrative(
    name: str, visits: int, tasks: int, coll_count: int, coll_total: float,
    ptp_fulfilled: int, overdue: int, eod_submitted: bool, completion: float,
) -> str:
    parts = []
    if tasks > 0:
        if completion >= 80:
            parts.append(f"{name}: {visits}/{tasks} visits ({completion}%) — on track.")
        elif completion >= 50:
            parts.append(f"{name}: {visits}/{tasks} visits ({completion}%) — follow-up needed.")
        else:
            parts.append(f"{name}: only {visits}/{tasks} visits ({completion}%) — manager follow-up recommended.")
    else:
        parts.append(f"{name}: no tasks today.")

    if coll_count > 0:
        parts.append(f"Collected NPR {coll_total:,.0f} ({coll_count} txns).")
    else:
        parts.append("No collections today.")

    if ptp_fulfilled > 0:
        parts.append(f"{ptp_fulfilled} PTP fulfilled.")
    if overdue > 0:
        parts.append(f"{overdue} overdue client(s).")
    parts.append("EOD submitted." if eod_submitted else "EOD NOT submitted — pending.")

    return " ".join(parts)


@router.get("/eod-summary", response_model=ApiResponse)
async def get_eod_summary(
    officer_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Auto-generated EOD summary per officer from actual events."""
    try:
        today = _today_str()

        officers = (await db.execute(
            select(User).where(and_(User.is_active == True, User.role == "field_officer"))  # noqa: E712
        )).scalars().all()

        if officer_id:
            officers = [o for o in officers if o.id == officer_id]

        summaries = []
        for officer in officers:
            # Collections
            coll_row = (await db.execute(
                select(
                    func.count().label("cnt"),
                    func.coalesce(func.sum(Collection.amount), 0).label("total"),
                )
                .select_from(Collection)
                .join(TaskAssignment, Collection.task_id == TaskAssignment.id)
                .where(and_(TaskAssignment.user_id == officer.id, Collection.collected_at.like(f"{today}%")))
            )).one()

            # Visits
            visit_count = (await db.execute(
                select(func.count()).select_from(VisitCheckin)
                .join(TaskAssignment, VisitCheckin.task_id == TaskAssignment.id)
                .where(and_(TaskAssignment.user_id == officer.id, VisitCheckin.checked_in_at.like(f"{today}%")))
            )).scalar() or 0

            # Tasks
            task_total = (await db.execute(
                select(func.count()).select_from(TaskAssignment)
                .where(and_(TaskAssignment.user_id == officer.id, TaskAssignment.task_date == today))
            )).scalar() or 0

            # PTP fulfilled
            ptp_fulfilled = (await db.execute(
                select(func.count()).select_from(PromiseToPay)
                .join(TaskAssignment, PromiseToPay.task_id == TaskAssignment.id)
                .where(and_(TaskAssignment.user_id == officer.id, PromiseToPay.expected_payment_date == today, PromiseToPay.status == "fulfilled"))
            )).scalar() or 0

            # EOD status
            eod = (await db.execute(
                select(EndOfDayReport).where(and_(EndOfDayReport.officer_id == officer.id, EndOfDayReport.report_date == today))
            )).scalar_one_or_none()

            # Overdue clients
            overdue = (await db.execute(
                select(func.count()).select_from(Client)
                .join(TaskAssignment, TaskAssignment.client_id == Client.id)
                .where(and_(TaskAssignment.user_id == officer.id, Client.overdue_days > 0, Client.status == "active"))
            )).scalar() or 0

            completion = round(visit_count / task_total * 100, 1) if task_total > 0 else 0.0
            coll_count = coll_row.cnt or 0
            coll_total = round(coll_row.total, 2)

            alerts: list[dict] = []
            if task_total > 0 and completion < 50:
                alerts.append({"type": "low_completion", "message": f"Visit rate {completion}% — below 50%"})
            if not eod or not eod.is_submitted:
                alerts.append({"type": "eod_pending", "message": "EOD report not submitted"})
            if eod and eod.exceptions_json:
                try:
                    exc = json.loads(eod.exceptions_json)
                    if exc:
                        alerts.append({"type": "eod_exceptions", "message": f"{len(exc)} exception(s)"})
                except (json.JSONDecodeError, TypeError):
                    pass
            if overdue > 3:
                alerts.append({"type": "high_overdue", "message": f"{overdue} overdue clients"})

            summaries.append({
                "officer_id": officer.id, "staff_id": officer.staff_id, "officer_name": officer.name,
                "date": today, "tasks_total": task_total, "visits_completed": visit_count,
                "completion_rate": completion, "collections_count": coll_count,
                "collections_npr": coll_total, "ptp_fulfilled": ptp_fulfilled,
                "overdue_clients": overdue,
                "eod_submitted": eod.is_submitted if eod else False,
                "eod_confirmed": eod.is_confirmed if eod else False,
                "narrative": _generate_officer_narrative(
                    officer.name, visit_count, task_total, coll_count, coll_total,
                    ptp_fulfilled, overdue, eod.is_submitted if eod else False, completion,
                ),
                "alerts": alerts,
            })

        summaries.sort(key=lambda s: s["completion_rate"])

        return ApiResponse(success=True, data={
            "date": today,
            "total_officers": len(summaries),
            "officers_started": sum(1 for s in summaries if s["visits_completed"] > 0 or s["collections_count"] > 0),
            "eod_submitted": sum(1 for s in summaries if s["eod_submitted"]),
            "officers_with_alerts": sum(1 for s in summaries if s["alerts"]),
            "summaries": summaries,
        }, timestamp=_ts())
    except Exception as e:
        logger.error(f"EOD summary error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate EOD summary")


# ---------------------------------------------------------------------------
# 4. GET /manager/ai/branch-summary
# ---------------------------------------------------------------------------

@router.get("/branch-summary", response_model=ApiResponse)
async def get_branch_summary(db: AsyncSession = Depends(get_db)):
    """Branch-wide daily summary with AI-generated narrative and key actions."""
    try:
        today = _today_str()

        # All counts in single queries
        total_staff = (await db.execute(
            select(func.count()).select_from(User)
            .where(and_(User.is_active == True, User.role == "field_officer"))  # noqa: E712
        )).scalar() or 0

        coll_row = (await db.execute(
            select(func.count(), func.coalesce(func.sum(Collection.amount), 0))
            .select_from(Collection).where(Collection.collected_at.like(f"{today}%"))
        )).one()

        total_visits = (await db.execute(
            select(func.count()).select_from(VisitCheckin)
            .where(VisitCheckin.checked_in_at.like(f"{today}%"))
        )).scalar() or 0

        total_tasks = (await db.execute(
            select(func.count()).select_from(TaskAssignment).where(TaskAssignment.task_date == today)
        )).scalar() or 0

        completed_tasks = (await db.execute(
            select(func.count()).select_from(TaskAssignment)
            .where(and_(TaskAssignment.task_date == today, TaskAssignment.is_completed == True))  # noqa: E712
        )).scalar() or 0

        overdue_clients = (await db.execute(
            select(func.count()).select_from(Client)
            .where(and_(Client.overdue_days > 0, Client.status == "active"))
        )).scalar() or 0

        npa_clients = (await db.execute(
            select(func.count()).select_from(Client).where(Client.overdue_days >= 30)
        )).scalar() or 0

        ptp_due_today = (await db.execute(
            select(func.count()).select_from(PromiseToPay).where(PromiseToPay.expected_payment_date == today)
        )).scalar() or 0

        ptp_fulfilled = (await db.execute(
            select(func.count()).select_from(PromiseToPay)
            .where(and_(PromiseToPay.expected_payment_date == today, PromiseToPay.status == "fulfilled"))
        )).scalar() or 0

        eod_submitted = (await db.execute(
            select(func.count()).select_from(EndOfDayReport)
            .where(and_(EndOfDayReport.report_date == today, EndOfDayReport.is_submitted == True))  # noqa: E712
        )).scalar() or 0

        pending_sync = (await db.execute(
            select(func.count()).select_from(SyncEvent).where(SyncEvent.status == "pending")
        )).scalar() or 0

        hv_unverified = (await db.execute(
            select(func.count()).select_from(Collection)
            .where(and_(Collection.is_high_value == True, Collection.cbs_verified == False))  # noqa: E712
        )).scalar() or 0

        eod_exc = (await db.execute(
            select(func.count()).select_from(EndOfDayReport)
            .where(EndOfDayReport.exceptions_json.isnot(None))
        )).scalar() or 0

        recon_pending = (await db.execute(
            select(func.count()).select_from(CollectionEvent).where(CollectionEvent.event_status == "pending_review")
        )).scalar() or 0

        exceptions_count = hv_unverified + eod_exc + npa_clients
        completion = round(completed_tasks / total_tasks * 100, 1) if total_tasks > 0 else 0.0
        coll_count = coll_row[0] or 0
        coll_total = round(coll_row[1], 2)

        # Narrative
        parts = []
        if completion >= 80:
            parts.append(f"Branch performing well — {completion}% visit completion ({completed_tasks}/{total_tasks}).")
        elif completion >= 50:
            parts.append(f"Branch at {completion}% completion — {total_tasks - completed_tasks} remaining.")
        else:
            parts.append(f"Low completion rate {completion}% — only {completed_tasks}/{total_tasks} done. Manager attention needed.")

        parts.append(f"Collections: NPR {coll_total:,.0f} ({coll_count} txns).")

        if npa_clients > 0:
            parts.append(f"ALERT: {npa_clients} client(s) past NPA threshold.")
        elif overdue_clients > 0:
            parts.append(f"{overdue_clients} overdue client(s).")
        if ptp_due_today > 0:
            parts.append(f"{ptp_due_today} PTP due today, {ptp_fulfilled} fulfilled.")
        if eod_submitted < total_staff:
            parts.append(f"{total_staff - eod_submitted} officer(s) missing EOD.")
        if exceptions_count > 0:
            parts.append(f"{exceptions_count} exception(s) open.")

        # Key actions
        actions: list[dict[str, str]] = []
        if npa_clients > 0:
            actions.append({"priority": "critical", "action": f"Review {npa_clients} NPA-risk client(s)"})
        if overdue_clients > 5:
            actions.append({"priority": "high", "action": f"Follow up {overdue_clients} overdue clients"})
        if eod_submitted < total_staff:
            actions.append({"priority": "medium", "action": f"Remind {total_staff - eod_submitted} officer(s) for EOD"})
        if ptp_due_today - ptp_fulfilled > 0:
            actions.append({"priority": "high", "action": f"Confirm {ptp_due_today - ptp_fulfilled} pending PTP(s)"})
        if recon_pending > 0:
            actions.append({"priority": "medium", "action": f"Review {recon_pending} reconciliation event(s)"})
        if exceptions_count > 0:
            actions.append({"priority": "high", "action": f"Address {exceptions_count} exception(s)"})
        if completion < 50:
            actions.append({"priority": "high", "action": "Investigate low visit completion"})

        po = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        actions.sort(key=lambda a: po.get(a["priority"], 99))

        return ApiResponse(success=True, data={
            "date": today, "branch_name": "Kathmandu Main Branch",
            "metrics": {
                "total_staff": total_staff, "total_tasks": total_tasks,
                "completed_tasks": completed_tasks, "completion_rate": completion,
                "total_visits": total_visits, "total_collections": coll_count,
                "total_collections_npr": coll_total, "overdue_clients": overdue_clients,
                "npa_clients": npa_clients, "ptp_due_today": ptp_due_today,
                "ptp_fulfilled_today": ptp_fulfilled, "eod_submitted": eod_submitted,
                "eod_pending": total_staff - eod_submitted, "pending_sync": pending_sync,
                "exceptions_count": exceptions_count, "recon_pending": recon_pending,
            },
            "narrative": " ".join(parts),
            "key_actions": actions,
            "disclaimer": "Auto-generated from field data using rule-based analysis. AI suggests only — humans decide.",
        }, timestamp=_ts())
    except Exception as e:
        logger.error(f"Branch summary error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate branch summary")
