"""
Pilot Management Router — Phase 16 Pilot Preparation Backend

19 endpoints covering:
  - Pilot status dashboard (overview)
  - Branch readiness checklists
  - Training progress tracking
  - Real-time success metrics
  - Feedback form schema + submission
  - Escalation tracker (CRUD)
  - Pilot agreement management
  - 9 rich document endpoints with full professional content
"""
import time
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.database import get_db
from app.models.user import User
from app.schemas.common import ApiResponse
from app.deps.auth_deps import require_manager_or_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pilot", tags=["Pilot Management"])


def _ts() -> int:
    return int(time.time())


# ═══════════════════════════════════════════════════════════════════════════════
# IN-MEMORY STORES (for feedback, escalations, agreements)
# ═══════════════════════════════════════════════════════════════════════════════

_feedback_store: list[dict] = [
    {
        "id": 1,
        "respondent_role": "field_officer",
        "branch": "KTM Main",
        "submitted_at": "2025-05-22T10:30:00Z",
        "answers": {"q1": 4, "q2": 5, "q3": 4, "q4": 3, "q5": 5, "q6": "Easy to record collections on the go", "q7": "Offline sync can be slow sometimes", "q8": "None so far", "q9": "Definitely"},
    },
    {
        "id": 2,
        "respondent_role": "field_officer",
        "branch": "Pokhara",
        "submitted_at": "2025-05-22T14:15:00Z",
        "answers": {"q1": 5, "q2": 4, "q3": 5, "q4": 4, "q5": 4, "q6": "Check-in feature is great", "q7": "Need Nepali voice support", "q8": "App crashed once during sync", "q9": "Definitely"},
    },
    {
        "id": 3,
        "respondent_role": "branch_manager",
        "branch": "KTM Main",
        "submitted_at": "2025-05-23T09:00:00Z",
        "answers": {"q1": 4, "q2": 3, "q3": 4, "q4": 4, "q5": 4, "q6": "Dashboard gives real-time visibility", "q7": "Need more filter options in reports", "q8": "None", "q9": "Probably"},
    },
    {
        "id": 4,
        "respondent_role": "field_officer",
        "branch": "Lalitpur",
        "submitted_at": "2025-05-23T11:45:00Z",
        "answers": {"q1": 3, "q2": 4, "q3": 3, "q4": 2, "q5": 4, "q6": "Good for daily tracking", "q7": "Offline sync fails often in my area", "q8": "GPS sometimes inaccurate", "q9": "Probably"},
    },
    {
        "id": 5,
        "respondent_role": "field_officer",
        "branch": "Bhaktapur",
        "submitted_at": "2025-05-23T16:20:00Z",
        "answers": {"q1": 4, "q2": 4, "q3": 4, "q4": 3, "q5": 5, "q6": "Training was very helpful", "q7": "Small screen makes it hard to read", "q8": "None", "q9": "Definitely"},
    },
    {
        "id": 6,
        "respondent_role": "branch_manager",
        "branch": "Pokhara",
        "submitted_at": "2025-05-24T08:30:00Z",
        "answers": {"q1": 4, "q2": 4, "q3": 4, "q4": 3, "q5": 5, "q6": "Reduces phone calls from field", "q7": "Want export to Excel feature", "q8": "None", "q9": "Definitely"},
    },
    {
        "id": 7,
        "respondent_role": "field_officer",
        "branch": "KTM Main",
        "submitted_at": "2025-05-24T13:10:00Z",
        "answers": {"q1": 5, "q2": 5, "q3": 5, "q4": 4, "q5": 5, "q6": "Love the Nepali language support", "q7": "Nothing major", "q8": "None", "q9": "Definitely"},
    },
    {
        "id": 8,
        "respondent_role": "field_officer",
        "branch": "Lalitpur",
        "submitted_at": "2025-05-24T17:00:00Z",
        "answers": {"q1": 4, "q2": 4, "q3": 3, "q4": 4, "q5": 4, "q6": "Center meeting tracking is useful", "q7": "Battery drains faster", "q8": "App froze during EOD submission", "q9": "Probably"},
    },
]

_escalation_store: list[dict] = [
    {
        "id": 1, "title": "Device not syncing after update", "severity": "high",
        "branch": "Pokhara", "reported_by": "FO-305", "status": "resolved",
        "created_at": "2025-05-20T09:30:00Z", "assigned_to": "IT Support",
        "resolution": "Cleared app cache and re-authenticated. Sync resumed normally.",
        "resolved_at": "2025-05-20T11:15:00Z",
    },
    {
        "id": 2, "title": "GPS check-in showing wrong location", "severity": "medium",
        "branch": "Lalitpur", "reported_by": "FO-312", "status": "resolved",
        "created_at": "2025-05-20T14:00:00Z", "assigned_to": "IT Support",
        "resolution": "GPS accuracy improved after enabling high-accuracy mode in device settings.",
        "resolved_at": "2025-05-20T15:30:00Z",
    },
    {
        "id": 3, "title": "Collection amount not posting to CBS", "severity": "high",
        "branch": "KTM Main", "reported_by": "FO-208", "status": "resolved",
        "created_at": "2025-05-21T10:00:00Z", "assigned_to": "CBS Team",
        "resolution": "CBS posting queue was paused. Resumed manually and re-posted 3 pending events.",
        "resolved_at": "2025-05-21T12:45:00Z",
    },
    {
        "id": 4, "title": "Nepali font rendering issue on older devices", "severity": "medium",
        "branch": "Bhaktapur", "reported_by": "FO-318", "status": "in_progress",
        "created_at": "2025-05-21T11:30:00Z", "assigned_to": "Dev Team",
        "resolution": None,
    },
    {
        "id": 5, "title": "App crashes during center meeting", "severity": "high",
        "branch": "Pokhara", "reported_by": "FO-322", "status": "in_progress",
        "created_at": "2025-05-22T09:15:00Z", "assigned_to": "Dev Team",
        "resolution": None,
    },
    {
        "id": 6, "title": "PIN reset not working for blocked accounts", "severity": "medium",
        "branch": "KTM Main", "reported_by": "BM-101", "status": "open",
        "created_at": "2025-05-22T14:00:00Z", "assigned_to": "IT Support",
        "resolution": None,
    },
    {
        "id": 7, "title": "Offline data lost after battery drain", "severity": "high",
        "branch": "Lalitpur", "reported_by": "FO-315", "status": "open",
        "created_at": "2025-05-22T16:30:00Z", "assigned_to": "Dev Team",
        "resolution": None,
    },
    {
        "id": 8, "title": "Duplicate client records after sync", "severity": "medium",
        "branch": "KTM Main", "reported_by": "BM-101", "status": "resolved",
        "created_at": "2025-05-19T08:00:00Z", "assigned_to": "Dev Team",
        "resolution": "Added unique constraint on member_id + branch_id. Merged 2 duplicate records.",
        "resolved_at": "2025-05-19T16:00:00Z",
    },
    {
        "id": 9, "title": "Slow app performance on low-end devices", "severity": "low",
        "branch": "Bhaktapur", "reported_by": "FO-319", "status": "open",
        "created_at": "2025-05-23T10:00:00Z", "assigned_to": "Dev Team",
        "resolution": None,
    },
    {
        "id": 10, "title": "EOD report not showing all collections", "severity": "medium",
        "branch": "Pokhara", "reported_by": "BM-103", "status": "in_progress",
        "created_at": "2025-05-23T15:00:00Z", "assigned_to": "Dev Team",
        "resolution": None,
    },
    {
        "id": 11, "title": "Biometric login fails on some devices", "severity": "medium",
        "branch": "KTM Main", "reported_by": "FO-210", "status": "resolved",
        "created_at": "2025-05-18T09:00:00Z", "assigned_to": "IT Support",
        "resolution": "Fingerprint sensor needed recalibration. Guided user through device settings.",
        "resolved_at": "2025-05-18T10:30:00Z",
    },
    {
        "id": 12, "title": "Notification not received for overdue tasks", "severity": "low",
        "branch": "Lalitpur", "reported_by": "FO-314", "status": "resolved",
        "created_at": "2025-05-17T11:00:00Z", "assigned_to": "IT Support",
        "resolution": "Push notification permissions were disabled. Re-enabled in app settings.",
        "resolved_at": "2025-05-17T11:30:00Z",
    },
    {
        "id": 13, "title": "Receipt format not matching CBS format", "severity": "medium",
        "branch": "KTM Main", "reported_by": "BM-101", "status": "resolved",
        "created_at": "2025-05-16T14:00:00Z", "assigned_to": "CBS Team",
        "resolution": "Updated receipt template to match CBS receipt format. Deployed in v1.2.1.",
        "resolved_at": "2025-05-17T18:00:00Z",
    },
]

_agreement_store: dict[int, dict] = {
    1: {"branch_id": 1, "signed": True, "signed_by": "Suman Sharma", "signed_at": "2025-05-15T10:00:00Z", "document_version": "1.0"},
    2: {"branch_id": 2, "signed": True, "signed_by": "Anita Gurung", "signed_at": "2025-05-16T14:30:00Z", "document_version": "1.0"},
    3: {"branch_id": 3, "signed": False, "signed_by": None, "signed_at": None, "document_version": "1.0"},
    4: {"branch_id": 4, "signed": True, "signed_by": "Rajesh Thapa", "signed_at": "2025-05-18T09:00:00Z", "document_version": "1.0"},
    5: {"branch_id": 5, "signed": False, "signed_by": None, "signed_at": None, "document_version": "1.0"},
}


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic schemas for POST/PATCH endpoints
# ═══════════════════════════════════════════════════════════════════════════════

class FeedbackSubmitRequest(BaseModel):
    respondent_role: str = Field(..., description="Role of respondent: field_officer, branch_manager, area_manager")
    branch: str = Field(..., description="Branch name or code")
    answers: dict[str, Any] = Field(..., description="Answers keyed by question id")


class EscalationCreateRequest(BaseModel):
    title: str = Field(..., min_length=5, max_length=200, description="Brief escalation title")
    severity: str = Field(..., description="Severity: low, medium, high")
    branch: str = Field(..., description="Branch name or code")
    reported_by: str = Field(..., description="Staff ID of reporter")
    assigned_to: str = Field(default="IT Support", description="Team or person assigned")


class EscalationResolveRequest(BaseModel):
    resolution: str = Field(..., min_length=10, max_length=2000, description="Resolution description")


class AgreementSignRequest(BaseModel):
    signed_by: str = Field(..., description="Name of person signing on behalf of branch")


# ═══════════════════════════════════════════════════════════════════════════════
# 1. GET /pilot/overview — Pilot status dashboard
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/overview", response_model=ApiResponse)
async def get_pilot_overview(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns the pilot status dashboard with overall progress, milestones,
    and key preparation metrics for FieldOS Nepal Pilot v1.0.
    """
    overview = {
        "pilot_name": "FieldOS Nepal Pilot v1.0",
        "institution_name": "Demo Microfinance Ltd.",
        "phase": "preparation",
        "start_date": "2025-06-01",
        "end_date": "2025-08-31",
        "duration_weeks": 13,
        "branches_total": 5,
        "branches_ready": 3,
        "field_officers_total": 45,
        "field_officers_trained": 28,
        "branch_managers_total": 5,
        "branch_managers_trained": 4,
        "it_approved": True,
        "support_channel_active": True,
        "agreements_signed": 3,
        "milestones": [
            {"id": 1, "name": "IT Security Review", "status": "completed", "date": "2025-05-15"},
            {"id": 2, "name": "Branch Manager Training", "status": "in_progress", "date": "2025-05-25"},
            {"id": 3, "name": "Field Officer Training", "status": "in_progress", "date": "2025-06-01"},
            {"id": 4, "name": "Go-Live", "status": "pending", "date": "2025-06-05"},
            {"id": 5, "name": "Week 4 Review", "status": "pending", "date": "2025-06-28"},
            {"id": 6, "name": "Week 8 Review", "status": "pending", "date": "2025-07-26"},
            {"id": 7, "name": "Pilot Completion Report", "status": "pending", "date": "2025-08-29"},
        ],
    }
    return ApiResponse(success=True, data=overview, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 2. GET /pilot/branches — Branch readiness checklists
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/branches", response_model=ApiResponse)
async def get_branch_readiness(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns 5 pilot branches with detailed readiness checklists.
    Each branch has an 8-point readiness assessment with overall score and status.
    """
    branches = [
        {
            "id": 1,
            "name": "Kathmandu Main",
            "name_ne": "काठमाडौँ मुख्य",
            "manager": "Suman Sharma",
            "officers_count": 12,
            "clients_count": 340,
            "readiness": {
                "it_infrastructure": True,
                "network_connectivity": True,
                "staff_hired": True,
                "manager_trained": True,
                "officers_trained": True,
                "devices_provisioned": True,
                "agreement_signed": True,
                "go_live_ready": True,
                "score": 8,
                "status": "ready",
            },
        },
        {
            "id": 2,
            "name": "Pokhara Lakeside",
            "name_ne": "पोखरा तटीय",
            "manager": "Anita Gurung",
            "officers_count": 10,
            "clients_count": 285,
            "readiness": {
                "it_infrastructure": True,
                "network_connectivity": True,
                "staff_hired": True,
                "manager_trained": True,
                "officers_trained": True,
                "devices_provisioned": True,
                "agreement_signed": True,
                "go_live_ready": True,
                "score": 8,
                "status": "ready",
            },
        },
        {
            "id": 3,
            "name": "Lalitpur",
            "name_ne": "ललितपुर",
            "manager": "Bikash Maharjan",
            "officers_count": 8,
            "clients_count": 210,
            "readiness": {
                "it_infrastructure": True,
                "network_connectivity": True,
                "staff_hired": True,
                "manager_trained": False,
                "officers_trained": False,
                "devices_provisioned": True,
                "agreement_signed": False,
                "go_live_ready": False,
                "score": 5,
                "status": "in_progress",
            },
        },
        {
            "id": 4,
            "name": "Bhaktapur",
            "name_ne": "भक्तपुर",
            "manager": "Rajesh Thapa",
            "officers_count": 8,
            "clients_count": 195,
            "readiness": {
                "it_infrastructure": True,
                "network_connectivity": True,
                "staff_hired": True,
                "manager_trained": True,
                "officers_trained": True,
                "devices_provisioned": True,
                "agreement_signed": True,
                "go_live_ready": True,
                "score": 8,
                "status": "ready",
            },
        },
        {
            "id": 5,
            "name": "Chitwan",
            "name_ne": "चितवन",
            "manager": "Deepak Adhikari",
            "officers_count": 7,
            "clients_count": 175,
            "readiness": {
                "it_infrastructure": True,
                "network_connectivity": False,
                "staff_hired": True,
                "manager_trained": True,
                "officers_trained": False,
                "devices_provisioned": True,
                "agreement_signed": False,
                "go_live_ready": False,
                "score": 4,
                "status": "not_ready",
            },
        },
    ]
    return ApiResponse(success=True, data={"branches": branches}, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 3. GET /pilot/training — Training progress tracking
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/training", response_model=ApiResponse)
async def get_training_progress(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns training module completion rates and training session history.
    Tracks both self-paced and in-person training modules.
    """
    data = {
        "modules": [
            {"id": "m1", "name": "App Installation & Setup", "type": "self_paced", "duration_min": 30, "completion_rate": 92},
            {"id": "m2", "name": "Client Visit & Check-in", "type": "in_person", "duration_min": 60, "completion_rate": 85},
            {"id": "m3", "name": "Collection Recording", "type": "in_person", "duration_min": 90, "completion_rate": 78},
            {"id": "m4", "name": "Promise-to-Pay Management", "type": "in_person", "duration_min": 45, "completion_rate": 70},
            {"id": "m5", "name": "Center Meeting Facilitation", "type": "in_person", "duration_min": 60, "completion_rate": 65},
            {"id": "m6", "name": "End-of-Day Reporting", "type": "self_paced", "duration_min": 30, "completion_rate": 82},
            {"id": "m7", "name": "Security & Privacy", "type": "self_paced", "duration_min": 20, "completion_rate": 88},
            {"id": "m8", "name": "Dashboard for Branch Managers", "type": "in_person", "duration_min": 120, "completion_rate": 80},
        ],
        "sessions": [
            {"id": 1, "date": "2025-05-20", "branch": "KTM Main", "type": "in_person", "attendees": 14, "completed": 14, "modules": ["m2", "m3"]},
            {"id": 2, "date": "2025-05-21", "branch": "Pokhara", "type": "in_person", "attendees": 12, "completed": 12, "modules": ["m2", "m3"]},
            {"id": 3, "date": "2025-05-22", "branch": "Bhaktapur", "type": "in_person", "attendees": 10, "completed": 9, "modules": ["m2", "m3", "m4"]},
            {"id": 4, "date": "2025-05-23", "branch": "KTM Main", "type": "in_person", "attendees": 12, "completed": 12, "modules": ["m5", "m6"]},
            {"id": 5, "date": "2025-05-24", "branch": "Pokhara", "type": "in_person", "attendees": 10, "completed": 10, "modules": ["m5", "m6"]},
            {"id": 6, "date": "2025-05-25", "branch": "Lalitpur", "type": "in_person", "attendees": 8, "completed": 7, "modules": ["m2", "m3"]},
            {"id": 7, "date": "2025-05-25", "branch": "Chitwan", "type": "in_person", "attendees": 7, "completed": 6, "modules": ["m2"]},
            {"id": 8, "date": "2025-05-26", "branch": "KTM Main", "type": "in_person", "attendees": 2, "completed": 2, "modules": ["m8"]},
            {"id": 9, "date": "2025-05-27", "branch": "Pokhara", "type": "in_person", "attendees": 1, "completed": 1, "modules": ["m8"]},
        ],
    }
    return ApiResponse(success=True, data=data, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 4. GET /pilot/metrics — Success metrics
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/metrics", response_model=ApiResponse)
async def get_pilot_metrics(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns success metric targets with current values and status.
    Metrics are designed for the 13-week pilot period.
    """
    data = {
        "targets": [
            {"id": "m1", "name": "Field Officer Daily Active Use", "target": 80, "unit": "%", "current": 0, "status": "not_started"},
            {"id": "m2", "name": "Visit Check-in Completion", "target": 70, "unit": "%", "current": 0, "status": "not_started"},
            {"id": "m3", "name": "Collection Entry Same-Day", "target": 75, "unit": "%", "current": 0, "status": "not_started"},
            {"id": "m4", "name": "Dashboard Usage (BM)", "target": 5, "unit": "x/week", "current": 0, "status": "not_started"},
            {"id": "m5", "name": "Manager Phone Calls Reduced", "target": 40, "unit": "%", "current": 0, "status": "not_started"},
            {"id": "m6", "name": "PTP Follow-up Completion", "target": 100, "unit": "% tracked", "current": 0, "status": "not_started"},
            {"id": "m7", "name": "Offline Sync Success", "target": 95, "unit": "%", "current": 0, "status": "not_started"},
            {"id": "m8", "name": "User Satisfaction", "target": 4, "unit": "/5", "current": 0, "status": "not_started"},
        ],
        "weekly_snapshots": [],
    }
    return ApiResponse(success=True, data=data, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 5. GET /pilot/feedback — Feedback form + responses
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/feedback", response_model=ApiResponse)
async def get_feedback_data(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns the feedback form schema and all submitted responses with summary statistics.
    """
    # Compute summary from stored responses
    total = len(_feedback_store)
    rating_keys = ["q1", "q2", "q3", "q4", "q5"]
    all_ratings: list[int] = []
    recommend_count = 0
    for r in _feedback_store:
        for k in rating_keys:
            v = r["answers"].get(k)
            if isinstance(v, (int, float)):
                all_ratings.append(int(v))
        if r["answers"].get("q9") in ("Definitely", "Probably"):
            recommend_count += 1

    avg_satisfaction = round(sum(all_ratings) / len(all_ratings), 1) if all_ratings else 0
    recommend_rate = round((recommend_count / total) * 100, 1) if total else 0

    data = {
        "form_schema": {
            "questions": [
                {"id": "q1", "type": "rating", "label": "Overall app satisfaction", "scale": 5},
                {"id": "q2", "type": "rating", "label": "Ease of use", "scale": 5},
                {"id": "q3", "type": "rating", "label": "Speed and performance", "scale": 5},
                {"id": "q4", "type": "rating", "label": "Offline sync reliability", "scale": 5},
                {"id": "q5", "type": "rating", "label": "Training quality", "scale": 5},
                {"id": "q6", "type": "text", "label": "What works well?"},
                {"id": "q7", "type": "text", "label": "What needs improvement?"},
                {"id": "q8", "type": "text", "label": "Any bugs or issues?"},
                {"id": "q9", "type": "select", "label": "Would you recommend FieldOS?", "options": ["Definitely", "Probably", "Not sure", "Probably not", "Definitely not"]},
            ],
        },
        "responses": _feedback_store,
        "summary": {
            "total_responses": total,
            "average_satisfaction": avg_satisfaction,
            "would_recommend_rate": recommend_rate,
        },
    }
    return ApiResponse(success=True, data=data, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 6. POST /pilot/feedback — Submit feedback
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/feedback", response_model=ApiResponse)
async def submit_feedback(
    body: FeedbackSubmitRequest,
    _user: User = Depends(require_manager_or_admin),
):
    """Submit a new feedback response."""
    new_id = max(r["id"] for r in _feedback_store) + 1 if _feedback_store else 1
    response = {
        "id": new_id,
        "respondent_role": body.respondent_role,
        "branch": body.branch,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "answers": body.answers,
    }
    _feedback_store.append(response)
    return ApiResponse(success=True, data={"id": new_id, "message": "Feedback submitted successfully"}, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 7. GET /pilot/escalations — Escalation tracker
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/escalations", response_model=ApiResponse)
async def get_escalations(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns all escalation tickets with summary statistics.
    Filterable by status and severity.
    """
    open_count = sum(1 for e in _escalation_store if e["status"] == "open")
    in_progress_count = sum(1 for e in _escalation_store if e["status"] == "in_progress")
    resolved_count = sum(1 for e in _escalation_store if e["status"] == "resolved")

    # Calculate average resolution time for resolved escalations
    resolved_times: list[float] = []
    for e in _escalation_store:
        if e["status"] == "resolved" and e.get("resolved_at"):
            try:
                created = datetime.fromisoformat(e["created_at"].replace("Z", "+00:00"))
                resolved = datetime.fromisoformat(e["resolved_at"].replace("Z", "+00:00"))
                hours = (resolved - created).total_seconds() / 3600
                resolved_times.append(hours)
            except (ValueError, TypeError):
                pass
    avg_resolution = round(sum(resolved_times) / len(resolved_times), 1) if resolved_times else 0

    data = {
        "escalations": _escalation_store,
        "summary": {
            "open": open_count,
            "in_progress": in_progress_count,
            "resolved": resolved_count,
            "total": len(_escalation_store),
            "avg_resolution_hours": avg_resolution,
        },
    }
    return ApiResponse(success=True, data=data, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 8. POST /pilot/escalations — Create escalation
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/escalations", response_model=ApiResponse)
async def create_escalation(
    body: EscalationCreateRequest,
    _user: User = Depends(require_manager_or_admin),
):
    """Create a new escalation ticket."""
    if body.severity not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="Severity must be one of: low, medium, high")

    new_id = max(e["id"] for e in _escalation_store) + 1 if _escalation_store else 1
    escalation = {
        "id": new_id,
        "title": body.title,
        "severity": body.severity,
        "branch": body.branch,
        "reported_by": body.reported_by,
        "status": "open",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "assigned_to": body.assigned_to,
        "resolution": None,
    }
    _escalation_store.append(escalation)
    return ApiResponse(success=True, data={"id": new_id, "status": "open", "message": "Escalation created"}, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 9. PATCH /pilot/escalations/{id}/resolve — Resolve escalation
# ═══════════════════════════════════════════════════════════════════════════════

@router.patch("/escalations/{escalation_id}/resolve", response_model=ApiResponse)
async def resolve_escalation(
    escalation_id: int,
    body: EscalationResolveRequest,
    _user: User = Depends(require_manager_or_admin),
):
    """Resolve an open or in-progress escalation ticket."""
    for e in _escalation_store:
        if e["id"] == escalation_id:
            if e["status"] == "resolved":
                raise HTTPException(status_code=400, detail=f"Escalation {escalation_id} is already resolved")
            e["status"] = "resolved"
            e["resolution"] = body.resolution
            e["resolved_at"] = datetime.now(timezone.utc).isoformat()
            return ApiResponse(success=True, data={"id": escalation_id, "status": "resolved"}, timestamp=_ts())
    raise HTTPException(status_code=404, detail=f"Escalation {escalation_id} not found")


# ═══════════════════════════════════════════════════════════════════════════════
# 10. GET /pilot/agreements — Pilot agreement status
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/agreements", response_model=ApiResponse)
async def get_agreements(
    _user: User = Depends(require_manager_or_admin),
):
    """Returns the signing status of pilot agreements for all branches."""
    agreements = []
    branch_names = {1: "Kathmandu Main", 2: "Pokhara Lakeside", 3: "Lalitpur", 4: "Bhaktapur", 5: "Chitwan"}
    for bid in range(1, 6):
        agr = _agreement_store.get(bid, {"branch_id": bid, "signed": False, "signed_by": None, "signed_at": None, "document_version": "1.0"})
        agr_copy = dict(agr)
        agr_copy["branch_name"] = branch_names.get(bid, f"Branch {bid}")
        agreements.append(agr_copy)

    signed_count = sum(1 for a in agreements if a["signed"])
    return ApiResponse(
        success=True,
        data={"agreements": agreements, "total": 5, "signed": signed_count, "unsigned": 5 - signed_count},
        timestamp=_ts(),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# 11. POST /pilot/agreements/{branch_id}/sign — Sign pilot agreement
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/agreements/{branch_id}/sign", response_model=ApiResponse)
async def sign_agreement(
    branch_id: int,
    body: AgreementSignRequest,
    _user: User = Depends(require_manager_or_admin),
):
    """Sign the pilot agreement for a specific branch."""
    if branch_id not in _agreement_store:
        raise HTTPException(status_code=404, detail=f"Branch {branch_id} not found in pilot")
    agr = _agreement_store[branch_id]
    if agr["signed"]:
        raise HTTPException(status_code=400, detail=f"Branch {branch_id} agreement is already signed")

    agr["signed"] = True
    agr["signed_by"] = body.signed_by
    agr["signed_at"] = datetime.now(timezone.utc).isoformat()

    return ApiResponse(
        success=True,
        data={"branch_id": branch_id, "signed": True, "signed_by": body.signed_by, "signed_at": agr["signed_at"]},
        timestamp=_ts(),
    )


# ═══════════════════════════════════════════════════════════════════════════════════════
# DOCUMENT ENDPOINTS — Full professional content for each document
# ═══════════════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# 12. GET /pilot/documents/product-overview
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/documents/product-overview", response_model=ApiResponse)
async def get_doc_product_overview(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns the full Product Overview document for FieldOS Nepal.
    Covers system purpose, target users, key modules, architecture, and integration points.
    """
    doc = {
        "title": "FieldOS Nepal — Product Overview",
        "version": "1.0",
        "last_updated": "2025-05-01",
        "sections": [
            {
                "heading": "Introduction",
                "content": (
                    "FieldOS Nepal is a comprehensive field operations management platform specifically designed for "
                    "microfinance institutions operating in Nepal. Developed to address the unique challenges faced by "
                    "field officers who serve clients in urban centers and rural villages across the country, FieldOS "
                    "digitizes and streamlines the entire daily workflow — from morning task planning and client visit "
                    "check-ins to collection recording, center meeting facilitation, and end-of-day reporting. "
                    "The platform is built with an offline-first architecture that ensures field officers can continue "
                    "their work even in areas with limited or no internet connectivity, which is a common reality in "
                    "many parts of Nepal. All data is automatically synchronized with the central server when connectivity "
                    "is restored, ensuring data integrity and real-time visibility for branch managers and administrators."
                ),
            },
            {
                "heading": "Target Users",
                "content": (
                    "FieldOS Nepal is designed around four primary user roles. Field Officers (FO) are the primary users "
                    "who visit clients daily, record collections, facilitate center meetings, and manage promise-to-pay "
                    "agreements. The mobile application is their primary interface, optimized for one-handed operation "
                    "during field visits. Branch Managers (BM) use the web dashboard to monitor real-time field activity, "
                    "review collections, track overdue clients, and manage exception queues. Area Managers (AM) oversee "
                    "multiple branches through aggregated regional reports and cross-branch analytics. System Administrators "
                    "manage user accounts, device registrations, security policies, and system configuration. Each role has "
                    "carefully scoped permissions through role-based access control (RBAC), ensuring data privacy and "
                    "operational security at every level of the organization."
                ),
            },
            {
                "heading": "Key Modules",
                "content": (
                    "The platform consists of six core operational modules. The Visit Check-in module captures GPS "
                    "coordinates, timestamps, and client interaction notes when field officers arrive at client locations, "
                    "providing verifiable proof of client engagement. The Collection Recording module enables on-the-spot "
                    "payment entry with automatic receipt generation, CBS posting integration, and face verification for "
                    "high-value transactions exceeding NPR 10,000. The Promise-to-Pay (PTP) module tracks client "
                    "commitments for future payments with follow-up reminders and fulfillment tracking. The Center Meeting "
                    "module digitizes the traditional microfinance group meeting process, recording attendance, savings "
                    "contributions, and discussion notes for each member. The End-of-Day Reporting module consolidates "
                    "all daily activities into a comprehensive summary for manager review. Finally, the Sync Center "
                    "provides full visibility into offline data synchronization status, including pending uploads, failed "
                    "syncs, and retry capabilities."
                ),
            },
            {
                "heading": "Technical Architecture",
                "content": (
                    "FieldOS Nepal follows a modern, resilience-oriented architecture designed for challenging network "
                    "conditions. The mobile application is built with Expo React Native for cross-platform support on "
                    "Android devices, with a local SQLite database providing full offline functionality. The backend API "
                    "is powered by FastAPI (Python), chosen for its high performance and automatic API documentation. "
                    "The offline-first sync engine uses a queuing system where every field action creates a sync event "
                    "that is automatically uploaded when connectivity is available, with retry logic and conflict resolution "
                    "for edge cases. All data at rest is protected with AES-256 encryption, and all data in transit uses "
                    "TLS 1.2+. The manager dashboard is built with Next.js and shadcn/ui, providing a responsive web "
                    "interface for branch and area managers. The system communicates with the Core Banking System (CBS) "
                    "through secure API endpoints for client data import, collection posting, and balance reconciliation."
                ),
            },
            {
                "heading": "Multi-Language Support",
                "content": (
                    "FieldOS Nepal provides full bilingual support in English and Nepali. The interface language can be "
                    "toggled at any time from the login screen or settings menu, and the preference is persisted locally. "
                    "All screen labels, navigation elements, form fields, notification messages, and error states are "
                    "translated. The Nepali translations use appropriate formal language suitable for professional "
                    "microfinance contexts, with proper terminology for financial terms. The training materials and user "
                    "guide are also available in both languages. Future versions plan to add support for additional "
                    "regional languages based on user feedback and geographic expansion. The internationalization system "
                    "is built on a translation key architecture that makes adding new languages straightforward without "
                    "modifying application code."
                ),
            },
            {
                "heading": "CBS Integration",
                "content": (
                    "Integration with the Core Banking System (CBS) is a critical component of FieldOS Nepal. The system "
                    "imports client master data including member IDs, loan account details, outstanding balances, and "
                    "repayment schedules from the CBS on a configurable schedule. When field officers record collections "
                    "through the mobile app, the data is posted to the CBS for real-time balance updates. A reconciliation "
                    "engine compares FieldOS collection records against CBS posting confirmations, flagging any mismatches "
                    "for manager review. The integration uses idempotency keys to prevent duplicate postings and HMAC "
                    "signatures to ensure data integrity. The reconciliation queue in the manager dashboard allows branch "
                    "managers to approve or reject individual discrepancies, maintaining full financial control while "
                    "reducing manual reconciliation effort significantly."
                ),
            },
            {
                "heading": "Security and Compliance",
                "content": (
                    "FieldOS Nepal is built with a security-first approach aligned with Nepal Rastra Bank (NRB) guidelines "
                    "for digital financial services. Authentication requires both a PIN code and supports biometric "
                    "(fingerprint) verification. All sensitive operations are logged in a comprehensive audit trail that "
                    "captures user identity, device information, timestamps, GPS coordinates, and action details. The "
                    "audit log is append-only and cannot be modified or deleted, providing tamper-proof records for "
                    "compliance reporting. High-value transactions trigger face verification to prevent fraud. Device "
                    "management allows administrators to remotely revoke access for lost or compromised devices. The system "
                    "implements rate limiting, security headers, and input validation at every API endpoint to protect "
                    "against common web vulnerabilities."
                ),
            },
        ],
    }
    return ApiResponse(success=True, data=doc, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 13. GET /pilot/documents/security-overview
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/documents/security-overview", response_model=ApiResponse)
async def get_doc_security_overview(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns the full Security Overview document.
    Covers authentication, encryption, RBAC, audit logging, device management, and compliance.
    """
    doc = {
        "title": "FieldOS Nepal — Security Overview",
        "version": "1.0",
        "last_updated": "2025-05-01",
        "sections": [
            {
                "heading": "Authentication Framework",
                "content": (
                    "FieldOS Nepal implements a multi-layered authentication framework designed for field operations "
                    "in microfinance environments. Primary authentication uses a 4-6 digit personal identification number "
                    "(PIN) that is never stored in plaintext — passwords are hashed using bcrypt with a cost factor of 12. "
                    "Secondary authentication supports biometric fingerprint verification through the device's native "
                    "biometric hardware, providing quick and secure access for field officers who need to frequently "
                    "lock and unlock their devices throughout the day. Upon successful authentication, the system issues "
                    "JSON Web Tokens (JWT) signed with HS256 algorithm. Each token contains a unique JTI (JWT ID) for "
                    "individual tracking, a token type claim distinguishing access tokens from refresh tokens, and an "
                    "expiration window of 60 minutes for access tokens and 7 days for refresh tokens. Failed "
                    "authentication attempts are logged with the device ID and timestamp, and the system enforces "
                    "progressive delays after multiple consecutive failures to prevent brute-force attacks."
                ),
            },
            {
                "heading": "Encryption Standards",
                "content": (
                    "Data protection is implemented at multiple layers of the technology stack. For data at rest, "
                    "all local SQLite databases on mobile devices are encrypted using AES-256 encryption. KYC document "
                    "photos and other sensitive files stored on the device are protected through the operating system's "
                    "secure storage mechanisms. For data in transit, all communications between the mobile application, "
                    "manager dashboard, and backend API are encrypted using TLS 1.2 or higher. The backend implements "
                    "certificate pinning to prevent man-in-the-middle attacks. Sync payloads between the mobile app "
                    "and server are additionally signed with HMAC verification to ensure data integrity during "
                    "transmission. Server-side database files are protected with file-level AES-256 encryption, with "
                    "plans to migrate to SQLCipher for transparent database-level encryption in the production "
                    "deployment. Encryption keys are managed through a secure key management process with regular "
                    "rotation schedules."
                ),
            },
            {
                "heading": "Role-Based Access Control (RBAC)",
                "content": (
                    "The system enforces strict role-based access control with four defined roles: Field Officer, "
                    "Branch Manager, Area Manager, and System Administrator. Role assignments are stored server-side "
                    "in the database and validated on every API request — the user's role is never trusted from the "
                    "client-side token payload alone. Each role has precisely defined permissions across 12 endpoint "
                    "groups covering authentication, device management, mobile bootstrap, synchronization, task "
                    "management, client data, field operations, audit logs, manager dashboard, CBS integration, AI "
                    "intelligence, and security administration. Field officers are scoped to their own assigned clients "
                    "and tasks, while branch managers can view all data within their branch. Area managers have "
                    "read-only access across their assigned branches. Administrators have full access to all system "
                    "features including security configuration and user management. The RBAC system is implemented "
                    "through FastAPI dependency injection, making it consistent and enforceable across all endpoints."
                ),
            },
            {
                "heading": "Audit Logging System",
                "content": (
                    "FieldOS Nepal maintains a comprehensive, tamper-proof audit logging system that records every "
                    "sensitive operation performed within the system. There are 15+ audited action types including user "
                    "login (PIN and biometric), workday start, face verification, visit check-ins, collection recordings, "
                    "collection edits, receipt creation, promise-to-pay creation, center meeting completion, end-of-day "
                    "report submission, sync attempts, sync failures, and secure logout. Each audit event captures the "
                    "user ID, role, branch ID, device ID, action type, entity type, entity ID, timestamp, sync status, "
                    "verification status, and optional metadata. Audit records are append-only — they cannot be modified "
                    "or deleted through the application interface. The audit log serves both operational and compliance "
                    "purposes, providing a complete traceable history of all system interactions for internal review, "
                    "NRB compliance reporting, and incident investigation."
                ),
            },
            {
                "heading": "Device Management",
                "content": (
                    "Every mobile device that accesses the FieldOS system must be registered through a formal device "
                    "registration process that binds the device ID to a specific user account. The system tracks device "
                    "metadata including device name, model, operating system version, and app version. Active devices "
                    "send periodic heartbeat signals that allow administrators to monitor device health and connectivity "
                    "status. When a device is lost, stolen, or compromised, administrators can immediately revoke the "
                    "device's registration through the security dashboard, which terminates the device's ability to "
                    "sync data or access the API. The device management interface shows real-time status indicators "
                    "including active, recently seen, and inactive states based on the last heartbeat timestamp. "
                    "Devices that have not communicated within 24 hours are flagged for review. Revoked devices can "
                    "be restored if recovered, providing flexibility for common field scenarios where devices are "
                    "temporarily misplaced."
                ),
            },
            {
                "heading": "Data Privacy Compliance",
                "content": (
                    "FieldOS Nepal is designed to comply with Nepal Rastra Bank (NRB) directives on data protection "
                    "and customer privacy in digital financial services. Client personally identifiable information "
                    "(PII) including names, addresses, phone numbers, and financial data is accessible only to "
                    "authorized personnel based on their role and branch assignment. The system implements data "
                    "minimization principles — only the minimum necessary client data is loaded onto mobile devices "
                    "for daily operations. All client financial data displayed in the app is masked for partial "
                    "views (e.g., showing only the last 4 digits of account numbers). Data retention policies "
                    "are configurable, with automatic purging of audit logs older than the retention period. "
                    "The privacy policy is presented to users during initial app setup and is accessible at any "
                    "time through the profile settings. KYC document images are stored with access controls and "
                    "are never transmitted in unencrypted form."
                ),
            },
            {
                "heading": "Threat Mitigation",
                "content": (
                    "The system addresses the OWASP Mobile Top 10 and common web application vulnerabilities through "
                    "multiple defense layers. A STRIDE threat model covering 9 identified threats guides the security "
                    "architecture. Mitigations include certificate pinning and obfuscated code to prevent reverse "
                    "engineering, server-side validation of all client submissions to prevent data tampering, "
                    "comprehensive audit logging to prevent repudiation, RBAC enforcement to prevent unauthorized "
                    "access, a sliding-window rate limiter (100 requests per minute per IP) to prevent denial of "
                    "service, and JWT token validation with server-side role checking to prevent privilege escalation. "
                    "GPS location verification with future WiFi/tower cross-validation addresses spoofing risks. "
                    "Regular security assessments including penetration testing and dependency scanning are planned "
                    "on a quarterly basis. Security incidents follow a defined incident response playbook with "
                    "escalation timelines and communication procedures."
                ),
            },
        ],
    }
    return ApiResponse(success=True, data=doc, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 14. GET /pilot/documents/data-flow
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/documents/data-flow", response_model=ApiResponse)
async def get_doc_data_flow(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns the Data Flow document describing system architecture,
    data types at each node, encryption points, and compliance controls.
    """
    doc = {
        "title": "FieldOS Nepal — Data Flow Architecture",
        "version": "1.0",
        "last_updated": "2025-05-01",
        "sections": [
            {
                "heading": "System Architecture Overview",
                "content": (
                    "The FieldOS Nepal system consists of six primary components organized in a hub-and-spoke "
                    "architecture with the Backend API at the center. The Mobile Application (Expo React Native) "
                    "serves as the primary interface for field officers, communicating with the backend via RESTful "
                    "HTTPS endpoints. The Manager Dashboard (Next.js) provides a web-based interface for branch "
                    "managers and administrators. The Backend API (FastAPI) handles all business logic, "
                    "authentication, and data orchestration. The SQLite Database stores all operational data "
                    "including users, clients, collections, and audit records. The CBS (Core Banking System) is "
                    "an external system that receives collection postings and provides client master data. The AI "
                    "Intelligence Service is an internal rule-based engine that generates priority queues and "
                    "actionable suggestions for managers. Each component operates within clearly defined trust "
                    "boundaries with specific security controls at every connection point."
                ),
            },
            {
                "heading": "Mobile App to Backend API Data Flow",
                "content": (
                    "The connection between the mobile application and backend API is the most critical data flow "
                    "in the system, as it carries sensitive financial data over potentially unreliable networks. All "
                    "communication uses HTTPS with TLS 1.2+ encryption and certificate pinning to prevent "
                    "man-in-the-middle attacks. The mobile app authenticates using Bearer JWT tokens obtained through "
                    "the PIN/biometric login flow. Data types flowing from mobile to server include: collection "
                    "records (amounts, client IDs, receipt numbers), visit check-ins (GPS coordinates, timestamps, "
                    "client IDs), promise-to-pay records, center meeting data (attendance, savings, notes), end-of-day "
                    "reports, and batch sync events containing all offline-recorded data. Data flowing from server to "
                    "mobile includes: client lists with loan details, daily task assignments, system settings, and "
                    "sync confirmations. Each request includes the device ID and JWT token for full traceability. "
                    "Request payloads are signed with HMAC for integrity verification."
                ),
            },
            {
                "heading": "Backend API to Database Data Flow",
                "content": (
                    "The backend API communicates with the SQLite database through SQLAlchemy async ORM using aiosqlite. "
                    "This connection operates entirely within the server process, eliminating network-based "
                    "vulnerabilities. All queries are parameterized through the ORM, preventing SQL injection attacks. "
                    "The database operates in WAL (Write-Ahead Logging) mode for concurrent read/write access. Data "
                    "types stored include: user accounts (credentials, roles, branch assignments), client profiles "
                    "(names, member IDs, contact information, KYC references), loan accounts (disbursement amounts, "
                    "outstanding balances, repayment schedules), operational records (collections, visits, meetings, "
                    "PTP records), sync events (queued operations with retry counts and error logs), and audit logs "
                    "(immutable records of all sensitive operations). The database file is protected with file-level "
                    "AES-256 encryption at the operating system level. Regular automated backups are created daily "
                    "with 30-day retention."
                ),
            },
            {
                "heading": "Backend API to CBS Integration",
                "content": (
                    "The CBS integration data flow handles the exchange of financial data between FieldOS and the "
                    "institution's core banking system. This is the most sensitive data flow as it involves real "
                    "monetary transactions and client financial records. Communication uses HTTPS with TLS 1.2+ and "
                    "additional HMAC signatures for payload integrity. Authentication uses API keys with "
                    "idempotency keys on all write operations to prevent duplicate processing. Data flowing to CBS "
                    "includes: collection event postings (client ID, amount, receipt number, timestamp), client "
                    "data reconciliation queries, and posting approval confirmations. Data received from CBS "
                    "includes: client master data snapshots (names, member IDs, loan details, balances), loan "
                    "repayment schedules, and posting acknowledgment responses. In production, this connection "
                    "operates over a dedicated VPN tunnel for additional security. The reconciliation engine "
                    "compares FieldOS records against CBS confirmations and flags discrepancies for human review."
                ),
            },
            {
                "heading": "Backend API to AI Intelligence Service",
                "content": (
                    "The AI Intelligence Service operates as an internal module within the same server process, "
                    "meaning no network communication is required for this data flow. Data is passed through "
                    "function calls within the Python application. The AI service processes: client overdue data "
                    "with aging analysis, visit and collection history patterns, promise-to-pay fulfillment rates, "
                    "and center meeting attendance records. It produces: priority queues ranking clients by urgency "
                    "and recovery potential, actionable suggestions for branch managers (e.g., 'Client X has missed "
                    "3 visits — recommend field officer visit'), and automated end-of-day summaries with anomaly "
                    "detection. The rule-based engine uses configurable threshold parameters that can be adjusted "
                    "by administrators based on institutional policies. No external AI/ML services are called, "
                    "ensuring that sensitive client data never leaves the institution's infrastructure."
                ),
            },
            {
                "heading": "Manager Dashboard to Backend API",
                "content": (
                    "The Manager Dashboard communicates with the backend API through HTTPS REST endpoints, "
                    "protected by JWT authentication and RBAC authorization. Only users with branch_manager, "
                    "area_manager, or admin roles can access dashboard endpoints. Data types requested include: "
                    "aggregated KPIs (total collections, PAR rate, visit completion rate), staff activity reports "
                    "(individual officer performance metrics, task completion rates), collection summaries (daily "
                    "totals, CBS posting status), exception queues (overdue clients, failed syncs, missing visits), "
                    "and audit log reviews. The dashboard uses TanStack Query for efficient data fetching with "
                    "caching and automatic refresh. All dashboard endpoints require the require_manager_or_admin "
                    "dependency, ensuring that field officers cannot access management-level data. Area managers "
                    "receive aggregated data across their assigned branches without drill-down access to individual "
                    "officers outside their region."
                ),
            },
            {
                "heading": "Trust Boundaries and Compliance Controls",
                "content": (
                    "The system defines four distinct trust boundaries, each with specific security controls. "
                    "The Device-to-Network boundary is protected by TLS 1.2+, certificate pinning, and secure "
                    "storage for local data. The Network-to-Server boundary is protected by a reverse proxy, "
                    "security headers (CSP, X-Frame-Options, X-Content-Type-Options), rate limiting (100 req/min "
                    "per IP), and request body size limits. The Server-to-Database boundary uses ORM parameterized "
                    "queries and file system permissions. The Server-to-CBS boundary uses TLS 1.2+, HMAC signatures, "
                    "idempotency keys, and VPN tunneling in production. Each trust boundary is documented in the "
                    "security architecture and is subject to regular security assessments. Compliance controls "
                    "aligned with NRB guidelines include: mandatory encryption for all financial data, access logging "
                    "for all sensitive operations, data retention policies with automatic purging, and separation "
                    "of duties enforced through RBAC."
                ),
            },
        ],
    }
    return ApiResponse(success=True, data=doc, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 15. GET /pilot/documents/sop
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/documents/sop", response_model=ApiResponse)
async def get_doc_sop(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns the Standard Operating Procedures document.
    Step-by-step procedures for all field officer and manager workflows.
    """
    doc = {
        "title": "FieldOS Nepal — Standard Operating Procedures",
        "version": "1.0",
        "last_updated": "2025-05-01",
        "sections": [
            {
                "heading": "Field Officer Daily Workflow",
                "content": (
                    "The field officer daily workflow begins with the Morning Start procedure. Upon arriving at the "
                    "branch, the officer opens the FieldOS app and authenticates using their PIN or fingerprint. "
                    "The app displays the daily task list showing all assigned client visits, collections due, and "
                    "center meetings scheduled. The officer taps 'Start Day' to begin tracking field activities, "
                    "which creates an audit event and loads the day's tasks onto the device for offline use. Before "
                    "departing, the officer should verify their device battery level is above 50% and mobile data "
                    "is enabled for GPS functionality. The officer then plans their route based on the task list, "
                    "grouping nearby clients for efficient travel. Each task card shows the client name, member ID, "
                    "loan type, due amount, overdue status, and the last visit date to help prioritize visits. "
                    "Tasks are color-coded by urgency: red for high overdue, orange for moderate, and green for "
                    "on-track clients."
                ),
            },
            {
                "heading": "Client Visit and Check-in Procedure",
                "content": (
                    "When arriving at a client's location, the field officer opens the FieldOS app and selects the "
                    "client from the task list. The app navigates to the Client Detail screen showing the client's "
                    "full profile including loan summary, recent collection history, and any outstanding promise-to-pay "
                    "agreements. To record the visit, the officer taps the 'Visit Check-in' button. The app "
                    "automatically captures the current GPS coordinates (requiring accuracy within 100 meters) and "
                    "timestamp. The officer may optionally add visit notes describing the client's situation, any "
                    "issues encountered, or relevant observations. The check-in creates a permanent record with the "
                    "officer's ID, device ID, GPS location, and timestamp, which is stored locally and queued for "
                    "server sync. If GPS signal is unavailable, the app records the check-in with a fallback timestamp "
                    "and flags the record for review. Managers can view all check-ins on their dashboard with map "
                    "visualization to verify visit authenticity."
                ),
            },
            {
                "heading": "Collection Recording Procedure",
                "content": (
                    "The collection recording procedure is the most critical financial operation in the field workflow. "
                    "After checking in to a client visit, the officer taps 'Record Collection' to open the collection "
                    "entry screen. The app displays the client's due amount based on the latest CBS data, along with "
                    "the outstanding balance and any overdue amount. The officer enters the actual collected amount, "
                    "which must be a positive number. If the entered amount differs significantly from the expected "
                    "amount, the system prompts the officer to confirm. For collections exceeding NPR 10,000, the "
                    "app triggers face verification — the client must look at the device camera for a brief "
                    "verification scan to confirm the transaction. After entering the amount and any applicable notes, "
                    "the officer taps 'Record Collection'. The system generates a unique receipt number (format: "
                    "RCPT-YYYYMMDD-XXXXX), creates the collection record, enqueues it for CBS posting, creates a "
                    "sync queue event, and generates an audit log entry. The digital receipt can be shared with the "
                    "client via the app. The receipt shows CBS verification status as 'Pending' until the collection "
                    "is confirmed by the CBS system."
                ),
            },
            {
                "heading": "Promise-to-Pay Management",
                "content": (
                    "When a client is unable to make a full payment during a visit, the field officer should record "
                    "a Promise-to-Pay (PTP) agreement. From the Client Detail screen, the officer taps 'Record PTP' "
                    "to open the promise entry form. The officer enters the promised amount and selects the promised "
                    "date from a date picker (defaults to the next center meeting date). Optional notes can capture "
                    "the reason for non-payment and any recovery plan discussed with the client. The PTP is recorded "
                    "with the client ID, promised amount, promised date, and the officer's details. PTP records "
                    "are tracked in the system and appear on the manager dashboard as follow-up items. When the "
                    "promised date arrives, the client appears in the officer's task list with a PTP due indicator. "
                    "If the client fulfills the promise, the officer marks it as 'Fulfilled' during the collection "
                    "recording. If the client fails to fulfill, the system flags the record for escalation. Branch "
                    "managers can review all PTP records, filter by fulfillment status, and take appropriate action "
                    "for chronic defaulters."
                ),
            },
            {
                "heading": "Center Meeting Facilitation",
                "content": (
                    "Center meetings are a cornerstone of microfinance operations in Nepal, where groups of clients "
                    "gather to make savings contributions, discuss issues, and receive disbursements. The FieldOS "
                    "center meeting module digitizes this process. To start a meeting, the officer selects 'Center "
                    "Meeting' from the quick actions menu and selects the center group. The app loads the member "
                    "list with each member's current status (active, overdue, savings balance). During the meeting, "
                    "the officer records attendance for each member by toggling their status to 'Present' or 'Absent'. "
                    "Savings contributions are recorded per member with amounts and payment method. The app tracks "
                    "the meeting progress showing total members, attendance count, and total savings collected. "
                    "Discussion notes can be added to capture key decisions and action items. Once all members have "
                    "been processed, the officer taps 'Complete Meeting' to finalize the record. The meeting data "
                    "including attendance and savings is queued for sync and appears in the manager dashboard. "
                    "Meetings that are interrupted can be saved as drafts and resumed later."
                ),
            },
            {
                "heading": "End-of-Day Reporting",
                "content": (
                    "At the conclusion of each working day, the field officer must complete the End-of-Day (EOD) "
                    "report. This is a mandatory daily procedure that consolidates all activities into a single "
                    "report for manager review. The EOD screen displays a summary of the day's activities including: "
                    "total client visits completed, total collections recorded with amount breakdown, center meetings "
                    "facilitated, PTP records created, and any exceptions or issues encountered. The officer reviews "
                    "each section, confirms the totals are accurate, and adds any additional notes about the day's "
                    "work. The officer can save the report as a draft if they need to verify information before "
                    "final submission. Once confirmed, tapping 'Submit EOD' creates the final report, queues it "
                    "for sync, and creates an audit event. The system prevents duplicate EOD submissions for the "
                    "same date. Branch managers see submitted EOD reports in their dashboard and can flag any "
                    "discrepancies for follow-up. The EOD report also triggers the sync process to ensure all "
                    "day's data is uploaded to the server."
                ),
            },
            {
                "heading": "Escalation Procedures",
                "content": (
                    "When field officers encounter issues that cannot be resolved through standard procedures, they "
                    "should follow the escalation protocol. Technical issues (app crashes, sync failures, GPS errors) "
                    "should be reported to IT Support through the app's escalation form or by contacting the IT "
                    "helpdesk directly. The officer should provide the issue description, device model, app version, "
                    "and any error messages displayed. For CBS-related issues (collection not posting, balance "
                    "mismatches), the officer should notify the branch manager immediately, who escalates to the CBS "
                    "team. For client disputes or compliance concerns, the officer should document the issue in visit "
                    "notes and notify the branch manager. All escalations are tracked through the pilot escalation "
                    "system with severity levels (low, medium, high) and SLA targets: high severity issues must be "
                    "acknowledged within 1 hour and resolved within 4 hours; medium severity within 4 hours "
                    "acknowledgment and 24 hours resolution; low severity within 24 hours. Emergency situations "
                    "(data breach, device theft) should be reported immediately to the branch manager and system "
                    "administrator through phone, with a written follow-up within 30 minutes."
                ),
            },
            {
                "heading": "Data Backup and Recovery",
                "content": (
                    "FieldOS implements a multi-layer data backup strategy. On the mobile device, the local SQLite "
                    "database is the primary data store. The offline-first sync mechanism ensures that all data is "
                    "replicated to the server as soon as connectivity is available. Field officers should sync their "
                    "data at least twice daily — once during lunch break when returning near the branch, and once "
                    "at the end of the day after submitting the EOD report. The server performs automated daily "
                    "backups of the central database at 02:00 NPT with 30-day retention. In the event of a device "
                    "loss or failure, all data can be recovered from the server through the device re-registration "
                    "and bootstrap process, which downloads the officer's complete client list and recent data. "
                    "For server-side data recovery, the backup files are stored in a separate location with AES-256 "
                    "encryption. A backup restoration test should be performed monthly to verify backup integrity. "
                    "KYC document photos are stored locally on the device with sync queue entries, ensuring they "
                    "are also replicated to the server when connectivity allows."
                ),
            },
        ],
    }
    return ApiResponse(success=True, data=doc, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 16. GET /pilot/documents/training-guide
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/documents/training-guide", response_model=ApiResponse)
async def get_doc_training_guide(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns the Training Guide document with 8 training modules,
    objectives, duration, content outline, and assessment criteria.
    """
    doc = {
        "title": "FieldOS Nepal — Training Guide for Field Officers and Branch Managers",
        "version": "1.0",
        "last_updated": "2025-05-01",
        "sections": [
            {
                "heading": "Training Program Overview",
                "content": (
                    "The FieldOS Nepal training program is a comprehensive 8-module curriculum designed to prepare "
                    "field officers and branch managers for effective use of the FieldOS platform. The program "
                    "combines self-paced digital modules that can be completed on the trainee's own device with "
                    "instructor-led practical sessions that provide hands-on experience. The total program duration "
                    "is approximately 7.5 hours spread across 3-4 training days, with each module building on the "
                    "previous one. Training materials are available in both English and Nepali. Assessment criteria "
                    "include practical demonstration of each skill, a written quiz at the end of each module, and "
                    "a final field simulation exercise. Trainees must achieve a minimum score of 80% on assessments "
                    "to be certified for pilot participation. Refresher sessions are scheduled for Week 4 and Week 8 "
                    "of the pilot period to address emerging questions and reinforce best practices."
                ),
            },
            {
                "heading": "Module 1: App Installation and Setup (Self-Paced, 30 min)",
                "content": (
                    "This introductory module covers the initial setup of the FieldOS mobile application. "
                    "Learning objectives include: downloading and installing the app from the authorized distribution "
                    "channel, granting required permissions (camera, location, notifications, biometric), "
                    "understanding the login screen and authentication options (PIN vs biometric), changing the "
                    "interface language between English and Nepali, and navigating the app's main screens. "
                    "The module includes a step-by-step walkthrough with screenshots in both languages. Trainees "
                    "practice logging in with their assigned credentials, toggling the language, and navigating "
                    "between the Dashboard, Tasks, and Profile screens. Assessment: Trainee must successfully "
                    "install the app, log in, switch language, and navigate to all 5 main tabs within 10 minutes "
                    "without assistance. Common issues addressed: app installation failures on older devices, "
                    "permission denial workarounds, and network connectivity troubleshooting."
                ),
            },
            {
                "heading": "Module 2: Client Visit and Check-in (In-Person, 60 min)",
                "content": (
                    "Module 2 teaches the visit check-in workflow, which is fundamental to daily field operations. "
                    "Learning objectives include: understanding the task list and client prioritization, navigating "
                    "to client detail pages, performing GPS-based visit check-ins, adding visit notes, and "
                    "understanding how managers use check-in data. The practical session begins with a classroom "
                    "walkthrough of the task list interface, followed by a simulated field exercise where trainees "
                    "practice checking in at designated locations within the branch premises. Trainees learn how "
                    "GPS accuracy indicators work and what to do when GPS signal is weak. The module covers "
                    "common scenarios: successful check-in, GPS failure fallback, and partial check-in scenarios. "
                    "Assessment: Trainee must complete 3 consecutive check-ins with proper GPS coordinates and "
                    "visit notes, demonstrating correct handling of at least one GPS-poor scenario. Discussion "
                    "topics include privacy considerations when capturing location data and ethical use of "
                    "GPS tracking for accountability purposes."
                ),
            },
            {
                "heading": "Module 3: Collection Recording (In-Person, 90 min)",
                "content": (
                    "This is the most extensive module, covering the financial transaction workflow that is central "
                    "to microfinance operations. Learning objectives include: understanding the collection entry "
                    "screen and amount verification, recording partial and full payments, understanding face "
                    "verification for high-value transactions, sharing digital receipts with clients, and "
                    "understanding CBS posting status. The module begins with a detailed walkthrough of the "
                    "collection process, including what each field means and how to handle edge cases such as "
                    "overpayments, partial payments, and refused payments. Trainees practice recording collections "
                    "in simulated scenarios with different amounts. The face verification procedure is demonstrated "
                    "and practiced, including proper client positioning and handling verification failures. Receipt "
                    "sharing via the app's share function is practiced. Assessment: Trainee must complete 5 "
                    "collection recordings with 100% accuracy on amounts and receipt generation, plus successfully "
                    "complete one face verification. The module emphasizes the importance of receipt generation for "
                    "client trust and CBS reconciliation."
                ),
            },
            {
                "heading": "Module 4: Promise-to-Pay Management (In-Person, 45 min)",
                "content": (
                    "Module 4 covers the PTP workflow for handling clients who cannot make full payments. "
                    "Learning objectives include: understanding when and how to create a PTP, entering promised "
                    "amounts and dates, adding contextual notes about non-payment reasons, understanding how PTP "
                    "records appear in follow-up task lists, and the PTP fulfillment workflow. The session includes "
                    "role-play exercises where trainees practice the conversation flow: acknowledging the client's "
                    "situation, discussing a realistic repayment plan, and recording the agreement in FieldOS. "
                    "Trainees learn to set appropriate promise dates aligned with center meeting schedules. The "
                    "module covers the PTP lifecycle: creation, appearance in task list, fulfillment during "
                    "collection, and escalation for broken promises. Assessment: Trainee must correctly create "
                    "2 PTP records with appropriate amounts, dates, and notes, and demonstrate the fulfillment "
                    "workflow for at least one PTP. Best practices discussion includes setting realistic expectations "
                    "with clients and documenting the conversation accurately."
                ),
            },
            {
                "heading": "Module 5: Center Meeting Facilitation (In-Person, 60 min)",
                "content": (
                    "Module 5 teaches the digitized center meeting process. Learning objectives include: "
                    "starting a new center meeting, recording member attendance (present/absent), entering "
                    "savings contributions per member, adding discussion notes, saving meeting drafts for "
                    "interruption recovery, and completing and submitting the final meeting record. The practical "
                    "session simulates a full center meeting with 10-15 role-playing participants. Trainees "
                    "practice managing the attendance roll, recording varied savings amounts, and handling "
                    "interruptions (simulated phone calls, late arrivals). The module emphasizes the importance "
                    "of accurate attendance recording for institutional reporting and the savings tracking "
                    "workflow. Draft saving and recovery is practiced to prepare for real-world interruptions. "
                    "Assessment: Trainee must facilitate a simulated center meeting with at least 8 members, "
                    "recording attendance and savings for all members, saving one draft, and completing the "
                    "meeting record with zero errors."
                ),
            },
            {
                "heading": "Module 6: End-of-Day Reporting (Self-Paced, 30 min)",
                "content": (
                    "Module 6 covers the daily closing procedure. Learning objectives include: understanding the "
                    "EOD report structure and sections, reviewing daily activity summaries (visits, collections, "
                    "meetings, PTP records), adding supplementary notes, saving drafts vs final submission, "
                    "understanding the EOD sync trigger, and knowing the consequences of missed EOD submissions. "
                    "The self-paced module includes a video walkthrough of the complete EOD process followed by "
                    "interactive exercises where trainees review sample daily data and submit practice EOD reports. "
                    "The module explains that EOD submission triggers automatic data synchronization and that "
                    "duplicate submissions for the same date are prevented by the system. Assessment: Trainee must "
                    "review a provided daily activity dataset, identify any discrepancies, add appropriate notes, "
                    "and submit the EOD report correctly. The module also covers what to do when the day's data "
                    "appears incomplete or contains errors."
                ),
            },
            {
                "heading": "Module 7: Security and Privacy (Self-Paced, 20 min)",
                "content": (
                    "Module 7 covers the security features and privacy responsibilities of FieldOS users. "
                    "Learning objectives include: understanding PIN and biometric authentication, knowing the "
                    "audit logging system and what actions are tracked, understanding data privacy obligations "
                    "under NRB guidelines, proper handling of client financial information, device security "
                    "best practices (screen lock, app logout), and procedures for reporting lost or stolen "
                    "devices. The module presents real-world scenarios where security awareness prevents data "
                    "breaches: sharing devices with unauthorized persons, leaving the app unlocked unattended, "
                    "discussing client financial details in public spaces, and taking screenshots of client data. "
                    "Assessment: Trainee must answer 10 multiple-choice questions covering security policies, "
                    "privacy obligations, and incident reporting procedures, achieving a minimum score of 80%. "
                    "The module emphasizes that every action in the app is logged and that field officers are "
                    "personally responsible for the security of client data accessed through their device."
                ),
            },
            {
                "heading": "Module 8: Dashboard for Branch Managers (In-Person, 120 min)",
                "content": (
                    "Module 8 is exclusively for branch managers and covers the web dashboard interface. "
                    "Learning objectives include: navigating the dashboard layout and all view types, "
                    "understanding KPI cards and trend indicators, reviewing staff activity and performance "
                    "metrics, monitoring collections and CBS posting status, managing the exception queue "
                    "(overdue clients, failed syncs, missing visits), reviewing EOD reports and flagging "
                    "discrepancies, tracking PAR follow-up items, monitoring sync status across devices, "
                    "and accessing audit logs for compliance review. The extended 2-hour session provides "
                    "hands-on practice with a demo dataset that includes realistic branch operations data. "
                    "Managers practice filtering, sorting, and drilling into specific officers or clients. "
                    "The module covers how to interpret AI-generated suggestions and priority queues, "
                    "emphasizing that these are decision-support tools, not automated actions. Assessment: "
                    "Manager must demonstrate proficiency in navigating all dashboard views, interpreting "
                    "KPI data correctly, identifying at least 3 issues from a sample dataset, and explaining "
                    "the appropriate follow-up action for each."
                ),
            },
        ],
    }
    return ApiResponse(success=True, data=doc, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 17. GET /pilot/documents/role-access-matrix
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/documents/role-access-matrix", response_model=ApiResponse)
async def get_doc_role_access_matrix(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns the Role Access Matrix document with detailed permissions
    for all 4 roles across every system feature.
    """
    doc = {
        "title": "FieldOS Nepal — Role Access Matrix",
        "version": "1.0",
        "last_updated": "2025-05-01",
        "sections": [
            {
                "heading": "Role Definitions",
                "content": (
                    "FieldOS Nepal implements a four-tier role hierarchy designed to match the organizational "
                    "structure of Nepali microfinance institutions. The Field Officer (FO) is the most granular "
                    "role, representing the front-line staff who visit clients, collect payments, and facilitate "
                    "center meetings. Field officers access the system exclusively through the mobile application "
                    "and their data access is strictly limited to their own assigned clients and tasks. The "
                    "Branch Manager (BM) role represents the supervisory level at individual branch offices. "
                    "Branch managers access the system through the web dashboard and can view all operational "
                    "data for their assigned branch, including all field officers, clients, collections, and "
                    "audit logs within the branch. The Area Manager (AM) role provides regional oversight, "
                    "allowing managers to view aggregated data across multiple branches without the ability to "
                    "drill into individual officer-level details outside their region. The System Administrator "
                    "(Admin) has full access to all system features including user management, device management, "
                    "security configuration, and cross-branch data access. Role assignments are managed centrally "
                    "by administrators and cannot be modified by users."
                ),
            },
            {
                "heading": "Mobile Application Features",
                "content": (
                    "Access to mobile application features is governed by the following role permissions. "
                    "Login and Authentication: All roles can authenticate, but only FO and Admin use the mobile "
                    "app directly (BM and AM use the web dashboard). Daily Start Day: FO only — marks the "
                    "beginning of field activities. Client Task List: FO sees only their assigned tasks; other "
                    "roles do not access mobile tasks. Client Visit Check-in: FO has full create access; BM/AM "
                    "have read-only access through the dashboard. Collection Recording: FO has full create access; "
                    "BM/AM have read-only review access. Promise-to-Pay: FO creates PTP records; BM/AM view "
                    "and manage PTP follow-ups. Center Meeting: FO facilitates meetings and records data; BM "
                    "reviews meeting summaries. End-of-Day Report: FO submits; BM reviews and can flag "
                    "discrepancies. Sync Center: FO manages their own sync queue; BM monitors sync status across "
                    "all branch devices. Profile and Settings: All mobile users can update their own profile "
                    "preferences including language selection and notification settings."
                ),
            },
            {
                "heading": "Manager Dashboard Features",
                "content": (
                    "The web dashboard provides the following access control by role. Field Officers have no "
                    "dashboard access — their data is input-only through the mobile app. Branch Managers have "
                    "full access to their branch dashboard including: real-time KPI cards showing daily collection "
                    "totals, PAR rate, and visit completion rate; staff activity view showing individual officer "
                    "performance; today's visits map with GPS check-in visualization; collections report with "
                    "CBS posting status; PAR follow-up queue with overdue client prioritization; PTP due today "
                    "list; exception queue highlighting failed syncs, missing visits, and amount discrepancies; "
                    "EOD review panel for submitted daily reports; sync monitoring for all branch devices; and "
                    "audit log viewer with filtering capabilities. Area Managers see the same dashboard structure "
                    "but with data aggregated across all their assigned branches, with drill-down limited to "
                    "branch-level summaries (not individual officers). Administrators have unrestricted access "
                    "to all dashboard data across all branches."
                ),
            },
            {
                "heading": "CBS Integration Permissions",
                "content": (
                    "CBS integration features have the most restrictive access controls due to the financial "
                    "sensitivity of the data. Field Officers have no direct access to CBS features — they see "
                    "CBS verification status on their receipts but cannot interact with the CBS system. Branch "
                    "Managers have full CBS access within their branch including: viewing CBS import history and "
                    "data freshness, viewing CBS client details with loan schedules, checking PAR status summaries, "
                    "accessing the reconciliation queue to review collection posting discrepancies, approving or "
                    "rejecting individual reconciliation items, performing bulk approval of low-risk reconciliations, "
                    "and submitting CBS posting corrections. Area Managers have read-only access to CBS data "
                    "across their branches for monitoring purposes — they can view PAR trends and reconciliation "
                    "statistics but cannot approve or reject individual items. Administrators have full CBS access "
                    "including triggering manual CBS imports, configuring import schedules, and accessing "
                    "cross-branch CBS data for institutional reporting."
                ),
            },
            {
                "heading": "Security and Administration",
                "content": (
                    "Security and administrative features are exclusively available to administrator-level roles. "
                    "Device Management: Admins can view all registered devices, revoke device access, and restore "
                    "previously revoked devices. BM and AM have read-only access to device lists within their "
                    "scope. Threat Model and Security Documentation: BM and AM have read access; Admin has full "
                    "access including modification rights. Audit Log Export: BM exports branch-level audit logs; "
                    "AM exports regional logs; Admin exports institution-wide logs. Privacy Policy and Compliance "
                    "Status: BM and AM have read access; Admin manages policies and compliance configurations. "
                    "Penetration Test Results and Dependency Scans: Admin only. User Management (create, modify, "
                    "deactivate users): Admin only. Role Assignment Changes: Admin only — role changes require "
                    "dual authorization from two administrators for security. System Configuration (rate limits, "
                    "sync intervals, GPS thresholds): Admin only. Pilot Management (agreements, milestones, "
                    "metrics): BM (read), AM (read), Admin (full). This layered access ensures that operational "
                    "staff cannot modify security configurations while giving managers visibility into system health."
                ),
            },
            {
                "heading": "Permission Summary Table",
                "content": (
                    "The following summarizes the permission levels across all major feature groups. "
                    "Authentication (Login): FO=Full, BM=Full, AM=Full, Admin=Full. Device Registration: "
                    "FO=Full, BM=ReadOnly, AM=ReadOnly, Admin=Full. Mobile Bootstrap: FO=OwnData, BM=None, "
                    "AM=None, Admin=OwnData. Sync Operations: FO=Full, BM=ReadOnly, AM=ReadOnly, Admin=Full. "
                    "Task Management: FO=OwnTasks, BM=BranchTasks, AM=RegionTasks, Admin=All. Client Data: "
                    "FO=AssignedClients, BM=BranchClients, AM=RegionClients, Admin=All. Field Operations "
                    "(Collections, Visits, PTP, Meetings, EOD): FO=Create, BM=Review, AM=Review, Admin=Review. "
                    "Audit Logs: FO=OwnLogs, BM=BranchLogs, AM=RegionLogs, Admin=All. Manager Dashboard: "
                    "FO=None, BM=BranchView, AM=RegionView, Admin=All. CBS Integration: FO=None, BM=Full, "
                    "AM=ReadOnly, Admin=Full. AI Intelligence: FO=None, BM=Full, AM=Full, Admin=Full. "
                    "Security Administration: FO=None, BM=ReadOnly, AM=ReadOnly, Admin=Full. Pilot Management: "
                    "FO=None, BM=ReadOnly, AM=ReadOnly, Admin=Full."
                ),
            },
        ],
    }
    return ApiResponse(success=True, data=doc, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 18. GET /pilot/documents/escalation-plan
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/documents/escalation-plan", response_model=ApiResponse)
async def get_doc_escalation_plan(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns the Support Escalation Plan with L1/L2/L3 tiers,
    timelines, SLAs, and contact directory.
    """
    doc = {
        "title": "FieldOS Nepal — Support Escalation Plan",
        "version": "1.0",
        "last_updated": "2025-05-01",
        "sections": [
            {
                "heading": "Support Tiers Overview",
                "content": (
                    "The FieldOS Nepal support structure operates on a three-tier model designed to resolve issues "
                    "efficiently while ensuring that complex problems receive appropriate expert attention. Level 1 "
                    "(L1) Support is the first point of contact, staffed by trained support agents at the branch "
                    "level who can handle common issues such as app navigation questions, basic troubleshooting "
                    "(app restart, cache clear, re-login), password resets, and training refresher questions. "
                    "Level 2 (L2) Support handles technical issues that require deeper investigation, including "
                    "sync failures, GPS errors, CBS posting discrepancies, device compatibility issues, and "
                    "data inconsistency problems. L2 is staffed by the IT Support team at the head office. "
                    "Level 3 (L3) Support addresses critical system issues that require development team "
                    "involvement, including application bugs causing data loss, security vulnerabilities, "
                    "performance degradation affecting multiple branches, and integration failures with CBS. "
                    "Each tier has defined escalation criteria, response times, and communication channels to "
                    "ensure issues are tracked and resolved within SLA targets."
                ),
            },
            {
                "heading": "Escalation Timelines and SLAs",
                "content": (
                    "Response and resolution times are defined based on issue severity and support tier. "
                    "Critical severity (system down, data loss, security breach): L1 acknowledgment within 15 "
                    "minutes, escalation to L2 within 30 minutes, L3 engagement within 2 hours, target resolution "
                    "within 4 hours. High severity (functionality broken for multiple users, CBS posting failures, "
                    "sync failures affecting a branch): L1 acknowledgment within 30 minutes, escalation to L2 "
                    "within 1 hour, L3 engagement within 4 hours, target resolution within 8 hours. Medium "
                    "severity (individual user issues, intermittent errors, non-critical bugs): L1 acknowledgment "
                    "within 2 hours, escalation to L2 within 4 hours if unresolved, target resolution within 24 "
                    "hours. Low severity (UI issues, feature requests, minor inconveniences): L1 acknowledgment "
                    "within 8 hours, target resolution within 72 hours or next scheduled release. SLA compliance "
                    "is tracked through the escalation system dashboard and reported weekly to the pilot "
                    "steering committee. Repeated SLA breaches trigger process review and resource reallocation."
                ),
            },
            {
                "heading": "Communication Channels",
                "content": (
                    "Multiple communication channels are established to ensure support requests reach the appropriate "
                    "team quickly. Level 1 communication uses Viber/WhatsApp groups established per branch, "
                    "allowing field officers to quickly reach L1 support agents with screenshots and descriptions. "
                    "A dedicated phone hotline (+977-1-XXXXXXX) is available for urgent issues during business "
                    "hours (10:00-17:00 NPT, Sunday-Friday). Level 2 communication uses a centralized Slack "
                    "channel (#fieldos-support) where IT Support team members monitor incoming issues. Email "
                    "(support@fieldosnepal.com) serves as the formal communication channel with automatic ticket "
                    "creation. Level 3 communication uses a separate Slack channel (#fieldos-dev) for development "
                    "team coordination, with critical issues escalated via phone call to the technical lead. "
                    "All communication channels are logged and linked to escalation tickets for traceability. "
                    "During the pilot period, daily standup calls at 09:00 NPT bring together L1, L2, and L3 "
                    "representatives to review open issues and coordinate on active escalations."
                ),
            },
            {
                "heading": "Escalation Procedures by Issue Type",
                "content": (
                    "Specific procedures are defined for common issue categories. For sync failures, the L1 agent "
                    "first verifies network connectivity, then checks the Sync Center in the app for error "
                    "details, attempts a manual sync trigger, and if unresolved, escalates to L2 with the sync "
                    "error code and device information. For CBS posting discrepancies, L1 notifies the branch "
                    "manager who verifies the collection amount against physical records. If the amounts match, "
                    "L2 checks the reconciliation queue and CBS posting logs. L3 is engaged if the issue is "
                    "systemic (affecting multiple postings). For device hardware issues (battery drain, GPS "
                    "inaccuracy, screen problems), L1 provides basic troubleshooting guidance. If the device is "
                    "malfunctioning, L2 coordinates device replacement from the spare device pool. For data "
                    "inconsistency (incorrect balances, missing records), L1 documents the specific discrepancy, "
                    "L2 investigates by comparing mobile, server, and CBS records, and L3 is engaged if a "
                    "systematic data corruption is suspected. For security incidents (lost device, unauthorized "
                    "access attempt, suspicious activity), L1 immediately notifies the branch manager, L2 "
                    "revokes the affected device if applicable, and L3 performs a security audit of affected "
                    "accounts."
                ),
            },
            {
                "heading": "Emergency Procedures",
                "content": (
                    "Emergency situations require immediate action outside normal escalation timelines. For a "
                    "confirmed data breach, the response protocol is: (1) Immediately revoke all affected devices "
                    "and user sessions, (2) Notify the pilot steering committee within 30 minutes, (3) Engage L3 "
                    "for forensic analysis, (4) Preserve all audit logs for investigation, (5) Notify affected "
                    "clients if PII was compromised, per NRB guidelines. For complete system outage affecting "
                    "all branches, field officers revert to manual paper-based operations using pre-distributed "
                    "paper forms, and all manual records are digitized upon system recovery. For a device theft "
                    "or loss, the officer immediately reports to the branch manager who contacts L2 for device "
                    "revocation. The officer's account is temporarily suspended until a replacement device is "
                    "provisioned. All data on the lost device is considered compromised, but server-side data "
                    "remains secure. Replacement devices from the spare pool are provisioned within 24 hours "
                    "with the officer's data restored through the bootstrap process."
                ),
            },
            {
                "heading": "Contact Directory",
                "content": (
                    "The following contact directory is maintained for the pilot period. L1 Support per Branch: "
                    "KTM Main — Ram Kumar (L1 Lead), Pokhara — Sita Basnet, Lalitpur — Hari Maharjan, "
                    "Bhaktapur — Gita Shrestha, Chitwan — Bijay Poudel. L2 IT Support Team: Team Lead — "
                    "Anil Sharma (anil.sharma@fieldosnepal.com), Members — Sanjeev Rai, Prakash Tamang, "
                    "Mina KC. L2 CBS Integration: Lead — Raju Pradhan (raju.pradhan@fieldosnepal.com), "
                    "Member — Srijana Thapa. L3 Development Team: Tech Lead — Bikash Karki "
                    "(bikash.karki@fieldosnepal.com), Mobile Dev — Saurav Jha, Backend Dev — Alisha Sharma, "
                    "QA Lead — Niraj Bhatta. Pilot Steering Committee: Project Manager — Deepak Bhatta, "
                    "IT Director — Saroj Koirala, Operations Director — Maya Gurung. Support Hotline: "
                    "+977-1-XXXXXXX (10:00-17:00 NPT, Sun-Fri). Emergency Hotline: +977-98XXXXXXXX "
                    "(24/7, emergencies only). Support Email: support@fieldosnepal.com. This directory is "
                    "updated weekly during the pilot period and distributed to all branch managers."
                ),
            },
        ],
    }
    return ApiResponse(success=True, data=doc, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 19. GET /pilot/documents/success-metrics
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/documents/success-metrics", response_model=ApiResponse)
async def get_doc_success_metrics(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns the Success Metrics Definition document.
    Covers each KPI, measurement methodology, data sources, targets, and review cadence.
    """
    doc = {
        "title": "FieldOS Nepal — Success Metrics Definition",
        "version": "1.0",
        "last_updated": "2025-05-01",
        "sections": [
            {
                "heading": "Metrics Framework Overview",
                "content": (
                    "The FieldOS Nepal pilot success is measured through 8 key performance indicators (KPIs) "
                    "organized across three dimensions: adoption metrics that measure how well staff are using "
                    "the system, efficiency metrics that measure operational improvements, and satisfaction "
                    "metrics that measure user experience quality. Each metric has a clearly defined target "
                    "that represents successful pilot performance, a measurement methodology explaining how the "
                    "metric is calculated, data sources indicating where the raw data originates, and a review "
                    "cadence specifying how often the metric is evaluated. Metrics are tracked from Week 1 of "
                    "the pilot, with initial expectations being lower as users adapt to the new system. Targets "
                    "ramp up progressively: Week 1-2 targets are 50% of full target, Week 3-4 targets are 75%, "
                    "and Week 5+ targets are at 100%. Weekly snapshots are captured every Saturday at 23:59 NPT "
                    "and compared against the progressive targets. The pilot is considered successful if at least "
                    "6 of 8 metrics achieve their Week 13 targets."
                ),
            },
            {
                "heading": "M1: Field Officer Daily Active Use (Target: 80%)",
                "content": (
                    "This metric measures the percentage of active field officers who log into and use the "
                    "FieldOS app at least once during each working day. A 'use' is defined as any authenticated "
                    "session with at least one field action (visit check-in, collection, PTP, meeting, or EOD "
                    "submission). The calculation is: (Number of unique FOs with activity on a given day / "
                    "Total active FOs assigned to pilot branches) x 100. Data sources include the audit log "
                    "(login events) and operational records (visit check-ins, collections, etc.). Exclusions "
                    "include officers on approved leave and officers whose devices are in for repair. The metric "
                    "is reviewed daily by branch managers and weekly in aggregate by the pilot steering committee. "
                    "A drop below 60% for any branch triggers an immediate investigation. This is the primary "
                    "adoption indicator — if officers are not using the app, other metrics become meaningless. "
                    "Common reasons for low scores include device issues, training gaps, or resistance to change."
                ),
            },
            {
                "heading": "M2: Visit Check-in Completion (Target: 70%)",
                "content": (
                    "This metric tracks the percentage of planned client visits that result in a successful GPS "
                    "check-in recorded in the system. The calculation is: (Number of visit check-ins with valid "
                    "GPS / Total planned client visits for the day) x 100. A planned visit is defined as any "
                    "client appearing in the officer's daily task list. Data sources include the task assignment "
                    "system (planned visits) and visit check-in records (completed visits). The 70% target "
                    "accounts for realistic field conditions where officers may not reach all planned clients due "
                    "to travel time, client unavailability, or route changes. Visits without GPS coordinates "
                    "are still counted if the officer provides a manual check-in with notes explaining the GPS "
                    "failure. The metric is reviewed daily by branch managers and weekly in aggregate. Trends "
                    "are analyzed to identify officers or branches consistently below target, indicating potential "
                    "training needs or geographic challenges. An upward trend over the pilot period indicates "
                    "improving adoption of the check-in workflow."
                ),
            },
            {
                "heading": "M3: Collection Entry Same-Day (Target: 75%)",
                "content": (
                    "This efficiency metric measures the percentage of total daily collections that are recorded "
                    "in FieldOS on the same day they are received from clients. The calculation is: (Total NPR "
                    "amount recorded in FieldOS on date D / Total NPR amount posted to CBS on date D or D+1) "
                    "x 100. The CBS posting date may be D+1 due to processing delays. Data sources include the "
                    "FieldOS collection records and CBS posting logs. Collections recorded on a subsequent day "
                    "(recorded on D+1 or later for a D collection) are counted as missed. This metric directly "
                    "measures whether field officers are transitioning from paper-based collection recording to "
                    "digital recording. A high percentage indicates successful workflow adoption. The target of "
                    "75% acknowledges that some collections, especially during center meetings with many clients, "
                    "may be batch-recorded after the meeting. The metric is reviewed daily by branch managers "
                    "who compare FieldOS collection totals against CBS posting confirmations. Discrepancies "
                    "are flagged for investigation."
                ),
            },
            {
                "heading": "M4-M6: Manager Dashboard, Phone Calls, and PTP Tracking",
                "content": (
                    "M4 (Dashboard Usage — Target: 5x/week) measures how frequently branch managers log into "
                    "the web dashboard, counting unique login sessions per week. Data source: dashboard audit "
                    "logs. Regular dashboard usage indicates that managers are leveraging the real-time visibility "
                    "provided by FieldOS for operational decision-making. M5 (Manager Phone Calls Reduced — "
                    "Target: 40% reduction) compares the number of inquiry phone calls from field officers to "
                    "branch managers during the pilot against a baseline measured in the 2 weeks before go-live. "
                    "Data source: manager self-reporting logs maintained before and during pilot. The hypothesis "
                    "is that FieldOS provides enough information through the app that officers need fewer phone "
                    "calls for routine queries. M6 (PTP Follow-up Completion — Target: 100% tracked) measures "
                    "the percentage of active PTP records that have a follow-up action recorded (fulfilled, "
                    "broken, or rescheduled) before or on the promised date. Data source: PTP records with "
                    "fulfillment status. This metric ensures that PTP records are not created and forgotten — "
                    "every promise must be tracked to completion."
                ),
            },
            {
                "heading": "M7-M8: Technical Performance and User Satisfaction",
                "content": (
                    "M7 (Offline Sync Success — Target: 95%) measures the percentage of sync events that are "
                    "successfully uploaded to the server on the first attempt. The calculation is: (Number of "
                    "sync events with status 'synced' on first attempt / Total sync events attempted) x 100. "
                    "Data source: sync queue records. Failed events that succeed on retry are counted as "
                    "successful for this metric. A sync success rate below 90% indicates network infrastructure "
                    "or application issues that need immediate attention. M8 (User Satisfaction — Target: 4.0/5) "
                    "is measured through the structured feedback form (9 questions) administered at Week 4, "
                    "Week 8, and Week 13 of the pilot. The metric is the average of Q1 (overall satisfaction) "
                    "responses across all respondents. Data source: feedback submission database. This is the "
                    "primary qualitative measure of pilot success — a score below 3.5 indicates significant "
                    "usability issues that must be addressed. Open-ended feedback (Q6-Q8) is analyzed thematically "
                    "to identify common pain points and improvement opportunities."
                ),
            },
            {
                "heading": "Data Collection and Reporting Cadence",
                "content": (
                    "Metrics data is collected through automated system processes and structured feedback "
                    "mechanisms. Automated metrics (M1-M4, M6-M7) are calculated daily from system logs and "
                    "stored in the metrics database. Weekly snapshots are generated every Saturday at 23:59 NPT, "
                    "aggregating the daily values into weekly summaries. The pilot steering committee reviews "
                    "weekly metrics every Monday morning in a dedicated review meeting. Monthly progress reports "
                    "compare cumulative performance against the pilot success criteria. Manager-reported metrics "
                    "(M5 phone call reduction) are collected through a simple weekly survey sent to all branch "
                    "managers every Friday. User satisfaction (M8) is collected through the in-app feedback form "
                    "at three points during the pilot: end of Week 4, end of Week 8, and end of Week 12. All "
                    "raw data is archived for post-pilot analysis and is available through the metrics export "
                    "functionality in the admin dashboard. Data quality checks run daily to identify anomalies "
                    "such as zero-activity days or sudden metric drops, triggering automated alerts to the "
                    "pilot coordinator."
                ),
            },
        ],
    }
    return ApiResponse(success=True, data=doc, timestamp=_ts())


# ═══════════════════════════════════════════════════════════════════════════════
# 20. GET /pilot/documents/feedback-form
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/documents/feedback-form", response_model=ApiResponse)
async def get_doc_feedback_form(
    _user: User = Depends(require_manager_or_admin),
):
    """
    Returns the Feedback Form Template document with instructions,
    submission guidelines, and privacy notice.
    """
    doc = {
        "title": "FieldOS Nepal — Feedback Form Template and Guidelines",
        "version": "1.0",
        "last_updated": "2025-05-01",
        "sections": [
            {
                "heading": "Purpose and Importance of Feedback",
                "content": (
                    "The FieldOS Nepal feedback system is a critical component of the pilot program, designed to "
                    "capture structured user experiences from both field officers and branch managers throughout "
                    "the 13-week pilot period. Your feedback directly influences the development priorities, "
                    "bug fixes, and user experience improvements implemented during and after the pilot. Every "
                    "response is reviewed by the pilot team, and common themes are prioritized in weekly "
                    "development sprints. The feedback form uses a mix of quantitative rating scales and "
                    "qualitative open-ended questions to capture both measurable satisfaction metrics and "
                    "detailed user perspectives. We encourage honest, constructive feedback — both positive "
                    "experiences and areas for improvement are equally valuable. Anonymous feedback is not "
                    "supported (we need to know your role and branch for contextual analysis), but all individual "
                    "responses are kept confidential and are never shared in a way that identifies individual "
                    "respondents to their managers or peers."
                ),
            },
            {
                "heading": "Form Structure and Questions",
                "content": (
                    "The feedback form consists of 9 questions organized in three sections. Section 1 — "
                    "Satisfaction Ratings (Q1-Q5): Five rating-scale questions measuring overall satisfaction "
                    "(Q1), ease of use (Q2), speed and performance (Q3), offline sync reliability (Q4), and "
                    "training quality (Q5). Each uses a 1-5 scale where 1 is Very Poor and 5 is Excellent. "
                    "Section 2 — Open Feedback (Q6-Q8): Three free-text questions asking what works well (Q6), "
                    "what needs improvement (Q7), and any bugs or issues encountered (Q8). These questions "
                    "allow detailed responses and are especially valuable for identifying specific pain points "
                    "and edge cases not captured by rating scales. Section 3 — Recommendation (Q9): A single "
                    "select question asking whether the respondent would recommend FieldOS to other microfinance "
                    "institutions, with five options ranging from 'Definitely' to 'Definitely not'. This serves "
                    "as the Net Promoter Score equivalent for the pilot program. The entire form takes approximately "
                    "5-7 minutes to complete."
                ),
            },
            {
                "heading": "Submission Guidelines",
                "content": (
                    "Feedback is collected at three scheduled points during the pilot: end of Week 4, end of "
                    "Week 8, and end of Week 12 (one week before pilot conclusion). Branch managers are "
                    "responsible for ensuring all field officers in their branch complete the feedback form "
                    "during each collection period. The form is accessible through the manager dashboard under "
                    "Pilot Management > Feedback. Alternatively, paper forms are available at each branch for "
                    "officers who prefer handwritten submissions — these are digitized by the L1 support team "
                    "within 48 hours. When completing the form, please provide thoughtful, specific responses. "
                    "For rating questions, consider your cumulative experience over the review period, not just "
                    "the most recent day. For open-text questions, include specific examples where possible — "
                    "e.g., instead of 'sync is slow', describe when and where you experience slow sync (branch "
                    "name, time of day, approximate data volume). For bug reports, include the device model, "
                    "app version (visible in Profile), and steps to reproduce the issue. Feedback submitted "
                    "after the collection deadline will still be recorded but may not be included in the "
                    "formal weekly analysis."
                ),
            },
            {
                "heading": "Privacy Notice and Data Usage",
                "content": (
                    "All feedback responses are collected and stored in compliance with the FieldOS Nepal "
                    "privacy policy and applicable NRB data protection guidelines. The following information "
                    "is captured with each feedback submission: respondent role (field officer or branch "
                    "manager), branch name or code, timestamp of submission, and the complete set of answers. "
                    "No personally identifiable information such as names, staff IDs, or device IDs is stored "
                    "with feedback records — responses are linked only to role and branch for aggregate analysis. "
                    "Feedback data is used exclusively for: (1) calculating satisfaction metrics (average "
                    "scores, recommendation rates), (2) identifying common themes and prioritizing development "
                    "work, (3) tracking satisfaction trends across the pilot period, and (4) informing the "
                    "pilot completion report. Individual responses are never shared with managers, peers, or "
                    "any party outside the pilot evaluation team. Aggregated results (branch-level and "
                    "institution-wide averages) are shared in weekly pilot review meetings. Feedback data is "
                    "retained for 12 months after pilot completion for longitudinal analysis, after which it "
                    "is permanently deleted. By submitting the feedback form, you consent to the collection "
                    "and use of your responses as described above."
                ),
            },
            {
                "heading": "How Feedback Drives Improvement",
                "content": (
                    "The feedback loop is designed to translate user input into tangible improvements within "
                    "the pilot period. The weekly analysis process works as follows: (1) All new feedback "
                    "responses are reviewed by the pilot coordinator within 24 hours of collection, "
                    "(2) Quantitative scores are aggregated by role, branch, and question, producing "
                    "trend comparisons against previous periods, (3) Qualitative responses are thematically "
                    "coded into categories (usability, performance, bugs, training, features), "
                    "(4) Top 5 improvement themes are presented at the Monday steering committee meeting, "
                    "(5) The development team allocates 30% of sprint capacity to addressing feedback-driven "
                    "items, (6) Resolved feedback items are communicated back to branches through the "
                    "weekly pilot newsletter. This ensures that field officers see their feedback leading to "
                    "real changes, encouraging continued engagement with the feedback process. Post-pilot, "
                    "the complete feedback analysis is included in the Pilot Completion Report submitted to "
                    "institution leadership, informing the decision on full-scale deployment."
                ),
            },
        ],
    }
    return ApiResponse(success=True, data=doc, timestamp=_ts())
